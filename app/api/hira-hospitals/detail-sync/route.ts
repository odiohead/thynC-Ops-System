import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// 심평원 의료기관별상세정보서비스 — 시설정보(허가병상수)
// 목록 조회 미지원(ykiho 필수)이라 병원당 1콜. 일일 트래픽 한도 10,000건
const API_BASE = 'https://apis.data.go.kr/B551182/MadmDtlInfoService2.8/getEqpInfo2.8'
const CALL_DELAY_MS = 100
const PROGRESS_EVERY = 100

// 병원급 7종만 대상 (의원급은 건수가 일일 한도를 초과해 범위 제외 — 2026-08-10 확정)
// route 파일은 핸들러 외 export 금지 — 목록 변경 시 페이지(page.tsx)의 DETAIL_CL_CODES도 동기화
const DETAIL_CL_CODES: { code: string; name: string }[] = [
  { code: '01', name: '상급종합병원' },
  { code: '11', name: '종합병원' },
  { code: '21', name: '병원' },
  { code: '28', name: '요양병원' },
  { code: '29', name: '정신병원' },
  { code: '41', name: '치과병원' },
  { code: '92', name: '한방병원' },
]

function toInt(val: unknown): number | null {
  if (val === undefined || val === null || String(val).trim() === '') return null
  const n = parseInt(String(val).trim(), 10)
  return isNaN(n) ? null : n
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class HiraApiError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
  // 일일 트래픽 한도 초과 등 — 계속 호출해도 소용없는 오류
  get isFatal() {
    return ['22', '30', '31', '20'].includes(this.code)
  }
}

