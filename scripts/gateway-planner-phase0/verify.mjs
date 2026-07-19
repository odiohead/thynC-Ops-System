// Phase 0 개선 — 2-pass 검증: 1차(타일) 인식 결과를 오버레이로 보여주고 교정 → analysis_v3
// 사용: node scripts/gateway-planner-phase0/verify.mjs [샘플명...]
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
const COLORS = {
  corridor: '#2563eb', ward: '#059669', toilet: '#d97706', nurse_station: '#7c3aed',
  stairs: '#6b7280', elevator: '#6b7280', outdoor: '#9ca3af', storage: '#92400e',
  machine: '#374151', other: '#db2777',
}

const tool = {
  name: 'report_corrections',
  description: '1차 공간 인식 결과에 대한 교정 목록을 보고한다.',
  input_schema: {
    type: 'object',
    properties: {
      removeIds: { type: 'array', items: { type: 'string' }, description: '삭제할 공간 id (실체 없음·중복·도면 밖·여러 실을 잘못 묶음)' },
      retype: {
        type: 'array', description: '유형이 잘못된 공간',
        items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: SPACE_TYPES } }, required: ['id', 'type'] },
      },
      rebox: {
        type: 'array', description: 'bbox가 어긋난 공간의 수정 좌표',
        items: { type: 'object', properties: { id: { type: 'string' }, bbox: { type: 'array', items: { type: 'number' } } }, required: ['id', 'bbox'] },
      },
      add: {
        type: 'array', description: '누락된 공간 (특히 복도·화장실 우선 점검)',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: SPACE_TYPES }, label: { type: 'string' },
            bbox: { type: 'array', items: { type: 'number' } }, confidence: { type: 'string', enum: ['high', 'mid', 'low'] },
          },
          required: ['type', 'label', 'bbox', 'confidence'],
        },
      },
    },
    required: ['removeIds', 'retype', 'rebox', 'add'],
  },
}

const SYSTEM = `당신은 병원 건축 도면 분석 검수자다. 1차 AI가 인식한 공간(색상 박스 + id 라벨)이 오버레이된 도면을 보고 오류를 교정한다.

색상: 파랑=corridor, 초록=ward(병실), 주황=toilet, 보라=nurse_station, 회색=stairs/elevator, 갈색=storage, 진회색=machine, 분홍=other.
이미지에는 픽셀 그리드(하늘색 100px 간격, 가장자리 눈금 라벨)도 있다. 좌표는 이 눈금 기준.

점검 순서:
1. **누락된 복도** — 실들을 잇는 통로인데 파란 박스가 없는 곳이 있으면 add. 복도 bbox는 통로 폭만 정확히.
2. **누락된 실** — 병실·화장실 등 박스가 전혀 없는 실이 있으면 add.
3. **여러 실을 하나로 묶은 박스** — removeIds에 넣고 각 실을 add로 분리.
4. **유형 오류** — 병상 그림이 있는데 other로 된 방 등은 retype.
5. **실체 없는 박스** — 도면 요소가 없는 위치의 박스, 같은 실에 겹친 중복 박스는 removeIds.
6. **크게 어긋난 bbox** — 벽 경계와 많이 다른 것만 rebox (미세 오차는 무시).

교정할 것이 없으면 빈 배열로 보고한다. 확실한 교정만 한다.`

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

async function verifyOne(name) {
  const analysis = JSON.parse(fs.readFileSync(path.join(WORK, `${name}_analysis_v2.json`), 'utf8'))
  const gridPath = path.join(WORK, `${name}_grid.png`)
  const { width: w, height: h } = await sharp(gridPath).metadata()

  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`
  for (const s of analysis.spaces) {
    const [x1, y1, x2, y2] = s.bbox
    const c = COLORS[s.type] || '#000'
    svg += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="2"/>`
    svg += `<text x="${x1 + 3}" y="${y1 + 13}" font-size="11" font-weight="bold" font-family="sans-serif" fill="${c}">${esc(s.id)}</text>`
  }
  svg += '</svg>'
  const overlayBuf = await sharp(gridPath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
  fs.writeFileSync(path.join(WORK, `${name}_verify_input.png`), overlayBuf)

  const listText = analysis.spaces.map((s) => `${s.id}: ${s.type}${s.label ? ` (${s.label})` : ''}`).join('\n')
  console.log(`[${name}] 2-pass 검증 요청 (공간 ${analysis.spaces.length}개)`)
  const t0 = Date.now()
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'report_corrections' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: overlayBuf.toString('base64') } },
        { type: 'text', text: `1차 인식 결과 목록:\n${listText}\n\n이미지(${w}x${h}px)를 검수하고 report_corrections로 교정을 보고하라.` },
      ],
    }],
  })
  const msg = await stream.finalMessage()
  const corr = msg.content.find((b) => b.type === 'tool_use').input

  let spaces = analysis.spaces.filter((s) => !corr.removeIds.includes(s.id))
  for (const r of corr.retype) { const s = spaces.find((x) => x.id === r.id); if (s) s.type = r.type }
  for (const r of corr.rebox) { const s = spaces.find((x) => x.id === r.id); if (s && r.bbox.length === 4) s.bbox = r.bbox }
  for (const a of corr.add) spaces.push({ id: '', ...a })
  spaces.forEach((s, i) => (s.id = `s${i + 1}`))

  const out = { ...analysis, method: 'tiled-2x2 + verify', spaces, corrections: corr, verifyUsage: msg.usage, verifyElapsedMs: Date.now() - t0 }
  fs.writeFileSync(path.join(WORK, `${name}_analysis_v3.json`), JSON.stringify(out, null, 2))
  const byType = {}
  for (const s of spaces) byType[s.type] = (byType[s.type] || 0) + 1
  console.log(`[${name}] 완료 ${((Date.now() - t0) / 1000).toFixed(1)}s | 교정: 삭제 ${corr.removeIds.length}·유형 ${corr.retype.length}·좌표 ${corr.rebox.length}·추가 ${corr.add.length} → ${spaces.length}개`, byType, `| tokens in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`)
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['good_1', 'good_2']
for (const name of targets) await verifyOne(name)
