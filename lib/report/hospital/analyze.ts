import Anthropic from '@anthropic-ai/sdk'
import type { AiEffort } from '@/lib/ai/settings'
import type { HospitalReportAi, HospitalReportFacts } from './types'
import { AS_SOURCE_LABEL, VOC_SOURCE_LABEL, maskPhone } from './build'

/**
 * 병원 고객 운영 이력 레포트 — AI 분석 (projects/hospital_report_design.md §7)
 * 도구 없는 단발 호출 1회. 필요한 사실은 전부 입력으로 넣고, 출력은 구조화 출력(JSON 스키마)으로 정해진 칸만 받는다.
 * AI는 숫자를 만들지 않는다 — 건수·기간은 build 단계에서 vocCodes로 다시 센다. 문장 속 숫자는 서버가 대조해 경고만 남긴다.
 */

const MAX_TOKENS = 32000
/** 본문 말뭉치 상한 (문자) — 넘으면 오래된 VOC부터 제외하고 건수를 비고에 기록 (조용히 자르지 않음) */
const CORPUS_LIMIT = 150_000
const LIMITS = { summary: 1200, groupNote: 160, themeName: 30, insight: 160, issue: 30, ask: 90, action: 180, asProcess: 300, insTitle: 30, insDetail: 260 }
const CAPS = { groupNotes: 12, themes: 8, keyIssues: 6, insights: 5 }

const SYSTEM_PROMPT = `당신은 의료 모니터링 솔루션 thynC를 병원에 공급·운영하는 회사의 운영 분석가다. 운영관리시스템 데이터로 '고객 운영 이력 레포트'의 해석 칸을 작성한다. 레포트의 숫자·표는 시스템이 이미 만들었고, 당신은 정해진 칸의 글만 쓴다.

작성 원칙
- 근거는 입력으로 준 DATA와 TEXT뿐이다. 입력에 없는 사실을 추측해 쓰지 않는다. 확인되지 않은 원인은 "원인 미확인"으로 쓴다.
- 숫자는 DATA·TEXT에 있는 값만 그대로 인용한다. 새로 계산한 비율·합계·평균을 만들지 않는다. 숫자가 꼭 필요 없으면 쓰지 않는다.
- VOC를 지목할 때는 반드시 TEXT에 있는 VOC 코드(VOC-YYYYMM-NNNN)만 쓴다.
- 환자 개인정보·연락처·전화번호는 쓰지 않는다.
- 문체: 사내 보고서 문체. 문장은 "~습니다"로 짧게, 표 칸(note·insight·issue·ask·action)은 개조식 명사형으로 끝낸다.

칸별 지침
- summary: 레포트 맨 위 요약 3문단(문단 사이 줄바꿈 1개, 문단당 1~3문장).
  1문단 — 계약(일자·도입형태·병상)과 구축 착수, 지금까지 기록 규모(AS 횟수·대수, VOC 건수, 유지보수·기타업무 건수).
  2문단 — AS가 어디에 몰려 있는지(기종 비중, 도입 대비 AS 비중, 수리 판정 주원인 등 DATA에 있는 것만).
  3문단 — 지금 열려 있는 것(진행 중 AS, 타병원 등록 시리얼 등 미결 사항). 미결이 없으면 운영 안정 여부를 쓴다.
- groupNotes: DATA voc.byGroup의 대분류마다 1개씩, group은 대분류 이름을 그대로. note는 그 분류에서 실제로 확인된 문의 내용을 쉼표로 나열(반복은 괄호에 횟수, 예: "산소포화도 빨간 느낌표(2), 게이트웨이 꺼짐·미점등(3)").
- themes: VOC를 반복되는 '문의 주제'로 묶는다. 시스템 분류를 그대로 옮기지 말고 실제 내용 기준으로 묶는다(예: 게이트웨이 LED 미점등, 파형 지연·미표시·누락). 2건 이상 반복된 주제만, 최대 8개. vocCodes에 해당 VOC 코드를 모두 넣는다. insight는 그 주제가 운영에 주는 시사점 한 줄.
- keyIssues: 서비스 품질·고객 신뢰에 영향이 큰 이슈 최대 6건(응급 상황, 장기 미해결, 반복 장애, 데이터 누락 등), 오래된 순. vocCodes에 같은 이슈의 VOC를 넣되 대표 VOC를 맨 앞에. issue는 짧은 이슈명, ask는 문의 내용 한 줄 요약, action은 TEXT의 처리 내용에 근거한 조치와 확인 결과(원인 미확인이면 그렇게 명시).
- asProcess: 이 병원의 AS 처리 흐름을 "단계 → 단계 → …" 한 줄로(누가 접수하고, 대체기기를 어떻게 하고, 고장품을 어떻게 회수·판정하는지). hospital.asMemo·tags·TEXT에 근거가 없으면 빈 문자열.
- insights: 레포트 마지막 '시사점' 3~5개. title은 짧은 명사구(예: "산소포화도 내구성", "AS 접수 품질"), detail은 근거 사실과 해야 할 일을 1~2문장으로. 리스크와 개선 방향을 함께 담고, 실행 가능한 것만.`

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'groupNotes', 'themes', 'keyIssues', 'asProcess', 'insights'],
  properties: {
    summary: { type: 'string', description: '요약 3문단, 문단 사이 줄바꿈' },
    groupNotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['group', 'note'],
        properties: { group: { type: 'string' }, note: { type: 'string' } },
      },
    },
    themes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'vocCodes', 'insight'],
        properties: { name: { type: 'string' }, vocCodes: { type: 'array', items: { type: 'string' } }, insight: { type: 'string' } },
      },
    },
    keyIssues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['vocCodes', 'issue', 'ask', 'action'],
        properties: { vocCodes: { type: 'array', items: { type: 'string' } }, issue: { type: 'string' }, ask: { type: 'string' }, action: { type: 'string' } },
      },
    },
    asProcess: { type: 'string' },
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
      },
    },
  },
} as const