// 병원 1건의 허가병상수 조회 — 시설정보 없으면 null
async function fetchPermSbdCnt(ykiho: string, apiKey: string): Promise<number | null> {
  const url = `${API_BASE}?ykiho=${encodeURIComponent(ykiho)}&_type=json&serviceKey=${encodeURIComponent(apiKey)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  type HiraResponse = {
    response?: {
      header?: { resultCode?: string; resultMsg?: string }
      body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] } | '' }
    }
  }

  const text = await res.text()
  let json: HiraResponse
  try {
    json = JSON.parse(text) as HiraResponse
  } catch {
    // 게이트웨이 오류(한도 초과 등)는 XML로 응답됨
    const codeMatch = text.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/)
    const msgMatch = text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/)
    throw new HiraApiError(codeMatch?.[1] ?? '?', msgMatch?.[1] ?? text.slice(0, 200))
  }

  const header = json?.response?.header
  if (header?.resultCode !== '00') {
    throw new HiraApiError(String(header?.resultCode ?? '?'), String(header?.resultMsg ?? '알 수 없는 오류'))
  }

  const body = json?.response?.body
  const rawItems = body && typeof body.items === 'object' ? body.items?.item : null
  if (!rawItems) return null
  const item = Array.isArray(rawItems) ? rawItems[0] : rawItems
  return toInt(item?.permSbdCnt)
}

async function runDetailSync(jobId: number, apiKey: string, typeCodes: string[]) {
  const groups = DETAIL_CL_CODES.filter((c) => typeCodes.includes(c.code))
  const totalGroups = groups.length

  async function addLog(type: string, message: string, stats?: object) {
    await prisma.hiraSyncLog.create({
      data: { jobId, type, message, stats: stats ? (stats as object) : undefined },
    })
  }

  try {
    const totalTargets = await prisma.hiraHospital.count({ where: { typeCode: { in: typeCodes } } })
    await addLog('init', `병원상세정보연동을 시작합니다. 종별 ${totalGroups}개, 대상 ${totalTargets.toLocaleString()}개 병원 (허가병상수).`, {
      totalGroups, totalTargets, typeCodes,
    })

    let cumulativeCount = 0
    let fatalStop = false

    for (let i = 0; i < groups.length && !fatalStop; i++) {
      const { code: clCd, name: clCdName } = groups[i]
      const idxStr = `[${String(i + 1).padStart(2, '0')}/${totalGroups}]`

      // 미연동(NULL) 우선 → 오래된 순: 중단된 잡을 재실행하면 남은 병원부터 이어서 진행
      const targets = await prisma.hiraHospital.findMany({
        where: { typeCode: clCd },
        select: { id: true, hiraId: true },
        orderBy: [{ detailSyncedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      })

      await addLog('group_start', `${idxStr} 종별코드 ${clCd} (${clCdName}) — ${targets.length.toLocaleString()}개 병원 조회 시작`, {
        groupIndex: i + 1, clCd, clCdName, targetCount: targets.length,
      })

      let updated = 0
      let failed = 0

      for (let t = 0; t < targets.length; t++) {
        try {
          const permSbdCnt = await fetchPermSbdCnt(targets[t].hiraId, apiKey)
          await prisma.hiraHospital.update({
            where: { id: targets[t].id },
            data: { permSbdCnt, detailSyncedAt: new Date() },
          })
          updated++
        } catch (e) {
          if (e instanceof HiraApiError && e.isFatal) {
            await addLog('error', `${idxStr} API 중단 오류 [${e.code}]: ${e.message} — 연동을 중단합니다. 재실행하면 미연동 병원부터 이어서 진행됩니다.`, {
              groupIndex: i + 1, fatal: true, apiCode: e.code,
            })
            fatalStop = true
            break
          }
          failed++
          if (failed <= 5) {
            const errMsg = e instanceof Error ? e.message : String(e)
            await addLog('error', `${idxStr} 병원 조회 실패 (${errMsg}) — 스킵`, { groupIndex: i + 1 })
          }
        }

        if ((t + 1) % PROGRESS_EVERY === 0) {
          await addLog('group_progress', `${idxStr} 진행 ${t + 1}/${targets.length} — 갱신 ${updated}건${failed ? `, 실패 ${failed}건` : ''}`, {
            groupIndex: i + 1, processed: t + 1, updated, failed,
          })
        }

        await delay(CALL_DELAY_MS)
      }

      cumulativeCount += updated
      await addLog('group_db_done', `${idxStr} ${clCdName} 완료 — ${updated.toLocaleString()}건 갱신${failed ? `, ${failed}건 실패` : ''}`, {
        groupIndex: i + 1, upsertedCount: updated, failedCount: failed, cumulativeCount,
      })
    }

    await prisma.hiraSyncJob.update({
      where: { id: jobId },
      data: { status: fatalStop ? 'error' : 'done', endedAt: new Date(), totalCount: cumulativeCount },
    })
    if (!fatalStop) {
      await addLog('done', '병원상세정보연동이 완료되었습니다.', { totalProcessed: cumulativeCount })
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    await prisma.hiraSyncJob.update({
      where: { id: jobId },
      data: { status: 'error', endedAt: new Date() },
    }).catch(() => {})
    await addLog('error', `치명적 오류: ${errMsg}`, { fatal: true }).catch(() => {})
  }
}

// POST — 백그라운드 상세정보 연동 시작 (body: { typeCodes: string[] })
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const apiKey = process.env.HIRA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'HIRA_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 })
  }

  let typeCodes: string[] = []
  try {
    const body = await request.json()
    if (Array.isArray(body?.typeCodes)) typeCodes = body.typeCodes.map(String)
  } catch {
    // body 없음 — 아래 검증에서 400
  }

  const validCodes = new Set(DETAIL_CL_CODES.map((c) => c.code))
  typeCodes = typeCodes.filter((c) => validCodes.has(c))
  if (typeCodes.length === 0) {
    return NextResponse.json({ error: '연동할 종별을 1개 이상 선택하세요.' }, { status: 400 })
  }

  // 목록/상세 연동 공통 배타 — 동시에 하나의 잡만 실행
  const running = await prisma.hiraSyncJob.findFirst({ where: { status: 'running' } })
  if (running) {
    return NextResponse.json({ error: '이미 연동이 진행 중입니다.' }, { status: 409 })
  }

  const job = await prisma.hiraSyncJob.create({ data: { status: 'running', jobType: 'detail' } })

  // 백그라운드 실행 — await 하지 않음
  runDetailSync(job.id, apiKey, typeCodes).catch(async () => {
    await prisma.hiraSyncJob.update({
      where: { id: job.id },
      data: { status: 'error', endedAt: new Date() },
    }).catch(() => {})
  })

  return NextResponse.json({ jobId: job.id })
}
