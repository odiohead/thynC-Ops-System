/**
 * 출고업무 Slack 알림 (2026-11-02 — projects/stock_out_notify_design.md)
 *
 * 도메인 이벤트 2종을 `notifyDomainEvent`(lib/notify.ts — 업무 알림 단일 경로)로 보낸다.
 * 메시지(2026-11-03 피드백): 머리줄 '[이벤트] 병원명'만, 품목 줄 없음, 링크는 '*티켓 링크*' 라벨로 **출고요청 상세**(/stock-out-requests/[id] — 도메인 알림은 도메인 레코드 링크, 티켓 관점은 공통 규칙 담당), Slack 링크 미리보기 끔(lib/slack.ts unfurl off). 채널·사용 여부는 설정 > Slack 알림의 라우팅 규칙.
 *  - STOCK_OUT_CREATED   : 출고요청 생성 직후 (POST /api/stock-out-requests)
 *  - STOCK_OUT_COMPLETED : 출고업무 상태가 '완료'로 진입할 때 — `notifyTicketChanged`의 상태 전이 판정에서 호출(경로 3종 공통), 취소는 제외.
 *                          요청자(출고요청 등록자)를 Slack에서 태그
 * best-effort — 절대 throw하지 않음.
 */
import { prisma } from '@/lib/prisma'
import { notifyDomainEvent } from '@/lib/notify'
import { STOCK_OUT_PURPOSE_LABELS, type StockOutPurpose } from '@/lib/stockOutShared'

const STOCK_OUT_DONE_STATUS = '완료'

const notifySelect = {
  id: true, sorCode: true, purpose: true, requestDate: true, ticketId: true, fulfilledAt: true, createdById: true,
  createdBy: { select: { name: true } },
  fulfilledBy: { select: { name: true } },
  status: { select: { name: true } },
  project: { select: { projectName: true, hospital: { select: { hospitalName: true } } } },
} as const

type NotifyRow = NonNullable<Awaited<ReturnType<typeof loadById>>>

function loadById(id: number) {
  return prisma.stockOutRequest.findUnique({ where: { id }, select: notifySelect })
}
function loadByTicket(ticketId: number) {
  return prisma.stockOutRequest.findUnique({ where: { ticketId }, select: notifySelect })
}

/** 머리줄 — 병원명만 (2026-11-03 피드백: 프로젝트명·SOR 코드 제거, 병원명 없으면 프로젝트명) */
const titleOf = (r: NotifyRow) => r.project?.hospital?.hospitalName ?? r.project?.projectName ?? r.sorCode
const ymdKst = (d: Date | null | undefined) => (d ? d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : '')
const purposeOf = (p: string) => STOCK_OUT_PURPOSE_LABELS[p as StockOutPurpose] ?? p

/** 출고요청 등록 알림 — 생성 라우트에서 커밋 후 호출 */
export async function notifyStockOutCreated(requestId: number): Promise<void> {
  try {
    const r = await loadById(requestId)
    if (!r?.ticketId) return
    await notifyDomainEvent({
      event: 'STOCK_OUT_CREATED',
      ticketId: r.ticketId,
      title: titleOf(r),
      fields: [
        { label: '요청자', value: r.createdBy?.name ?? '' },
        { label: '업무 구분', value: purposeOf(r.purpose) },
        { label: '희망 출고일', value: r.requestDate.toISOString().slice(0, 10) }, // @db.Date — UTC 자정 저장
      ], // 품목 줄 제거 (2026-11-03 피드백) — 품목은 출고요청 상세에서
      link: `/stock-out-requests/${r.id}`, // 도메인 알림 = 도메인 레코드 링크 (티켓 상세 아님 — 2026-11-03 정정, 공통 규칙만 티켓 관점)
      linkLabel: '티켓 링크',
    })
  } catch (err) {
    console.error('[stock-out-notify] 등록 알림 예외:', err)
  }
}

/** 출고 완료 알림 — 티켓이 종료로 전이된 출고업무 중 도메인 상태가 '완료'인 건만(취소 제외). 요청자 태그 */
export async function notifyStockOutCompletedByTicket(ticketId: number, actorName: string | null): Promise<void> {
  try {
    const r = await loadByTicket(ticketId)
    if (!r || r.status?.name !== STOCK_OUT_DONE_STATUS) return
    await notifyDomainEvent({
      event: 'STOCK_OUT_COMPLETED',
      ticketId,
      actorName: r.fulfilledBy?.name ?? actorName, // [출고 처리]면 처리자, 상태 직접 변경·티켓 종료면 변경한 사람
      title: titleOf(r),
      fields: [
        { label: '출고일', value: ymdKst(r.fulfilledAt) || ymdKst(new Date()) },
      ], // 품목 줄 제거 (2026-11-03 피드백, 등록 알림과 동일)
      mentionUserIds: r.createdById ? [r.createdById] : [],
      mentionText: '출고가 완료됐습니다',
      link: `/stock-out-requests/${r.id}`,
      linkLabel: '티켓 링크',
    })
  } catch (err) {
    console.error('[stock-out-notify] 완료 알림 예외:', err)
  }
}
