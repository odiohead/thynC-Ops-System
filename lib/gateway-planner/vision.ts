// 게이트웨이 배치 플래너 — 도면 래스터화 + Claude Vision 공간 인식 (서버 전용)
// Phase 0 검증 결과 반영: 2x2 타일 분할(실효 해상도 ↑) + 전체 뷰 치수 판독(스케일용) 조합
import Anthropic from '@anthropic-ai/sdk'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { GwAnalysis, GwDimensionReading, GwSpace, SPACE_TYPES } from './types'

const execFileAsync = promisify(execFile)

const MODEL = 'claude-opus-4-8'
const VISION_LONG = 1568 // Claude Vision 실효 해상도 상한
const TILE_OVERLAP = 0.15

// ---------- 래스터화 ----------

export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const tmp = path.join(os.tmpdir(), `gwp_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
  try {
    await fs.writeFile(tmp, pdfBuffer)
    const { stdout } = await execFileAsync('pdfinfo', [tmp])
    const m = stdout.match(/^Pages:\s+(\d+)/m)
    return m ? parseInt(m[1], 10) : 1
  } finally {
    await fs.unlink(tmp).catch(() => {})
  }
}

/** PDF 지정 페이지 → 200DPI PNG */
export async function rasterizePdf(pdfBuffer: Buffer, pageIndex: number): Promise<Buffer> {
  const base = path.join(os.tmpdir(), `gwp_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const tmpPdf = `${base}.pdf`
  try {
    await fs.writeFile(tmpPdf, pdfBuffer)
    const page = String(pageIndex + 1)
    await execFileAsync('pdftoppm', ['-r', '200', '-png', '-f', page, '-l', page, '-singlefile', tmpPdf, base])
    return await fs.readFile(`${base}.png`)
  } finally {
    await fs.unlink(tmpPdf).catch(() => {})
    await fs.unlink(`${base}.png`).catch(() => {})
  }
}

/** 원본 이미지 정규화: full(원본 해상도 PNG) + vision(장변 1568px) */
export async function normalizeImage(input: Buffer) {
  const full = await sharp(input).rotate().png().toBuffer() // EXIF 회전 반영
  const meta = await sharp(full).metadata()
  const fullW = meta.width || 1
  const fullH = meta.height || 1
  const scale = Math.min(1, VISION_LONG / Math.max(fullW, fullH))
  const visionW = Math.round(fullW * scale)
  const visionH = Math.round(fullH * scale)
  const vision = await sharp(full).resize(visionW, visionH).png().toBuffer()
  return { full, fullW, fullH, vision, visionW, visionH, visionScale: scale }
}

// ---------- 그리드 오버레이 ----------

async function gridOverlay(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata()
  const w = meta.width || 0
  const h = meta.height || 0
  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`
  for (let x = 100; x < w; x += 100) {
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#00A0FF" stroke-width="1" stroke-opacity="0.35"/>`
    svg += `<text x="${x + 2}" y="14" font-size="13" font-family="sans-serif" fill="#0060C0">${x}</text>`
    svg += `<text x="${x + 2}" y="${h - 4}" font-size="13" font-family="sans-serif" fill="#0060C0">${x}</text>`
  }
  for (let y = 100; y < h; y += 100) {
    svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#00A0FF" stroke-width="1" stroke-opacity="0.35"/>`
    svg += `<text x="2" y="${y - 3}" font-size="13" font-family="sans-serif" fill="#0060C0">${y}</text>`
    svg += `<text x="${w - 38}" y="${y - 3}" font-size="13" font-family="sans-serif" fill="#0060C0">${y}</text>`
  }
  svg += '</svg>'
  return sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
}

// ---------- Claude Vision ----------

const dimensionItems = {
  type: 'object' as const,
  properties: {
    valueMm: { type: 'number' as const, description: '치수값 (mm)' },
    fromPx: { type: 'array' as const, items: { type: 'number' as const }, description: '구간 시작점 [x,y] px' },
    toPx: { type: 'array' as const, items: { type: 'number' as const }, description: '구간 끝점 [x,y] px' },
    confidence: { type: 'string' as const, enum: ['high', 'mid', 'low'] },
  },
  required: ['valueMm', 'fromPx', 'toPx', 'confidence'],
}

