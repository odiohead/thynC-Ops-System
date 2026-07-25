/**
 * AI 어시스턴트 회귀·비용 검증 스크립트
 *
 * 실행: npx tsx scripts/ai-agent-smoke.mts
 *       npx tsx scripts/ai-agent-smoke.mts "직접 넣을 질문"
 *
 * 채팅 API를 거치지 않고 에이전트 루프를 직접 호출한다(ai_usage_logs에 기록되지 않음 — 집계 오염 없음).
 * 질문별 도구 호출·토큰·캐시 적중률·추정 비용을 출력해 변경 전후를 비교한다.
 */
import { runAgentChat, AI_MODEL } from '@/lib/ai/agent'
import { getAiSettings } from '@/lib/ai/settings'
import { prisma } from '@/lib/prisma'

// opus-5 단가 (USD / 1M tokens)
const PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }

const DEFAULT_QUESTIONS = [
  '제주한라병원 현황 알려줘',
  '이번달 유지보수 몇 건이야?',
  '진행중인 구축 프로젝트 알려줘',
  'thynC 알람 정책 기준이 어떻게 되는지 위키에서 찾아줘',
]

const cost = (u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) =>
  (u.inputTokens * PRICE.input +
    u.outputTokens * PRICE.output +
    u.cacheReadTokens * PRICE.cacheRead +
    u.cacheWriteTokens * PRICE.cacheWrite) /
  1_000_000

async function main() {
  const questions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_QUESTIONS
  const settings = await getAiSettings()
  console.log(`모델: ${AI_MODEL} / effort: ${settings.effort} / cacheTtl: ${settings.cacheTtl}\n`)

  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

  for (const q of questions) {
    const started = Date.now()
    let answer = ''
    const result = await runAgentChat({
      history: [{ role: 'user', content: q }],
      hospitalContext: null,
      onEvent: (e) => {
        if (e.type === 'text') answer += e.delta
      },
    })
    const u = result.usage
    const prompt = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens
    const hit = prompt > 0 ? (u.cacheReadTokens / prompt) * 100 : 0
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += u[k]

    console.log(`Q: ${q}`)
    console.log(`   도구 ${result.toolCalls.length}회 [${result.toolCalls.map((t) => t.name).join(', ')}]`)
    console.log(
      `   input ${u.inputTokens} / cacheRead ${u.cacheReadTokens} / cacheWrite ${u.cacheWriteTokens} / output ${u.outputTokens}`,
    )
    console.log(
      `   캐시적중 ${hit.toFixed(1)}% · $${cost(u).toFixed(4)} · ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
    console.log(`   답변: ${answer.replace(/\s+/g, ' ').slice(0, 110)}...\n`)
  }

  const prompt = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
  console.log('─'.repeat(60))
  console.log(`합계 ${questions.length}건`)
  console.log(
    `  input ${totals.inputTokens} / cacheRead ${totals.cacheReadTokens} / cacheWrite ${totals.cacheWriteTokens} / output ${totals.outputTokens}`,
  )
  console.log(`  캐시 적중률 ${((totals.cacheReadTokens / prompt) * 100).toFixed(1)}%`)
  console.log(`  총 $${cost(totals).toFixed(4)} · 건당 평균 $${(cost(totals) / questions.length).toFixed(4)}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
