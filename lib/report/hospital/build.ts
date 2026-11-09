import type { ReportBlock, ReportDoc, ReportItem, ReportSection } from '../doc'
import { AS_CATEGORY_LABELS } from '@/lib/asReceiptShared'
import type { HospitalReportAi, HospitalReportFacts, KindCount, VocItem } from './types'

/**
 * facts(+AI 결과) → 고객 운영 이력 레포트 문서 모델 (projects/hospital_report_design.md §5)
 * 구성은 병원과 무관하게 고정 (기준: 제주한라병원_운영레포트_20261107 — 2026-11-08 사용자 지정 양식)
 *   요약(번호 없음: 기준 줄·요약 3문단·지표 4칸)
 *   1. 병원 개요  2. 계약 및 구축 이력  3. 운영 연혁  4. AS 현황(1~4)  5. 진행 중 · 미결 사항
 *   6. VOC 현황(1~2)  7. 주요 서비스 이슈  8. 시사점  / 출처
 * 숫자·표는 facts에서만 만든다. AI 칸(요약·확인된 내용·반복 주제·주요 이슈·AS 프로세스·시사점)은 ai가 없으면 상태 문구.
 * 데이터 점검 규칙(facts.checks)은 별도 표 없이 해당 표 아래 ※ 주석으로 붙인다.
 */

export type AiState = 'pending' | 'running' | 'done' | 'failed'

export interface BuildOpts {
  docNumber: string | null
  date: string // YYYY.MM.DD
  dept: string
  author: string
  aiState: AiState
  aiError?: string | null
  model?: string | null
  effort?: string | null
  generatedAt?: string | null // ISO
}

