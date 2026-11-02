/**
 * 딜(계약 이력) 첨부 — 견적서·계약서 (projects/sales_crm_design.md §7, 2026-11-02)
 * kind 어휘·라벨·용량 한도의 단일 소스 (클라이언트·서버 공용 — prisma import 금지).
 * 첨부는 필수가 아니다(계약서는 추후 전달되는 경우가 있음) — 화면은 '미첨부'를 눈에 띄게만 표시한다.
 */

export const SALES_DEAL_FILE_KINDS = ['QUOTE', 'CONTRACT'] as const
export type SalesDealFileKind = (typeof SALES_DEAL_FILE_KINDS)[number]

export const SALES_DEAL_FILE_KIND_LABELS: Record<SalesDealFileKind, string> = {
  QUOTE: '견적서',
  CONTRACT: '계약서',
}

export function isSalesDealFileKind(v: unknown): v is SalesDealFileKind {
  return typeof v === 'string' && (SALES_DEAL_FILE_KINDS as readonly string[]).includes(v)
}

/** 파일당 20MB · 한 번에 10개 (주간업무 첨부와 동일 한도) */
export const SALES_DEAL_FILE_MAX_BYTES = 20 * 1024 * 1024
export const SALES_DEAL_FILES_PER_REQUEST = 10

export interface SalesDealFileDto {
  id: number
  kind: SalesDealFileKind
  fileName: string
  sizeBytes: number
  contentType: string | null
  uploadedByName: string | null
  uploadedAt: string // ISO
}

/** prisma row(+uploadedBy.name) → DTO */
export function toSalesDealFileDto(f: {
  id: number
  kind: string
  fileName: string
  sizeBytes: number
  contentType: string | null
  uploadedAt: Date
  uploadedBy?: { name: string } | null
}): SalesDealFileDto {
  return {
    id: f.id,
    kind: isSalesDealFileKind(f.kind) ? f.kind : 'QUOTE',
    fileName: f.fileName,
    sizeBytes: f.sizeBytes,
    contentType: f.contentType,
    uploadedByName: f.uploadedBy?.name ?? null,
    uploadedAt: f.uploadedAt.toISOString(),
  }
}

/** 업로드 금지 확장자 (실행 파일류 — 주간업무 첨부와 동일) */
export const SALES_DEAL_FILE_BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'sh', 'js', 'msi', 'com', 'scr', 'ps1'])

/** 파일명 정규화 — 경로 구분자·제어문자 제거, NFC (S3 키·저장 파일명 공용) */
export function safeDealFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .split('')
    .map((ch) => (ch === '/' || ch === '\\' || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .trim()
  return cleaned || 'file'
}
