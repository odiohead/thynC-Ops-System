// Phase 0 — 공간 인식 결과를 vision 이미지 위에 색상 bbox로 렌더 (검증용)
// 사용: node scripts/gateway-planner-phase0/render_spaces.mjs [샘플명...]
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const WORK = path.join(path.resolve(import.meta.dirname, '../..'), 'scripts/gateway-planner-phase0/work')

const COLORS = {
  corridor: '#2563eb', ward: '#059669', toilet: '#d97706', nurse_station: '#7c3aed',
  stairs: '#6b7280', elevator: '#6b7280', outdoor: '#9ca3af', storage: '#92400e',
  machine: '#374151', other: '#db2777',
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

const V = process.env.VARIANT ? `_${process.env.VARIANT}` : ''

async function renderOne(name) {
  const analysis = JSON.parse(fs.readFileSync(path.join(WORK, `${name}_analysis${V}.json`), 'utf8'))
  const visionPath = path.join(WORK, `${name}_vision.png`)
  const { width: w, height: h } = await sharp(visionPath).metadata()
  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`
  for (const s of analysis.spaces) {
    const [x1, y1, x2, y2] = s.bbox
    const c = COLORS[s.type] || '#000'
    const dash = s.confidence === 'low' ? ' stroke-dasharray="6,4"' : ''
    svg += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="${c}" fill-opacity="0.13" stroke="${c}" stroke-width="2"${dash}/>`
    svg += `<text x="${x1 + 3}" y="${y1 + 14}" font-size="11" font-weight="bold" font-family="sans-serif" fill="${c}">${esc(s.id)}:${s.type}${s.confidence !== 'high' ? '(' + s.confidence + ')' : ''}</text>`
  }
  for (const d of analysis.dimensionReadings || []) {
    svg += `<line x1="${d.fromPx[0]}" y1="${d.fromPx[1]}" x2="${d.toPx[0]}" y2="${d.toPx[1]}" stroke="#dc2626" stroke-width="3" stroke-opacity="0.7"/>`
    const mx = (d.fromPx[0] + d.toPx[0]) / 2, my = (d.fromPx[1] + d.toPx[1]) / 2
    svg += `<text x="${mx}" y="${my - 5}" font-size="13" font-weight="bold" font-family="sans-serif" fill="#dc2626">${d.valueMm}mm</text>`
  }
  svg += '</svg>'
  const out = path.join(WORK, `${name}_spaces${V}.png`)
  await sharp(visionPath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out)
  console.log(`[${name}] → ${out}`)
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['good_1', 'good_2', 'bad_1', 'bad_2']
for (const name of targets) await renderOne(name)
