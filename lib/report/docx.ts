import { readFile } from 'fs/promises'
import path from 'path'
import JSZip from 'jszip'
import type { ReportBlock, ReportDoc } from './doc'

/**
 * 레포트 Word 생성 — 사내 양식(02_SEERS_2026_보고서_세로양식)을 템플릿으로 재사용 (projects/hospital_report_design.md §9)
 * UDI 입출고대장(lib/udiLedgerDocx.ts)과 같은 방식: 문서를 새로 그리지 않고 원본을 열어 채운다
 * → 머리글 로고·바닥글 양식번호(F401-5)·결재란·여백·글꼴 보존. 양식 개정 시 템플릿 파일만 교체.
 * 본문 서식 기준: 제주한라병원_운영레포트_20261107.docx (2026-11-08 사용자 지정)
 *   표 머리 E8EDF5 + 남색 굵게, 표 위·아래 남색 선, 항목 열·합계 행 F2F2F2 굵게, 목차·하위 제목 굵게, 줄간격 264
 *
 * 템플릿 구조 (assets/templates/seers-report-portrait-2026.docx)
 *   머리글  : '문서번호: ST-P-26xxxx-xx' 단일 run
 *   표0     : [보 고 서|작성|검토|승인] / [서명칸×4] / [제목|값] / [작성일자|값|작성부서|값|작성자|값] — 값 칸은 run 없는 빈 문단
 *   본문    : [작성방법] 안내 블록 → 목차 `1.`(numId 2) + 하위 `1)`(목차별 numId 3~9) → sectPr
 *   번호    : 목차 abstract 8(`%1.`, left 440), 하위 abstract 0~5·7(`%1)`, left 880), 불릿 numId 1(`-`)
 * 표0 뒤 본문 전체를 ReportDoc에서 만든 OOXML로 교체한다.
 */

const TEMPLATE_PATH = path.join(process.cwd(), 'assets', 'templates', 'seers-report-portrait-2026.docx')
const FONT = 'Pretendard Variable'
const BODY_SZ = 20 // 10pt (양식 안내: 소제목·내용 Pretendard Variable 10pt)
const TABLE_SZ = 18 // 9pt
const NOTE_SZ = 17
const NAVY = '0F4290'
const HEAD_FILL = 'E8EDF5'
const KEY_FILL = 'F2F2F2'
const BORDER = 'BFBFBF'
const NOTE_COLOR = '595959'
const CONTENT_W = 11906 - 1134 * 2 // A4 - 좌우 여백 (9638)
const IND = 440 // 목차 본문 들여쓰기
const SUB_IND = 880 // 하위 항목 본문 들여쓰기
/** 하위 번호 목록 — 하위 항목이 있는 목차 순서대로 양식의 numId 3~9를 쓰고, 모자라면 101부터 추가 생성 */
const TEMPLATE_SUB_NUM_IDS = [3, 4, 5, 6, 7, 8, 9]
const EXTRA_NUM_BASE = 101
const SECTION_NUM_ID = 2
const BULLET_NUM_ID = 1
const LINE = 264

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type RunOpt = { sz?: number; bold?: boolean; color?: string }
function rPr(o: RunOpt = {}): string {
  const sz = o.sz ?? BODY_SZ
  return `<w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}"/>${o.bold ? '<w:b/><w:bCs/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`
}
function runs(text: string, o: RunOpt = {}): string {
  return text.split('\n').map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${rPr(o)}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('')
}

