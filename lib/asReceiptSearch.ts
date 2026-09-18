// AS접수 목록·상세 공용 서버 조회 헬퍼 (2026-09-18)
// - 검색어(q) OR 조건 단일 소스 — 목록 GET·Excel export 공용
// - 운송장 검색은 양쪽 정규화(영숫자만, 대소문자 무시) 비교: DB 값이 'CJ 2609…'처럼 접두·공백을 포함해 Prisma contains로는 'CJ 2609'·'2609' 검색이 빠지던 문제
// - 중복접수 대조: 같은 시리얼의 미종결 라인이 다른 접수에도 있으면 '확인필요'(목록 태그 DUPLICATE·상세 라인 duplicateOf)
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { splitAsSearchKeywords, type AsSearchField } from '@/lib/asReceiptShared'

/** 운송장 정규화 — 영숫자만 남기고 대문자 (검색어·DB 양쪽 동일 규칙) */
export function normalizeTrackingNo(v: string): string {
  return v.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}

/** 수거 송장(접수 헤더)·발송 송장(라인) 정규화 부분 일치 접수 id — 키워드 여러 개면 합집합 */
export async function findAsReceiptIdsByTracking(keywords: string[]): Promise<number[]> {
  const keys = Array.from(new Set(keywords.map(normalizeTrackingNo).filter(Boolean)))
  if (!keys.length) return []
  const likes = keys.map((k) => `%${k}%`)
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT r.id FROM as_receipts r
    WHERE upper(regexp_replace(coalesce(r.pickup_tracking_no, ''), '[^0-9A-Za-z]', '', 'g')) LIKE ANY(${likes}::text[])
    UNION
    SELECT i.receipt_id AS id FROM as_receipt_items i
    WHERE upper(regexp_replace(coalesce(i.ship_tracking_no, ''), '[^0-9A-Za-z]', '', 'g')) LIKE ANY(${likes}::text[])`)
  return rows.map((r) => r.id)
}

/**
 * 목록·export 공용 검색 OR 조건 (2026-09-18 항목 지정·쉼표 복수 키워드)
 * field: all(통합 = 접수번호·고객명·병원명·시리얼·송장·담당자) / hospital / serial / code / tracking / owner(연결 티켓 담당자)
 * 키워드는 ','로 분리해 OR — 어느 키워드든 어느 대상이든 하나라도 맞으면 포함. 조건이 하나도 없으면 null(필터 없음)
 */
export async function buildAsReceiptSearchOr(q: string, field: AsSearchField = 'all'): Promise<Prisma.AsReceiptWhereInput[] | null> {
  const keywords = splitAsSearchKeywords(q)
  if (!keywords.length) return null
  const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const })
  const or: Prisma.AsReceiptWhereInput[] = []
  for (const k of keywords) {
    if (field === 'all' || field === 'code') or.push({ asCode: ci(k) })
    if (field === 'all') or.push({ reporterName: ci(k) })
    if (field === 'all' || field === 'hospital') or.push({ hospital: { hospitalName: ci(k) } })
    if (field === 'all' || field === 'serial') or.push({ items: { some: { serialNo: ci(k.replace(/\s+/g, '')) } } })
    if (field === 'all' || field === 'owner') or.push({ ticket: { owner: { name: ci(k) } } })
  }
  if (field === 'all' || field === 'tracking') {
    const ids = await findAsReceiptIdsByTracking(keywords)
    if (ids.length) or.push({ id: { in: ids } })
    else if (field === 'tracking') or.push({ id: -1 }) // 송장 항목 지정인데 매치 없음 → 0건
  }
  return or
}

export interface AsOpenLineRef { receiptId: number; asCode: string }

/** 시리얼별 미종결(outcome NULL) 라인을 가진 접수 목록 — 호출부가 자기 접수를 제외해 중복접수 판정 */
export async function findOpenLinesBySerial(serials: string[]): Promise<Map<string, AsOpenLineRef[]>> {
  const map = new Map<string, AsOpenLineRef[]>()
  if (!serials.length) return map
  const rows = await prisma.asReceiptItem.findMany({
    where: { serialNo: { in: serials }, outcome: null },
    select: { serialNo: true, receiptId: true, receipt: { select: { asCode: true } } },
    orderBy: { receiptId: 'asc' },
  })
  for (const r of rows) {
    const cur = map.get(r.serialNo) ?? []
    if (!cur.some((x) => x.receiptId === r.receiptId)) cur.push({ receiptId: r.receiptId, asCode: r.receipt.asCode })
    map.set(r.serialNo, cur)
  }
  return map
}

/** 접수 1건 기준 — 시리얼 → 다른 접수의 접수번호 목록(중복 없으면 키 없음) */
export function duplicatesForReceipt(receiptId: number, serials: string[], openBySerial: Map<string, AsOpenLineRef[]>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const s of serials) {
    const others = (openBySerial.get(s) ?? []).filter((x) => x.receiptId !== receiptId).map((x) => x.asCode)
    if (others.length) out.set(s, others)
  }
  return out
}
