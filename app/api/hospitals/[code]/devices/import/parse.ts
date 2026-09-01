/**
 * 임포트 입력 파서 — Excel(B-1) · 붙여넣기(B-2) · 온프렘 export 초안(B-3: `deviceRegisterList` JSON / TSV·CSV 별칭 헤더)
 * 순수 함수(DB 없음). 판정은 서비스 `previewRows`가 담당하고, 여기서는 행(`ImportRowInput`)과 입력 형상만 만든다.
 *
 * 행 번호 규약(§7.2): 시트 실제 행 번호(헤더 자동 인식 시 2부터, 헤더 없는 파일은 1부터) / 붙여넣기 원문 줄 번호(1부터)
 */
import * as XLSX from 'xlsx'
import type { ImportRowInput } from '@/lib/deviceRegistry'
import {
  IMPORT_MAX_ROWS,
  ONPREM_HEADER_ALIASES,
  ONPREM_JSON_KEYS,
  detectOnpremHeader,
  guessDeviceClassByPrefix,
  normalizeSerial,
  parseSerialLines,
  type OnpremHeaderMap,
} from '@/lib/deviceRegistryShared'

export type ImportInputFormat = 'excel' | 'excel_headerless' | 'onprem_excel' | 'paste' | 'onprem_json' | 'onprem_table'

export interface ImportInputShape {
  format: ImportInputFormat
  /** 온프렘 export로 감지됨 → 초안 모드 제안(§6.1 임포트 탭) */
  onprem: boolean
  /** 헤더 행을 인식해 건너뜀(행 번호는 2부터) */
  header: boolean
  columns: OnpremHeaderMap | null
  /** MAX+1건에서 파싱을 멈춤 — 라우트가 400으로 처리 */
  overflow: boolean
}

export interface ParsedImportInput {
  rows: ImportRowInput[]
  shape: ImportInputShape
}

const LIMIT = IMPORT_MAX_ROWS + 1

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function cellInt(v: unknown): number | null {
  const s = cellStr(v)
  if (!s) return null
  const n = Number(s)
  return Number.isInteger(n) ? n : null
}

/**
 * 셀이 시리얼처럼 보이는가 — A1 판정으로 헤더 유무를 가른다(관리자 콘솔 xlsx는 A열만·헤더 없음).
 * 합성/바코드형이면 시리얼, 그 외에는 영숫자만 + 숫자 4자리 이상 + 접두 추정이 붙는 경우.
 */
export function looksLikeSerial(cell: unknown): boolean {
  const ns = normalizeSerial(cellStr(cell))
  if (!ns.serialNo) return false
  if (ns.kind !== 'PLAIN') return true
  const key = ns.serialNo
  if (/[^A-Z0-9-]/.test(key)) return false
  if (!/\d{4,}/.test(key)) return false
  return !!guessDeviceClassByPrefix(key).deviceClass || /^[A-Z]{1,3}\d{5,}$/.test(key)
}

const SERIAL_HEADER_EXTRA = ['serial', 'serialno', 'sn', '시리얼no', '기기시리얼']
function isSerialHeaderCell(cell: unknown): boolean {
  const norm = cellStr(cell)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s　_\-]+/g, '')
  if (!norm) return false
  return ONPREM_HEADER_ALIASES.serial.includes(norm) || SERIAL_HEADER_EXTRA.includes(norm)
}

function onpremRow(row: number, cells: readonly unknown[], map: OnpremHeaderMap): ImportRowInput | null {
  const pick = (idx: number | undefined) => (idx == null ? '' : cellStr(cells[idx]))
  const serialInput = pick(map.serial)
  const wardCode = pick(map.wardCode) || null
  const deviceType = map.deviceType == null ? null : cellInt(cells[map.deviceType])
  const org = pick(map.organizationCode) || null
  const macAddress = pick(map.macAddress) || null
  const extDeviceCode = pick(map.deviceCode) || null
  if (!serialInput && !wardCode && deviceType == null && !org && !macAddress && !extDeviceCode) return null
  // wardInput에도 코드를 실어 신규 등록 모드로 실행해도 병동 열이 사라지지 않게 한다(초안 모드는 wardCode 우선)
  return { row, serialInput, wardCode, wardInput: wardCode, deviceType, org, macAddress, extDeviceCode }
}

