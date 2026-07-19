// 게이트웨이 배치 플래너 — PPTX 생성 (A4 가로, 도면 배경 + 빨간 점 개별 도형 + 총 대수 텍스트박스)
import PptxGenJS from 'pptxgenjs'
import { GwPoint, GwRules } from './types'

const A4_W_IN = 11.69
const A4_H_IN = 8.27
const MARGIN_IN = 0.2
const CM_PER_IN = 2.54

export interface PptxInput {
  title: string
  imagePng: Buffer // 원본 해상도 도면 PNG
  imageWidth: number
  imageHeight: number
  points: GwPoint[] // vision px 좌표
  visionWidth: number
  visionHeight: number
  rules: Pick<GwRules, 'dotDiameterCm' | 'dotColor'>
}

export async function generatePptx(input: PptxInput): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'A4_LANDSCAPE', width: A4_W_IN, height: A4_H_IN })
  pptx.layout = 'A4_LANDSCAPE'
  const slide = pptx.addSlide()

  // 도면 이미지 — 비율 유지 최대 크기, 중앙 배치
  const areaW = A4_W_IN - MARGIN_IN * 2
  const areaH = A4_H_IN - MARGIN_IN * 2
  const scale = Math.min(areaW / input.imageWidth, areaH / input.imageHeight)
  const drawW = input.imageWidth * scale
  const drawH = input.imageHeight * scale
  const offX = MARGIN_IN + (areaW - drawW) / 2
  const offY = MARGIN_IN + (areaH - drawH) / 2

  slide.addImage({
    data: `data:image/png;base64,${input.imagePng.toString('base64')}`,
    x: offX, y: offY, w: drawW, h: drawH,
  })

  // 게이트웨이 점 — 개별 도형 (PowerPoint에서 선택·이동·삭제 가능)
  const dotD = input.rules.dotDiameterCm / CM_PER_IN
  for (const p of input.points) {
    const cx = offX + (p.x / input.visionWidth) * drawW
    const cy = offY + (p.y / input.visionHeight) * drawH
    slide.addShape('ellipse', {
      x: cx - dotD / 2, y: cy - dotD / 2, w: dotD, h: dotD,
      fill: { color: input.rules.dotColor },
      line: { type: 'none' },
    })
  }

  // 총 대수 텍스트박스 (우상단, 편집 가능)
  slide.addText(`게이트웨이 총 ${input.points.length}대`, {
    x: A4_W_IN - 2.9, y: 0.12, w: 2.7, h: 0.4,
    align: 'right', fontSize: 14, bold: true, color: 'C00000',
    fontFace: '맑은 고딕',
  })

  const out = await pptx.write({ outputType: 'nodebuffer' })
  return out as Buffer
}
