import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { intakeAsLines, AsServiceError } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { notifyTicketChanged, notifyDomainEvent } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 입고처리 (2026-09-11 — as_work_design.md §14)
 * POST { serials: string[] | serialsText: string, receivedAt?, checkedAt? }
 * 실물 시리얼을 접수 라인과 대조: 일치 → 정상입고, 접수됐으나 없음 → 미입고, 접수에 없음 → 미식별입고 라인. 누적 실행 가능.
 * 헤더 입고일(최초)·확인일 갱신, 상태 '입고' 자동(이전 단계일 때). 권한: USER 이상 전원
 * 2026-10-14: 화면은 '입고확인일' 하나만 보냄(receivedAt) — checkedAt 미지정 시 서비스가 입고일과 같은 날짜로 기록(시트 O열 역기입 유지)
 * 2026-09-17: 정상입고 라인의 기기는 센터 입고(INTAKE — AS_WAITING·리프레시센터). 종결 접수는 선교체(REPLACE·미입고) 라인만 사후 입고 허용(§7.3 조건부 완화)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()
  const serials: string[] = Array.isArray(body.serials)
    ? body.serials.map(String)
    : typeof body.serialsText === 'string' ? body.serialsText.split(/[\r\n,]+/) : []

  let result
  try {
    result = await intakeAsLines(id, { userId: user.userId, name: user.name }, {
      serials,
      receivedAt: typeof body.receivedAt === 'string' ? body.receivedAt : null,
      checkedAt: typeof body.checkedAt === 'string' ? body.checkedAt : null,
    })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e) // RegistryError·RegistryTxAbort(2026-09-17) 공통
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true, hospital: { select: { hospitalName: true } } } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 입고처리`,
    after: { serials, receivedAt: body.receivedAt, checkedAt: body.checkedAt, ...result },
  })
  if (asReceipt?.ticketId) {
    syncTicketClocksSafe(asReceipt.ticketId)
    notifyTicketChanged({ ticketId: asReceipt.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
    // 도메인 이벤트 'AS 입고확인' (2026-10-27 domain_event_notify_design.md §2.3) — 실행 1회 = 알림 1건, 채널·조건은 알림 설정 > 이벤트
    const shown = result.received.slice(0, 10).join(', ') + (result.received.length > 10 ? ` 외 ${result.received.length - 10}대` : '')
    const warn = [result.mismatch.length ? `미입고(접수됐으나 없음) ${result.mismatch.length}대: ${result.mismatch.slice(0, 5).join(', ')}` : '', result.extra.length ? `미식별 입고(접수에 없음) ${result.extra.length}대: ${result.extra.slice(0, 5).join(', ')}` : ''].filter(Boolean).join(' / ')
    notifyDomainEvent({
      event: 'AS_INTAKE_CONFIRMED', ticketId: asReceipt.ticketId, actorName: user.name,
      title: `${asReceipt.hospital?.hospitalName ?? ''} · ${asReceipt.asCode}`,
      fields: [
        { label: '입고 기기', value: result.received.length ? `${result.received.length}대 (${shown})` : '0대' },
        { label: '입고확인일', value: typeof body.receivedAt === 'string' && body.receivedAt ? body.receivedAt : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) },
        { label: '상태', value: result.statusChanged ? "'입고'로 변경" : '' },
      ],
      warning: warn || null,
      link: `/as-receipts/${id}`,
    }).catch(() => {})
  }
  return NextResponse.json({ success: true, ...result })
}
