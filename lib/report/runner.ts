import type { Prisma, ReportRun } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAiReportSettings, type AiEffort } from '@/lib/ai/settings'
import { collectHospitalFacts } from './hospital/collect'
import { analyzeHospitalReport } from './hospital/analyze'
import { buildHospitalReportDoc, type AiState } from './hospital/build'
import type { HospitalReportAi, HospitalReportFacts } from './hospital/types'
import { DEFAULT_DOC_NUMBER, type ReportDoc } from './doc'

/**
 * 레포트 실행기 (projects/hospital_report_design.md §8)
 * 생성은 비동기 — POST가 행을 만들고 백그라운드로 수집→AI 분석을 돌린다(GW 플래너 runPipeline 패턴).
 * PM2 재시작 등으로 끊긴 실행은 조회 시 10분 경과로 중단 처리한다.
 */

export const REPORT_KIND_HOSPITAL = 'HOSPITAL_HISTORY'
const STALE_MS = 10 * 60 * 1000

export async function startHospitalReport(input: { hospitalCode: string; userId: string; docNumber?: string | null }): Promise<ReportRun> {
  const settings = await getAiReportSettings()
  const run = await prisma.reportRun.create({
    data: {
      kind: REPORT_KIND_HOSPITAL,
      hospitalCode: input.hospitalCode,
      status: 'COLLECTING',
      model: settings.model,
      effort: settings.effort,
      docNumber: input.docNumber?.trim() || null,
      createdById: input.userId,
    },
  })
  // 백그라운드 실행 — await 하지 않음
  runHospitalReport(run.id).catch((e) => console.error('[report] 실행 실패', run.id, e))
  return run
}

async function runHospitalReport(id: string): Promise<void> {
  const run = await prisma.reportRun.findUniqueOrThrow({ where: { id } })
  let facts: HospitalReportFacts
  try {
    facts = await collectHospitalFacts(run.hospitalCode)
  } catch (e) {
    await prisma.reportRun.update({ where: { id }, data: { status: 'FAILED', error: errMsg(e), finishedAt: new Date() } })
    return
  }
  await prisma.reportRun.update({ where: { id }, data: { facts: facts as unknown as Prisma.InputJsonValue, status: 'ANALYZING' } })
  await analyzeStep(id, facts, run.model!, run.effort as AiEffort, run.createdById)
}

/** AI 단계만 다시 — 같은 facts, 현재 레포트 AI 설정으로 */
export async function retryReportAi(id: string, userId: string): Promise<void> {
  const run = await prisma.reportRun.findUniqueOrThrow({ where: { id } })
  if (!run.facts) throw new Error('수집 데이터가 없어 AI만 다시 실행할 수 없습니다 — 보고서를 새로 생성하세요')
  if (run.status === 'COLLECTING' || run.status === 'ANALYZING') throw new Error('이미 실행 중입니다')
  const settings = await getAiReportSettings()
  await prisma.reportRun.update({ where: { id }, data: { status: 'ANALYZING', aiError: null, model: settings.model, effort: settings.effort } })
  analyzeStep(id, run.facts as unknown as HospitalReportFacts, settings.model, settings.effort, userId).catch((e) => console.error('[report] AI 재실행 실패', id, e))
}

async function analyzeStep(id: string, facts: HospitalReportFacts, model: string, effort: AiEffort, userId: string | null): Promise<void> {
  try {
    const r = await analyzeHospitalReport(facts, model, effort)
    await prisma.reportRun.update({
      where: { id },
      data: {
        aiResult: r.ai as unknown as Prisma.InputJsonValue, aiError: null, status: 'DONE', finishedAt: new Date(), model: r.model,
        inputTokens: r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens, outputTokens: r.outputTokens,
      },
    })
    const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }) : null
    await prisma.aiUsageLog.create({
      data: {
        feature: 'report', userId, userName: user?.name ?? '', userEmail: user?.email ?? '', hospitalCode: facts.hospital.code, model: r.model,
        inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens,
      },
    }).catch((e) => console.error('[report] 사용량 기록 실패', e))
  } catch (e) {
    // 코드 섹션은 그대로 쓸 수 있으므로 DONE + ai_error (§4)
    await prisma.reportRun.update({ where: { id }, data: { status: 'DONE', aiError: errMsg(e), finishedAt: new Date() } })
  }
}

/** 끊긴 실행 정리 — 조회 시점에 호출 */
export async function settleStale(run: ReportRun): Promise<ReportRun> {
  if ((run.status === 'COLLECTING' || run.status === 'ANALYZING') && Date.now() - run.updatedAt.getTime() > STALE_MS) {
    return prisma.reportRun.update({
      where: { id: run.id },
      data: run.status === 'COLLECTING'
        ? { status: 'FAILED', error: '실행이 중단되었습니다(서버 재시작 등)', finishedAt: new Date() }
        : { status: 'DONE', aiError: '실행이 중단되었습니다(서버 재시작 등)', finishedAt: new Date() },
    })
  }
  return run
}

export function aiStateOf(run: ReportRun): AiState {
  if (run.status === 'ANALYZING' || run.status === 'COLLECTING') return 'running'
  if (run.aiResult) return 'done'
  return 'failed'
}

/** 실행 행 → 문서 모델 (작성부서·작성자는 생성자 기준 — D7) */
export async function reportDocOf(run: ReportRun): Promise<ReportDoc | null> {
  if (!run.facts) return null
  const creator = run.createdById
    ? await prisma.user.findUnique({ where: { id: run.createdById }, select: { name: true, department: { select: { name: true } } } })
    : null
  const date = new Date(run.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '.')
  const state = aiStateOf(run)
  return buildHospitalReportDoc(run.facts as unknown as HospitalReportFacts, (run.aiResult as unknown as HospitalReportAi) ?? null, {
    docNumber: run.docNumber || DEFAULT_DOC_NUMBER,
    date,
    dept: creator?.department?.name ?? '',
    author: creator?.name ?? '',
    aiState: state,
    aiError: run.aiError,
    model: run.aiResult ? run.model : null,
    effort: run.aiResult ? run.effort : null,
    generatedAt: run.finishedAt?.toISOString() ?? null,
  })
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.length > 300 ? `${m.slice(0, 300)}…` : m
}