/** 양식 목차 문단 (`1.`) — 굵게 */
function pSection(title: string, first: boolean): string {
  return `<w:p><w:pPr><w:pStyle w:val="a8"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${SECTION_NUM_ID}"/></w:numPr><w:spacing w:before="${first ? 120 : 280}" w:after="60" w:line="${LINE}" w:lineRule="auto"/><w:ind w:leftChars="0"/><w:keepNext/>${rPr({ bold: true })}</w:pPr>${runs(title, { bold: true })}</w:p>`
}
/** 양식 하위 문단 (`1)`) — 굵게 */
function pSub(title: string, numId: number): string {
  return `<w:p><w:pPr><w:pStyle w:val="a8"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr><w:spacing w:before="100" w:after="40" w:line="${LINE}" w:lineRule="auto"/><w:ind w:leftChars="0"/><w:keepNext/>${rPr({ bold: true })}</w:pPr>${runs(title, { bold: true })}</w:p>`
}
function pText(text: string, indent: number, o: RunOpt = {}, sp = { before: 20, after: 60 }, jc: 'both' | 'left' = 'both'): string {
  return `<w:p><w:pPr><w:spacing w:before="${sp.before}" w:after="${sp.after}" w:line="${LINE}" w:lineRule="auto"/>${indent ? `<w:ind w:left="${indent}"/>` : ''}<w:jc w:val="${jc}"/>${rPr(o)}</w:pPr>${runs(text, o)}</w:p>`
}
function pBullet(item: string | { lead: string; text: string }, indent: number): string {
  const body = typeof item === 'string' ? runs(item) : runs(item.lead, { bold: true }) + runs(` — ${item.text}`)
  return `<w:p><w:pPr><w:pStyle w:val="a8"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${BULLET_NUM_ID}"/></w:numPr><w:spacing w:before="30" w:after="30" w:line="${LINE}" w:lineRule="auto"/><w:ind w:left="${indent + 580}" w:hanging="220"/><w:jc w:val="both"/>${rPr()}</w:pPr>${body}</w:p>`
}
const spacer = () => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/>${rPr({ sz: 8 })}</w:pPr></w:p>`

type CellOpt = { fill?: string; bold?: boolean; color?: string; align?: string; keepNext?: boolean; span?: number }
function cell(text: string, w: number, o: CellOpt): string {
  const jc = `<w:jc w:val="${o.align === 'center' ? 'center' : o.align === 'right' ? 'right' : 'left'}"/>`
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span && o.span > 1 ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>` +
    `<w:p><w:pPr>${o.keepNext ? '<w:keepNext/>' : ''}<w:snapToGrid w:val="0"/><w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/>${jc}${rPr({ sz: TABLE_SZ, bold: o.bold, color: o.color })}</w:pPr>${runs(text || '', { sz: TABLE_SZ, bold: o.bold, color: o.color })}</w:p></w:tc>`
}
function tableXml(ws: number[], indent: number, rowsXml: string): string {
  const width = ws.reduce((a, x) => a + x, 0)
  const b = (side: string, color: string, sz: number) => `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/>`
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/>${indent ? `<w:tblInd w:w="${indent}" w:type="dxa"/>` : ''}` +
    `<w:tblBorders>${b('top', NAVY, 8)}${b('left', BORDER, 4)}${b('bottom', NAVY, 8)}${b('right', BORDER, 4)}${b('insideH', BORDER, 4)}${b('insideV', BORDER, 4)}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:top w:w="28" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:bottom w:w="28" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rowsXml}</w:tbl>${spacer()}`
}
function widths(rel: number[], total: number): number[] {
  const sum = rel.reduce((a, c) => a + c, 0)
  const ws = rel.map((c) => Math.floor((c / sum) * total))
  ws[ws.length - 1] += total - ws.reduce((a, x) => a + x, 0)
  return ws
}
const HEAD_CELL: CellOpt = { fill: HEAD_FILL, bold: true, color: NAVY, align: 'center', keepNext: true }
const headRow = (cells: string) => `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${cells}</w:tr>`
const row = (cells: string) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells}</w:tr>`

function table(b: Extract<ReportBlock, { type: 'table' }>, indent: number): string {
  const ws = widths(b.columns.map((c) => c.width), CONTENT_W - indent)
  const head = headRow(b.columns.map((c, i) => cell(c.label, ws[i], HEAD_CELL)).join(''))
  const body = b.rows.map((r, ri) => {
    const total = b.totalRow && ri === b.rows.length - 1
    return row(r.map((t, i) => {
      const key = total || (b.keyColumn && i === 0)
      return cell(t, ws[i], { fill: key ? KEY_FILL : undefined, bold: key, align: b.columns[i]?.align })
    }).join(''))
  }).join('')
  return tableXml(ws, indent, head + body)
}
/** 항목표 — [항목,값,항목,값] / [항목,값(나머지 3칸 병합)] */
function kvTable(b: Extract<ReportBlock, { type: 'kv' }>, indent: number): string {
  const ws = widths([1400, 3195, 1400, 3195], CONTENT_W - indent)
  const key: CellOpt = { fill: KEY_FILL, bold: true }
  const body = b.rows.map((r) => row(r.length >= 4
    ? cell(r[0], ws[0], key) + cell(r[1], ws[1], {}) + cell(r[2], ws[2], key) + cell(r[3], ws[3], {})
    : cell(r[0], ws[0], key) + cell(r[1] ?? '', ws[1] + ws[2] + ws[3], { span: 3 }))).join('')
  return tableXml(ws, indent, body)
}
/** 요약 지표 — 본문 전체 폭, 머리/값(굵게)/보조 */
function kpiTable(b: Extract<ReportBlock, { type: 'kpi' }>): string {
  const ws = widths(b.items.map(() => 1), CONTENT_W)
  const head = headRow(b.items.map((x, i) => cell(x.label, ws[i], HEAD_CELL)).join(''))
  const val = row(b.items.map((x, i) => cell(x.value, ws[i], { bold: true, align: 'center' })).join(''))
  const sub = row(b.items.map((x, i) => cell(x.sub, ws[i], { align: 'center' })).join(''))
  return tableXml(ws, 0, head + val + sub)
}

