/**
 * VOC접수 어댑터 (cs_ticket_workflow_design.md §5) — 어댑터 SOP(§3.4)의 첫 적용 사례.
 * 연결 티켓(refType 'VOC')이 CS 마스터 티켓 — 하위 도메인 티켓(P3)의 parentId 대상.
 *
 * 워크플로 상태(VOC_STATUS): 접수 → 처리중 → 회신완료(RESOLVED, 자동 종결 배치 대상) → 종결 + 보류
 */
import { Prisma, TicketStatus } from '@prisma/client'
import { generateTicketCode, addTicketEvent } from '@/lib/ticket'
import { buildTicketDescription } from '@/lib/ticketCtiRules'
import { TICKET_DOMAIN_META } from './meta'
import type { TicketDomainAdapter } from './types'
import {
  STATUS_MAPPING_SELECT,
  getStatusMapping,
  mappedTicketStatus,
  pickDomainStatus,
  resolvePendingReasonId,
  resolveRuleWithFallback,
  bannerDate,
} from './shared'

// ── 상태 폴백 매핑 (매핑 컬럼 유실 시 전용 — 단일 소스는 status_codes.ticket_status) ──

/** VOC 상태명 → 티켓 상태 */
export function vocStatusToTicket(statusName: string | null, hasOwner: boolean): TicketStatus {
  switch (statusName) {
    case '처리중': return 'IN_PROGRESS'
    case '보류': return 'PENDING'
    case '회신완료': return 'RESOLVED'
    case '종결': return 'CLOSED'
    case '접수':
    default:
      return hasOwner ? 'ASSIGNED' : 'OPEN'
  }
}

/** 티켓 상태 → VOC 상태명 (역방향 이름 폴백 — 매핑 행 전무 환경) */
export function ticketStatusToVoc(status: TicketStatus): string {
  switch (status) {
    case 'IN_PROGRESS': return '처리중'
    case 'PENDING': return '보류'
    case 'RESOLVED': return '회신완료'
    case 'CLOSED': return '종결'
    default: return '접수'
  }
}

interface VocForTicket {
  id: number
  vocCode: string | null
  title: string
  hospitalCode: string | null
  hospitalName: string | null
  statusName: string | null
  statusId?: number | null // VOC_STATUS status_code id — 티켓 상태 매핑 컬럼 조회용
  vocTypeId?: number | null // VOC 분류 — 자동생성 규칙 조건 축
  content?: string | null // 내용 → 티켓 설명 자동 입력 소스
  receivedAt: Date | null
  resolvedAt: Date | null
  createdAt: Date
}

/** VOC용 티켓 생성 (POST 생성 경로·콜 승격 공용). 반환: ticketId */
export async function createTicketForVoc(
  tx: Prisma.TransactionClient,
  v: VocForTicket,
  actorId: string | null,
  via: 'domain' | 'backfill'
): Promise<number> {
  // 코드 폴백 없음(신규 도메인 — 규칙 시드가 전제). 규칙·CTI 기본 그룹·이름 폴백까지 전부 없으면 에러.
  const rule = await resolveRuleWithFallback(tx, 'VOC', () => Promise.resolve(null), {
    statusCodeId: v.vocTypeId ?? null,
  })
  if (!rule.queueId) throw new Error("Assignment Group 'CS'가 없습니다. seed-cs-masters.sql을 먼저 적용하세요.")

  // 담당 배정은 티켓이 단독 소유 (2026-08-15 개정) — 생성 시 미배정(OPEN), 배정은 티켓 UI에서
  const statusMap = await getStatusMapping(tx, v.statusId)
  const status = mappedTicketStatus(statusMap, false, () => vocStatusToTicket(v.statusName, false))

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    pendingReasonId = await resolvePendingReasonId(tx, statusMap?.ticketPendingReasonId, '기타')
    pendingNote = 'VOC 보류 (도메인 동기화)'
  }

  const ticketCode = await generateTicketCode(tx)
  const now = new Date()
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: `[VOC] ${v.title}`,
      descriptionHtml: rule.fillDescription
        ? buildTicketDescription({ refType: 'VOC', source: v.content, refCode: v.vocCode })
        : null,
      status,
      severity: 'SEV4',
      queueId: rule.queueId,
      ctiId: rule.ctiId,
      hospitalCode: v.hospitalCode,
      refType: 'VOC',
      pendingReasonId,
      pendingNote,
      createdAt: via === 'backfill' ? v.createdAt : undefined,
      statusChangedAt: via === 'backfill' ? v.createdAt : undefined,
      resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? v.resolvedAt ?? now : undefined,
      closedAt: status === 'CLOSED' ? v.resolvedAt ?? now : undefined,
    },
  })
  await addTicketEvent(tx, ticket.id, 'created', actorId, { via, refType: 'VOC', refCode: v.vocCode })
  await tx.vocReceipt.update({ where: { id: v.id }, data: { ticketId: ticket.id } })
  return ticket.id
}

