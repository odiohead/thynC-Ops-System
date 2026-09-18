import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { TICKET_STATUS_LABELS } from '@/lib/ticket-shared'
import { deviceConditionLabel } from '@/lib/deviceRegistryShared'
import type { TicketStatus } from '@prisma/client'
import { type AsPickupMethod,
  AS_CATEGORY_LABELS, AS_PICKUP_METHOD_LABELS, AS_SHIP_METHOD_LABELS, AS_DEST_TYPE_LABELS, AS_OUTCOME_LABELS, AS_TAGS, AS_TAG_FIELDS, AS_TAG_LABELS,
  type AsCategory, type AsMethod, type AsDestType, type AsOutcome,
} from '@/lib/asReceiptShared'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 타임라인 (2026-09-15) — 상세 하단 이력. 읽기 전용 합성(별도 테이블 없음):
 *  · audit_logs(resource=as_receipt, resource_id=asCode) — 등록·접수정보 수정(필드 diff)·입고처리·입고 확인·라인 최종확정·발송정보·원장 확정·완료·리오픈·수리완료/해제·폐기(2026-09-17)
 *  · ticket_logs(연결 티켓) — 생성·상태 전이·담당 배정·댓글
 * 최신순. 초안 저장(draft-lines)은 감사로그가 없어 나타나지 않는다(확정 시점만 이력).
 */
export interface AsTimelineEvent {
  id: string
  at: string
  actor: string | null
  source: 'audit' | 'ticket'
  title: string
  details: string[]
}

type Rec = Record<string, unknown>
const d10 = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : v == null ? '-' : String(v))
const str = (v: unknown) => (v == null || v === '' ? '-' : String(v))

/** 접수 헤더 필드 diff — before(existing, status 포함)·after(detailInclude) */
function diffHeader(before: Rec, after: Rec): string[] {
  const out: string[] = []
  const bs = (before.status as Rec | null)?.name, as_ = (after.status as Rec | null)?.name
  if (bs !== as_) out.push(`상태 ${str(bs)} → ${str(as_)}`)
  const cmp = (key: string, label: string, fmt: (v: unknown) => string = str) => {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) out.push(`${label} ${fmt(before[key])} → ${fmt(after[key])}`)
  }
  cmp('hospitalCode', '병원')
  cmp('category', '구분', (v) => AS_CATEGORY_LABELS[v as AsCategory] ?? str(v))
  cmp('receiptDate', '접수일', d10)
  cmp('reporterName', '고객명')
  cmp('pickupMethod', '수거방법', (v) => (v ? AS_PICKUP_METHOD_LABELS[v as AsPickupMethod] ?? String(v) : '-'))
  cmp('pickupTrackingNo', '수거 송장')
  cmp('pickedUpAt', '수거일', d10)
  cmp('receivedAt', '입고일', d10)
  cmp('destType', '발송지 구분', (v) => (v ? AS_DEST_TYPE_LABELS[v as AsDestType] ?? String(v) : '-'))
  cmp('destInfo', '발송지 정보')
  cmp('pickupDestDiffers', '회수지 상이', (v) => (v ? '예' : '아니오'))
  cmp('pickupDestInfo', '회수지 정보')
  cmp('expectedShipDate', '예상 출하일', d10)
  for (const t of AS_TAGS) cmp(AS_TAG_FIELDS[t], `태그 ${AS_TAG_LABELS[t]}`, (v) => (v ? '켬' : '끔'))
  if ((before.note ?? null) !== (after.note ?? null)) {
    const b = String(before.note ?? ''), a = String(after.note ?? '')
    // 비고 뒤에 이력 줄만 덧붙은 경우(입고처리 등 시스템 추가)는 별도 이벤트가 있으므로 생략
    if (!a.startsWith(b) || a.length <= b.length) out.push('비고 수정')
    else if (!b) out.push('비고 입력')
  }
  return out
}

