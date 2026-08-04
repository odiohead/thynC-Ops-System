import { readFile } from 'fs/promises'
import path from 'path'
import JSZip from 'jszip'
import { prisma } from '@/lib/prisma'
import type { Ledger, LedgerRow } from '@/lib/udiLedger'

/**
 * UDI 입출고대장 docx 생성 (projects/inventory_udi_ledger_design.md §5.3)
 *
 * 라이브러리로 문서를 새로 그리지 않고 **원본 양식(F707-1)을 템플릿으로 재사용**한다.
 * 글꼴·테두리·머리글/바닥글·여백이 그대로 보존되고, 양식이 개정되면 템플릿 파일만 교체하면 된다.
 *
 * 템플릿 구조 (assets/templates/udi-ledger-F707-1.docx)
 *   표0 헤더  : [제목] / [모델명|값] / [품 명|값|원자재식별 NO|값]
 *   표1 입고  : [제목] / [열 헤더] / [데이터 행 템플릿 — <w:t> 7칸]
 *   표2 출고  : [제목] / [열 헤더] / [데이터 행 템플릿 — <w:t> 7칸] / [빈 행] / [비고|값]
 *
 * 셀 텍스트가 전부 단일 run이고 중첩 표가 없는 것을 확인하고 채택한 방식이다.
 */

const TEMPLATE_PATH = path.join(process.cwd(), 'assets', 'templates', 'udi-ledger-F707-1.docx')

/** 출고 표 최소 행 수 — 원본 양식의 페이지 레이아웃 유지용 */
const OUT_MIN_ROWS = 24

export interface LedgerDocMeta {
  docNumber: string
  formNumber: string
  revision: string
  effectiveFrom: string
  companyName: string
  revisions: { rev: string; date: string; note: string }[]
}

export const DEFAULT_DOC_META: LedgerDocMeta = {
  docNumber: 'ST-G1000-1593',
  formNumber: 'F707-1',
  revision: '4',
  effectiveFrom: '2026.03.31 ~',
  companyName: '(주)씨어스테크놀로지',
  revisions: [{ rev: '4', date: '2026.03.31', note: '문서양식 변경적용' }],
}

export const DOC_META_KEY = 'udi_ledger_doc_meta'

export async function getLedgerDocMeta(): Promise<LedgerDocMeta> {
  const row = await prisma.appSetting.findUnique({ where: { key: DOC_META_KEY } })
  if (!row?.value) return DEFAULT_DOC_META
  try {
    const parsed = JSON.parse(row.value)
    return {
      ...DEFAULT_DOC_META,
      ...parsed,
      revisions: Array.isArray(parsed.revisions) ? parsed.revisions : DEFAULT_DOC_META.revisions,
    }
  } catch {
    return DEFAULT_DOC_META
  }
}

// ─── XML 유틸 ───

function escapeXml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 중첩 없는 <w:TAG ...>…</w:TAG> 블록 위치 목록 (<w:trPr> 등 접두사 오탐 방지) */
function findBlocks(xml: string, tag: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const openRe = new RegExp(`<w:${tag}[ >]`, 'g')
  const close = `</w:${tag}>`
  let m: RegExpExecArray | null
  while ((m = openRe.exec(xml)) !== null) {
    const start = m.index
    const closeIdx = xml.indexOf(close, start)
    if (closeIdx === -1) break
    const end = closeIdx + close.length
    out.push({ start, end })
    openRe.lastIndex = end
  }
  return out
}

/** 블록 안 k번째 <w:t>의 텍스트를 교체 */
function setTextAt(block: string, index: number, value: string): string {
  let n = 0
  return block.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (full, open: string, _old: string, close: string) => {
    if (n++ !== index) return full
    // 앞뒤 공백이 잘리지 않도록 xml:space 보존
    const openTag = open.includes('xml:space') ? open : open.replace(/>$/, ' xml:space="preserve">')
    return `${openTag}${escapeXml(value)}${close}`
  })
}

/** 행 템플릿에 값 배열을 순서대로 채움 */
function fillRow(rowTpl: string, values: string[]): string {
  let row = rowTpl
  values.forEach((v, i) => { row = setTextAt(row, i, v) })
  return row
}

/** 표의 행 목록을 [고정 앞부분 유지] + [생성 행들]로 교체 */
function replaceTableRows(tbl: string, keepBefore: number, newRows: string[], tailRows: string[] = []): string {
  const rows = findBlocks(tbl, 'tr')
  if (rows.length === 0) return tbl
  const headEnd = rows[Math.min(keepBefore, rows.length) - 1].end
  const tblTail = tbl.slice(rows[rows.length - 1].end)
  return tbl.slice(0, headEnd) + newRows.join('') + tailRows.join('') + tblTail
}

// ─── 생성 ───