const spacesTool = {
  name: 'report_floorplan_analysis',
  description: '병원 도면(부분 이미지) 분석 결과를 구조화하여 보고한다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      dimensionReadings: { type: 'array' as const, description: '명확히 읽히는 치수 최대 6개', items: dimensionItems },
      spaces: {
        type: 'array' as const,
        description: '이 이미지 안에 보이는 모든 공간',
        items: {
          type: 'object' as const,
          properties: {
            id: { type: 'string' as const },
            type: { type: 'string' as const, enum: [...SPACE_TYPES] },
            label: { type: 'string' as const, description: '도면에 표기된 실명 그대로 (없으면 빈 문자열)' },
            bbox: { type: 'array' as const, items: { type: 'number' as const }, description: '[x1,y1,x2,y2] px' },
            confidence: { type: 'string' as const, enum: ['high', 'mid', 'low'] },
          },
          required: ['id', 'type', 'label', 'bbox', 'confidence'],
        },
      },
    },
    required: ['dimensionReadings', 'spaces'],
  },
}

const dimsTool = {
  name: 'report_dimensions',
  description: '도면 전체에서 읽히는 치수 표기를 보고한다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      dimensionReadings: { type: 'array' as const, description: '명확히 읽히는 치수 3~10개 (여러 칸 합계 치수 우선)', items: dimensionItems },
    },
    required: ['dimensionReadings'],
  },
}

const SPACES_SYSTEM = `당신은 병원 건축 도면 분석 전문가다. 병실 모니터링 시스템의 신호수신장치(게이트웨이) 설치 계획을 위해 도면의 공간 구조를 인식한다.

지금 보는 이미지는 큰 도면의 한 조각(타일)이다. 이미지에는 픽셀 좌표 그리드(파란 선, 100px 간격)가 오버레이되어 있고 가장자리에 px 눈금 라벨이 있다. 모든 좌표는 이 이미지 기준 px로 보고한다.

공간 분류: corridor(복도)/ward(병실)/toilet(화장실)/nurse_station(간호사실·NS)/stairs(계단실)/elevator(EV)/outdoor(발코니·테라스)/storage(창고)/machine(기계·공조·EPS·PS)/other(그 외 실).

중요 규칙:
1. **복도를 절대 놓치지 마라.** 복도는 실들을 잇는 통로다 — 병실 열 사이의 긴 띠, 날개(wing)마다 있는 통로, 홀·로비 연결부까지 전부 corridor로 보고한다. 복도가 L/T자형이면 직선 구간별로 나눠 여러 개 보고한다. 복도 bbox는 통로 폭(양쪽 벽 사이)을 정확히 감싸야 한다 — 인접 실을 포함하면 안 된다.
2. **병실은 호실 단위로 분리해서 보고하라.** 병실 여러 개가 이어져 있어도 벽 경계마다 각각 별도 공간으로 보고한다. 여러 호실을 하나의 bbox로 묶으면 안 된다. 병상 기호(침대 그림)가 그려진 방이 병실이다.
3. **인출선(리더라인) 표기를 따라가라.** 실명 라벨이 실 밖에 박스로 있고 선이 실 위치를 가리키는 경우, 라벨 박스 위치가 아니라 가리켜진 실의 위치를 bbox로 보고한다.
4. 조각 가장자리에 걸쳐 잘린 공간은 절반 이상 보이는 경우에만 보고한다.
5. bbox는 벽 경계 기준 최소 사각형. 표제란·범례·도면 밖 영역은 제외.
6. 치수는 숫자가 명확한 것만. 확신 없으면 confidence를 낮춘다. 지어내지 않는다.`

const DIMS_SYSTEM = `당신은 건축 도면의 치수 판독 전문가다. 이미지에는 픽셀 좌표 그리드(파란 선, 100px 간격)가 있다.
도면 가장자리의 치수 체인(그리드 열 간격 등)에서 숫자가 명확히 읽히는 치수를 보고한다. 여러 칸에 걸친 합계 치수(긴 구간)를 우선 포함한다.
각 치수에 대해 치수선이 가리키는 구간의 양 끝점을 픽셀 좌표로 정확히 보고한다. 확신 없으면 confidence를 낮춘다. 지어내지 않는다.`

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.')
  return new Anthropic({ apiKey })
}

