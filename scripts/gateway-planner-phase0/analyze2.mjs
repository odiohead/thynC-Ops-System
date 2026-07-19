// Phase 0 개선 — 타일 분할 고해상도 공간 인식 (2x2 + 오버랩) + 결과 병합
// 사용: node scripts/gateway-planner-phase0/analyze2.mjs [샘플명...]  → work/{name}_analysis_v2.json (vision 좌표계)
import Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(import.meta.dirname, '../..')
const WORK = path.join(ROOT, 'scripts/gateway-planner-phase0/work')

const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const apiKey = envText.match(/^ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)"?/m)?.[1]
const client = new Anthropic({ apiKey })
const MODEL = process.env.GP_MODEL || 'claude-opus-4-8'

const SPACE_TYPES = ['corridor', 'ward', 'toilet', 'nurse_station', 'stairs', 'elevator', 'outdoor', 'storage', 'machine', 'other']
const TILE_LONG = 1568
const OVERLAP = 0.15

const tool = {
  name: 'report_floorplan_analysis',
  description: '병원 도면(부분 이미지) 분석 결과를 구조화하여 보고한다.',
  input_schema: {
    type: 'object',
    properties: {
      dimensionReadings: {
        type: 'array',
        description: '이 조각 안에서 명확히 읽히는 치수 표기 최대 6개. 치수선 양 끝점을 이 이미지의 픽셀 좌표로',
        items: {
          type: 'object',
          properties: {
            valueMm: { type: 'number' },
            fromPx: { type: 'array', items: { type: 'number' } },
            toPx: { type: 'array', items: { type: 'number' } },
            confidence: { type: 'string', enum: ['high', 'mid', 'low'] },
          },
          required: ['valueMm', 'fromPx', 'toPx', 'confidence'],
        },
      },
      spaces: {
        type: 'array',
        description: '이 조각 안에 보이는 모든 공간',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: SPACE_TYPES },
            label: { type: 'string' },
            bbox: { type: 'array', items: { type: 'number' }, description: '[x1,y1,x2,y2] px (이 이미지 기준)' },
            confidence: { type: 'string', enum: ['high', 'mid', 'low'] },
          },
          required: ['id', 'type', 'label', 'bbox', 'confidence'],
        },
      },
    },
    required: ['dimensionReadings', 'spaces'],
  },
}

const SYSTEM = `당신은 병원 건축 도면 분석 전문가다. 병실 모니터링 시스템의 신호수신장치(게이트웨이) 설치 계획을 위해 도면의 공간 구조를 인식한다.

지금 보는 이미지는 큰 도면의 한 조각(타일)이다. 이미지에는 픽셀 좌표 그리드(파란 선, 100px 간격)가 오버레이되어 있고 가장자리에 px 눈금 라벨이 있다. 모든 좌표는 이 이미지 기준 px로 보고한다.

공간 분류: corridor(복도)/ward(병실)/toilet(화장실)/nurse_station(간호사실·NS)/stairs(계단실)/elevator(EV)/outdoor(발코니·테라스)/storage(창고)/machine(기계·공조·EPS·PS)/other(그 외 실).

중요 규칙:
1. **복도를 절대 놓치지 마라.** 복도는 실들을 잇는 통로다 — 병실 열 사이의 긴 띠, 날개(wing)마다 있는 통로, 홀·로비 연결부까지 전부 corridor로 보고한다. 복도가 L/T자형이면 직선 구간별로 나눠 여러 개 보고한다. 복도 bbox는 통로 폭(양쪽 벽 사이)을 정확히 감싸야 한다 — 인접 실을 포함하면 안 된다.
2. **병실은 호실 단위로 분리해서 보고하라.** 병실 여러 개가 이어져 있어도 벽 경계마다 각각 별도 공간으로 보고한다. 여러 호실을 하나의 bbox로 묶으면 안 된다. 병상 기호(침대 그림)가 그려진 방이 병실이다.
3. **인출선(리더라인) 표기를 따라가라.** 실명 라벨이 실 밖에 박스로 있고 선이 실 위치를 가리키는 경우(예: "화장실-1", "공용화장실-2"), 선이 가리키는 실제 실의 위치를 bbox로 보고한다. 라벨 박스 위치가 아니라 가리켜진 실의 위치다.
4. 조각 가장자리에 걸쳐 잘린 공간은 절반 이상 보이는 경우에만 보고한다.
5. bbox는 벽 경계 기준 최소 사각형. 그리드 눈금을 활용해 정확히. 표제란·범례·도면 밖 영역은 제외.
6. 치수 표기는 숫자가 명확한 것만, 여러 칸 합계 치수(긴 구간) 우선. 확신 없으면 confidence를 낮춘다. 지어내지 않는다.`

async function makeGridOn(buf) {
  const meta = await sharp(buf).metadata()
  const { width: w, height: h } = meta
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

async function analyzeTile(tileBuf, tileInfo, name, idx) {
  const gridBuf = await makeGridOn(tileBuf)
  fs.writeFileSync(path.join(WORK, `${name}_tile${idx}.png`), gridBuf)
  const meta = await sharp(gridBuf).metadata()
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'report_floorplan_analysis' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: gridBuf.toString('base64') } },
        { type: 'text', text: `병원 도면의 일부 조각이다 (전체 ${tileInfo.gridDesc} 중 ${tileInfo.posDesc}, 이미지 ${meta.width}x${meta.height}px). report_floorplan_analysis로 보고하라.` },
      ],
    }],
  })
  const msg = await stream.finalMessage()
  const block = msg.content.find((b) => b.type === 'tool_use')
  return { result: block.input, usage: msg.usage }
}

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const inter = ix * iy
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  return inter / (areaA + areaB - inter)
}
const containRatio = (inner, outer) => {
  const ix = Math.max(0, Math.min(inner[2], outer[2]) - Math.max(inner[0], outer[0]))
  const iy = Math.max(0, Math.min(inner[3], outer[3]) - Math.max(inner[1], outer[1]))
  return (ix * iy) / ((inner[2] - inner[0]) * (inner[3] - inner[1]))
}

