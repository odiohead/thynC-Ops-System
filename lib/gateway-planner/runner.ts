// 게이트웨이 배치 플래너 — 백그라운드 파이프라인 러너 (HiraSyncJob 패턴)
import { prisma } from '@/lib/prisma'
import { uploadToS3, getSignedUrl } from '@/lib/s3'
import { analyzeDrawing, getPdfPageCount, normalizeImage, rasterizePdf } from './vision'
import { computeScale } from './scale'
import { placeAll } from './placement'
import { loadRules } from './rules'
import { GwAnalysis, GwRules } from './types'

export const s3KeyOf = (jobId: number, file: string) => `gateway-planner/${jobId}/${file}`

async function downloadFromS3(key: string): Promise<Buffer> {
  const url = await getSignedUrl(key, 300)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`S3 다운로드 실패 (${res.status}): ${key}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 업로드 → 래스터화 → AI 공간 인식 → 스케일 후보 산출 → 미리보기용 자동 배치 → NEED_SCALE(사용자 확정 대기)
 * originalBuffer가 없으면 S3에서 원본을 내려받아 진행 (재분석)
 */
export async function runPipeline(jobId: number, originalBuffer?: Buffer): Promise<void> {
  try {
    const job = await prisma.gatewayPlanJob.findUnique({ where: { id: jobId } })
    if (!job) return

    // 1) 래스터화
    await prisma.gatewayPlanJob.update({ where: { id: jobId }, data: { status: 'RASTERIZING', errorMessage: null } })
    const original = originalBuffer ?? (await downloadFromS3(job.originalKey))
    const isPdf = job.originalName.toLowerCase().endsWith('.pdf')
    let pageCount: number | null = null
    let raster: Buffer
    if (isPdf) {
      pageCount = await getPdfPageCount(original)
      const pageIndex = Math.min(job.pageIndex, Math.max(0, pageCount - 1))
      raster = await rasterizePdf(original, pageIndex)
    } else {
      raster = original
    }
    const norm = await normalizeImage(raster)
    await uploadToS3(norm.full, s3KeyOf(jobId, 'page.png'), 'image/png')
    await uploadToS3(norm.vision, s3KeyOf(jobId, 'vision.png'), 'image/png')
    await prisma.gatewayPlanJob.update({
      where: { id: jobId },
      data: {
        status: 'ANALYZING',
        pageCount,
        imageKey: s3KeyOf(jobId, 'page.png'),
        visionKey: s3KeyOf(jobId, 'vision.png'),
        imageWidth: norm.fullW,
        imageHeight: norm.fullH,
        visionWidth: norm.visionW,
        visionHeight: norm.visionH,
      },
    })

    // 2) AI 공간 인식 + 치수 판독 (타일 4 + 전체 뷰 1)
    const { analysis, usage } = await analyzeDrawing(norm.full, norm.visionScale)
    const candidate = computeScale(analysis.dimensionReadings)

    // 3) 미리보기용 자동 배치 (후보 스케일 기준 — 확정은 사용자가)
    const rules = await loadRules()
    const placement = placeAll(analysis.spaces, candidate.mPerPx, rules)

    await prisma.gatewayPlanJob.update({
      where: { id: jobId },
      data: {
        status: 'NEED_SCALE',
        analysis: analysis as object,
        scaleMeta: { candidate } as object,
        placements: placement as object,
        gatewayCount: placement.points.length,
        rulesSnapshot: rules as object,
        tokenUsage: { inputTokens: usage.input, outputTokens: usage.output, calls: usage.calls } as object,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await prisma.gatewayPlanJob.update({
      where: { id: jobId },
      data: { status: 'ERROR', errorMessage: message.slice(0, 1000) },
    }).catch(() => {})
  }
}

/** 현재 규칙 + 지정 스케일로 재배치 (AI 미호출) */
export async function runPlacement(jobId: number, mPerPx: number | null, rulesOverride?: GwRules): Promise<{ count: number }> {
  const job = await prisma.gatewayPlanJob.findUnique({ where: { id: jobId } })
  if (!job?.analysis) throw new Error('분석 결과가 없습니다.')
  const analysis = job.analysis as unknown as GwAnalysis
  const rules = rulesOverride ?? (await loadRules())
  const placement = placeAll(analysis.spaces, mPerPx, rules)
  await prisma.gatewayPlanJob.update({
    where: { id: jobId },
    data: {
      placements: placement as object,
      gatewayCount: placement.points.length,
      rulesSnapshot: rules as object,
      pptxKey: null, // 배치가 바뀌면 기존 PPTX는 무효
    },
  })
  return { count: placement.points.length }
}

export { downloadFromS3 }
