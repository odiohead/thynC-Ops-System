import Anthropic from '@anthropic-ai/sdk'
import { AI_TOOLS, TOOL_LABELS, executeTool } from './tools'

/**
 * AI 어시스턴트 에이전트 루프 (function_ai_assistant.html §4)
 * - claude-opus-4-8 + adaptive thinking + 스트리밍
 * - tool use 반복 (최대 8회), 텍스트 델타는 onEvent로 즉시 중계
 */

const MODEL = 'claude-opus-4-8'
const MAX_TOKENS = 4096
const MAX_ITERATIONS = 8

const SYSTEM_PROMPT = `당신은 thynC Operations System의 업무 어시스턴트다. thynC는 병원에 입원환자 모니터링 솔루션을 구축·운영하는 사업이며, 이 시스템은 병원·구축 프로젝트·유지보수·답사·설치계획·기타업무·사내위키를 관리한다.

역할 3축:
1. CS 응대 — thynC 제품 기능·알람 기준·장애 조치를 사내위키(search_wiki/read_wiki_page)에서 찾아 안내. 특정 병원 상담이면 read_hospital_note로 과거 상담이력·특이사항을 함께 확인
2. 정보 조회 — 특정 병원의 현황·장비 구성·업무 이력 (get_hospital_overview 및 각 업무 조회 도구)
3. 영업·운영 현황 — 기간·건수 집계는 aggregate_stats, 전사 요약은 get_dashboard_summary

원칙:
- 데이터 질문에는 반드시 도구를 호출해 실데이터로 답한다. 추측으로 수치를 만들지 않는다.
- 제품 지식 질문은 위키를 먼저 검색한다. 위키에도 없으면 일반 지식으로 답하되 사내 문서에 근거하지 않았음을 밝힌다.
- 도구 결과에 없는 내용은 "확인되지 않는다"고 말한다.
- 병원명이 모호하면 search_hospitals로 확인 후 진행한다.
- 기간 집계 질문("이번주/이번달 ~건수·현황")에는 목록 도구가 아니라 aggregate_stats를 사용한다.
- 상대 기간("이번주", "이번달")은 컨텍스트의 오늘 날짜(KST) 기준으로 계산해 from/to를 지정한다. 주는 월요일 시작.
- 한국어로, 간결하게 답한다. 목록은 표나 불릿으로 정리한다.
- 사용자가 병원을 지정해 둔 경우 그 병원 관련 질문으로 우선 해석한다.`

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

export async function runAgentChat(opts: {
  history: { role: 'user' | 'assistant'; content: string }[]
  hospitalContext?: { code: string; name: string } | null
  onEvent: (e: AgentEvent) => void
}): Promise<AgentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.')
  const client = new Anthropic({ apiKey })

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
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
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
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
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
