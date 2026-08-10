/**
 * 병원상세정보연동 스모크 — 심평원 getEqpInfo2.8 실호출 + hira_hospitals 갱신 검증
 * 상급종합·치과병원·한방병원 각 2곳에 대해 허가병상수(permSbdCnt)를 조회·저장하고 값 확인
 * (실데이터 갱신 — 연동 기능의 정상 산출물이므로 롤백하지 않음)
 *
 *   npx tsx scripts/hira-detail-sync-smoke.mts
 */
import { prisma } from '../lib/prisma'

const API_BASE = 'https://apis.data.go.kr/B551182/MadmDtlInfoService2.8/getEqpInfo2.8'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}`) }
}

function toInt(val: unknown): number | null {
  if (val === undefined || val === null || String(val).trim() === '') return null
  const n = parseInt(String(val).trim(), 10)
  return isNaN(n) ? null : n
}

// detail-sync route와 동일 로직
async function fetchPermSbdCnt(ykiho: string, apiKey: string): Promise<number | null> {
  const url = `${API_BASE}?ykiho=${encodeURIComponent(ykiho)}&_type=json&serviceKey=${encodeURIComponent(apiKey)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = JSON.parse(await res.text())
  const header = json?.response?.header
  if (header?.resultCode !== '00') throw new Error(`API [${header?.resultCode}] ${header?.resultMsg}`)
  const rawItems = json?.response?.body?.items?.item
  if (!rawItems) return null
  const item = Array.isArray(rawItems) ? rawItems[0] : rawItems
  return toInt(item?.permSbdCnt)
}

async function main() {
  const apiKey = process.env.HIRA_API_KEY
  if (!apiKey) throw new Error('HIRA_API_KEY 미설정')

  for (const typeCode of ['01', '41', '92']) {
    const targets = await prisma.hiraHospital.findMany({
      where: { typeCode },
      select: { id: true, hiraId: true, name: true, typeName: true },
      take: 2,
      orderBy: { id: 'asc' },
    })
    for (const t of targets) {
      const permSbdCnt = await fetchPermSbdCnt(t.hiraId, apiKey)
      await prisma.hiraHospital.update({
        where: { id: t.id },
        data: { permSbdCnt, detailSyncedAt: new Date() },
      })
      const saved = await prisma.hiraHospital.findUnique({
        where: { id: t.id },
        select: { permSbdCnt: true, detailSyncedAt: true },
      })
      check(
        `[${t.typeName}] ${t.name} — 허가병상수 ${permSbdCnt ?? 'null'} 저장·재조회 일치`,
        saved?.permSbdCnt === permSbdCnt && saved?.detailSyncedAt != null,
      )
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  // 서울아산병원 실측값(2,446) 교차 검증
  const asan = await prisma.hiraHospital.findFirst({
    where: { name: { contains: '서울아산병원' } },
    select: { id: true, hiraId: true, name: true },
  })
  if (asan) {
    const cnt = await fetchPermSbdCnt(asan.hiraId, apiKey)
    check(`서울아산병원 허가병상수 = 2446 (실측 ${cnt})`, cnt === 2446)
  }

  console.log(`\n결과: ${pass} pass / ${fail} fail`)
  if (fail > 0) process.exit(1)
}

main().finally(() => prisma.$disconnect())
