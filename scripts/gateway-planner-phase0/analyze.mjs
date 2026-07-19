// Phase 0 — Claude Vision 공간 인식 실험
// 사용: node scripts/gateway-planner-phase0/analyze.mjs [샘플명...] (기본: 전체)
import Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(import.meta.dirname, '../..')
const WORK = path.join(ROOT, 'scripts/gateway-planner-phase0/work')

const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const apiKey = envText.match(/^ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)"?/m)?.[1]
if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found in .env')
const client = new Anthropic({ apiKey })

const MODEL = process.env.GP_MODEL || 'claude-opus-4-8'

const SPACE_TYPES = ['corridor', 'ward', 'toilet', 'nurse_station', 'stairs', 'elevator', 'outdoor', 'storage', 'machine', 'other']

const tool = {
  name: 'report_floorplan_analysis',
  description: '병원 도면 분석 결과를 구조화하여 보고한다.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '도면 표제 (예: 지상9층 평면도). 없으면 빈 문자열' },
      scaleText: { type: 'string', description: '도면에 표기된 축척 문구 (예: A1 1/150). 없으면 빈 문자열' },
      dimensionReadings: {
        type: 'array',
        description: '도면의 치수 표기 중 명확히 읽히는 것 3~8개. 치수선이 가리키는 구간의 양 끝점을 이 이미지의 픽셀 좌표로 보고',
        items: {
          type: 'object',
          properties: {
            valueMm: { type: 'number', description: '치수값 (mm 단위, 예: 6000)' },
            fromPx: { type: 'array', items: { type: 'number' }, description: '구간 시작점 [x, y] (px)' },
            toPx: { type: 'array', items: { type: 'number' }, description: '구간 끝점 [x, y] (px)' },
            confidence: { type: 'string', enum: ['high', 'mid', 'low'] },
          },
          required: ['valueMm', 'fromPx', 'toPx', 'confidence'],
        },
      },
      spaces: {
        type: 'array',
        description: '도면 안의 모든 공간(방·복도). 표제란·범례·도면 밖 영역은 제외',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 's1, s2, ... 순번' },
            type: { type: 'string', enum: SPACE_TYPES },
            label: { type: 'string', description: '도면에 표기된 실명 그대로 (예: 9808호, 남/여 화장실). 표기 없으면 빈 문자열' },
            bbox: { type: 'array', items: { type: 'number' }, description: '[x1, y1, x2, y2] px — 공간을 감싸는 최소 사각형. 파란 그리드 눈금 기준으로 정확히' },
            confidence: { type: 'string', enum: ['high', 'mid', 'low'] },
          },
          required: ['id', 'type', 'label', 'bbox', 'confidence'],
        },
      },
    },
    required: ['title', 'scaleText', 'dimensionReadings', 'spaces'],
  },
}

const SYSTEM = `당신은 병원 건축 도면 분석 전문가다. 병실 모니터링 시스템의 신호수신장치(게이트웨이) 설치 계획을 위해 도면의 공간 구조를 인식한다.

이미지에는 픽셀 좌표 그리드(파란 선, 100px 간격)가 오버레이되어 있고 가장자리에 px 눈금 라벨이 있다. 모든 좌표는 이 눈금을 기준으로 보고한다.

공간 분류 기준:
- corridor: 복도 (실들을 연결하는 통로. L/T자형이면 직선 구간별로 나눠 여러 개로 보고)
- ward: 병실 (호수 표기가 있는 입원실. 병상 기호가 그려진 방)
- toilet: 화장실 (공용·실내 구분 없이. 실명에 화장실/T 표기 또는 위생기구 기호)
- nurse_station: 간호사실/간호데스크/NS
- stairs: 계단실 / elevator: 엘리베이터·EV홀 / outdoor: 야외(발코니·테라스·옥상)
- storage: 창고·물품보관 / machine: 기계실·공조실·EPS·PS(파이프샤프트) 등 설비 공간
- other: 위에 해당하지 않는 모든 실 (진료실·처치실·상담실·데이룸·휴게실 등)

규칙:
- 도면에 그려진 모든 폐쇄 공간을 빠짐없이 보고한다. 작은 방도 생략하지 않는다.
- bbox는 벽 경계를 기준으로 그 공간만 감싸는 최소 사각형. 그리드 눈금을 활용해 최대한 정확히.
- 실명 텍스트가 있으면 label에 그대로 옮긴다 (면적·병상수 표기 포함. 예: "9808호(6->4) 36.4m2").
- 치수 표기(dimensionReadings)는 숫자가 명확히 읽히는 것만. 치수선 양 끝점의 픽셀 위치를 정확히 보고한다. 특히 여러 칸에 걸친 합계 치수(긴 구간)가 있으면 우선 포함한다.
- 확신이 없으면 confidence를 낮춘다. 지어내지 않는다.`

async function analyzeOne(name) {
  const gridPath = path.join(WORK, `${name}_grid.png`)
  const meta = await sharp(gridPath).metadata()
  const imgB64 = fs.readFileSync(gridPath).toString('base64')

  console.log(`[${name}] 분석 요청 (${meta.width}x${meta.height}, model=${MODEL}) ...`)
  const t0 = Date.now()
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'report_floorplan_analysis' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imgB64 } },
          {
            type: 'text',
            text: `이 병원 도면(이미지 크기 ${meta.width}x${meta.height}px)을 분석해 report_floorplan_analysis 도구로 보고하라.`,
          },
        ],
      },
    ],
  })
  const msg = await stream.finalMessage()
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block) throw new Error('tool_use 블록 없음: ' + JSON.stringify(msg.content).slice(0, 500))
  const result = block.input
  const outPath = path.join(WORK, `${name}_analysis.json`)
  fs.writeFileSync(outPath, JSON.stringify({ model: MODEL, usage: msg.usage, elapsedMs: Date.now() - t0, ...result }, null, 2))
  const byType = {}
  for (const s of result.spaces) byType[s.type] = (byType[s.type] || 0) + 1
  console.log(`[${name}] 완료 ${(Date.now() - t0) / 1000}s | 공간 ${result.spaces.length}개`, byType, `| 치수 ${result.dimensionReadings.length}건 | tokens in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`)
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['good_1', 'good_2', 'bad_1', 'bad_2']
for (const name of targets) {
  await analyzeOne(name)
}