/** 타일 간 중복 제거 + 잘린 복도 이어붙이기 */
function mergeSpaces(spaces) {
  // 1) 중복 제거 (면적 큰 것 우선 유지)
  const sorted = [...spaces].sort((a, b) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) - (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]))
  const kept = []
  for (const s of sorted) {
    const dup = kept.find((k) =>
      iou(k.bbox, s.bbox) > 0.6 ||
      (k.type === s.type && (iou(k.bbox, s.bbox) > 0.4 || containRatio(s.bbox, k.bbox) > 0.8)))
    if (!dup) kept.push(s)
  }
  // 2) 동일 축선 복도 세그먼트 병합 (타일 경계에서 잘린 것)
  let corridors = kept.filter((s) => s.type === 'corridor')
  const rest = kept.filter((s) => s.type !== 'corridor')
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < corridors.length; i++) {
      for (let j = i + 1; j < corridors.length; j++) {
        const A = corridors[i].bbox, B = corridors[j].bbox
        const overlapY = Math.min(A[3], B[3]) - Math.max(A[1], B[1])
        const overlapX = Math.min(A[2], B[2]) - Math.max(A[0], B[0])
        const hA = A[3] - A[1], hB = B[3] - B[1], wA = A[2] - A[0], wB = B[2] - B[0]
        const bothHorizontal = wA > hA && wB > hB
        const bothVertical = hA > wA && hB > wB
        const gapX = Math.max(A[0], B[0]) - Math.min(A[2], B[2])
        const gapY = Math.max(A[1], B[1]) - Math.min(A[3], B[3])
        if ((bothHorizontal && overlapY > 0.7 * Math.min(hA, hB) && gapX < 30) ||
            (bothVertical && overlapX > 0.7 * Math.min(wA, wB) && gapY < 30)) {
          corridors[i] = { ...corridors[i], bbox: [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])] }
          corridors.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  const merged = [...rest, ...corridors]
  merged.forEach((s, i) => (s.id = `s${i + 1}`))
  return merged
}

async function analyzeOne(name) {
  const metaAll = JSON.parse(fs.readFileSync(path.join(WORK, 'meta.json'), 'utf8'))
  const m = metaAll.find((x) => x.name === name)
  const fullPath = path.join(WORK, `${name}_full.png`)
  const { width: W, height: H } = await sharp(fullPath).metadata()

  // 2x2 타일 (오버랩 포함). 작은 이미지는 확대해서라도 해상도 확보
  const tw = Math.round(W * (0.5 + OVERLAP / 2))
  const th = Math.round(H * (0.5 + OVERLAP / 2))
  const origins = [
    [0, 0, '좌상단'], [W - tw, 0, '우상단'],
    [0, H - th, '좌하단'], [W - tw, H - th, '우하단'],
  ]

  console.log(`[${name}] 타일 분석 시작 (full ${W}x${H}, 타일 ${tw}x${th} x4, model=${MODEL})`)
  const t0 = Date.now()
  const allSpaces = []
  const allDims = []
  let totalIn = 0, totalOut = 0

  const tasks = origins.map(async ([ox, oy, posDesc], idx) => {
    const buf = await sharp(fullPath).extract({ left: ox, top: oy, width: tw, height: th }).toBuffer()
    const tMeta = await sharp(buf).metadata()
    const scale = TILE_LONG / Math.max(tMeta.width, tMeta.height)
    const resized = await sharp(buf).resize(Math.round(tMeta.width * scale), Math.round(tMeta.height * scale)).png().toBuffer()
    const { result, usage } = await analyzeTile(resized, { gridDesc: '2x2 분할', posDesc }, name, idx)
    totalIn += usage.input_tokens; totalOut += usage.output_tokens
    // 타일 px → full px → vision px
    const toVision = (p) => [(p[0] / scale + ox) * m.visionScale, (p[1] / scale + oy) * m.visionScale]
    for (const s of result.spaces || []) {
      const p1 = toVision([s.bbox[0], s.bbox[1]]), p2 = toVision([s.bbox[2], s.bbox[3]])
      allSpaces.push({ ...s, bbox: [p1[0], p1[1], p2[0], p2[1]], tile: idx })
    }
    for (const d of result.dimensionReadings || []) {
      allDims.push({ ...d, fromPx: toVision(d.fromPx), toPx: toVision(d.toPx) })
    }
  })
  await Promise.all(tasks)

  const spaces = mergeSpaces(allSpaces)
  const out = {
    model: MODEL, method: 'tiled-2x2', elapsedMs: Date.now() - t0,
    usage: { input_tokens: totalIn, output_tokens: totalOut },
    title: '', scaleText: '',
    rawCount: allSpaces.length,
    dimensionReadings: allDims,
    spaces,
  }
  fs.writeFileSync(path.join(WORK, `${name}_analysis_v2.json`), JSON.stringify(out, null, 2))
  const byType = {}
  for (const s of spaces) byType[s.type] = (byType[s.type] || 0) + 1
  console.log(`[${name}] 완료 ${((Date.now() - t0) / 1000).toFixed(1)}s | raw ${allSpaces.length} → 병합 ${spaces.length}개`, byType, `| 치수 ${allDims.length}건 | tokens in=${totalIn} out=${totalOut}`)
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['good_1', 'good_2']
for (const name of targets) await analyzeOne(name)
