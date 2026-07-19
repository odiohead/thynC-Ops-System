// Phase 0 전처리: 샘플 도면 → full(원본해상도·방향보정) / vision(장변 1568px) / grid(vision+좌표 그리드)
// 사용: node scripts/gateway-planner-phase0/preprocess.mjs
import sharp from 'sharp'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SRC = path.join(ROOT, 'docs/gateway-planner-samples')
const OUT = path.join(ROOT, 'scripts/gateway-planner-phase0/work')
fs.mkdirSync(OUT, { recursive: true })

// Claude Vision은 장변 약 1568px로 다운샘플하므로, 좌표 정밀도를 위해 이 해상도로 직접 보냄
const VISION_LONG = 1568
const GRID_STEP = 100 // vision px 기준 그리드 간격

/** vision 이미지에 좌표 그리드(연한 선 + 가장자리 px 라벨) 합성 */
async function makeGrid(visionPath, gridPath) {
  const { width: w, height: h } = await sharp(visionPath).metadata()
  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`
  for (let x = GRID_STEP; x < w; x += GRID_STEP) {
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#00A0FF" stroke-width="1" stroke-opacity="0.35"/>`
    svg += `<text x="${x + 2}" y="14" font-size="13" font-family="sans-serif" fill="#0060C0">${x}</text>`
    svg += `<text x="${x + 2}" y="${h - 4}" font-size="13" font-family="sans-serif" fill="#0060C0">${x}</text>`
  }
  for (let y = GRID_STEP; y < h; y += GRID_STEP) {
    svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#00A0FF" stroke-width="1" stroke-opacity="0.35"/>`
    svg += `<text x="2" y="${y - 3}" font-size="13" font-family="sans-serif" fill="#0060C0">${y}</text>`
    svg += `<text x="${w - 38}" y="${y - 3}" font-size="13" font-family="sans-serif" fill="#0060C0">${y}</text>`
  }
  svg += '</svg>'
  await sharp(visionPath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(gridPath)
}

async function processOne(name, inputPath, rotate = 0) {
  let img = sharp(inputPath)
  if (rotate) img = img.rotate(rotate)
  const fullPath = path.join(OUT, `${name}_full.png`)
  await img.png().toFile(fullPath)
  const meta = await sharp(fullPath).metadata()
  const visionPath = path.join(OUT, `${name}_vision.png`)
  const long = Math.max(meta.width, meta.height)
  const scale = VISION_LONG / long
  await sharp(fullPath)
    .resize(Math.round(meta.width * scale), Math.round(meta.height * scale))
    .png()
    .toFile(visionPath)
  const vMeta = await sharp(visionPath).metadata()
  await makeGrid(visionPath, path.join(OUT, `${name}_grid.png`))
  console.log(`${name}: full ${meta.width}x${meta.height} → vision ${vMeta.width}x${vMeta.height} (scale ${scale.toFixed(4)})`)
  return { name, full: { w: meta.width, h: meta.height }, vision: { w: vMeta.width, h: vMeta.height }, visionScale: scale, rotate }
}

const results = []

// good_2: PDF → 200DPI PNG (회전 여부는 래스터 후 판단 — 기본 0으로 생성)
const g2raw = path.join(OUT, 'good_2_raw.png')
if (!fs.existsSync(g2raw)) {
  execSync(`pdftoppm -r 200 -png -singlefile "${path.join(SRC, 'good_2.pdf')}" "${g2raw.replace(/\.png$/, '')}"`)
}
const ROT_GOOD2 = Number(process.env.ROT_GOOD2 ?? 0)

results.push(await processOne('good_1', path.join(SRC, 'good_1.jpg')))
results.push(await processOne('good_2', g2raw, ROT_GOOD2))
results.push(await processOne('bad_1', path.join(SRC, 'bad_1.jpg')))
results.push(await processOne('bad_2', path.join(SRC, 'bad_2.jpg')))

fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(results, null, 2))
console.log('완료 →', OUT)
