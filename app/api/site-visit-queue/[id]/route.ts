import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadToS3 } from '@/lib/s3'
import { parseFormEmail, buildNoteHtml } from '@/lib/gmail'
import { createCalendarEvent } from '@/lib/googleCalendar'
import { advanceHospitalStatus } from '@/lib/hospitalStatus'
import { auditActorFromJWT } from '@/lib/audit'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const id = parseInt(params.id, 10)
  const queueItem = await prisma.siteVisitQueue.findUnique({ where: { id } })
  if (!queueItem) {
    return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })
  }
  if (queueItem.status === 'registered') {
    return NextResponse.json({ error: '이미 등록된 항목입니다.' }, { status: 409 })
  }

  const body = await request.json()
  const hospitalCode: string | null = body.hospitalCode || null

  if (!hospitalCode) {
    return NextResponse.json({ error: '병원을 선택해주세요.' }, { status: 400 })
  }

  // raw_body에서 전체 텍스트 추출 → Tiptap HTML로 변환
  const parsed = parseFormEmail(queueItem.rawBody)
  const notes = buildNoteHtml(queueItem, parsed.fullText)

  // 접수 상태코드 조회
  const statusAccepted = await prisma.statusCode.findFirst({
    where: { category: 'SITE_VISIT', name: '접수' },
  })

  // SiteVisit 생성
  const created = await prisma.siteVisit.create({
    data: {
      hospitalCode,
      requestDate: queueItem.requestDate || new Date(),
      statusId: statusAccepted?.id ?? null,
      notes,
    },
  })

  // siteVisitCode 생성: VISIT-YYYYMM-NNNNN
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `VISIT-${ym}-`
  const last = await prisma.siteVisit.findFirst({
    where: { siteVisitCode: { startsWith: prefix } },
    orderBy: { siteVisitCode: 'desc' },
    select: { siteVisitCode: true },
  })
  const seq = last?.siteVisitCode ? parseInt(last.siteVisitCode.slice(-5)) + 1 : 1
  const siteVisitCode = `${prefix}${String(seq).padStart(5, '0')}`

  const siteVisit = await prisma.siteVisit.update({
    where: { id: created.id },
    data: { siteVisitCode },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  })

  // 파일 링크가 있으면 다운로드 → S3 업로드 → SiteVisitFile 생성
  if (queueItem.fileUrl) {
    try {
      const fileRes = await fetch(queueItem.fileUrl)
      if (fileRes.ok) {
        const contentType = fileRes.headers.get('content-type') || 'application/octet-stream'
        let fileName = parsed.fileName || ''
        if (!fileName) {
          const disposition = fileRes.headers.get('content-disposition') || ''
          const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i)
          fileName = filenameMatch
            ? decodeURIComponent(filenameMatch[1])
            : `floor-plan_${siteVisitCode}.pdf`
        }

        const buffer = Buffer.from(await fileRes.arrayBuffer())
        const s3Key = `site-visits/${hospitalCode}/floor-plan_${Date.now()}_${fileName}`

        await uploadToS3(buffer, s3Key, contentType)

        await prisma.siteVisitFile.create({
          data: {
            siteVisitId: siteVisit.id,
            fileCategory: 'FLOOR_PLAN',
            fileName,
            s3Key,
          },
        })
      }
    } catch (err) {
      console.error(`[site-visit-queue] 도면 파일 다운로드/업로드 실패 (queue id: ${id}):`, err)
    }
  }

  // Task 레코드 생성
  const taskPrefix = `TASK-${ym}-`
  const lastTask = await prisma.task.findFirst({
    where: { taskCode: { startsWith: taskPrefix } },
    orderBy: { taskCode: 'desc' },
    select: { taskCode: true },
  })
  const taskSeq = lastTask?.taskCode ? parseInt(lastTask.taskCode.slice(-5)) + 1 : 1
  const taskCode = `${taskPrefix}${String(taskSeq).padStart(5, '0')}`

  await prisma.task.create({
    data: {
      taskCode,
      taskType: 'SITE_VISIT',
      refCode: siteVisitCode,
      hospitalCode,
      title: `${siteVisit.hospital.hospitalName ?? siteVisit.hospital.hiraHospitalName ?? ''} 답사`,
    },
  })

  // Google Calendar 이벤트 생성 (비차단)
  if (siteVisit.visitDate) {
    const hospitalName = siteVisit.hospital.hospitalName ?? siteVisit.hospital.hiraHospitalName ?? ''
    const eventId = await createCalendarEvent('site-visit', {
      summary: `[답사] ${hospitalName}`,
      description: `답사 코드: ${siteVisitCode}`,
      startDate: siteVisit.visitDate,
    })
    if (eventId) {
      await prisma.siteVisit.update({
        where: { id: siteVisit.id },
        data: { calendarEventId: eventId },
      })
    }
  }

  // 큐 상태 업데이트
  await prisma.siteVisitQueue.update({
    where: { id },
    data: { status: 'registered', siteVisitId: siteVisit.id },
  })

  await advanceHospitalStatus({
    hospitalCode,
    targetStatus: '답사요청',
    req: request,
    actor: auditActorFromJWT(authUser),
    source: '답사 메일큐 등록',
  })

  return NextResponse.json({ siteVisit })
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
  const queueItem = await prisma.siteVisitQueue.findUnique({ where: { id } })
  if (!queueItem) {
    return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })
  }

  await prisma.siteVisitQueue.update({
    where: { id },
    data: { status: 'ignored' },
  })

  return new NextResponse(null, { status: 204 })
}