/** AI에 넘길 DATA — 표에 쓰인 집계 그대로 (원문 목록 제외) */
function dataBlock(f: HospitalReportFacts) {
  return {
    hospital: f.hospital,
    deals: f.deals.map(({ code, roundNo, status, contractDate, wardCount, bedCount, wardsText, devices, productType }) => ({ code, roundNo, status, contractDate, wardCount, bedCount, wardsText, devices, productType })),
    projects: f.projects,
    devices: { contracted: f.devices.contracted, active: f.devices.active, activeTotal: f.devices.activeTotal, noWard: f.devices.noWard, wards: f.devices.wards },
    as: {
      totals: f.as.totals, quarters: f.as.quarters, peakMonth: f.as.peakMonth, lead: f.as.lead, outcome: f.as.outcome, repeat: f.as.repeat,
      distinctByKind: f.as.distinctByKind, wardMissing: f.as.wardMissing, repair: f.as.repair, otherHospitalSerials: f.as.otherHospitalSerials,
      receipts: f.as.receipts.map((r) => ({ code: r.code, date: r.receiptDate, status: r.status, category: r.category, source: (r.source && AS_SOURCE_LABEL[r.source]) || r.source, lines: r.lines, kind: r.kind, resolvedAt: r.resolvedAt, leadDays: r.leadDays })),
    },
    voc: { total: f.voc.total, firstAt: f.voc.firstAt, lastAt: f.voc.lastAt, byStatus: f.voc.byStatus, bySource: f.voc.bySource.map((x) => ({ source: VOC_SOURCE_LABEL[x.source] ?? x.source, count: x.count })), byQuarter: f.voc.byQuarter, byGroup: f.voc.byGroup, unresolved: f.voc.unresolved },
    timeline: f.timeline,
    checks: f.checks.filter((c) => c.level === 'warn'),
    tickets: f.tickets,
  }
}

/** TEXT — VOC(최신순 상한)·채널톡 요약·유지보수·기타업무 원문 */
function corpus(f: HospitalReportFacts): { text: string; truncatedVoc: number } {
  const parts: string[] = []
  for (const c of f.chats) if (c.summary) parts.push(`[채널톡 상담 ${c.openedAt ?? ''}] ${c.summary.replace(/\n+/g, ' / ')}`)
  for (const m of f.maintenances) parts.push(`[유지보수 ${m.code} ${m.reportedAt ?? ''} ${m.status ?? ''}] ${m.title}\n증상: ${m.symptoms ?? '—'}\n조치: ${m.resolution ?? '—'}\n비고: ${m.notes ?? '—'}`)
  for (const e of f.etcTasks) parts.push(`[기타업무 ${e.code} ${e.reportedAt ?? ''} ${e.status ?? ''}] ${e.title} — ${e.note ?? ''}`)
  let used = parts.join('\n\n').length
  const vocs = [...f.voc.items].reverse() // 최신순으로 채우고 넘치면 오래된 것 제외
  const kept: string[] = []
  let truncatedVoc = 0
  for (const v of vocs) {
    const t = `[${v.code} ${v.receivedAt} ${v.type ?? '미분류'} ${v.status ?? ''}]\n제목: ${v.title}\n내용: ${v.content.slice(0, 700)}\n처리: ${v.resolution.slice(0, 500) || '—'}`
    if (used + t.length > CORPUS_LIMIT) { truncatedVoc++; continue }
    used += t.length + 2
    kept.push(t)
  }
  return { text: [...parts, ...kept.reverse()].join('\n\n'), truncatedVoc }
}

