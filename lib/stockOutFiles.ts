/**
 * 출고요청 첨부파일 — 엑셀 등 요청 근거 (projects/stock_out_v2_design.md §15, 2026-11-02)
 * 한도·DTO의 단일 소스 (클라이언트·서버 공용 — prisma import 금지). 분류 없음, 요청당 N건.
 */

/** 파일당 20MB · 한 번에 10개 (주간업무·딜 첨부와 동일 한도) */
export const STOCK_OUT_FILE_MAX_BYTES = 20 * 1024 * 1024
export const STOCK_OUT_FILES_PER_REQUEST = 10

/** 업로드 금지 확장자 (실행 파일류) — 엑셀(xlsx/xls/csv)·PDF·이미지 등은 허용 */
export const STOCK_OUT_FILE_BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'sh', 'js', 'msi', 'com', 'scr', 'ps1'])

export interface StockOutFileDto {
  id: number
  fileName: string
  sizeBytes: number
  contentType: string | null
  uploadedById: string | null
  uploadedByName: string | null
  uploadedAt: string // ISO
}

export function toStockOutFileDto(f: {
  id: number
  fileName: string
  sizeBytes: number
  contentType: string | null
  uploadedById: string | null
  uploadedAt: Date
  uploadedBy?: { name: string } | null
}): StockOutFileDto {
  return {
    id: f.id,
    fileName: f.fileName,
    sizeBytes: f.sizeBytes,
    contentType: f.contentType,
    uploadedById: f.uploadedById,
    uploadedByName: f.uploadedBy?.name ?? null,
    uploadedAt: f.uploadedAt.toISOString(),
  }
}

/** 파일명 정규화 — 경로 구분자·제어문자 제거, NFC (S3 키·저장 파일명 공용) */
export function safeStockOutFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .split('')
    .map((ch) => (ch === '/' || ch === '\\' || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .trim()
  return cleaned || 'file'
}

/** 엑셀 계열 여부 — 목록에서 아이콘 구분용 */
export function isSpreadsheetFile(name: string): boolean {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'csv'
}
