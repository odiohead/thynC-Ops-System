import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadToS3 } from '@/lib/s3'
import { parseFormEmail, buildNoteHtml } from '@/lib/gmail'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
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

  const planCode = `IP-${String(created.id).padStart(5, '0')}`

  const installPlan = await prisma.installPlan.update({
    where: { id: created.id },
    data: { planCode },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  })

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

  return NextResponse.json({ installPlan })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
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