/**
 * VOC 변경 → 티켓 동기화 (상태·분류(CTI)·제목·병원). VOC PUT 핸들러의 트랜잭션 안에서 호출.
 * 담당(owner·참여자)은 티켓 단독 소유 (2026-08-15 개정) — 여기서 건드리지 않는다.
 */
export async function syncVocToTicket(tx: Prisma.TransactionClient, vocId: number, actorId: string | null) {
  const v = await tx.vocReceipt.findUnique({
    where: { id: vocId },
    select: {
      id: true, ticketId: true, title: true, hospitalCode: true, resolvedAt: true, vocTypeId: true,
      status: { select: STATUS_MAPPING_SELECT },
    },
  })
  if (!v?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: v.ticketId } })
  if (!ticket) return

  const hasOwner = !!ticket.ownerId // owner 규칙 판정은 티켓 현재 배정 기준
  const nextStatus = mappedTicketStatus(v.status, hasOwner, () => vocStatusToTicket(v.status?.name ?? null, hasOwner))
  // VOC 분류 변경 → CTI 재동기화 (유지보수 장애유형과 동일 패턴 — 규칙 테이블 경유)
  const nextCti = (
    await resolveRuleWithFallback(tx, 'VOC', () => Promise.resolve(null), { statusCodeId: v.vocTypeId ?? null })
  ).ctiId

  const data: Prisma.TicketUncheckedUpdateInput = { title: `[VOC] ${v.title}`, hospitalCode: v.hospitalCode }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = v.resolvedAt ?? new Date(); data.closedAt = v.resolvedAt ?? new Date() }
    else if (nextStatus === 'RESOLVED') { data.resolvedAt = v.resolvedAt ?? new Date(); data.closedAt = null }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      data.pendingReasonId = await resolvePendingReasonId(tx, v.status?.ticketPendingReasonId, '기타')
      data.pendingNote = 'VOC 보류 (도메인 동기화)'
    } else { data.pendingReasonId = null; data.pendingNote = null }
    await addTicketEvent(tx, ticket.id, 'status_change', actorId, { from: ticket.status, to: nextStatus, via: 'domain_sync' })
  }
  if (nextCti && nextCti !== ticket.ctiId) {
    data.ctiId = nextCti
    await addTicketEvent(tx, ticket.id, 'cti_change', actorId, { from: ticket.ctiId, to: nextCti, via: 'domain_sync' })
  }
  await tx.ticket.update({ where: { id: ticket.id }, data })
}

/** 티켓 전이/배정 → VOC 역동기화 (상태·완료일만 — 담당은 티켓 단독 소유라 도메인 미러 없음) */
export async function syncTicketToVoc(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, pendingReasonId: true,
      voc: { select: { id: true, statusId: true, resolvedAt: true } },
    },
  })
  if (!ticket?.voc) return
  const v = ticket.voc

  const nextStatusId = await pickDomainStatus(tx, 'VOC_STATUS', v.statusId, ticket, ticketStatusToVoc(ticket.status))

  const data: Prisma.VocReceiptUncheckedUpdateInput = {}
  if (nextStatusId) {
    data.statusId = nextStatusId
    data.statusChangedAt = new Date()
  }
  // 완료일 백필은 상태 변경과 독립 — RESOLVED(회신완료)에서 keep-if-consistent로 상태가 유지된 채
  // 티켓만 CLOSED(자동 종결 등)되는 경로에서도 완료일이 기록되어야 한다 (리뷰 2026-08-15)
  if ((ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && !v.resolvedAt) data.resolvedAt = new Date()
  if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && v.resolvedAt) data.resolvedAt = null
  if (Object.keys(data).length) await tx.vocReceipt.update({ where: { id: v.id }, data })
}

// ── 어댑터 ────────────────────────────────────────────────────

interface VocBannerRel {
  id: number
  vocCode: string | null
  customerName: string | null
  receivedAt: Date | string | null
  channel: { name: string } | null
  vocType: { name: string } | null
}

export const vocAdapter: TicketDomainAdapter = {
  refType: 'VOC',
  meta: TICKET_DOMAIN_META.VOC,
  detailInclude: {
    voc: {
      select: {
        id: true, vocCode: true, customerName: true, receivedAt: true,
        channel: { select: { name: true } },
        vocType: { select: { name: true } },
      },
    },
  },
  syncTicketToDomain: syncTicketToVoc,
  buildLinkedWork(ticket) {
    const v = ticket.voc as VocBannerRel | null | undefined
    if (!v) return null
    return {
      refType: 'VOC',
      code: v.vocCode ?? `#${v.id}`,
      meta: [
        `고객 ${v.customerName || '-'}`,
        `분류 ${v.vocType?.name ?? '-'}`,
        `채널 ${v.channel?.name ?? '-'}`,
        `접수일 ${bannerDate(v.receivedAt)}`,
      ].join(' · '),
      href: TICKET_DOMAIN_META.VOC.detailHref({ id: v.id, code: v.vocCode }),
      linkLabel: 'VOC 상세로 이동 →',
    }
  },
}
