// 모바일 앱(PWA) 아이콘 생성 — logo.svg(흰 워드마크)를 브랜드 primary(#2C5CE5) 정사각 배경에 배치
//   node scripts/gen-mobile-icons.mjs "$PWD"   → public/icons/*.png (mobile_pwa_design.md §4.1)
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
const root = process.argv[2]
const logo = readFileSync(`${root}/public/logo.svg`, 'utf8')
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
const BG = '#2C5CE5'
// size: 출력 px, ratio: 워드마크 폭 비율, radius: 모서리(0 = 꽉 찬 사각 — maskable·apple)
function svg(size, ratio, radius) {
  const w = size * ratio, h = w * 76 / 292
  const x = (size - w) / 2, y = (size - h) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  <svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 292 76">${inner}</svg></svg>`
}
const out = [
  ['icon-192.png', 192, 0.72, 0],
  ['icon-512.png', 512, 0.72, 0],
  ['maskable-512.png', 512, 0.56, 0], // 안전 영역(지름 80%) 안에 들어오도록 작게
  ['apple-touch-icon.png', 180, 0.70, 0],
]
for (const [name, size, ratio, r] of out) {
  await sharp(Buffer.from(svg(size, ratio, r))).png().toFile(`${root}/public/icons/${name}`)
  console.log(name)
}