export async function renderLedgerDocx(ledger: Ledger, meta: LedgerDocMeta): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE_PATH))

  const readXml = async (name: string) => {
    const f = zip.file(name)
    if (!f) throw new Error(`템플릿에 ${name}이 없습니다.`)
    return f.async('string')
  }

  let doc = await readXml('word/document.xml')
  const tbls = findBlocks(doc, 'tbl')
  if (tbls.length < 3) throw new Error('템플릿 표 구조가 예상과 다릅니다. (표 3개 필요)')

  // 뒤에서부터 치환해야 앞 표의 인덱스가 밀리지 않는다
  const [headerTbl, inTbl, outTbl] = tbls

  // ── 표2: 출고정보 ──
  {
    const tbl = doc.slice(outTbl.start, outTbl.end)
    const rows = findBlocks(tbl, 'tr')
    const dataTpl = tbl.slice(rows[2].start, rows[2].end)
    const emptyTpl = tbl.slice(rows[3].start, rows[3].end)
    const noteRow = tbl.slice(rows[4].start, rows[4].end)

    const dataRows = ledger.outRows.map((r) => fillRow(dataTpl, outValues(r)))
    const padCount = Math.max(0, OUT_MIN_ROWS - dataRows.length)
    const padRows = Array.from({ length: padCount }, () => emptyTpl)
    const filledNote = setTextAt(noteRow, 1, `현재고 ${ledger.currentStock.toLocaleString()}개`)

    const newTbl = replaceTableRows(tbl, 2, [...dataRows, ...padRows], [filledNote])
    doc = doc.slice(0, outTbl.start) + newTbl + doc.slice(outTbl.end)
  }

  // ── 표1: 입고정보 ──
  {
    const tbl = doc.slice(inTbl.start, inTbl.end)
    const rows = findBlocks(tbl, 'tr')
    const dataTpl = tbl.slice(rows[2].start, rows[2].end)
    const dataRows = ledger.inRows.map((r) => fillRow(dataTpl, inValues(r)))
    // 내역이 없어도 표가 무너지지 않도록 빈 행 1개는 남긴다
    const newTbl = replaceTableRows(tbl, 2, dataRows.length ? dataRows : [fillRow(dataTpl, [])])
    doc = doc.slice(0, inTbl.start) + newTbl + doc.slice(inTbl.end)
  }

  // ── 표0: 헤더 ──
  {
    const tbl = doc.slice(headerTbl.start, headerTbl.end)
    const rows = findBlocks(tbl, 'tr')
    let modelRow = tbl.slice(rows[1].start, rows[1].end)
    let classRow = tbl.slice(rows[2].start, rows[2].end)
    modelRow = setTextAt(modelRow, 1, ledger.header.modelName)
    classRow = setTextAt(classRow, 1, ledger.header.productClass)
    classRow = setTextAt(classRow, 3, ledger.header.materialNo)
    const newTbl =
      tbl.slice(0, rows[1].start) + modelRow + tbl.slice(rows[1].end, rows[2].start) + classRow + tbl.slice(rows[2].end)
    doc = doc.slice(0, headerTbl.start) + newTbl + doc.slice(headerTbl.end)
  }

  zip.file('word/document.xml', doc)

  // ── 머리글: 문서번호 · 문서양식 변경적용 ──
  const headerName = zip.file(/word\/header\d+\.xml/)[0]?.name
  if (headerName) {
    let header = await readXml(headerName)
    header = header
      .replace(/(문서번호\s*:\s*)[^<]*/, (_m, p1: string) => `${p1}${escapeXml(meta.docNumber)}`)
      .replace(/(문서양식 변경적용\s*:\s*)[^<]*/, (_m, p1: string) => `${p1}${escapeXml(meta.effectiveFrom)}`)
    zip.file(headerName, header)
  }

  // ── 바닥글: 양식번호(rev) · 회사명 ──
  const footerName = zip.file(/word\/footer\d+\.xml/)[0]?.name
  if (footerName) {
    let footer = await readXml(footerName)
    footer = footer
      .replace(/F707-1\(rev\.\d+\)/g, escapeXml(`${meta.formNumber}(rev.${meta.revision})`))
      .replace(/\(주\)씨어스테크놀로지/g, escapeXml(meta.companyName))
    zip.file(footerName, footer)
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function inValues(r: LedgerRow): string[] {
  return [r.date, r.udi, r.productName, r.lotNo, String(r.quantity), r.counterpart, r.checked ? '확인' : '']
}

function outValues(r: LedgerRow): string[] {
  return [r.date, r.udi, r.productName, r.lotNo, String(r.quantity), r.counterpart, r.note]
}

/** 다운로드 파일명 — 문서 1부 = 모델 1종 (예: 'MP100W Series 입출고대장.docx') */
export function ledgerFileName(ledger: Ledger): string {
  const model = (ledger.header.modelName || ledger.model.modelName).replace(/[\\/:*?"<>|]/g, '_')
  return `${model} 입출고대장.docx`
}