function blocks(bs: ReportBlock[], indent: number): string {
  return bs.map((b) => {
    switch (b.type) {
      case 'para': return pText(b.text, indent, b.tone === 'muted' ? { color: '7F7F7F' } : b.tone === 'warn' ? { color: 'C00000' } : {})
      case 'note': return pText(b.text, Math.min(indent, IND), { sz: NOTE_SZ, color: NOTE_COLOR }, { before: 40, after: 60 }, 'left')
      case 'bullets': return b.items.map((t) => pBullet(t, indent)).join('')
      case 'table': return table(b, IND)
      case 'kv': return kvTable(b, IND)
      case 'kpi': return kpiTable(b)
    }
  }).join('')
}

/** 하위 항목이 있는 목차마다 번호 목록 1개 (1)부터 다시) */
function subNumIds(doc: ReportDoc): (number | null)[] {
  let k = 0
  return doc.sections.map((s) => {
    if (!s.items.some((it) => it.title)) return null
    const id = k < TEMPLATE_SUB_NUM_IDS.length ? TEMPLATE_SUB_NUM_IDS[k] : EXTRA_NUM_BASE + (k - TEMPLATE_SUB_NUM_IDS.length)
    k++
    return id
  })
}

export function renderBodyXml(doc: ReportDoc): string {
  const ids = subNumIds(doc)
  const intro = doc.intro.map((b) => blocks([b], 0)).join('')
  const body = doc.sections.map((s, si) => {
    let x = pSection(s.title, si === 0 && !doc.intro.length)
    for (const it of s.items) {
      if (it.title) x += pSub(it.title, ids[si]!) + blocks(it.blocks, SUB_IND)
      else x += blocks(it.blocks, IND)
    }
    return x
  }).join('')
  return intro + body + blocks(doc.outro, IND)
}

/** 결재 표의 빈 값 칸(run 없는 문단)에 텍스트 채우기 — n번째 <w:tc> */
function fillCell(tbl: string, cellIndex: number, text: string): string {
  const re = /<w:tc>[\s\S]*?<\/w:tc>/g
  let i = 0
  return tbl.replace(re, (tc) => {
    if (i++ !== cellIndex) return tc
    const end = tc.lastIndexOf('</w:p>')
    return `${tc.slice(0, end)}<w:r>${rPr()}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>${tc.slice(end)}`
  })
}

export async function buildReportDocx(doc: ReportDoc): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE_PATH))

  // 머리글 문서번호
  for (const name of Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async('string')
    if (xml.includes('ST-P-26xxxx-xx')) zip.file(name, xml.replace('ST-P-26xxxx-xx', esc(doc.header.docNumber || 'ST-P-26xxxx-xx')))
  }

  // 양식에 없는 하위 번호 목록 추가 — abstract 0 재사용, 1부터 다시
  const extra = subNumIds(doc).filter((id): id is number => id != null && id >= EXTRA_NUM_BASE)
  if (extra.length) {
    const numXml = await zip.file('word/numbering.xml')!.async('string')
    const add = extra.filter((id) => !numXml.includes(`w:numId="${id}"`))
      .map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')
    if (add) zip.file('word/numbering.xml', numXml.replace('</w:numbering>', `${add}</w:numbering>`))
  }

  const xml = await zip.file('word/document.xml')!.async('string')
  const bodyStart = xml.indexOf('<w:body>') + '<w:body>'.length
  const tblEnd = xml.indexOf('</w:tbl>') + '</w:tbl>'.length
  const sectStart = xml.lastIndexOf('<w:sectPr')
  if (bodyStart < 8 || tblEnd < 8 || sectStart < tblEnd) throw new Error('보고서 양식 템플릿 구조가 예상과 다릅니다')

  // 표0 셀 순서: 0~3 머리, 4~7 서명칸, 8 '제목', 9 제목값, 10 '작성일자', 11 일자, 12 '작성부서', 13 부서, 14 '작성자', 15 작성자
  let tbl = xml.slice(bodyStart, tblEnd)
  tbl = fillCell(tbl, 9, doc.header.title)
  tbl = fillCell(tbl, 11, doc.header.date)
  tbl = fillCell(tbl, 13, doc.header.dept)
  tbl = fillCell(tbl, 15, doc.header.author)

  const out = xml.slice(0, bodyStart) + tbl + spacer() + renderBodyXml(doc) + xml.slice(sectStart)
  zip.file('word/document.xml', out)

  // 문서 속성 제목
  const core = zip.file('docProps/core.xml')
  if (core) {
    const c = await core.async('string')
    zip.file('docProps/core.xml', c.includes('<dc:title>') ? c.replace(/<dc:title>[\s\S]*?<\/dc:title>/, `<dc:title>${esc(doc.header.title)}</dc:title>`) : c.replace('</cp:coreProperties>', `<dc:title>${esc(doc.header.title)}</dc:title></cp:coreProperties>`))
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
