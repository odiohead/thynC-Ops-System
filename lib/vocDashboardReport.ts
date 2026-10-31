/**
 * VOC·AS 주간 대시보드 — 주간 보고 PDF 첨부 (2026-10-31)
 * 주(금요일)당 1건. 파워포인트로 만든 1페이지 PDF를 업로드하면 pdftoppm으로 PNG 변환해 S3에 원본·이미지 함께 저장,
 * 대시보드 하단에서 이미지로 표시한다(편집 기능 없음, 교체 = 재업로드).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { uploadToS3, deleteFromS3, getSignedUrl } from '@/lib/s3'

const execFileAsync = promisify(execFile)

export const VOC_DASHBOARD_REPORT_MAX_BYTES = 20 * 1024 * 1024 // 20MB
const RASTER_DPI = 200
const URL_TTL_SEC = 60 * 60 // 1시간

export type VocDashboardReportView = {
  id: number
  weekStart: string // YYYY-MM-DD(금요일)
  fileName: string
  imageUrl: string
  pdfUrl: string
  imageWidth: number
  imageHeight: number
  pdfSize: number
  uploadedBy: string | null
  createdAt: string
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

async function withTmpPdf<T>(pdf: Buffer, fn: (tmpPdf: string, base: string) => Promise<T>): Promise<T> {
  const base = path.join(os.tmpdir(), `vocrep_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const tmpPdf = `${base}.pdf`
  try {
    await fs.writeFile(tmpPdf, pdf)
    return await fn(tmpPdf, base)
  } finally {
    await fs.unlink(tmpPdf).catch(() => {})
    await fs.unlink(`${base}.png`).catch(() => {})
  }
}

/** PDF 검증(매직 바이트·페이지 수) + 1페이지 PNG 변환. 1페이지가 아니면 Error */
export async function rasterizeSinglePagePdf(pdf: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('PDF 파일이 아닙니다.')
  return withTmpPdf(pdf, async (tmpPdf, base) => {
    const { stdout } = await execFileAsync('pdfinfo', [tmpPdf])
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? NaN)
    if (!Number.isFinite(pages) || pages < 1) throw new Error('PDF 페이지 정보를 읽을 수 없습니다.')
    if (pages !== 1) throw new Error(`1페이지 PDF만 업로드할 수 있습니다. (현재 ${pages}페이지)`)
    await execFileAsync('pdftoppm', ['-r', String(RASTER_DPI), '-png', '-f', '1', '-l', '1', '-singlefile', tmpPdf, base])
    const png = await sharp(await fs.readFile(`${base}.png`)).png({ compressionLevel: 9 }).toBuffer()
    const meta = await sharp(png).metadata()
    return { png, width: meta.width ?? 0, height: meta.height ?? 0 }
  })
}

async function toView(r: {
  id: number; weekStart: Date; fileName: string; pdfKey: string; imageKey: string
  imageWidth: number; imageHeight: number; pdfSize: number; createdAt: Date; uploadedBy: { name: string } | null
}): Promise<VocDashboardReportView> {
  const [imageUrl, pdfUrl] = await Promise.all([
    getSignedUrl(r.imageKey, URL_TTL_SEC),
    getSignedUrl(r.pdfKey, URL_TTL_SEC, { downloadName: r.fileName, inline: true }),
  ])
  return {
    id: r.id, weekStart: ymd(r.weekStart), fileName: r.fileName, imageUrl, pdfUrl,
    imageWidth: r.imageWidth, imageHeight: r.imageHeight, pdfSize: r.pdfSize,
    uploadedBy: r.uploadedBy?.name ?? null, createdAt: r.createdAt.toISOString(),
  }
}

const include = { uploadedBy: { select: { name: true } } } as const

export async function getVocDashboardReport(weekStart: Date): Promise<VocDashboardReportView | null> {
  const r = await prisma.vocDashboardReport.findUnique({ where: { weekStart }, include })
  return r ? toView(r) : null
}

/** 업로드(기존 건 있으면 교체 — 이전 S3 객체는 DB 갱신 후 삭제) */
export async function saveVocDashboardReport(input: { weekStart: Date; fileName: string; pdf: Buffer; userId: string }): Promise<VocDashboardReportView> {
  if (input.pdf.length > VOC_DASHBOARD_REPORT_MAX_BYTES) throw new Error('파일 크기는 20MB 이하여야 합니다.')
  const { png, width, height } = await rasterizeSinglePagePdf(input.pdf)
  const week = ymd(input.weekStart)
  const stamp = Date.now()
  const pdfKey = `voc-dashboard/reports/${week}/${stamp}.pdf`
  const imageKey = `voc-dashboard/reports/${week}/${stamp}.png`
  await Promise.all([uploadToS3(input.pdf, pdfKey, 'application/pdf'), uploadToS3(png, imageKey, 'image/png')])

  const prev = await prisma.vocDashboardReport.findUnique({ where: { weekStart: input.weekStart }, select: { pdfKey: true, imageKey: true } })
  const data = { fileName: input.fileName.slice(0, 255), pdfKey, imageKey, imageWidth: width, imageHeight: height, pdfSize: input.pdf.length, uploadedById: input.userId }
  const saved = await prisma.vocDashboardReport.upsert({ where: { weekStart: input.weekStart }, create: { weekStart: input.weekStart, ...data }, update: data, include })
  if (prev) await Promise.allSettled([deleteFromS3(prev.pdfKey), deleteFromS3(prev.imageKey)])
  return toView(saved)
}

export async function deleteVocDashboardReport(weekStart: Date): Promise<{ id: number; fileName: string } | null> {
  const r = await prisma.vocDashboardReport.findUnique({ where: { weekStart } })
  if (!r) return null
  await prisma.vocDashboardReport.delete({ where: { id: r.id } })
  await Promise.allSettled([deleteFromS3(r.pdfKey), deleteFromS3(r.imageKey)])
  return { id: r.id, fileName: r.fileName }
}
