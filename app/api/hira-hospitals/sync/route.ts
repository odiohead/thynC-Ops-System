import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import * as xml2js from 'xml2js'

export const dynamic = 'force-dynamic'

const API_BASE = 'http://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList'
const NUM_OF_ROWS = 100
const UPSERT_BATCH = 100

const CL_CODES: { code: string; name: string }[] = [
  { code: '01', name: '상급종합병원' },
  { code: '11', name: '종합병원' },
  { code: '21', name: '병원' },
  { code: '28', name: '요양병원' },
  { code: '29', name: '정신병원' },
  { code: '31', name: '의원' },
  { code: '41', name: '치과병원' },
  { code: '42', name: '치과의원' },
  { code: '43', name: '한방병원' },
  { code: '51', name: '한의원' },
  { code: '61', name: '조산원' },
  { code: '62', name: '보건기관' },
  { code: '71', name: '사회복지시설' },
  { code: '72', name: '기타' },
  { code: '92', name: '약국' },
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

async function fetchPage(
  clCd: string,
  pageNo: number,
  apiKey: string,
): Promise<{ totalCount: number; items: Record<string, unknown>[] }> {
  const fullUrl = `${API_BASE}?pageNo=${pageNo}&numOfRows=${NUM_OF_ROWS}&clCd=${clCd}&ServiceKey=${encodeURIComponent(apiKey)}`

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

async function upsertBatch(items: Record<string, unknown>[]): Promise<number> {
  let count = 0
  for (let offset = 0; offset < items.length; offset += UPSERT_BATCH) {
    const batch = items.slice(offset, offset + UPSERT_BATCH)
    for (const item of batch) {
      const hiraId = toStr(item['ykiho'])
      if (!hiraId) continue

      const data = {
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
      }

      await prisma.hiraHospital.upsert({
        where: { hiraId },
        create: { hiraId, ...data },
        update: data,
      })
      count++
    }
  }
  return count
}

// 백그라운드 동기화 — HTTP 응답과 무관하게 실행
async function runSync(jobId: number, apiKey: string) {
  const totalGroups = CL_CODES.length

  async function addLog(type: string, message: string, stats?: object) {
    await prisma.hiraSyncLog.create({
      data: { jobId, type, message, stats: stats ? (stats as object) : undefined },
    })
  }

  try {
    await addLog('init', `연동을 시작합니다. 총 ${totalGroups}개 종별코드를 처리합니다.`, { totalGroups })

    let cumulativeCount = 0

    for (let i = 0; i < CL_CODES.length; i++) {
      const { code: clCd, name: clCdName } = CL_CODES[i]
      const groupIndex = i + 1
      const idxStr = `[${String(groupIndex).padStart(2, '0')}/${totalGroups}]`

      await addLog('group_start', `${idxStr} 종별코드 ${clCd} (${clCdName}) — API 호출 중...`, { groupIndex, clCd, clCdName })

      try {
        const first = await fetchPage(clCd, 1, apiKey)
        const totalCount = first.totalCount

        if (totalCount === 0) {
          await addLog('group_api_done', `${idxStr} API 수신 완료 — 전체 0페이지, 0건`, { groupIndex, totalPages: 0, fetchedCount: 0 })
          await addLog('group_db_done', `${idxStr} DB 저장 완료 — 0건 upsert`, { groupIndex, upsertedCount: 0, cumulativeCount })
          continue
        }

        const totalPages = Math.ceil(totalCount / NUM_OF_ROWS)
        const allItems: Record<string, unknown>[] = [...first.items]

        for (let page = 2; page <= totalPages; page++) {
          await delay(100)
          const { items } = await fetchPage(clCd, page, apiKey)
          allItems.push(...items)
        }

        await addLog('group_api_done', `${idxStr} API 수신 완료 — 전체 ${totalPages}페이지, ${allItems.length}건`, {
          groupIndex, totalPages, fetchedCount: allItems.length,
        })

        const upsertedCount = await upsertBatch(allItems)
        cumulativeCount += upsertedCount

        await addLog('group_db_done', `${idxStr} DB 저장 완료 — ${upsertedCount}건 upsert`, {
          groupIndex, upsertedCount, cumulativeCount,
        })
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        await addLog('error', `${idxStr} 종별코드 ${clCd} 오류: ${errMsg} — 해당 코드 스킵`, { groupIndex })
      }

      await delay(100)
    }

    await prisma.hiraSyncJob.update({
      where: { id: jobId },
      data: { status: 'done', endedAt: new Date(), totalCount: cumulativeCount },
    })
    await addLog('done', '연동이 완료되었습니다.', { totalProcessed: cumulativeCount })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    await prisma.hiraSyncJob.update({
      where: { id: jobId },
      data: { status: 'error', endedAt: new Date() },
    }).catch(() => {})
    await addLog('error', `치명적 오류: ${errMsg}`, { fatal: true }).catch(() => {})
  }
}

// GET — 연동 히스토리 목록
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const jobs = await prisma.hiraSyncJob.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({ jobs })
}

// POST — 백그라운드 연동 시작
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const apiKey = process.env.HIRA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'HIRA_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 })
  }

  // 이미 실행 중인 잡이 있으면 거부
  const running = await prisma.hiraSyncJob.findFirst({ where: { status: 'running' } })
  if (running) {
    return NextResponse.json({ error: '이미 연동이 진행 중입니다.' }, { status: 409 })
  }

  const job = await prisma.hiraSyncJob.create({ data: { status: 'running' } })

  // 백그라운드 실행 — await 하지 않음
  runSync(job.id, apiKey).catch(async () => {
    await prisma.hiraSyncJob.update({
      where: { id: job.id },
      data: { status: 'error', endedAt: new Date() },
    }).catch(() => {})
  })

  return NextResponse.json({ jobId: job.id })
}
