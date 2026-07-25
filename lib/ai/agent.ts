import Anthropic from '@anthropic-ai/sdk'
import { AI_TOOLS, TOOL_LABELS, executeTool } from './tools'
import { AI_CHAT_MODEL, getAiSettings, type AiCacheTtl } from './settings'

/**
 * AI 어시스턴트 에이전트 루프 (function_ai_assistant.html §4)
 * - claude-opus-5 + adaptive thinking + 스트리밍
 * - tool use 반복 (최대 8회), 텍스트 델타는 onEvent로 즉시 중계
 * - 반복마다 messages에 롤링 캐시 브레이크포인트를 갱신 (아래 rollCacheBreakpoints 주석 참고)
 */

export const AI_MODEL = AI_CHAT_MODEL
const MODEL = AI_MODEL
/** 사고(thinking) 토큰과 응답 텍스트를 함께 덮는 상한. opus-5는 사고가 기본 on이라 여유가 필요 */
const MAX_TOKENS = 16000
const MAX_ITERATIONS = 8

const SYSTEM_PROMPT = `당신은 thynC Operations System의 업무 어시스턴트다. thynC는 병원에 입원환자 모니터링 솔루션을 구축·운영하는 사업이며, 이 시스템은 병원·구축 프로젝트·유지보수·답사·설치계획·기타업무·사내위키를 관리한다.

역할 3축:
1. CS 응대 — thynC 제품 기능·알람 기준·장애 조치를 사내위키(search_wiki/read_wiki_page)에서 찾아 안내. thynC 솔루션 자체의 사양(기능정의서·API 규격·DB 설계·알람/부정맥 정책·외부 연동·설치/설정·용어)은 위키 'thync_1.3.0' 카테고리의 산출물 문서에 정리돼 있으니, 제품 내부 동작·규격 질문에는 search_wiki를 먼저 사용한다. 특정 병원 상담이면 read_hospital_note로 과거 상담이력·특이사항을 함께 확인
2. 정보 조회 — 특정 병원의 현황·장비 구성·업무 이력 (get_hospital_overview 및 각 업무 조회 도구)
3. 영업·운영 현황 — 기간·건수 집계는 aggregate_stats, 전사 요약은 get_dashboard_summary

원칙:
- 데이터 질문에는 반드시 도구를 호출해 실데이터로 답한다. 추측으로 수치를 만들지 않는다.
- 제품 지식 질문은 위키를 먼저 검색한다. 위키에도 없으면 일반 지식으로 답하되 사내 문서에 근거하지 않았음을 밝힌다.
- 도구 결과에 없는 내용은 "확인되지 않는다"고 말한다.
- 병원명이 모호하면 search_hospitals로 확인 후 진행한다.
- 기간 집계 질문("이번주/이번달 ~건수·현황")에는 목록 도구가 아니라 aggregate_stats를 사용한다.
- 상대 기간("이번주", "이번달")은 컨텍스트의 오늘 날짜(KST) 기준으로 계산해 from/to를 지정한다. 주는 월요일 시작.
- 한국어로, 간결하게 답한다. 목록은 표나 불릿으로 정리한다. 표는 GFM 마크다운 문법으로 작성한다(헤더 구분선 포함). 다만 열이 5개를 넘으면 좁은 화면에서 가로로 넘쳐 보기 어려우니, 핵심 열 3~4개만 표로 만들고 나머지 상세는 항목별 불릿으로 보완한다. 데이터가 1~2건이면 표 대신 불릿(라벨: 값)이 더 읽기 좋다.
- 사용자가 병원을 지정해 둔 경우 그 병원 관련 질문으로 우선 해석한다.

도구 호출 절약 원칙:
- 목록 도구(list_*)는 기본이 요약 모드이며 상위 몇 건만 반환한다. 건수만 필요하면 응답의 count/total을 쓰고 목록을 다시 부르지 않는다. 개별 건의 증상·조치 내용이 실제로 필요할 때만 detail='full'로 다시 호출한다.
- 같은 도구를 같은 조건으로 반복 호출하지 않는다. 이미 받은 결과로 답할 수 있으면 추가 확인 호출 없이 답한다.
- search_wiki 결과에는 카테고리 경로가 함께 오니, 어느 문서를 읽을지 판단한 뒤 read_wiki_page를 호출한다. 확신이 없다고 여러 문서를 차례로 열지 않는다.
- read_wiki_page가 truncated=true로 잘려 오면 응답의 nextOffset으로 이어 읽는다. 처음부터 다시 읽지 않는다.

답변 범위:
- 질문에 답하는 데 필요한 것만 쓴다. 묻지 않은 항목까지 조사해 덧붙이지 않는다.
- 도구 결과로 답이 나오면 거기서 끝낸다. 스스로 재검증하는 추가 호출을 하지 않는다.`

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; name: string; label: string }

export type AgentToolCall = { name: string; input: unknown; resultSummary: string }

export type AgentUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type AgentResult = { text: string; toolCalls: AgentToolCall[]; usage: AgentUsage }

// ===== 프롬프트 캐시 =====

type CacheableBlock = { type: string; cache_control?: Anthropic.CacheControlEphemeral | null }

/** thinking 계열 블록은 원문 그대로 되돌려야 하므로 캐시 마커를 붙이지 않는다 */
const NO_CACHE_MARK = new Set(['thinking', 'redacted_thinking'])

const cacheControl = (ttl: AiCacheTtl): Anthropic.CacheControlEphemeral =>
  ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }

/** 문자열 content를 블록 배열로 승격 (캐시 마커는 블록에만 붙일 수 있음) */
function messageBlocks(m: Anthropic.MessageParam): CacheableBlock[] | null {
  if (typeof m.content === 'string') {
    if (!m.content) return null
    m.content = [{ type: 'text', text: m.content }]
  }
  return Array.isArray(m.content) ? (m.content as unknown as CacheableBlock[]) : null
}

/**
 * messages 롤링 캐시 브레이크포인트
 *
 * 렌더 순서가 tools → system → messages 이므로 system에만 마커를 두면 도구 정의+시스템
 * 프롬프트까지만 캐시된다. 에이전트 루프는 반복마다 tool_use/tool_result를 messages에
 * 쌓으므로, 마커가 없으면 N번째 반복에서 1~N-1번째 도구 결과를 전부 정가로 재처리한다.
 *
 * 매 반복 직전 마지막 블록에 마커를 달아 다음 반복이 직전 결과까지를 캐시로 읽게 한다.
 * 직전 마커 1개는 남긴다 — 새 마커 위치에서 lookback(최대 20블록)으로 기존 캐시 항목을
 * 찾아야 읽기가 성립하기 때문. system 1 + messages 2 = 3개로 API 상한(4개) 안이다.
 */
function rollCacheBreakpoints(messages: Anthropic.MessageParam[], ttl: AiCacheTtl): void {
  const marked: CacheableBlock[] = []
  for (const m of messages) {
    for (const b of messageBlocks(m) ?? []) if (b.cache_control) marked.push(b)
  }

  // 마킹 대상 = 마지막 메시지의 마지막 블록 (thinking 계열은 건너뜀)
  let target: CacheableBlock | null = null
  for (let i = messages.length - 1; i >= 0 && !target; i--) {
    const blocks = messageBlocks(messages[i])
    if (!blocks) continue
    for (let j = blocks.length - 1; j >= 0; j--) {
      if (!NO_CACHE_MARK.has(blocks[j].type)) {
        target = blocks[j]
        break
      }
    }
  }
  if (!target || target.cache_control) return // 대상 없음 or 이미 마킹됨

  for (const b of marked.slice(0, -1)) delete b.cache_control // 직전 1개만 남기고 회수
  target.cache_control = cacheControl(ttl)
}

export async function runAgentChat(opts: {
  history: { role: 'user' | 'assistant'; content: string }[]
  hospitalContext?: { code: string; name: string } | null
  onEvent: (e: AgentEvent) => void
}): Promise<AgentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.')
  const client = new Anthropic({ apiKey })
  const settings = await getAiSettings()

  // 프롬프트 캐싱: 안정 프리픽스(도구 정의 + 시스템 프롬프트)에 breakpoint,
  // 가변 컨텍스트(오늘 날짜·선택 병원)는 캐시 뒤 별도 블록으로 배치
  const todayKst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const contextLines = [`오늘 날짜(KST): ${todayKst}`]
  if (opts.hospitalContext) {
    contextLines.push(
      `사용자가 지정한 병원: ${opts.hospitalContext.name} (hospitalCode: ${opts.hospitalContext.code})`,
    )
  }
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: cacheControl(settings.cacheTtl) },
    { type: 'text', text: `<context>\n${contextLines.join('\n')}\n</context>` },
  ]

  const messages: Anthropic.MessageParam[] = opts.history.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  const toolCalls: AgentToolCall[] = []
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  let finalText = ''

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 직전 반복까지의 messages를 캐시 prefix로 확정 (첫 반복에서는 히스토리 마지막 블록)
    rollCacheBreakpoints(messages, settings.cacheTtl)

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: settings.effort },
      system,
      tools: AI_TOOLS,
      messages,
    })

    stream.on('text', (delta) => {
      opts.onEvent({ type: 'text', delta })
    })

    const message = await stream.finalMessage()
    usage.inputTokens += message.usage.input_tokens
    usage.outputTokens += message.usage.output_tokens
    usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0
    usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0

    const turnText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (turnText) finalText += (finalText ? '\n\n' : '') + turnText

    if (message.stop_reason !== 'tool_use') break
    // 마지막 반복에서 또 도구를 요청하면 실행 없이 종료 (finalText까지의 내용으로 응답)
    if (i === MAX_ITERATIONS - 1) break

    // 도구 실행 → tool_result 붙여 재호출
    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    messages.push({ role: 'assistant', content: message.content })

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      opts.onEvent({ type: 'tool_start', name: tu.name, label: TOOL_LABELS[tu.name] ?? tu.name })
      const result = await executeTool(tu.name, tu.input as Record<string, unknown>)
      const isError = !!(result && typeof result === 'object' && 'error' in result)
      const serialized = JSON.stringify(result)
      toolCalls.push({
        name: tu.name,
        input: tu.input,
        resultSummary: serialized.length > 500 ? serialized.slice(0, 500) + '…' : serialized,
      })
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: serialized,
        ...(isError && { is_error: true }),
      })
    }
    messages.push({ role: 'user', content: results })

    // 다음이 마지막 반복이면 마무리 지시 주입 → 마지막 호출은 도구 없이 답변 생성
    if (i === MAX_ITERATIONS - 2) {
      messages.push({
        role: 'user',
        content: '도구 호출 한도에 도달했습니다. 추가 도구 호출 없이, 지금까지 확인한 내용으로 답변을 마무리하세요.',
      })
    }
  }

  return { text: finalText, toolCalls, usage }
}