interface Usage { input: number; output: number; calls: number }

async function callVision(
  client: Anthropic,
  system: string,
  tool: typeof spacesTool | typeof dimsTool,
  imageB64: string,
  userText: string,
  usage: Usage,
): Promise<Record<string, unknown>> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system,
    tools: [tool as never],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageB64 } },
        { type: 'text', text: userText },
      ],
    }],
  })
  const msg = await stream.finalMessage()
  usage.input += msg.usage.input_tokens
  usage.output += msg.usage.output_tokens
  usage.calls += 1
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new Error('AI 응답에 tool_use 블록이 없습니다.')
  return block.input as Record<string, unknown>
}

// ---------- 병합 (Phase 0 analyze2 포팅) ----------

type Box = [number, number, number, number]
const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const inter = ix * iy
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  return inter / (areaA + areaB - inter)
}
const containRatio = (inner: Box, outer: Box) => {
  const ix = Math.max(0, Math.min(inner[2], outer[2]) - Math.max(inner[0], outer[0]))
  const iy = Math.max(0, Math.min(inner[3], outer[3]) - Math.max(inner[1], outer[1]))
  return (ix * iy) / ((inner[2] - inner[0]) * (inner[3] - inner[1]))
}

function mergeSpaces(spaces: GwSpace[]): GwSpace[] {
  const sorted = [...spaces].sort(
    (a, b) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) - (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]),
  )
  const kept: GwSpace[] = []
  for (const s of sorted) {
    const dup = kept.find(
      (k) => iou(k.bbox, s.bbox) > 0.6 ||
        (k.type === s.type && (iou(k.bbox, s.bbox) > 0.4 || containRatio(s.bbox, k.bbox) > 0.8)),
    )
    if (!dup) kept.push(s)
  }
  // 동일 축선 복도 세그먼트 이어붙이기 (타일 경계에서 잘린 것)
  const corridors = kept.filter((s) => s.type === 'corridor')
  const rest = kept.filter((s) => s.type !== 'corridor')
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < corridors.length; i++) {
      for (let j = i + 1; j < corridors.length; j++) {
        const A = corridors[i].bbox
        const B = corridors[j].bbox
        const overlapY = Math.min(A[3], B[3]) - Math.max(A[1], B[1])
        const overlapX = Math.min(A[2], B[2]) - Math.max(A[0], B[0])
        const hA = A[3] - A[1], hB = B[3] - B[1], wA = A[2] - A[0], wB = B[2] - B[0]
        const bothHorizontal = wA > hA && wB > hB
        const bothVertical = hA > wA && hB > wB
        const gapX = Math.max(A[0], B[0]) - Math.min(A[2], B[2])
        const gapY = Math.max(A[1], B[1]) - Math.min(A[3], B[3])
        if ((bothHorizontal && overlapY > 0.7 * Math.min(hA, hB) && gapX < 30) ||
            (bothVertical && overlapX > 0.7 * Math.min(wA, wB) && gapY < 30)) {
          corridors[i] = {
            ...corridors[i],
            bbox: [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])],
          }
          corridors.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  const merged = [...rest, ...corridors]
  merged.forEach((s, i) => { s.id = `s${i + 1}` })
  return merged
}

// ---------- 메인 분석 ----------

const isBox = (b: unknown): b is Box => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number')
const isPt = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number')

/**
 * 도면 분석: 2x2 타일(공간 인식) + 전체 뷰(치수 판독) = 총 5회 호출
 * 좌표는 모두 vision px 기준으로 변환되어 반환
 */
