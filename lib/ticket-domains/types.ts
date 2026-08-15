/**
 * 티켓 도메인 어댑터 계약 (cs_ticket_workflow_design.md §3.2)
 *
 * 도메인 1종의 티켓 편입 지식을 어댑터 1파일에 응집한다.
 * 공용 코드(티켓 라우트·상세 배너·역동기화 디스패치)는 registry.ts 조회만 사용하고
 * refType switch를 직접 갖지 않는다.
 *
 * 어댑터가 다루지 않는 것 (의도적 — 해당 파일이 각자 소유):
 * - 알림 필드 카탈로그: lib/notifyFields.ts (taskType 단위 설정 카탈로그)
 * - SLA DOMAIN_DUE 앵커: lib/sla.ts (정적 Prisma select 타입 보존을 위해 유지)
 * - 병원 재지정: lib/workItemReassign.ts (도메인 테이블 직접 조작 — 티켓 지식 아님)
 */
import { Prisma } from '@prisma/client'
import type { DomainRefType, TicketDomainMeta, LinkedWorkData } from './meta'

export interface TicketDomainAdapter {
  refType: DomainRefType
  meta: TicketDomainMeta
  /**
   * 티켓 상세 GET include에 병합할 도메인 relation fragment
   * (buildLinkedWork가 읽는 필드와 정확히 일치해야 한다)
   */
  detailInclude: Record<string, unknown>
  /**
   * 티켓 변경 → 도메인 역동기화 (구 syncTicketToX).
   * 티켓 mutation 트랜잭션 안에서 registry.syncTicketToDomain 경유로 호출된다.
   */
  syncTicketToDomain(tx: Prisma.TransactionClient, ticketId: number): Promise<void>
  /**
   * 티켓 상세 응답의 '연결 업무 배너' 데이터 조립.
   * ticket은 detailInclude가 병합된 조회 결과 — 해당 relation이 없으면 null 반환.
   */
  buildLinkedWork(ticket: Record<string, unknown>): LinkedWorkData | null
}
