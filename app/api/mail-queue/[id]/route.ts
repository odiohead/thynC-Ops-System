import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notifyTaskEvent } from '@/lib/notify'
import { uploadToS3 } from '@/lib/s3'
import { parseFormEmail, buildNoteHtml } from '@/lib/gmail'
import { advanceHospitalStatus } from '@/lib/hospitalStatus'
import { auditActorFromJWT } from '@/lib/audit'
import { createTicketForInstallPlan } from '@/lib/ticketDomain'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isUserOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const id = parseInt(params.id, 10)
  const queueItem = await prisma.installPlanQueue.findUnique({ where: { id } })
  if (!queueItem) {
    return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })
  }
  if (queueItem.status === 'registered') {
    return NextResponse.json({ error: '이미 등록된 항목입니다.' }, { status: 409 })
  }

  const body = await request.json()
  const hospitalCode: string | null = body.hospitalCode || null

  // raw_body에서 전체 텍스트 추출 → Tiptap HTML로 변환
  const parsed = parseFormEmail(queueItem.rawBody)
  const note = buildNoteHtml(queueItem, parsed.fullText)

  const created = await prisma.installPlan.create({
    data: {
      hospitalCode,
      requestDate: queueItem.requestDate || new Date(),
      writeStatus: '미완료',
      replyStatus: '미완료',
      note,
    },
  })

  // planCode 생성: IP-YYYYMM-NNNNN (수동 등록과 동일한 포맷)
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const ipPrefix = `IP-${ym}-`
  const lastPlan = await prisma.installPlan.findFirst({
    where: { planCode: { startsWith: ipPrefix } },
    orderBy: { planCode: 'desc' },
    select: { planCode: true },
  })
  const ipSeq = lastPlan?.planCode ? parseInt(lastPlan.planCode.slice(-5)) + 1 : 1
  const planCode = `${ipPrefix}${String(ipSeq).padStart(5, '0')}`

  const installPlan = await prisma.installPlan.update({
    where: { id: created.id },
    data: { planCode },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  })

  // 티켓 동시 생성 (P8 편입 — 메일 인입 큐 = 티켓 생성 채널)
  await prisma.$transaction(async (tx) => {
    await createTicketForInstallPlan(tx, {
      id: installPlan.id,
      planCode,
      hospitalCode: installPlan.hospitalCode,
      hospitalName: installPlan.hospital?.hospitalName ?? installPlan.hospital?.hiraHospitalName ?? null,
      writeStatus: installPlan.writeStatus,
      replyStatus: installPlan.replyStatus,
      assigneeUserIds: [],
      createdAt: installPlan.createdAt,
      replyDate: null,
    }, authUser?.userId ?? null, 'domain')
  })

  // Slack 알림 (메일큐 자동등록) — best-effort
  notifyTaskEvent({ eventType: 'task_created', taskType: 'INSTALL_PLAN', refCode: planCode, autoRegistered: true }).catch(() => {})

  // 파일 링크가 있으면 다운로드 → S3 업로드 → InstallPlanFile 생성
  if (queueItem.fileUrl && hospitalCode) {
    try {
      const fileRes = await fetch(queueItem.fileUrl)
      if (fileRes.ok) {
        const contentType = fileRes.headers.get('content-type') || 'application/octet-stream'
        // 파일명: 메일 본문 > Content-Disposition > fallback
        let fileName = parsed.fileName || ''
        if (!fileName) {
          const disposition = fileRes.headers.get('content-disposition') || ''
          const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i)
          fileName = filenameMatch
            ? decodeURIComponent(filenameMatch[1])
            : `floor-plan_${planCode}.pdf`
        }

        const buffer = Buffer.from(await fileRes.arrayBuffer())
        const s3Key = `hospital/${hospitalCode}/install-plans/${planCode}/${Date.now()}_${fileName}`

        await uploadToS3(buffer, s3Key, contentType)

        await prisma.installPlanFile.create({
          data: {
            installPlanId: installPlan.id,
            fileCategory: 'FLOOR_PLAN',
            fileName,
            s3Key,
          },
        })
      }
    } catch (err) {
      console.error(`[mail-queue] 도면 파일 다운로드/업로드 실패 (queue id: ${id}):`, err)
    }
  }

  await prisma.installPlanQueue.update({
    where: { id },
    data: { status: 'registered', installPlanId: installPlan.id },
  })

  await advanceHospitalStatus({
    hospitalCode,
    targetStatus: '가견적요청',
    req: request,
    actor: auditActorFromJWT(authUser),
    source: '설치계획 메일큐 등록',
  })

  return NextResponse.json({ installPlan })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isUserOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const id = parseInt(params.id, 10)
  const queueItem = await prisma.installPlanQueue.findUnique({ where: { id } })
  if (!queueItem) {
    return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })
  }

  await prisma.installPlanQueue.update({
    where: { id },
    data: { status: 'ignored' },
  })

  return new NextResponse(null, { status: 204 })
}
