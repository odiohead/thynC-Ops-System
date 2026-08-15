/**
 * 도메인 ↔ 티켓 동기화 — 어댑터 레지스트리 파사드 (P0 리팩토링, cs_ticket_workflow_design.md §3)
 *
 * 도메인별 생성·동기화 로직은 lib/ticket-domains/<domain>.ts 어댑터로 이관되었다.
 * 이 파일은 기존 import 경로 호환을 위한 재-export + 도메인 무관 배치(runTicketAutoClose)만 유지한다.
 * 새 코드는 lib/ticket-domains/registry.ts 를 직접 사용해도 된다.
 *
 * 원칙 (ticket_dev_schedule.md P5 상세 설계 · P11 개정):
 * - 각 API 핸들러가 한 트랜잭션에서 양쪽을 갱신한다 (DB 트리거 없음 → 루프 없음)
 * - Slack 알림은 P11부터 티켓 레이어 단일 파이프라인(lib/notify.ts notifyTicket*) —
 *   도메인 라우트는 mutation 후 notifyTicketCreated/notifyTicketChanged만 호출한다
 */
import { prisma } from '@/lib/prisma'
import { addTicketEvent } from '@/lib/ticket'
import { syncTicketToDomain } from './ticket-domains/registry'

// ── 어댑터 재-export (기존 호출부 호환 — 시그니처 불변) ─────────
export {
  maintStatusToTicket,
  ticketStatusToMaint,
  priorityToSeverity,
  severityToPriority,
  maintTypeToCtiId,
  maintenanceQueueId,
  createTicketForMaintenance,
  syncMaintenanceToTicket,
  syncTicketToMaintenance,
} from './ticket-domains/maintenance'
export {
  createTicketForEtcTask,
  syncEtcTaskToTicket,
  syncTicketToEtcTask,
} from './ticket-domains/etcTask'
export {
  siteVisitStatusToTicket,
  ticketStatusToSiteVisit,
  createTicketForSiteVisit,
  syncSiteVisitToTicket,
  syncTicketToSiteVisit,
} from './ticket-domains/siteVisit'
export {
  installPlanStatusToTicket,
  installPlanNameToTicket,
  ticketStatusToInstallPlanName,
  createTicketForInstallPlan,
  syncInstallPlanToTicket,
  syncTicketToInstallPlan,
} from './ticket-domains/installPlan'
export {
  projectStatusToTicket,
  createTicketForProject,
  syncProjectToTicket,
  syncTicketToProject,
} from './ticket-domains/project'
export { syncTicketToDomain } from './ticket-domains/registry'

/**
 * RESOLVED → CLOSED 자동 확정 배치 (P2 부속 규칙의 P11 이행 — AWS 관례).
 * AppSetting `ticket_auto_close_days`(기본 0=미사용) 경과한 RESOLVED 티켓을 종결.
 * notify-scheduler 주기(run)에서 호출. 열린 서브 티켓이 있으면 스킵(마스터 규칙).
 * Slack 미발송(타임라인 이벤트만) — CLOSED는 터미널이라 sig 정체 무해.
 */
export async function runTicketAutoClose(): Promise<number> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'ticket_auto_close_days' } })
    const days = Math.floor(Number(row?.value ?? 0))
    if (!Number.isFinite(days) || days <= 0) return 0

    const cutoff = new Date(Date.now() - days * 86400000)
    const targets = await prisma.ticket.findMany({
      where: { status: 'RESOLVED', statusChangedAt: { lte: cutoff } },
      select: { id: true, ticketCode: true, refType: true },
    })
    let closed = 0
    for (const t of targets) {
      try {
        const openChildren = await prisma.ticket.count({
          where: { parentId: t.id, status: { notIn: ['RESOLVED', 'CLOSED'] } },
        })
        if (openChildren > 0) continue
        await prisma.$transaction(async (tx) => {
          await tx.ticket.update({
            where: { id: t.id },
            data: { status: 'CLOSED', statusChangedAt: new Date(), closedAt: new Date() },
          })
          await addTicketEvent(tx, t.id, 'status_change', null, { from: 'RESOLVED', to: 'CLOSED', via: 'auto_close', afterDays: days })
          await syncTicketToDomain(tx, t.id, t.refType)
        })
        closed++
      } catch (err) {
        console.error(`[ticketDomain] auto-close 실패 (${t.ticketCode}):`, err)
      }
    }
    if (closed) console.log(`[ticketDomain] RESOLVED ${days}일 경과 자동 종결: ${closed}건`)
    return closed
  } catch (err) {
    console.error('[ticketDomain] runTicketAutoClose 예외:', err)
    return 0
  }
}
