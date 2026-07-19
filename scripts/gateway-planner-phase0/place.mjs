// Phase 0 — 배치 엔진 시제품: 공간 인식 결과 + 스케일 → 게이트웨이 점 산출 + 오버레이 렌더
// 사용: node scripts/gateway-planner-phase0/place.mjs [샘플명...]
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const WORK = path.join(path.resolve(import.meta.dirname, '../..'), 'scripts/gateway-planner-phase0/work')

// 설계안 §6.2 기본 규칙
const RULES = {
  coverageDiameterM: 10,
  corridorOverlapFactor: 0.8, // 복도 점 간격 = 10m × 0.8 = 8m
  wardDefaultCount: 2,
  wardSmallCount: 1,
  wardSmallThresholdM2: 20,
  toiletCount: 1,
  excludedSpaceTypes: ['stairs', 'elevator', 'outdoor'],
  minRoomAreaM2: 2, // 이보다 작은 실(PS 샤프트 등)은 스킵 — 스케일 있을 때만 적용
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** 치수 판독으로부터 스케일(m/px) 산출 — 긴 구간 우선 + 이상치 제거(robust median) */
function computeScale(readings) {
  const cands = readings
    .filter((r) => r.confidence !== 'low')
    .map((r) => ({ mPerPx: r.valueMm / 1000 / dist(r.fromPx, r.toPx), pxLen: dist(r.fromPx, r.toPx) }))
    .filter((c) => Number.isFinite(c.mPerPx) && c.mPerPx > 0 && c.pxLen >= 100) // 짧은 구간은 끝점 오차 비율이 커서 제외
  if (!cands.length) return { mPerPx: null, spreadPct: null, candidates: [], used: 0 }
  const median = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)]
  // 1차 중앙값 → ±30% 밖 이상치 제거 → 생존 후보로 재계산 (2회 반복)
  let vals = cands.map((c) => c.mPerPx)
  for (let iter = 0; iter < 2; iter++) {
    const med = median(vals)
    const kept = vals.filter((v) => Math.abs(v - med) / med <= 0.3)
    if (kept.length >= 3) vals = kept
  }
  const m = median(vals)
  const spreadPct = ((Math.max(...vals) - Math.min(...vals)) / m) * 100
  return { mPerPx: m, spreadPct, candidates: vals.map((v) => +v.toFixed(5)), used: vals.length, rejected: cands.length - vals.length }
}

function placeForSpace(s, mPerPx, rules) {
  const [x1, y1, x2, y2] = s.bbox
  const w = x2 - x1, h = y2 - y1
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
  const areaM2 = mPerPx ? w * h * mPerPx * mPerPx : null

  if (rules.excludedSpaceTypes.includes(s.type)) return { points: [], skipped: 'excluded' }
  if (areaM2 !== null && areaM2 < rules.minRoomAreaM2 && s.type !== 'corridor') return { points: [], skipped: 'too_small' }

  if (s.type === 'corridor') {
    // 장축 중심선을 따라 간격 배치
    const horizontal = w >= h
    const lengthPx = horizontal ? w : h
    const lengthM = mPerPx ? lengthPx * mPerPx : null
    const spacingM = rules.coverageDiameterM * rules.corridorOverlapFactor
    const n = lengthM ? Math.max(1, Math.round(lengthM / spacingM)) : 1
    const pts = []
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      pts.push(horizontal ? [x1 + w * t, cy] : [cx, y1 + h * t])
    }
    return { points: pts, note: lengthM ? `복도 ${lengthM.toFixed(0)}m → ${n}개 (간격 ${spacingM}m)` : '스케일 없음 → 중앙 1개' }
  }

  if (s.type === 'toilet') return { points: [[cx, cy]] }

  // ward 및 기타 실: 면적 기준 1~2개 (스케일 없으면 병실 2·기타 1)
  const two = areaM2 !== null ? areaM2 >= rules.wardSmallThresholdM2 : s.type === 'ward'
  if (two) {
    const horizontal = w >= h
    return {
      points: horizontal
        ? [[x1 + w * 0.25, cy], [x1 + w * 0.75, cy]]
        : [[cx, y1 + h * 0.25], [cx, y1 + h * 0.75]],
    }
  }
  return { points: [[cx, cy]] }
}

const V = process.env.VARIANT ? `_${process.env.VARIANT}` : ''
// 스케일용 치수는 다른 분석본에서 가져올 수 있음 (전체 뷰 판독이 치수 체인에 더 정확)
const SV = process.env.SCALE_VARIANT !== undefined ? (process.env.SCALE_VARIANT ? `_${process.env.SCALE_VARIANT}` : '') : V

async function placeOne(name) {
  const analysis = JSON.parse(fs.readFileSync(path.join(WORK, `${name}_analysis${V}.json`), 'utf8'))
  const scaleSrc = SV === V ? analysis : JSON.parse(fs.readFileSync(path.join(WORK, `${name}_analysis${SV}.json`), 'utf8'))
  const scale = computeScale(scaleSrc.dimensionReadings || [])
  const all = []
  const skipped = {}
  for (const s of analysis.spaces) {
    const r = placeForSpace(s, scale.mPerPx, RULES)
    if (r.skipped) { skipped[r.skipped] = (skipped[r.skipped] || 0) + 1; continue }
    for (const p of r.points) all.push({ x: p[0], y: p[1], spaceId: s.id, type: s.type, label: s.label })
  }

  const visionPath = path.join(WORK, `${name}_vision.png`)
  const { width: w, height: h } = await sharp(visionPath).metadata()
  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`
  for (const p of all) {
    svg += `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#FF0000" stroke="#ffffff" stroke-width="1.5"/>`
  }
  svg += `<rect x="${w - 200}" y="8" width="192" height="34" rx="6" fill="#111827" fill-opacity="0.85"/>`
  svg += `<text x="${w - 188}" y="31" font-size="19" font-weight="bold" font-family="sans-serif" fill="#ffffff">Gateway x ${all.length}</text>`
  svg += '</svg>'
  const out = path.join(WORK, `${name}_placed${V}.png`)
  await sharp(visionPath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out)

  const result = { rules: RULES, scale, total: all.length, skipped, points: all }
  fs.writeFileSync(path.join(WORK, `${name}_placement${V}.json`), JSON.stringify(result, null, 2))
  console.log(`[${name}] 스케일 ${scale.mPerPx ? scale.mPerPx.toFixed(5) + ' m/px (산포 ' + scale.spreadPct.toFixed(1) + '%, 후보 ' + JSON.stringify(scale.candidates) + ')' : '없음'} | 총 ${all.length}대 | 스킵`, skipped, `→ ${out}`)
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['good_1', 'good_2', 'bad_1', 'bad_2']
for (const name of targets) await placeOne(name)
