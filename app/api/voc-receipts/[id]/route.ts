import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { sanitizeRichTextHtml } from '@/lib/richtext'
import { syncVocToTicket } from '@/lib/ticket-domains/voc'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const detailInclude = {
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  channel: { select: { id: true, name: true, color: true } },
  vocType: { select: { id: true, name: true, color: true } },
  status: { select: { id: true, name: true, color: true } },
  createdBy: { select: { id: true, name: true } },
  ticket: {
    select: {
      id: true, ticketCode: true, status: true, parentId: true,
      owner: { select: { id: true, name: true } },
      children: {
        select: { id: true, ticketCode: true, title: true, status: true, severity: true, refType: true, ownerId: true },
        orderBy: { id: 'asc' as const },
      },
    },
  },
} as const

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const vocReceipt = await prisma.vocReceipt.findUnique({ where: { id }, include: detailInclude })
  if (!vocReceipt) return NextResponse.json({ error: 'VOC 접수를 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ vocReceipt })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.vocReceipt.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'VOC 접수를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()

  async function statusCodeOf(category: string, idVal: unknown, label: string): Promise<number | null> {
    if (idVal === null || idVal === '') return null
    const n = Number(idVal)
    if (!Number.isFinite(n)) throw new Error(`${label}이(가) 올바르지 않습니다.`)
    const row = await prisma.statusCode.findFirst({ where: { id: n, category }, select: { id: true } })
    if (!row) throw new Error(`${label}이(가) 올바르지 않습니다.`)
    return row.id
  }

  const data: Record<string, unknown> = {}
  try {
    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })
      data.title = title
    }
    if (body.hospitalCode !== undefined) {
      if (typeof body.hospitalCode === 'string' && body.hospitalCode) {
        const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: body.hospitalCode }, select: { hospitalCode: true } })
        if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 400 })
        data.hospitalCode = hospital.hospitalCode
      } else data.hospitalCode = null
    }
    if (body.hospitalNameRaw !== undefined) data.hospitalNameRaw = typeof body.hospitalNameRaw === 'string' && body.hospitalNameRaw.trim() ? body.hospitalNameRaw.trim() : null
    if (body.customerName !== undefined) data.customerName = typeof body.customerName === 'string' && body.customerName.trim() ? body.customerName.trim() : null
    if (body.customerPhone !== undefined) data.customerPhone = typeof body.customerPhone === 'string' && body.customerPhone.trim() ? body.customerPhone.trim() : null
    if (body.channelId !== undefined) data.channelId = await statusCodeOf('VOC_CHANNEL', body.channelId, '접수 채널')
    if (body.vocTypeId !== undefined) data.vocTypeId = await statusCodeOf('VOC_TYPE', body.vocTypeId, 'VOC 분류')
    if (body.statusId !== undefined) {
      const sid = await statusCodeOf('VOC_STATUS', body.statusId, '상태')
      data.statusId = sid
      // 상태 실변경 시 단계 진입 시각 기록 (기존 도메인 패턴)
      if (sid !== existing.statusId) {
        data.statusChangedAt = new Date()
        // 완료일 자동 관리 — 종결 버킷(RESOLVED/CLOSED 매핑) 진입 시 기록, 이탈 시 해제 (명시 전달이 없을 때만)
        if (body.resolvedAt === undefined) {
          const mapping = sid ? await prisma.statusCode.findUnique({ where: { id: sid }, select: { ticketStatus: true } }) : null
          const terminal = mapping?.ticketStatus === 'RESOLVED' || mapping?.ticketStatus === 'CLOSED'
          if (terminal && !existing.resolvedAt) data.resolvedAt = new Date()
          if (!terminal && existing.resolvedAt) data.resolvedAt = null
        }
      }
    }
    if (body.content !== undefined) data.content = typeof body.content === 'string' && body.content.trim() ? body.content.trim() : null
    if (body.resolution !== undefined) {
      data.resolution = typeof body.resolution === 'string' && body.resolution ? sanitizeRichTextHtml(body.resolution) : null
    }
    if (body.receivedAt !== undefined) {
      // null 금지 (필수 컬럼) — new Date(null)이 epoch로 통과하는 것도 여기서 차단
      const d = body.receivedAt ? new Date(body.receivedAt) : new Date(NaN)
      if (isNaN(d.getTime())) return NextResponse.json({ error: '접수 일시가 올바르지 않습니다.' }, { status: 400 })
      data.receivedAt = d
    }
    if (body.resolvedAt !== undefined) {
      if (body.resolvedAt) {
        const d = new Date(body.resolvedAt)
        if (isNaN(d.getTime())) return NextResponse.json({ error: '완료일이 올바르지 않습니다.' }, { status: 400 })
        data.resolvedAt = d
      } else data.resolvedAt = null
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  await prisma.vocReceipt.update({ where: { id }, data })

  // 티켓 동기화 (상태·분류·제목·병원 — 어댑터 경유, 규칙 3. 담당은 티켓 단독 소유)
  await prisma.$transaction(async (tx) => {
    await syncVocToTicket(tx, id, user.userId)
  })

  const vocReceipt = await prisma.vocReceipt.findUnique({ where: { id }, include: detailInclude })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'voc_receipt',
    resourceId: existing.vocCode,
    resourceLabel: `${existing.vocCode} ${vocReceipt?.title ?? ''}`,
    before: existing,
    after: vocReceipt,
  })

  if (existing.ticketId) {
    syncTicketClocksSafe(existing.ticketId)
    notifyTicketChanged({ ticketId: existing.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }

  return NextResponse.json({ vocReceipt })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.vocReceipt.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'VOC 접수를 찾을 수 없습니다.' }, { status: 404 })

  await prisma.vocReceipt.delete({ where: { id } })

  // 연결 티켓도 삭제 (도메인과 생명주기 공유 — 유지보수 P5 선례). 콜기록 ticket_id는 FK SetNull로 자동 해제
  if (existing.ticketId) {
    await prisma.ticket.delete({ where: { id: existing.ticketId } }).catch(() => {})
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'voc_receipt',
    resourceId: existing.vocCode,
    resourceLabel: `${existing.vocCode} ${existing.title}`,
    before: existing,
  })

  return NextResponse.json({ success: true })
}
