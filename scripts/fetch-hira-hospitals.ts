import { PrismaClient } from '@prisma/client'
import * as xml2js from 'xml2js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const prisma = new PrismaClient()

const API_BASE = 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList'
const API_KEY = process.env.HIRA_API_KEY!
const NUM_OF_ROWS = 1000

const CL_CODES: { code: string; name: string }[] = [
  { code: '1',  name: '상급종합' },
  { code: '11', name: '종합병원' },
  { code: '21', name: '병원' },
  { code: '28', name: '요양병원' },
  { code: '29', name: '정신병원' },
  { code: '31', name: '의원' },
  { code: '41', name: '치과병원' },
  { code: '51', name: '치과의원' },
  { code: '61', name: '조산원' },
  { code: '71', name: '보건소' },
  { code: '72', name: '보건지소' },
  { code: '73', name: '보건진료소' },
  { code: '75', name: '보건의료원' },
  { code: '92', name: '한방병원' },
  { code: '93', name: '한의원' },
]

function toStr(val: unknown): string | null {
  if (val === undefined || val === null) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

function toInt(val: unknown): number | null {
  const s = toStr(val)
  if (!s) return null
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

function toDate(val: unknown): string | null {
  const s = toStr(val)
  if (!s || s.length !== 8) return null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPage(clCd: string, pageNo: number): Promise<{ totalCount: number; items: Record<string, unknown>[] }> {
  const url = new URL(API_BASE)
  url.searchParams.set('pageNo', String(pageNo))
  url.searchParams.set('numOfRows', String(NUM_OF_ROWS))
  url.searchParams.set('clCd', clCd)
  const fullUrl = `${url.toString()}&ServiceKey=${encodeURIComponent(API_KEY)}`

  const res = await fetch(fullUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

  const xml = await res.text()
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, trim: true })

  const response = parsed?.response
  const header = response?.header
  const resultCode = header?.resultCode
  if (resultCode !== '00') {
    throw new Error(`API 오류 [${resultCode}]: ${header?.resultMsg}`)
  }

  const body = response?.body
  const totalCount = toInt(body?.totalCount) ?? 0

  if (totalCount === 0) return { totalCount: 0, items: [] }

  const rawItems = body?.items?.item
  if (!rawItems) return { totalCount, items: [] }

  const items: Record<string, unknown>[] = Array.isArray(rawItems) ? rawItems : [rawItems]
  return { totalCount, items }
}

async function upsertHospitals(items: Record<string, unknown>[]): Promise<number> {
  let count = 0
  for (const item of items) {
    const hiraId = toStr(item['ykiho'])
    if (!hiraId) continue

    await prisma.hiraHospital.upsert({
      where: { hiraId },
      create: {
        hiraId,
        name: toStr(item['yadmNm']) ?? '',
        typeCode: toStr(item['clCd']) ?? '',
        typeName: toStr(item['clCdNm']) ?? '',
        sidoCode: toStr(item['sidoCd']) ?? '',
        sidoName: toStr(item['sidoCdNm']) ?? '',
        sigunguCode: toStr(item['sgguCd']) ?? '',
        sigunguName: toStr(item['sgguCdNm']) ?? '',
        eupmyeondong: toStr(item['emdongNm']),
        postalCode: toStr(item['postNo']),
        address: toStr(item['addr']),
        phone: toStr(item['telno']),
        homepage: toStr(item['hospUrl']),
        openedAt: toDate(item['estbDd']),
        totalDoctors: toInt(item['drTotCnt']),
        coordinateX: toStr(item['XPos']),
        coordinateY: toStr(item['YPos']),
        mdeptGdrCnt: toInt(item['mdeptGdrCnt']),
        mdeptIntnCnt: toInt(item['mdeptIntnCnt']),
        mdeptResdntCnt: toInt(item['mdeptResdntCnt']),
        mdeptSdrCnt: toInt(item['mdeptSdrCnt']),
        detyGdrCnt: toInt(item['detyGdrCnt']),
        detyIntnCnt: toInt(item['detyIntnCnt']),
        detyResdntCnt: toInt(item['detyResdntCnt']),
        detySdrCnt: toInt(item['detySdrCnt']),
        cmdcGdrCnt: toInt(item['cmdcGdrCnt']),
        cmdcIntnCnt: toInt(item['cmdcIntnCnt']),
        cmdcResdntCnt: toInt(item['cmdcResdntCnt']),
        cmdcSdrCnt: toInt(item['cmdcSdrCnt']),
      },
      update: {
        name: toStr(item['yadmNm']) ?? '',
        typeCode: toStr(item['clCd']) ?? '',
        typeName: toStr(item['clCdNm']) ?? '',
        sidoCode: toStr(item['sidoCd']) ?? '',
        sidoName: toStr(item['sidoCdNm']) ?? '',
        sigunguCode: toStr(item['sgguCd']) ?? '',
        sigunguName: toStr(item['sgguCdNm']) ?? '',
        eupmyeondong: toStr(item['emdongNm']),
        postalCode: toStr(item['postNo']),
        address: toStr(item['addr']),
        phone: toStr(item['telno']),
        homepage: toStr(item['hospUrl']),
        openedAt: toDate(item['estbDd']),
        totalDoctors: toInt(item['drTotCnt']),
        coordinateX: toStr(item['XPos']),
        coordinateY: toStr(item['YPos']),
        mdeptGdrCnt: toInt(item['mdeptGdrCnt']),
        mdeptIntnCnt: toInt(item['mdeptIntnCnt']),
        mdeptResdntCnt: toInt(item['mdeptResdntCnt']),
        mdeptSdrCnt: toInt(item['mdeptSdrCnt']),
        detyGdrCnt: toInt(item['detyGdrCnt']),
        detyIntnCnt: toInt(item['detyIntnCnt']),
        detyResdntCnt: toInt(item['detyResdntCnt']),
        detySdrCnt: toInt(item['detySdrCnt']),
        cmdcGdrCnt: toInt(item['cmdcGdrCnt']),
        cmdcIntnCnt: toInt(item['cmdcIntnCnt']),
        cmdcResdntCnt: toInt(item['cmdcResdntCnt']),
        cmdcSdrCnt: toInt(item['cmdcSdrCnt']),
      },
    })
    count++
  }
  return count
}

async function main() {
  if (!API_KEY) {
    console.error('HIRA_API_KEY 환경변수가 설정되지 않았습니다.')
    process.exit(1)
  }

  console.log('=== 심평원 병원정보 전체 갱신 시작 ===\n')

  const summary: { name: string; count: number }[] = []
  let grandTotal = 0

  for (const cl of CL_CODES) {
    console.log(`▶ [${cl.code}] ${cl.name} 처리 중...`)

    // 1페이지로 totalCount 파악
    const first = await fetchPage(cl.code, 1)
    const totalCount = first.totalCount

    if (totalCount === 0) {
      console.log(`  → 데이터 없음\n`)
      summary.push({ name: cl.name, count: 0 })
      continue
    }

    const totalPages = Math.ceil(totalCount / NUM_OF_ROWS)
    console.log(`  총 ${totalCount}건 / ${totalPages}페이지`)

    let clTotal = 0

    // 1페이지 upsert
    clTotal += await upsertHospitals(first.items)
    console.log(`  페이지 1/${totalPages} 완료 (${first.items.length}건)`)

    // 2페이지 이후
    for (let page = 2; page <= totalPages; page++) {
      await delay(100)
      const { items } = await fetchPage(cl.code, page)
      clTotal += await upsertHospitals(items)
      console.log(`  페이지 ${page}/${totalPages} 완료 (${items.length}건)`)
    }

    console.log(`  ✓ ${cl.name} 완료: ${clTotal}건\n`)
    summary.push({ name: cl.name, count: clTotal })
    grandTotal += clTotal

    await delay(100)
  }

  console.log('=== 처리 결과 요약 ===')
  for (const s of summary) {
    console.log(`  ${s.name.padEnd(10)}: ${s.count.toLocaleString()}건`)
  }
  console.log(`  ${'합계'.padEnd(10)}: ${grandTotal.toLocaleString()}건`)
  console.log('\n=== 완료 ===')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