function summarizeAudit(row: { id: number; action: string; resourceLabel: string | null; before: unknown; after: unknown; createdAt: Date; actorName: string | null }, asCode: string): AsTimelineEvent {
  const suffix = (row.resourceLabel ?? '').replace(asCode, '').trim()
  const after = (row.after ?? {}) as Rec
  const before = (row.before ?? {}) as Rec
  const warn = Array.isArray(after.warnings) && after.warnings.length ? [`경고 ${after.warnings.length}건`] : []
  const base = { id: `a${row.id}`, at: row.createdAt.toISOString(), actor: row.actorName, source: 'audit' as const }
  if (row.action === 'CREATE') return { ...base, title: '접수 등록', details: suffix ? [suffix] : [] }
  if (row.action === 'DELETE') return { ...base, title: '접수 삭제', details: [] }
  if (suffix === '입고처리') {
    const r = (k: string) => (Array.isArray(after[k]) ? (after[k] as string[]) : [])
    const details = [`입력 ${r('serials').length}대 · 정상입고 ${r('received').length}`]
    if (r('mismatch').length) details.push(`미입고 ${r('mismatch').length} (${r('mismatch').join(', ')})`)
    if (r('extra').length) details.push(`미식별입고 ${r('extra').length} (${r('extra').join(', ')})`)
    if (after.receivedAt) details.push(`입고일 ${d10(after.receivedAt)}`)
    return { ...base, title: '입고처리', details: [...details, ...warn] }
  }
  if (suffix.startsWith('입고 확인')) {
    const typeLabel: Record<string, string> = { REMAP: '시리얼 치환', MARK_RECEIVED: '정상입고 확정', NOT_RECEIVED: '미회수 종결', ACCEPT_EXTRA: '미식별입고 편입', DISCARD_EXTRA: '미식별입고 삭제' }
    const details: string[] = []
    if (after.comment) details.push(String(after.comment))
    if (after.autoCompleted) details.push("전 라인 종결 → '발송완료'")
    return { ...base, title: `입고 확인 — ${typeLabel[String(after.type)] ?? String(after.type ?? '')}`, details: [...details, ...warn] }
  }
  if (suffix === '라인 최종확정' || suffix === '라인 처리') {
    const details: string[] = []
    const lines = Array.isArray(after.lines) ? (after.lines as Rec[]) : []
    if (lines.length) {
      const byOutcome = new Map<string, number>()
      for (const l of lines) byOutcome.set(String(l.outcome), (byOutcome.get(String(l.outcome)) ?? 0) + 1)
      details.push(Array.from(byOutcome).map(([o, n]) => `${AS_OUTCOME_LABELS[o as AsOutcome] ?? o} ${n}대`).join(' · '))
    } else if (after.confirmed != null) {
      details.push(typeof after.confirmed === 'number' ? `${after.confirmed}대 확정` : Array.isArray(after.confirmed) ? `${after.confirmed.length}대 확정` : String(after.confirmed))
    }
    if (after.effectiveDate) details.push(`기준일 ${d10(after.effectiveDate)}`)
    if (after.autoCompleted) details.push("전 라인 종결 → '발송완료'")
    return { ...base, title: suffix === '라인 처리' ? '라인 처리 확정' : '라인 최종확정', details: [...details, ...warn] }
  }
  if (suffix === '발송정보 갱신') {
    const details: string[] = []
    if (after.shipMethod) details.push(AS_SHIP_METHOD_LABELS[after.shipMethod as AsMethod] ?? String(after.shipMethod))
    if (after.shipTrackingNo) details.push(`송장 ${after.shipTrackingNo}`)
    if (after.shippedAt) details.push(`발송일 ${d10(after.shippedAt)}`)
    details.push(`${str(after.updated)}대 적용`)
    return { ...base, title: '발송정보 갱신', details }
  }
  if (suffix === '원장 확정') {
    const kind: Record<string, string> = { created: '원장 신규 등록', reregistered: '재등록', transferred: '타병원에서 이관' }
    return { ...base, title: '원장 확정', details: [kind[String(after.kind)] ?? '', ...warn].filter(Boolean) }
  }
  if (suffix === '시리얼 보정') {
    const st: Record<string, string> = { ACTIVE_HERE: '원장 연결', ACTIVE_OTHER: '타병원 배치', RECOVERED: '회수 상태', NONE: '미등록' }
    return { ...base, title: `시리얼 보정 ${str(after.previousSerialNo)} → ${str(after.serialNo)}`, details: [`${st[String(after.state)] ?? ''}${after.modelName ? ` · ${after.modelName}` : ''}`, ...warn].filter(Boolean) }
  }
  // 수리완료 체크·해제·폐기 (2026-09-17 — 기기 상태·위치 축 §6.1) — after { itemId, serialNo, repaired, repairedAt, condition, warnings } / { itemId, serialNo, memo, condition, warnings }
  if (suffix === '수리완료' || suffix === '수리완료 해제') {
    const details: string[] = []
    if (suffix === '수리완료' && after.repairedAt) details.push(`수리완료일 ${d10(after.repairedAt)}`)
    if (after.condition) details.push(`기기 상태 ${deviceConditionLabel(String(after.condition))}`)
    return { ...base, title: `${suffix} — ${str(after.serialNo)}`, details: [...details, ...warn] }
  }
  if (suffix === '폐기') {
    const details: string[] = []
    if (after.memo) details.push(String(after.memo))
    return { ...base, title: `폐기 — ${str(after.serialNo)}`, details: [...details, ...warn] }
  }
  if (suffix === '기기등록 완료') return { ...base, title: '기기등록 완료 → 접수 완료', details: after.statusName ? [`상태 ${after.statusName}`] : [] }
  if (suffix === '리오픈') return { ...base, title: `리오픈${after.statusName ? ` → ${after.statusName}` : ''}`, details: after.reason ? [String(after.reason)] : [] }
  // 일반 수정 — 헤더 필드 diff
  const details = Object.keys(before).length && Object.keys(after).length ? diffHeader(before, after) : []
  return { ...base, title: details.length ? '접수 수정' : '접수 수정 (기기 라인)', details }
}

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const receipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  if (!receipt) return NextResponse.json({ error: 'AS접수를 찾을 수 없습니다.' }, { status: 404 })

  const [audits, logs] = await Promise.all([
    prisma.auditLog.findMany({
      where: { resource: 'as_receipt', resourceId: receipt.asCode },
      select: { id: true, action: true, resourceLabel: true, before: true, after: true, createdAt: true, actorName: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
    receipt.ticketId
      ? prisma.ticketLog.findMany({
          where: { ticketId: receipt.ticketId },
          select: { id: true, logType: true, payload: true, contentHtml: true, createdAt: true, author: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
          take: 500,
        })
      : Promise.resolve([]),
  ])

  const events: AsTimelineEvent[] = audits.map((a) => summarizeAudit(a, receipt.asCode))
  // 담당 배정 표기용 사용자 이름
  const userIds = new Set<string>()
  for (const l of logs) {
    if (l.logType !== 'assign') continue
    const p = (l.payload ?? {}) as Rec
    for (const k of ['from', 'to']) if (typeof p[k] === 'string') userIds.add(p[k] as string)
  }
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, name: true } }) : []
  const nameOf = (v: unknown) => (v == null ? '미배정' : users.find((u) => u.id === v)?.name ?? String(v))
  const sl = (v: unknown) => TICKET_STATUS_LABELS[v as TicketStatus] ?? String(v)
  for (const l of logs) {
    const p = (l.payload ?? {}) as Rec
    const base = { id: `t${l.id}`, at: l.createdAt.toISOString(), actor: l.author?.name ?? null, source: 'ticket' as const }
    switch (l.logType) {
      case 'created': events.push({ ...base, title: '티켓 생성', details: [] }); break
      case 'status_change': {
        // 도메인 동기화로 생긴 전이는 접수 상태 변경 이벤트와 중복이므로 자동 표기
        const details: string[] = []
        if (p.via === 'domain_sync' || p.auto) details.push('자동')
        if (p.pendingReason) details.push(`사유 ${p.pendingReason}${p.pendingNote ? ` — ${p.pendingNote}` : ''}`)
        events.push({ ...base, title: `티켓 상태 ${sl(p.from)} → ${sl(p.to)}`, details }); break
      }
      case 'assign': events.push({ ...base, title: `담당 ${nameOf(p.from)} → ${nameOf(p.to)}`, details: [] }); break
      case 'comment': events.push({ ...base, title: '티켓 댓글', details: [String(l.contentHtml ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)].filter(Boolean) }); break
      default: events.push({ ...base, title: `티켓 ${l.logType}`, details: [] })
    }
  }
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return NextResponse.json({ events })
}