const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('ko-KR'))
const won = (v: number | null | undefined) => (v == null ? null : `${v.toLocaleString('ko-KR')}원`)
const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—')
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
const ymd = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
/** ISO → 'YYYY-MM-DD HH:mm' (KST) — 서버 Node ICU 로케일에 기대지 않음 */
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')
const korDate = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${y}년 ${m}월 ${dd}일` }
const md = (d: string) => { const [, m, dd] = d.split('-').map(Number); return `${m}/${dd}` }
const emptyRow = (cols: number, text = '기록 없음') => [text, ...Array(cols - 1).fill('')]
const sumKind = (k: KindCount) => k.spo2 + k.ecg + k.other
const kindText = (k: KindCount) => [k.spo2 ? `산소포화도 ${n(k.spo2)}` : null, k.ecg ? `심전계 ${n(k.ecg)}` : null, k.other ? `기타 ${n(k.other)}` : null].filter(Boolean).join(' · ') || '—'

/** 접수 경로 표기 — as_receipts.source / vocs.source 어휘 (schema.prisma 주석 기준) */
export const AS_SOURCE_LABEL: Record<string, string> = { IMPORT: 'AS이력 시트 이관', SHEET: 'AS 시트 연동', CHANNELTALK: '채널톡 상담 자동', INTAKE_QUEUE: '채널톡 등록대기 확정', MANUAL: '화면 등록' }
export const VOC_SOURCE_LABEL: Record<string, string> = { SHEET: 'VOC현황 시트 이관', CHANNELTALK: '채널톡 상담 자동 승격', MANUAL: '화면 등록' }

/** 전화번호 가리기 — VOC 제목·본문·메모에 고객 연락처가 섞여 들어오는 경우가 있어 레포트에는 싣지 않는다 */
export const maskPhone = (t: string) => t.replace(/(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g, '(연락처 생략)')

/** VOC 한 줄 요약 — 제목이 짧으면 본문 앞부분(시트 메모 블록 제외) */
export function vocBrief(v: VocItem, max = 90): string {
  const body = v.content.split('[VOC현황 시트')[0].split('[채널톡 상담]')[0].replace(/\s+/g, ' ').trim()
  const t = v.title.length >= 12 ? v.title : body || v.title
  const m = maskPhone(t)
  return m.length > max ? `${m.slice(0, max)}…` : m
}

/** 날짜 범위 — 같은 날 하나, 같은 달 'YYYY-MM-DD~DD', 같은 해 'YYYY-MM-DD~MM-DD' (sep으로 구분자 지정) */
function span(a: string, b: string, sep = '-'): string {
  const f = (x: string) => x.replace(/-/g, sep)
  if (a === b) return f(a)
  if (a.slice(0, 7) === b.slice(0, 7)) return `${f(a)}~${b.slice(8)}`
  return a.slice(0, 4) === b.slice(0, 4) ? `${f(a)}~${f(b.slice(5))}` : `${f(a)}~${f(b)}`
}
const dateRange = (vs: VocItem[]) => (vs.length ? span(vs[0].receivedAt, vs[vs.length - 1].receivedAt, '.') : '—')

function aiPlaceholder(state: AiState, err?: string | null): ReportBlock {
  if (state === 'failed') return { type: 'para', tone: 'warn', text: `AI 분석에 실패했습니다${err ? ` (${err})` : ''}. 레포트 화면에서 [AI 다시 실행]을 눌러 주세요.` }
  return { type: 'para', tone: 'muted', text: 'AI 분석 중입니다. 완료되면 이 칸이 채워집니다.' }
}

export function buildHospitalReportDoc(f: HospitalReportFacts, ai: HospitalReportAi | null, o: BuildOpts): ReportDoc {
  const h = f.hospital
  const a = f.as
  const vocByCode = new Map(f.voc.items.map((v) => [v.code, v]))
  const hasAi = o.aiState === 'done' && !!ai
  const asOfDay = ymd(f.asOf)
  const warn = new Map(f.checks.filter((c) => c.level === 'warn').map((c) => [c.key, c]))
  const warnStart = (prefix: string) => f.checks.filter((c) => c.level === 'warn' && c.key.startsWith(prefix))
  const contracted = f.devices.contracted
  const contractedTotal = sumKind(contracted)
  const deal0 = f.deals[0]

  // ── 요약 (번호 없음)
  const openReceipts = a.receipts.filter((r) => !r.resolvedAt)
  const openLines = openReceipts.reduce((s, r) => s + r.lines, 0)
  const openAllJudged = openReceipts.length > 0 && openReceipts.every((r) => r.receivedAt && r.repaired + r.noFault > 0)
  const statusCount = (xs: { status: string | null }[]) => {
    const m = new Map<string, number>()
    for (const x of xs) m.set(x.status ?? '진행', (m.get(x.status ?? '진행') ?? 0) + 1)
    return Array.from(m.entries()).map(([k, v]) => `${k} ${v}`).join(' · ')
  }
  const vocClosed = f.voc.byStatus.filter((s) => s.status === '종결').reduce((s, x) => s + x.count, 0)
  const intro: ReportBlock[] = [
    { type: 'note', text: `${h.code} | ${korDate(asOfDay)} | 데이터 기준: 운영관리시스템 ${kst(f.asOf)} 조회` },
    ...(hasAi ? ai!.summary.split(/\n+/).map((t) => t.trim()).filter(Boolean).map((t) => ({ type: 'para' as const, text: t })) : [aiPlaceholder(o.aiState, o.aiError)]),
    {
      type: 'kpi',
      items: [
        { label: 'AS 접수', value: `${n(a.totals.receipts)}회 / ${n(a.totals.lines)}대`, sub: kindText(a.totals.kind) },
        { label: 'VOC', value: `${n(f.voc.total)}건`, sub: f.voc.total ? `종결 ${n(vocClosed)} · 미종결 ${n(f.voc.total - vocClosed)}` : '기록 없음' },
        { label: '진행 중 AS', value: `${openReceipts.length}건 / ${n(openLines)}대`, sub: openReceipts.length ? (openAllJudged ? '입고·수리 판정 완료' : statusCount(openReceipts)) : '없음' },
        { label: '기기 원장 등록', value: `${n(f.devices.activeTotal)}대`, sub: contractedTotal ? `계약 ${n(contractedTotal)}대 대비 ${pct(f.devices.activeTotal, contractedTotal)}` : '계약 수량 미기재' },
      ],
    },
  ]

  // ── 1. 병원 개요
  const wards = f.devices.wards
  const contacts = h.contacts ?? []
  const overview: ReportBlock = {
    type: 'kv',
    rows: [
      ['병원코드', h.code, '종별', dash(h.type)],
      ['주소', dash(h.address), '운영상태', dash(h.status)],
      ['도입형태', dash(h.introType), '도입병상', h.introBeds ? `${n(h.introBeds)}병상` : '—'],
      ['계약일', dash(h.contractDate), '대웅 담당', dash([deal0?.daewoongDivision, deal0?.daewoongOffice, deal0?.daewoongManager].filter(Boolean).join(' · '))],
      ['병원 태그', h.tags.length ? h.tags.map((t) => `${t.name}${t.description ? ` (${t.description})` : ''}`).join(', ') : '—', '대웅 거래처코드', dash(h.daewoongClientCode)],
      ['AS 운영 메모', h.asMemo ? `${maskPhone(h.asMemo)}${h.asMemoUpdatedAt ? ` — ${h.asMemoUpdatedAt} 기록` : ''}` : '—'],
      ['병원 측 창구', contacts.length ? contacts.map((c) => [c.department, c.name, c.title].filter(Boolean).join(' ') + (c.note ? ` (${maskPhone(c.note)})` : '')).join('\n') : '시스템 미등록'],
      [`원장 병동 (${wards.length})`, wards.length ? wards.map((w) => w.name).join(' · ') + (f.devices.noWard ? `\n+ 병동 미지정 ${n(f.devices.noWard)}대` : '') : '—'],
    ],
  }
  const s1Notes: string[] = []
  if (warn.has('infra_missing')) s1Notes.push('※ 서버 구성·EMR 연동 정보, 원격 접속 URL은 시스템에 등록되어 있지 않습니다.')
  if (warn.has('registry_ratio')) s1Notes.push(`※ 기기 원장 등록률: ${warn.get('registry_ratio')!.detail} — ${warn.get('registry_ratio')!.impact}.`)
  if (warn.has('device_no_ward')) s1Notes.push(`※ 원장 병동 미지정: ${warn.get('device_no_ward')!.detail}.`)

  // ── 2. 계약 및 구축 이력
  const contractRows: string[][] = []
  for (const x of f.deals) {
    const scope = [x.wardsText, x.wardCount ? `${x.wardCount}병동` : null, x.bedCount ? `${n(x.bedCount)}병상` : null].filter(Boolean).join(' ')
    contractRows.push(['영업 딜', `${x.code}${x.roundNo ? ` (${x.roundNo}차${x.status ? `, ${x.status}` : ''})` : x.status ? ` (${x.status})` : ''}${x.contractDate ? ` — ${x.contractDate} 계약` : ''}${scope ? `, ${scope}` : ''}${x.remark ? `, ${x.remark}` : ''}`])
    if (x.devices.length) contractRows.push(['도입 기기', x.devices.map((v) => `${v.name} ${n(v.qty)}대`).join(' · ')])
    const amounts = [won(x.amountTotal) && `계약금액(총견적가) ${won(x.amountTotal)}`, won(x.amountProduct) && `제품 ${won(x.amountProduct)}`, won(x.amountConstruction) && `공사비 ${won(x.amountConstruction)}`, won(x.amountActual) && `실판매액 ${won(x.amountActual)}`].filter(Boolean).join(' · ')
    const settle = [x.taxInvoice && `세금계산서 ${x.taxInvoice}`, x.settlement && `정산 ${x.settlement}`].filter(Boolean).join(' · ')
    if (amounts || settle) contractRows.push(['계약 금액 (대웅 원장)', [amounts, settle].filter(Boolean).join(' / ')])
  }
  for (const p of f.projects) {
    contractRows.push(['구축 프로젝트', `${p.code} ${p.name}${p.buildStatus ? ` — ${p.buildStatus}` : ''}${p.constructor ? `, 시공사 ${p.constructor}` : ''}${[p.wardCount ? `${p.wardCount}병동` : null, p.bedCount ? `${n(p.bedCount)}병상` : null, p.gatewayCount ? `게이트웨이 ${n(p.gatewayCount)}대` : null].filter(Boolean).map((t) => `, ${t}`).join('')}`])
    contractRows.push(['구축 일정', `착수 ${dash(p.startDate)} · 완료 예정 ${dash(p.endDateExpected)} · 교육 ${dash(p.educationDate)}`])
  }
  const s2Notes = [...warnStart('ward_mismatch_'), ...warnStart('project_missing_')].map((c) => `※ ${c.label}: ${c.detail}.`)

  // ── 3. 운영 연혁 (규칙 연혁 + AI 주요 이슈를 '서비스 이슈'로 합침)
  const issues = hasAi
    ? ai!.keyIssues.map((k) => {
        const codes = k.vocCodes?.length ? k.vocCodes : k.vocCode ? [k.vocCode] : []
        const vs = codes.map((c) => vocByCode.get(c)).filter((v): v is VocItem => !!v).sort((x, y) => x.receivedAt.localeCompare(y.receivedAt))
        return { k, vs, rep: vocByCode.get(codes[0]) }
      }).filter((x) => x.rep)
    : []
  const tl = [
    ...f.timeline.map((t) => ({ sort: t.date, date: t.text.startsWith('월 최대') ? t.date.slice(0, 7) : t.date, kind: t.kind, text: t.text })),
    ...issues.map(({ k, vs }) => ({
      sort: vs[0].receivedAt,
      date: span(vs[0].receivedAt, vs[vs.length - 1].receivedAt),
      kind: '서비스 이슈',
      text: `${k.issue}${k.ask ? ` — ${k.ask}` : ''}`,
    })),
  ].sort((x, y) => x.sort.localeCompare(y.sort))

  // ── 4. AS 현황
  const avg = a.totals.receipts ? (a.totals.lines / a.totals.receipts).toFixed(1) : null
  const bySource = new Map<string, { first: string; last: string; count: number }>()
  for (const r of a.receipts) {
    const k = (r.source && AS_SOURCE_LABEL[r.source]) || r.source || '경로 미기재'
    const e = bySource.get(k)
    if (!e) bySource.set(k, { first: r.receiptDate, last: r.receiptDate, count: 1 })
    else { e.last = r.receiptDate; e.count++ }
  }
  const asIntro = a.totals.receipts
    ? `AS는 지금까지 ${n(a.totals.receipts)}회 · ${n(a.totals.lines)}대가 접수되었고, 회당 평균 ${avg}대입니다.${a.peakMonth ? ` 월 최대 접수는 ${a.peakMonth.month.replace('-', '.')}의 ${a.peakMonth.receipts}회 ${n(a.peakMonth.lines)}대입니다.` : ''} 접수 경로는 ${Array.from(bySource.entries()).map(([k, v]) => `${k} ${v.count}회(${v.first.slice(0, 7)}${v.first.slice(0, 7) !== v.last.slice(0, 7) ? `~${v.last.slice(0, 7)}` : ''})`).join(', ')}입니다.`
    : 'AS 접수 기록이 없습니다.'
  const qRows = a.quarters.map((q) => [q.label, `${q.receipts}회`, `${n(q.kind.spo2)}대`, `${n(q.kind.ecg)}대`, `${n(q.total)}대`])
  if (qRows.length) {
    const last = qRows.length - 1
    if (a.quarters[last].label === `${asOfDay.slice(0, 4)}년 ${Math.floor((Number(asOfDay.slice(5, 7)) - 1) / 3) + 1}분기`) qRows[last][0] += ` (${md(asOfDay)} 기준)`
    qRows.push(['합계', `${a.totals.receipts}회`, `${n(a.totals.kind.spo2)}대`, `${n(a.totals.kind.ecg)}대`, `${n(a.totals.lines)}대`])
  }
  // 첫 접수~기준월 사이 접수 없는 달
  const gapMonths: string[] = []
  if (a.receipts.length >= 2) {
    const have = new Set(a.receipts.map((r) => r.receiptDate.slice(0, 7)))
    let [y, m] = a.receipts[0].receiptDate.slice(0, 7).split('-').map(Number)
    const end = asOfDay.slice(0, 7)
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      if (key >= end) break
      if (!have.has(key)) gapMonths.push(`${y}년 ${m}월`)
      m++; if (m > 12) { m = 1; y++ }
    }
  }
  const asMetric = [
    ['완료 / 진행', `${a.totals.done}건 / ${a.totals.open}건`, a.totals.open ? (openAllJudged ? `진행 ${a.totals.open}건은 입고·수리 판정 완료, 출고·종결 대기` : '진행 건은 5. 진행 중 · 미결 사항 참조') : '—'],
    [`처리 소요 (완료 ${a.totals.done}건)`, a.lead.median != null ? `중앙값 ${a.lead.median}일 · 평균 ${a.lead.avg}일` : '—', a.lead.longest.length ? `장기: ${a.lead.longest.map((x) => `${x.code.replace(/^AS-\d{6}-/, '')} ${x.days}일`).join(', ')}` : '—'],
    ['라인 처리 결과', `수리 후 반환 ${n(a.outcome.repairReturn)} · 교체 ${n(a.outcome.replace)} · 취소 ${n(a.outcome.canceled)} · 미확정 ${n(a.outcome.undecided)}`, a.outcome.undecided ? `미확정 ${n(a.outcome.undecided)} = 진행 ${a.totals.open}건 ${n(a.outcome.undecided - a.outcome.undecidedInDone)} + 완료건 라인 결과 미기재 ${n(a.outcome.undecidedInDone)}` : '—'],
    ['반복 AS', `고유 시리얼 ${n(a.repeat.distinctSerials)}대 중 ${n(a.repeat.repeatedSerials)}대 (${pct(a.repeat.repeatedSerials, a.repeat.distinctSerials)})`, a.repeat.dist.length ? a.repeat.dist.map((x) => `${x.times}회 ${x.serials}대`).join(' · ') + (a.repeat.top[0] ? ` (최다 ${a.repeat.top[0].serial} ${a.repeat.top[0].times}회)` : '') : '—'],
    ['도입 대비 AS 비중 (참고)', [contracted.spo2 ? `산소포화도 ${n(a.distinctByKind.spo2)}/${n(contracted.spo2)} (${pct(a.distinctByKind.spo2, contracted.spo2)})` : null, contracted.ecg ? `심전계 ${n(a.distinctByKind.ecg)}/${n(contracted.ecg)} (${pct(a.distinctByKind.ecg, contracted.ecg)})` : null].filter(Boolean).join(' · ') || '—', '고유 시리얼 기준 — 교체로 들어온 기기 포함, 상한값'],
  ]
  const asMetricNotes: string[] = []
  if (warn.has('as_ward_missing')) asMetricNotes.push(`※ AS 라인 병동 미기재: ${warn.get('as_ward_missing')!.detail} — ${warn.get('as_ward_missing')!.impact}.`)
  const r = a.repair
  const repairItem: ReportItem = {
    title: r.judged ? `수리 판정 결과 (판정 기록 ${n(r.judged)}대)` : '수리 판정 결과',
    blocks: r.judged
      ? [
          { type: 'para', text: `입고 시 수리 판정이 기록된 ${n(r.judged)}대 중 ${n(r.repaired)}대가 수리, ${n(r.noFault)}대가 이상 없음으로 판정됐습니다.${r.byKind.length ? ` 이상 없음 비율은 ${r.byKind.map((k) => `${k.kind} ${pct(k.noFault, k.repaired + k.noFault)}(${k.noFault}/${k.repaired + k.noFault})`).join(', ')}입니다.` : ''}` },
          ...(r.findings.length
            ? [
                { type: 'table' as const, columns: [{ label: '판정 소견 (중복 포함)', width: 58 }, { label: '대수', width: 21, align: 'center' as const }, { label: '비중', width: 21, align: 'center' as const }], rows: r.findings.map((x) => [x.label, n(x.count), pct(x.count, r.judged)]) },
                { type: 'note' as const, text: '※ 한 기기에 소견이 여럿 기록될 수 있어 비중의 합은 100%를 넘을 수 있습니다.' },
              ]
            : []),
        ]
      : [{ type: 'para', tone: 'muted', text: '수리 판정 기록이 없습니다.' }],
  }
  const asItems: ReportItem[] = [
    { title: null, blocks: [{ type: 'para', text: asIntro }] },
    {
      title: '분기별 접수 추이',
      blocks: [
        { type: 'table', totalRow: qRows.length > 0, columns: [{ label: '기간', width: 30 }, { label: '접수 횟수', width: 17.5, align: 'center' }, { label: '산소포화도', width: 17.5, align: 'center' }, { label: '심전계', width: 17.5, align: 'center' }, { label: '합계', width: 17.5, align: 'center' }], rows: qRows.length ? qRows : [emptyRow(5)] },
        ...(gapMonths.length ? [{ type: 'note' as const, text: `※ ${gapMonths.join(', ')}에는 접수 기록이 없습니다.` }] : []),
      ],
    },
    {
      title: '처리 결과와 소요 기간',
      blocks: [
        { type: 'table', keyColumn: true, columns: [{ label: '지표', width: 22 }, { label: '값', width: 37 }, { label: '비고', width: 41 }], rows: asMetric },
        ...asMetricNotes.map((t) => ({ type: 'note' as const, text: t })),
      ],
    },
    repairItem,
    { title: 'AS 운영 프로세스', blocks: hasAi ? [ai!.asProcess ? { type: 'para', text: ai!.asProcess } : { type: 'para', tone: 'muted', text: '시스템 기록(AS 메모·병원 태그·상담)에서 확인되는 처리 흐름이 없습니다.' }] : [aiPlaceholder(o.aiState, o.aiError)] },
  ]

  // ── 5. 진행 중 · 미결 사항
  const openRows: string[][] = []
  for (const x of openReceipts) {
    openRows.push([
      `${x.code} (${md(x.receiptDate)}, ${x.lines}대: ${kindText(x.kind)}${x.category && x.category !== 'FAULT' ? `, ${AS_CATEGORY_LABELS[x.category as keyof typeof AS_CATEGORY_LABELS] ?? x.category}` : ''})`,
      [x.pickedUpAt && `${md(x.pickedUpAt)} 수거`, x.receivedAt && `${md(x.receivedAt)} 입고`, x.repaired + x.noFault ? `수리 ${x.repaired} · 이상 없음 ${x.noFault} 판정` : null].filter(Boolean).join(' → ') + `. 상태 '${x.status ?? '진행'}'`,
      x.repaired + x.noFault ? '수리품 출고·라인 결과 확정 후 종결' : '입고·판정 진행 확인',
    ])
    const others = a.otherHospitalSerials.filter((s) => s.asCode === x.code)
    if (others.length) openRows.push([`└ 타병원 등록 시리얼 ${others.length}대`, `${others.map((s) => s.serial).join(' · ')} — 원장상 ${Array.from(new Set(others.map((s) => s.hospitalName))).join(', ')} 배치 상태`, '원장 확정 처리 방안 결정'])
  }
  const mismatch = warn.get('voc_status_mismatch')?.detail ?? ''
  const repliedOpen = warn.get('voc_replied_open')?.detail ?? ''
  for (const v of f.voc.unresolved) {
    const isMismatch = mismatch.includes(v.code)
    openRows.push([
      `${v.code} ${maskPhone(v.title.length > 40 ? `${v.title.slice(0, 40)}…` : v.title)}`,
      isMismatch ? `본문은 종료로 기록, 시스템 상태는 '${v.status}'` : v.status === '회신완료' ? `${md(v.receivedAt)} 접수 — 회신 후 종결 미처리` : `${md(v.receivedAt)} 접수 — 상태 '${v.status}'`,
      isMismatch ? '상태 정리 (종결)' : v.status === '회신완료' || repliedOpen.includes(v.code) ? '종결 처리' : '진행 확인',
    ])
  }
  for (const m of f.maintenances.filter((m) => !m.resolvedAt)) openRows.push([`${m.code} ${m.title}`, `유지보수 ${m.reportedAt ? `${md(m.reportedAt)} 접수 — ` : ''}상태 '${m.status ?? '진행'}'`, '진행 확인'])
  for (const e of f.etcTasks.filter((e) => !e.resolvedAt)) openRows.push([`${e.code} ${e.title}`, `기타업무 ${e.reportedAt ? `${md(e.reportedAt)} 접수 — ` : ''}상태 '${e.status ?? '진행'}'`, '진행 확인'])

  // ── 6. VOC 현황
  const groupNote = new Map((hasAi ? ai!.groupNotes ?? [] : []).map((g) => [g.group, g.note]))
  const vocGroupRows = f.voc.byGroup.map((g) => [g.group, n(g.count), g.subs.map((s) => `${s.name} ${s.count}`).join(' · '), hasAi ? groupNote.get(g.group) ?? '—' : o.aiState === 'failed' ? 'AI 분석 실패' : 'AI 분석 중'])
  if (vocGroupRows.length) vocGroupRows.push(['합계', n(f.voc.total), '', ''])
  const vocIntro = f.voc.total
    ? `VOC는 ${n(f.voc.total)}건이며 ${f.voc.firstAt}부터 ${f.voc.lastAt}까지 접수됐습니다. 기록 경로는 ${f.voc.bySource.map((s) => `${VOC_SOURCE_LABEL[s.source] ?? s.source} ${s.count}건`).join(', ')}입니다. 분기별로는 ${f.voc.byQuarter.map((q) => `${q.label} ${q.count}건`).join(', ')}입니다.`
    : 'VOC 기록이 없습니다.'
  const vocGap = warn.get('voc_gap')
  const themeBlocks: ReportBlock[] = hasAi
    ? ai!.themes.length
      ? [{
          type: 'table',
          columns: [{ label: '주제', width: 22 }, { label: '횟수', width: 8, align: 'center' }, { label: '기간', width: 20, align: 'center' }, { label: '시사점', width: 50 }],
          rows: ai!.themes.map((t) => {
            const vs = t.vocCodes.map((c) => vocByCode.get(c)).filter((v): v is VocItem => !!v).sort((x, y) => x.receivedAt.localeCompare(y.receivedAt))
            const a1 = vs[0]?.receivedAt.slice(0, 7), b1 = vs[vs.length - 1]?.receivedAt.slice(0, 7)
            return [t.name, n(vs.length), vs.length ? (a1 === b1 ? a1 : `${a1} ~ ${b1}`) : '—', t.insight]
          }),
        }, { type: 'note', text: '※ 주제 묶음은 AI가 VOC 본문과 채널톡 상담을 읽고 분류한 결과이며(분류 코드 기준 아님), 횟수·기간은 시스템이 해당 VOC로 다시 센 값입니다.' }]
      : [{ type: 'para', tone: 'muted', text: '2건 이상 반복된 문의 주제가 없습니다.' }]
    : [aiPlaceholder(o.aiState, o.aiError)]

  // ── 7. 주요 서비스 이슈
  const issueBlocks: ReportBlock[] = hasAi
    ? issues.length
      ? [{
          type: 'table',
          columns: [{ label: '접수일', width: 19, align: 'center' }, { label: '이슈', width: 16 }, { label: '문의 내용', width: 29 }, { label: '조치 및 확인 결과', width: 36 }],
          rows: issues.map(({ k, vs, rep }) => [dateRange(vs), k.issue, k.ask || vocBrief(rep!, 70), k.action]),
        }]
      : [{ type: 'para', tone: 'muted', text: '별도로 짚을 주요 서비스 이슈가 없습니다.' }]
    : [aiPlaceholder(o.aiState, o.aiError)]

  // ── 8. 시사점
  const insights = hasAi
    ? ai!.insights ?? [...(ai!.risks ?? []).map((t) => ({ title: '리스크', detail: t })), ...(ai!.recommendations ?? [])]
    : []
  const insightBlocks: ReportBlock[] = hasAi
    ? insights.length ? [{ type: 'bullets', items: insights.map((x) => ({ lead: x.title, text: x.detail })) }] : [{ type: 'para', tone: 'muted', text: '시사점 없음' }]
    : [aiPlaceholder(o.aiState, o.aiError)]

  const sections: ReportSection[] = [
    { title: '병원 개요', items: [{ title: null, blocks: [overview, ...s1Notes.map((t) => ({ type: 'note' as const, text: t }))] }] },
    { title: '계약 및 구축 이력', items: [{ title: null, blocks: [
      { type: 'table', keyColumn: true, columns: [{ label: '구분', width: 20 }, { label: '내용', width: 80 }], rows: contractRows.length ? contractRows : [['—', '영업 딜·구축 프로젝트 기록 없음']] },
      ...s2Notes.map((t) => ({ type: 'note' as const, text: t })),
    ] }] },
    { title: '운영 연혁', items: [{ title: null, blocks: [{ type: 'table', columns: [{ label: '일자', width: 19, align: 'center' }, { label: '구분', width: 14, align: 'center' }, { label: '내용', width: 67 }], rows: tl.length ? tl.map((t) => [t.date, t.kind, t.text]) : [emptyRow(3)] }] }] },
    { title: 'AS 현황', items: asItems },
    { title: `진행 중 · 미결 사항 (${md(asOfDay)} 기준)`, items: [{ title: null, blocks: [{ type: 'table', columns: [{ label: '건', width: 29 }, { label: '현황', width: 44 }, { label: '필요 조치', width: 27 }], rows: openRows.length ? openRows : [emptyRow(3, '미결 사항 없음')] }] }] },
    {
      title: 'VOC 현황',
      items: [
        { title: null, blocks: [{ type: 'para', text: vocIntro }, ...(vocGap ? [{ type: 'note' as const, text: `※ ${vocGap.detail} — 최근 문의가 VOC로 기록되지 않았을 수 있어 건수가 과소 집계됐을 수 있습니다.` }] : [])] },
        { title: '분류별 현황', blocks: [{ type: 'table', totalRow: vocGroupRows.length > 0, columns: [{ label: '대분류', width: 16 }, { label: '건수', width: 8, align: 'center' }, { label: '세부 분류', width: 32 }, { label: '확인된 내용', width: 44 }], rows: vocGroupRows.length ? vocGroupRows : [emptyRow(4)] }] },
        { title: '반복되는 문의 주제', blocks: themeBlocks },
      ],
    },
    { title: '주요 서비스 이슈', items: [{ title: null, blocks: issueBlocks }] },
    { title: '시사점', items: [{ title: null, blocks: insightBlocks }] },
  ]

  // ── 출처
  const sc = new Map(f.sourceCounts.map((s) => [s.label, s.count]))
  const outro: ReportBlock[] = [
    { type: 'note', text: `출처: 운영관리시스템 — 병원·영업 딜(${n(sc.get('영업 딜'))}건)·프로젝트(${n(sc.get('프로젝트'))}건)·기기 원장(${n(sc.get('기기 원장(ACTIVE)'))}대·이벤트 ${n(sc.get('기기 원장 이벤트'))}건)·AS접수(${n(sc.get('AS 접수'))}건·${n(sc.get('AS 기기 라인'))}라인)·VOC(${n(sc.get('VOC'))}건)·채널톡 상담(${n(sc.get('채널톡 상담(병원 매칭)'))}건)·유지보수(${n(sc.get('유지보수'))}건)·기타업무(${n(sc.get('기타업무'))}건)·티켓(${n(sc.get('티켓'))}건). ${kst(f.asOf)} 읽기 전용 조회.` },
  ]
  if (o.model) outro.push({ type: 'note', text: `요약·확인된 내용·반복 문의 주제·주요 서비스 이슈·AS 운영 프로세스·시사점은 AI(${o.model} · effort ${o.effort ?? '—'}${o.generatedAt ? ` · ${kst(o.generatedAt)}` : ''})가 같은 데이터를 읽고 작성했습니다.` })
  if (hasAi && ai!.truncatedVoc > 0) outro.push({ type: 'note', text: `AI 입력 분량 상한으로 오래된 VOC ${ai!.truncatedVoc}건은 AI 분석에서 제외했습니다(수치 집계에는 포함).` })
  if (hasAi) for (const w of ai!.warnings) outro.push({ type: 'note', text: `검증 경고: ${w}` })

  return {
    header: { docNumber: o.docNumber, title: `${h.name}(${h.code}) 고객 운영 이력 레포트`, date: o.date, dept: o.dept, author: o.author },
    intro,
    sections,
    outro,
  }
}