function templateRow(row: number, cells: readonly unknown[]): ImportRowInput | null {
  const serialInput = cellStr(cells[0])
  const modelInput = cellStr(cells[1]) || null
  const wardInput = cellStr(cells[2]) || null
  const memo = cellStr(cells[3]) || null
  const usageTypeInput = cellStr(cells[4]) || null
  const productTypeInput = cellStr(cells[5]) || null
  if (!serialInput && !modelInput && !wardInput && !memo && !usageTypeInput && !productTypeInput) return null
  return { row, serialInput, modelInput, wardInput, memo, ...(usageTypeInput ? { usageTypeInput } : {}), ...(productTypeInput ? { productTypeInput } : {}) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Excel (B-1) — 첫 시트. A1이 시리얼이면 헤더 없음 / 온프렘 별칭 헤더면 초안 열 / 그 외 A 시리얼·B 모델·C 병동·D 메모·E 용도(판매용/평가용, 선택)·F 상품유형(일반/라이트, 선택)
// ─────────────────────────────────────────────────────────────────────────────

export function parseImportExcel(buffer: ArrayBuffer): ParsedImportInput {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const empty: ParsedImportInput = { rows: [], shape: { format: 'excel', onprem: false, header: false, columns: null, overflow: false } }
  if (!sheet) return empty
  // raw:false → 숫자 셀도 표시 문자열로(시리얼 앞자리 0·지수 표기 방지), defval → 빈 셀 채워 열 인덱스 고정
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' }) as unknown[][]
  const firstIdx = grid.findIndex((r) => Array.isArray(r) && r.some((c) => cellStr(c)))
  if (firstIdx < 0) return empty
  const first = grid[firstIdx]

  let format: ImportInputFormat
  let columns: OnpremHeaderMap | null = null
  let dataStart: number
  if (looksLikeSerial(first[0])) {
    format = 'excel_headerless'
    dataStart = firstIdx
  } else {
    columns = detectOnpremHeader(first)
    format = columns ? 'onprem_excel' : 'excel'
    dataStart = firstIdx + 1
  }

  const rows: ImportRowInput[] = []
  let overflow = false
  for (let i = dataStart; i < grid.length; i++) {
    const cells = grid[i]
    if (!Array.isArray(cells) || cells.length === 0) continue
    const r = columns ? onpremRow(i + 1, cells, columns) : templateRow(i + 1, cells)
    if (!r) continue
    rows.push(r)
    if (rows.length >= LIMIT) {
      overflow = true
      break
    }
  }
  return { rows, shape: { format, onprem: !!columns, header: format !== 'excel_headerless', columns, overflow } }
}

// ─────────────────────────────────────────────────────────────────────────────
// 붙여넣기 — ① deviceRegisterList JSON ② 온프렘 별칭 헤더 TSV/CSV ③ parseSerialLines (B-2)
// ─────────────────────────────────────────────────────────────────────────────

function findDeviceRegisterList(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (Array.isArray(o.deviceRegisterList)) return o.deviceRegisterList
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = (v as Record<string, unknown>).deviceRegisterList
      if (Array.isArray(inner)) return inner
    }
  }
  return null
}

function parseOnpremJson(text: string): ParsedImportInput | null {
  const t = text.trim()
  if (!(t.startsWith('[') || t.startsWith('{'))) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(t)
  } catch {
    return null
  }
  const list = findDeviceRegisterList(parsed)
  if (!list) return null
  const items = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
  if (items.length === 0 || !items.some((x) => ONPREM_JSON_KEYS.serial in x)) return null
  const rows: ImportRowInput[] = []
  let overflow = false
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    rows.push({
      row: i + 1,
      serialInput: cellStr(it[ONPREM_JSON_KEYS.serial]),
      wardCode: cellStr(it[ONPREM_JSON_KEYS.wardCode]) || null,
      wardInput: cellStr(it[ONPREM_JSON_KEYS.wardCode]) || null,
      deviceType: cellInt(it[ONPREM_JSON_KEYS.deviceType]),
      org: cellStr(it[ONPREM_JSON_KEYS.organizationCode]) || null,
      macAddress: cellStr(it[ONPREM_JSON_KEYS.macAddress]) || null,
      extDeviceCode: cellStr(it[ONPREM_JSON_KEYS.deviceCode]) || null,
    })
    if (rows.length >= LIMIT) {
      overflow = true
      break
    }
  }
  return { rows, shape: { format: 'onprem_json', onprem: true, header: false, columns: null, overflow } }
}

/** 탭 > 쉼표 > 2칸 이상 공백 */
function pickDelimiter(line: string): RegExp {
  if (line.includes('\t')) return /\t/
  if (line.includes(',')) return /,/
  return /[ 　]{2,}/
}

function parseOnpremTable(text: string): ParsedImportInput | null {
  const lines = text.split(/\r\n|\r|\n/)
  const headerIdx = lines.findIndex((l) => l.trim() && !l.trim().startsWith('#'))
  if (headerIdx < 0) return null
  const delimiter = pickDelimiter(lines[headerIdx])
  const headerCells = lines[headerIdx].split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''))
  const columns = detectOnpremHeader(headerCells)
  if (!columns) return null
  const rows: ImportRowInput[] = []
  let overflow = false
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const cells = line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''))
    const r = onpremRow(i + 1, cells, columns)
    if (!r) continue
    rows.push(r)
    if (rows.length >= LIMIT) {
      overflow = true
      break
    }
  }
  return { rows, shape: { format: 'onprem_table', onprem: true, header: true, columns, overflow } }
}

export function parseImportText(text: string): ParsedImportInput {
  const json = parseOnpremJson(text)
  if (json) return json
  const table = parseOnpremTable(text)
  if (table) return table

  // 일반 붙여넣기 — 첫 줄이 '시리얼' 류 헤더면 건너뛴다(줄 번호는 원문 유지)
  const lines = text.split(/\r\n|\r|\n/)
  const firstIdx = lines.findIndex((l) => l.trim() && !l.trim().startsWith('#'))
  let header = false
  let body = text
  if (firstIdx >= 0) {
    const firstCell = lines[firstIdx].trim().split(/\t+|[ 　]{2,}|,/)[0]
    if (isSerialHeaderCell(firstCell) && !looksLikeSerial(firstCell)) {
      header = true
      body = lines.map((l, i) => (i === firstIdx ? '' : l)).join('\n')
    }
  }
  const parsed = parseSerialLines(body, IMPORT_MAX_ROWS)
  const overflow = parsed.length > IMPORT_MAX_ROWS
  const rows: ImportRowInput[] = parsed.map((p) => ({
    row: p.row,
    serialInput: p.serialInput,
    wardInput: p.wardInput ?? null,
    memo: p.memo ?? null,
    ...(p.usageInput ? { usageTypeInput: p.usageInput } : {}),
    ...(p.productTypeInput ? { productTypeInput: p.productTypeInput } : {}),
  }))
  return { rows, shape: { format: 'paste', onprem: false, header, columns: null, overflow } }
}