const clip = (s: unknown, max: number) => {
  const t = maskPhone(String(s ?? '').replace(/\s+\n/g, '\n').trim())
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** 문장 속 숫자 중 입력에 없는 값 → 경고 (차단하지 않음) */
function numberWarnings(texts: string[], source: string): string[] {
  const norm = (x: string) => x.replace(/,/g, '').replace(/\.0+$/, '')
  const allowed = new Set((source.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(norm))
  const bad = new Set<string>()
  for (const t of texts) for (const m of t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const v = norm(m)
    if (v.length <= 1) continue // 한 자리 수(순번·소량)는 대조 생략
    if (!allowed.has(v)) bad.add(m)
  }
  return bad.size ? [`AI 문장에 데이터에서 확인되지 않는 숫자가 있습니다: ${Array.from(bad).slice(0, 8).join(', ')}`] : []
}

export function validateAi(raw: unknown, f: HospitalReportFacts, source: string, truncatedVoc: number): HospitalReportAi {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const codes = new Set(f.voc.items.map((v) => v.code))
  const groups = new Set(f.voc.byGroup.map((g) => g.group))
  const warnings: string[] = []
  const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[]
  let droppedCodes = 0
  const keepCodes = (v: unknown) => {
    const all = (Array.isArray(v) ? v : []).map(String)
    const ok = Array.from(new Set(all.filter((c) => codes.has(c))))
    droppedCodes += all.filter((c) => !codes.has(c)).length
    return ok
  }

  const groupNotes = arr(o.groupNotes).slice(0, CAPS.groupNotes)
    .map((g) => ({ group: String(g.group ?? ''), note: clip(g.note, LIMITS.groupNote) }))
    .filter((g) => groups.has(g.group) && g.note)
  const themes = arr(o.themes).slice(0, CAPS.themes)
    .map((t) => ({ name: clip(t.name, LIMITS.themeName), vocCodes: keepCodes(t.vocCodes), insight: clip(t.insight, LIMITS.insight) }))
    .filter((t) => t.name && t.vocCodes.length > 0)
  const keyIssues = arr(o.keyIssues)
    .map((k) => ({ vocCodes: keepCodes(k.vocCodes), issue: clip(k.issue, LIMITS.issue), ask: clip(k.ask, LIMITS.ask), action: clip(k.action, LIMITS.action) }))
    .filter((k) => k.vocCodes.length > 0 && k.issue)
    .slice(0, CAPS.keyIssues)
  if (droppedCodes > 0) warnings.push(`이 병원에 없는 VOC 코드 ${droppedCodes}건을 AI 결과에서 제외했습니다`)
  const asProcess = clip(o.asProcess, LIMITS.asProcess)
  const insights = arr(o.insights).slice(0, CAPS.insights)
    .map((r) => ({ title: clip(r.title, LIMITS.insTitle), detail: clip(r.detail, LIMITS.insDetail) })).filter((r) => r.title && r.detail)
  const summary = clip(o.summary, LIMITS.summary)
  if (!summary) throw new Error('AI 응답에 요약(summary)이 없습니다')

  warnings.push(...numberWarnings([
    summary, asProcess,
    ...groupNotes.map((g) => g.note), ...themes.map((t) => t.insight),
    ...keyIssues.flatMap((k) => [k.ask, k.action]), ...insights.map((r) => r.detail),
  ], source))
  return { summary, groupNotes, themes, keyIssues, asProcess, insights, warnings, truncatedVoc }
}

export interface AnalyzeResult {
  ai: HospitalReportAi
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export async function analyzeHospitalReport(f: HospitalReportFacts, model: string, effort: AiEffort): Promise<AnalyzeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다')
  const client = new Anthropic({ apiKey })

  const data = JSON.stringify(dataBlock(f))
  const { text, truncatedVoc } = corpus(f)
  const user = `병원: ${f.hospital.name} (${f.hospital.code})\n기준 시각: ${f.asOf}\n\n<DATA>\n${data}\n</DATA>\n\n<TEXT>\n${text || '(본문 기록 없음)'}\n</TEXT>\n\n위 자료로 레포트 해석 칸을 작성하세요.`

  const params = {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' as const },
    output_config: { effort, format: { type: 'json_schema' as const, schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: 'user' as const, content: user }],
  }

  // 거절(refusal) 시 서버 측 폴백 — SDK 0.88 타입에 없는 beta 필드라 본문에 그대로 싣는다. 거부되면(400) 폴백 없이 1회 재시도
  const run = (withFallback: boolean) =>
    client.messages
      .stream(
        (withFallback ? { ...params, fallbacks: 'default' } : params) as unknown as Anthropic.MessageStreamParams,
        withFallback ? { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } } : undefined
      )
      .finalMessage()

  let msg: Anthropic.Message
  try {
    msg = await run(true)
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError) msg = await run(false)
    else throw e
  }

  if (msg.stop_reason === 'refusal') throw new Error('AI가 분석을 거절했습니다(refusal)')
  if (msg.stop_reason === 'max_tokens') throw new Error('AI 응답이 길이 상한에 걸렸습니다(max_tokens)')
  const out = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error('AI 응답을 JSON으로 해석하지 못했습니다')
  }
  const ai = validateAi(parsed, f, `${data}\n${text}`, truncatedVoc)
  const u = msg.usage
  return {
    ai,
    model: msg.model,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  }
}