export async function analyzeDrawing(full: Buffer, visionScale: number): Promise<{ analysis: GwAnalysis; usage: Usage }> {
  const client = getClient()
  const usage: Usage = { input: 0, output: 0, calls: 0 }
  const meta = await sharp(full).metadata()
  const W = meta.width || 1
  const H = meta.height || 1

  const tw = Math.round(W * (0.5 + TILE_OVERLAP / 2))
  const th = Math.round(H * (0.5 + TILE_OVERLAP / 2))
  const origins: Array<[number, number, string]> = [
    [0, 0, '좌상단'], [W - tw, 0, '우상단'], [0, H - th, '좌하단'], [W - tw, H - th, '우하단'],
  ]

  const allSpaces: GwSpace[] = []
  const tileDims: GwDimensionReading[] = []

  const tileTasks = origins.map(async ([ox, oy, posDesc]) => {
    const crop = await sharp(full).extract({ left: ox, top: oy, width: tw, height: th }).toBuffer()
    const cMeta = await sharp(crop).metadata()
    const scale = VISION_LONG / Math.max(cMeta.width || 1, cMeta.height || 1)
    const resized = await sharp(crop)
      .resize(Math.round((cMeta.width || 1) * scale), Math.round((cMeta.height || 1) * scale))
      .png().toBuffer()
    const withGrid = await gridOverlay(resized)
    const gMeta = await sharp(withGrid).metadata()
    const result = await callVision(
      client, SPACES_SYSTEM, spacesTool, withGrid.toString('base64'),
      `병원 도면의 일부 조각이다 (전체 2x2 분할 중 ${posDesc}, 이미지 ${gMeta.width}x${gMeta.height}px). report_floorplan_analysis로 보고하라.`,
      usage,
    )
    const toVision = (p: [number, number]): [number, number] =>
      [(p[0] / scale + ox) * visionScale, (p[1] / scale + oy) * visionScale]
    for (const raw of (result.spaces as unknown[]) || []) {
      const s = raw as GwSpace
      if (!isBox(s.bbox) || !SPACE_TYPES.includes(s.type)) continue
      const p1 = toVision([s.bbox[0], s.bbox[1]])
      const p2 = toVision([s.bbox[2], s.bbox[3]])
      allSpaces.push({ id: s.id || '', type: s.type, label: s.label || '', bbox: [p1[0], p1[1], p2[0], p2[1]], confidence: s.confidence || 'mid' })
    }
    for (const raw of (result.dimensionReadings as unknown[]) || []) {
      const d = raw as GwDimensionReading
      if (typeof d.valueMm !== 'number' || !isPt(d.fromPx) || !isPt(d.toPx)) continue
      tileDims.push({ valueMm: d.valueMm, fromPx: toVision(d.fromPx), toPx: toVision(d.toPx), confidence: d.confidence || 'mid' })
    }
  })

  // 전체 뷰 치수 판독 (스케일용 — Phase 0에서 타일 판독보다 정확함이 검증됨)
  const fullViewTask = (async () => {
    const vision = await sharp(full).resize(Math.round(W * Math.min(1, VISION_LONG / Math.max(W, H)))).png().toBuffer()
    const withGrid = await gridOverlay(vision)
    const gMeta = await sharp(withGrid).metadata()
    const gScale = (gMeta.width || 1) / (W * visionScale) // 전체뷰 px → vision px 보정 (거의 1)
    const result = await callVision(
      client, DIMS_SYSTEM, dimsTool, withGrid.toString('base64'),
      `이 병원 도면(${gMeta.width}x${gMeta.height}px)의 치수 표기를 report_dimensions로 보고하라.`,
      usage,
    )
    const dims: GwDimensionReading[] = []
    for (const raw of (result.dimensionReadings as unknown[]) || []) {
      const d = raw as GwDimensionReading
      if (typeof d.valueMm !== 'number' || !isPt(d.fromPx) || !isPt(d.toPx)) continue
      dims.push({
        valueMm: d.valueMm,
        fromPx: [d.fromPx[0] / gScale, d.fromPx[1] / gScale],
        toPx: [d.toPx[0] / gScale, d.toPx[1] / gScale],
        confidence: d.confidence || 'mid',
      })
    }
    return dims
  })()

  const [fullViewDims] = await Promise.all([fullViewTask, ...tileTasks])

  const spaces = mergeSpaces(allSpaces)
  // 스케일 판독: 전체 뷰 우선, 부족하면 타일 판독 병행
  const dimensionReadings = fullViewDims.length >= 3 ? fullViewDims : [...fullViewDims, ...tileDims]
  return { analysis: { spaces, dimensionReadings }, usage }
}
