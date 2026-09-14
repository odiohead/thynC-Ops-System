/**
 * 심평원 병원상세정보연동 v2 — 실행기 (projects/hira_detail_sync_v2_design.md §4)
 *
 * 의료기관별상세정보서비스(MadmDtlInfoService2.8)는 기관코드(ykiho) 단위 1콜이라 병원 수 × 항목 수만큼 호출된다.
 * 일일 한도(10,000콜) 안에서 수일에 걸쳐 자동 분할 실행하며, 진행 상태는 전부 DB(hira_sync_jobs·hira_sync_job_targets)에
 * 있어 프로세스 재시작에 안전하다.
 *
 *  - 항목: bed(허가병상수 getEqpInfo) · dept(진료과목 getDgsbjtInfo) · sdr(전문과목별 전문의수 getSpcSbjtSdrInfo)
 *  - 일일 병원 처리량 = floor(DAILY_CALL_BUDGET / 항목수)
 *  - 하루 처리 후 남으면 status=waiting + nextRunAt(익일 00:10 KST) → 스케줄러(5분 tick)가 재개
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

const API_BASE = 'https://apis.data.go.kr/B551182/MadmDtlInfoService2.8'
const CALL_DELAY_MS = 100
const PROGRESS_EVERY = 100
const CANCEL_CHECK_EVERY = 20
const TARGET_BATCH = 200
export const DAILY_CALL_BUDGET = 9000
const RESUME_HOUR_KST = 0
const RESUME_MINUTE_KST = 10
const SCHEDULER_TICK_MS = 5 * 60 * 1000

export type DetailItem = 'bed' | 'dept' | 'sdr'
export const DETAIL_ITEMS: { key: DetailItem; name: string; op: string }[] = [
  { key: 'bed', name: '허가병상수', op: 'getEqpInfo2.8' },
  { key: 'dept', name: '진료과목', op: 'getDgsbjtInfo2.8' },
  { key: 'sdr', name: '전문의수', op: 'getSpcSbjtSdrInfo2.8' },
]

// 대상 종별 — route/page 양쪽이 이 목록을 사용
export const DETAIL_CL_CODES: { code: string; name: string }[] = [
  { code: '01', name: '상급종합병원' },
  { code: '11', name: '종합병원' },
  { code: '21', name: '병원' },
  { code: '28', name: '요양병원' },
  { code: '29', name: '정신병원' },
  { code: '31', name: '의원' },
  { code: '41', name: '치과병원' },
  { code: '92', name: '한방병원' },
]

export type DetailJobParams = { typeCodes: string[]; items: DetailItem[] }

export function dailyQuotaFor(itemCount: number) {
  return Math.max(1, Math.floor(DAILY_CALL_BUDGET / Math.max(1, itemCount)))
}

// ---------- KST 날짜 유틸 ----------
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function kstDateString(d = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 익일 00:10 KST */
export function nextResumeAt(from = new Date()): Date {
  const kst = new Date(from.getTime() + KST_OFFSET_MS)
  const next = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1, RESUME_HOUR_KST, RESUME_MINUTE_KST, 0)
  return new Date(next - KST_OFFSET_MS)
}

// ---------- API ----------
function toInt(val: unknown): number | null {
  if (val === undefined || val === null || String(val).trim() === '') return null
  const n = parseInt(String(val).trim(), 10)
  return isNaN(n) ? null : n
}

function toCode(val: unknown): string | null {
  if (val === undefined || val === null) return null
  const s = String(val).trim()
  if (!s) return null
  // 응답이 숫자형(11)으로 오는 경우가 있어 2자리로 정규화
  return /^\d$/.test(s) ? s.padStart(2, '0') : s
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class HiraApiError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
  // 일일 트래픽 한도 초과 등 — 계속 호출해도 소용없는 오류 (오늘은 중단, 익일 재개)
  get isFatal() {
    return ['22', '30', '31', '20'].includes(this.code)
  }
}

type RawItem = Record<string, unknown>

async function callOp(op: string, ykiho: string, apiKey: string): Promise<RawItem[]> {
  const url = `${API_BASE}/${op}?ykiho=${encodeURIComponent(ykiho)}&_type=json&numOfRows=100&serviceKey=${encodeURIComponent(apiKey)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  type HiraResponse = {
    response?: {
      header?: { resultCode?: string; resultMsg?: string }
      body?: { items?: { item?: RawItem | RawItem[] } | '' }
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
  if (!rawItems) return []
  return Array.isArray(rawItems) ? rawItems : [rawItems]
}

type DeptRow = { cd: string; nm: string; prSdrCnt: number | null; cdiagDrCnt: number | null }
type SdrRow = { cd: string; nm: string; dtlSdrCnt: number | null }

/** 병원 1곳의 선택 항목을 순서대로 호출해 DB 반영. 반환: 사용한 호출 수 */
async function syncOneHospital(
  hospital: { id: number; hiraId: string },
  items: DetailItem[],
  apiKey: string,
): Promise<number> {
  let calls = 0
  const now = new Date()
  const hospitalData: Prisma.HiraHospitalUpdateInput = {}
  let deptRows: DeptRow[] | null = null
  let sdrRows: SdrRow[] | null = null

  for (const item of items) {
    const def = DETAIL_ITEMS.find((d) => d.key === item)!
    calls++
    const raw = await callOp(def.op, hospital.hiraId, apiKey)
    if (item === 'bed') {
      hospitalData.permSbdCnt = toInt(raw[0]?.permSbdCnt)
      hospitalData.detailSyncedAt = now
    } else if (item === 'dept') {
      deptRows = raw
        .map((r) => ({ cd: toCode(r.dgsbjtCd), nm: String(r.dgsbjtCdNm ?? '').trim(), prSdrCnt: toInt(r.dgsbjtPrSdrCnt), cdiagDrCnt: toInt(r.cdiagDrCnt) }))
        .filter((r): r is DeptRow => !!r.cd)
      hospitalData.deptSyncedAt = now
    } else if (item === 'sdr') {
      sdrRows = raw
        .map((r) => ({ cd: toCode(r.dgsbjtCd), nm: String(r.dgsbjtCdNm ?? '').trim(), dtlSdrCnt: toInt(r.dtlSdrCnt) }))
        .filter((r): r is SdrRow => !!r.cd)
      hospitalData.sdrSyncedAt = now
    }
    if (items.indexOf(item) < items.length - 1) await delay(CALL_DELAY_MS)
  }

  await prisma.$transaction(async (tx) => {
    await tx.hiraHospital.update({ where: { id: hospital.id }, data: hospitalData })

    if (deptRows) {
      const codes = deptRows.map((r) => r.cd)
      for (const r of deptRows) {
        await tx.hiraHospitalDept.upsert({
          where: { hiraHospitalId_dgsbjtCd: { hiraHospitalId: hospital.id, dgsbjtCd: r.cd } },
          create: { hiraHospitalId: hospital.id, dgsbjtCd: r.cd, dgsbjtNm: r.nm || r.cd, prSdrCnt: r.prSdrCnt, cdiagDrCnt: r.cdiagDrCnt },
          update: { dgsbjtNm: r.nm || undefined, prSdrCnt: r.prSdrCnt, cdiagDrCnt: r.cdiagDrCnt },
        })
      }
      // 응답에 없는 과목: 진료과목 컬럼만 비우고, 전문의 정보도 없으면 행 삭제
      await tx.hiraHospitalDept.updateMany({
        where: { hiraHospitalId: hospital.id, dgsbjtCd: { notIn: codes } },
        data: { prSdrCnt: null, cdiagDrCnt: null },
      })
      await tx.hiraHospitalDept.deleteMany({
        where: { hiraHospitalId: hospital.id, dgsbjtCd: { notIn: codes }, dtlSdrCnt: null },
      })
    }

    if (sdrRows) {
      const codes = sdrRows.map((r) => r.cd)
      for (const r of sdrRows) {
        await tx.hiraHospitalDept.upsert({
          where: { hiraHospitalId_dgsbjtCd: { hiraHospitalId: hospital.id, dgsbjtCd: r.cd } },
          create: { hiraHospitalId: hospital.id, dgsbjtCd: r.cd, dgsbjtNm: r.nm || r.cd, dtlSdrCnt: r.dtlSdrCnt },
          update: { dgsbjtNm: r.nm || undefined, dtlSdrCnt: r.dtlSdrCnt },
        })
      }
      await tx.hiraHospitalDept.updateMany({
        where: { hiraHospitalId: hospital.id, dgsbjtCd: { notIn: codes } },
        data: { dtlSdrCnt: null },
      })
      await tx.hiraHospitalDept.deleteMany({
        where: { hiraHospitalId: hospital.id, dgsbjtCd: { notIn: codes }, prSdrCnt: null, cdiagDrCnt: null },
      })
    }
  })

  return calls
}

// ---------- 잡 ----------
async function addLog(jobId: number, type: string, message: string, stats?: object) {
  await prisma.hiraSyncLog.create({ data: { jobId, type, message, stats: stats ? (stats as object) : undefined } })
}

export function parseParams(params: unknown): DetailJobParams | null {
  if (!params || typeof params !== 'object') return null
  const p = params as Record<string, unknown>
  const typeCodes = Array.isArray(p.typeCodes) ? p.typeCodes.map(String) : []
  const validItems = new Set(DETAIL_ITEMS.map((d) => d.key))
  const items = (Array.isArray(p.items) ? p.items.map(String) : []).filter((i): i is DetailItem => validItems.has(i as DetailItem))
  if (typeCodes.length === 0 || items.length === 0) return null
  return { typeCodes, items }
}

export function itemNames(items: DetailItem[]) {
  return items.map((i) => DETAIL_ITEMS.find((d) => d.key === i)?.name ?? i).join('·')
}

/** 잡 생성 + 대상 적재 + 첫날 실행 시작. 배타 검사는 호출부(route) 책임 */
export async function startDetailSyncJob(params: DetailJobParams, apiKey: string): Promise<number> {
  const hospitals = await prisma.hiraHospital.findMany({
    where: { typeCode: { in: params.typeCodes } },
    select: { id: true },
    orderBy: [{ typeCode: 'asc' }, { id: 'asc' }],
  })
  const dailyQuota = dailyQuotaFor(params.items.length)

  const job = await prisma.hiraSyncJob.create({
    data: {
      status: 'running',
      jobType: 'detail',
      params: params as unknown as Prisma.InputJsonValue,
      totalTargets: hospitals.length,
      dailyQuota,
    },
  })
  for (let i = 0; i < hospitals.length; i += 2000) {
    await prisma.hiraSyncJobTarget.createMany({
      data: hospitals.slice(i, i + 2000).map((h) => ({ jobId: job.id, hiraHospitalId: h.id })),
    })
  }

  const typeNames = params.typeCodes.map((c) => DETAIL_CL_CODES.find((d) => d.code === c)?.name ?? c).join('·')
  const totalCalls = hospitals.length * params.items.length
  const days = Math.max(1, Math.ceil(hospitals.length / dailyQuota))
  await addLog(job.id, 'init',
    `병원상세정보연동을 시작합니다. 종별 ${typeNames}, 항목 ${itemNames(params.items)}, 대상 ${hospitals.length.toLocaleString()}개 병원 (총 ${totalCalls.toLocaleString()}회 호출, 하루 ${dailyQuota.toLocaleString()}개 병원 × 약 ${days}일).`,
    { totalTargets: hospitals.length, totalCalls, dailyQuota, estimatedDays: days, ...params },
  )

  void runDay(job.id, apiKey)
  return job.id
}

const inProgress = new Set<number>() // 같은 프로세스 내 중복 실행 방지

/** 하루치 실행 — 오늘 처리량·API 한도 안에서 pending 대상을 처리하고, 남으면 waiting 전환 */
export async function runDay(jobId: number, apiKey: string): Promise<void> {
  if (inProgress.has(jobId)) return
  inProgress.add(jobId)
  try {
    const job = await prisma.hiraSyncJob.findUnique({ where: { id: jobId } })
    if (!job) return
    const params = parseParams(job.params)
    if (!params) {
      await prisma.hiraSyncJob.update({ where: { id: jobId }, data: { status: 'error', endedAt: new Date() } })
      await addLog(jobId, 'error', '잡 파라미터가 없어 실행할 수 없습니다.', { fatal: true })
      return
    }

    const today = kstDateString()
    let callsToday = job.quotaDate === today ? job.callsToday : 0
    const dayCount = job.quotaDate === today ? job.dayCount : job.dayCount + 1
    let doneCount = job.doneCount
    let failedCount = job.failedCount

    await prisma.hiraSyncJob.update({
      where: { id: jobId },
      data: { status: 'running', nextRunAt: null, quotaDate: today, callsToday, dayCount },
    })
    const remainingBefore = await prisma.hiraSyncJobTarget.count({ where: { jobId, status: 'pending' } })
    await addLog(jobId, 'day_start', `${dayCount}일차 (${today}) 실행 시작 — 남은 대상 ${remainingBefore.toLocaleString()}개, 오늘 호출 사용 ${callsToday.toLocaleString()}/${DAILY_CALL_BUDGET.toLocaleString()}`, {
      day: dayCount, date: today, remaining: remainingBefore, callsToday,
    })

    const perHospital = params.items.length
    let processedToday = 0
    let cancelled = false
    let quotaHit = false
    let fatal: HiraApiError | null = null

    outer: while (true) {
      const targets = await prisma.hiraSyncJobTarget.findMany({
        where: { jobId, status: 'pending' },
        select: { id: true, hiraHospital: { select: { id: true, hiraId: true } } },
        orderBy: { id: 'asc' },
        take: TARGET_BATCH,
      })
      if (targets.length === 0) break

      for (let t = 0; t < targets.length; t++) {
        if (callsToday + perHospital > DAILY_CALL_BUDGET) { quotaHit = true; break outer }

        if (processedToday % CANCEL_CHECK_EVERY === 0) {
          const fresh = await prisma.hiraSyncJob.findUnique({ where: { id: jobId }, select: { status: true } })
          if (fresh?.status === 'cancelled') { cancelled = true; break outer }
        }

        const target = targets[t]
        try {
          const calls = await syncOneHospital(target.hiraHospital, params.items, apiKey)
          callsToday += calls
          doneCount++
          await prisma.$transaction([
            prisma.hiraSyncJobTarget.update({ where: { id: target.id }, data: { status: 'done', processedAt: new Date(), error: null } }),
            prisma.hiraSyncJob.update({ where: { id: jobId }, data: { doneCount, callsToday } }),
          ])
        } catch (e) {
          if (e instanceof HiraApiError && e.isFatal) { fatal = e; break outer }
          // 항목 일부 호출은 이미 소진됐을 수 있음 — 보수적으로 병원당 호출 수만큼 차감
          callsToday += perHospital
          failedCount++
          const errMsg = e instanceof Error ? e.message : String(e)
          await prisma.$transaction([
            prisma.hiraSyncJobTarget.update({ where: { id: target.id }, data: { status: 'failed', processedAt: new Date(), error: errMsg.slice(0, 500) } }),
            prisma.hiraSyncJob.update({ where: { id: jobId }, data: { failedCount, callsToday } }),
          ])
          if (failedCount <= 5 || failedCount % 100 === 0) {
            await addLog(jobId, 'error', `병원 조회 실패 (${errMsg}) — 스킵 (누적 실패 ${failedCount}건)`, { failedCount })
          }
        }
        processedToday++

        if (processedToday % PROGRESS_EVERY === 0) {
          await addLog(jobId, 'group_progress', `${dayCount}일차 진행 ${processedToday.toLocaleString()}개 — 누적 완료 ${doneCount.toLocaleString()}/${job.totalTargets.toLocaleString()}${failedCount ? `, 실패 ${failedCount}건` : ''} (오늘 호출 ${callsToday.toLocaleString()})`, {
            day: dayCount, processedToday, doneCount, failedCount, callsToday,
          })
        }
        await delay(CALL_DELAY_MS)
      }
    }

    const remaining = await prisma.hiraSyncJobTarget.count({ where: { jobId, status: 'pending' } })

    if (cancelled) {
      await prisma.hiraSyncJob.update({ where: { id: jobId }, data: { status: 'cancelled', endedAt: new Date(), totalCount: doneCount } })
      await addLog(jobId, 'error', `사용자 취소로 중단되었습니다. 완료 ${doneCount.toLocaleString()}개, 미처리 ${remaining.toLocaleString()}개.`, { fatal: true, cancelled: true })
      return
    }

    if (fatal) {
      const nextRunAt = nextResumeAt()
      await prisma.hiraSyncJob.update({ where: { id: jobId }, data: { status: 'waiting', nextRunAt, totalCount: doneCount } })
      await addLog(jobId, 'day_done', `API 한도/중단 오류 [${fatal.code}]: ${fatal.message} — 오늘 실행을 멈추고 ${fmtKst(nextRunAt)}에 이어서 진행합니다. (${dayCount}일차 처리 ${processedToday.toLocaleString()}개, 남은 대상 ${remaining.toLocaleString()}개)`, {
        day: dayCount, processedToday, remaining, apiCode: fatal.code, nextRunAt: nextRunAt.toISOString(),
      })
      return
    }

    if (remaining > 0) {
      const nextRunAt = nextResumeAt()
      await prisma.hiraSyncJob.update({ where: { id: jobId }, data: { status: 'waiting', nextRunAt, totalCount: doneCount } })
      await addLog(jobId, 'day_done', `${dayCount}일차 완료 — 오늘 ${processedToday.toLocaleString()}개 처리 (호출 ${callsToday.toLocaleString()}/${DAILY_CALL_BUDGET.toLocaleString()}). 남은 대상 ${remaining.toLocaleString()}개는 ${fmtKst(nextRunAt)}에 자동으로 이어서 진행합니다.`, {
        day: dayCount, processedToday, remaining, quotaHit, nextRunAt: nextRunAt.toISOString(),
      })
      return
    }

    await prisma.hiraSyncJob.update({ where: { id: jobId }, data: { status: 'done', endedAt: new Date(), nextRunAt: null, totalCount: doneCount } })
    await addLog(jobId, 'done', `병원상세정보연동이 완료되었습니다. ${dayCount}일에 걸쳐 ${doneCount.toLocaleString()}개 병원 갱신${failedCount ? `, ${failedCount.toLocaleString()}개 실패` : ''}.`, {
      totalProcessed: doneCount, failedCount, days: dayCount,
    })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    await prisma.hiraSyncJob.update({ where: { id: jobId }, data: { status: 'error', endedAt: new Date() } }).catch(() => {})
    await addLog(jobId, 'error', `치명적 오류: ${errMsg}`, { fatal: true }).catch(() => {})
  } finally {
    inProgress.delete(jobId)
  }
}

function fmtKst(d: Date) {
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export async function cancelDetailSyncJob(jobId: number): Promise<'ok' | 'not_found' | 'not_active'> {
  const job = await prisma.hiraSyncJob.findUnique({ where: { id: jobId } })
  if (!job) return 'not_found'
  if (job.status === 'waiting') {
    // 대기 중이면 실행 루프가 없으므로 여기서 바로 종결
    await prisma.hiraSyncJob.update({ where: { id: jobId }, data: { status: 'cancelled', endedAt: new Date(), nextRunAt: null } })
    const remaining = await prisma.hiraSyncJobTarget.count({ where: { jobId, status: 'pending' } })
    await addLog(jobId, 'error', `사용자 취소로 중단되었습니다. 완료 ${job.doneCount.toLocaleString()}개, 미처리 ${remaining.toLocaleString()}개.`, { fatal: true, cancelled: true })
    return 'ok'
  }
  if (job.status === 'running') {
    // 실행 루프가 다음 확인 시점에 감지해 종결 로그를 남긴다
    await prisma.hiraSyncJob.update({ where: { id: jobId }, data: { status: 'cancelled' } })
    return 'ok'
  }
  return 'not_active'
}

// ---------- 스케줄러 ----------
let timer: ReturnType<typeof setInterval> | null = null

async function schedulerTick() {
  const apiKey = process.env.HIRA_API_KEY
  if (!apiKey) return
  try {
    const running = await prisma.hiraSyncJob.findFirst({ where: { status: 'running' }, select: { id: true } })
    if (running) return // 목록 연동 등 다른 잡 실행 중 — 다음 tick에 재시도
    const due = await prisma.hiraSyncJob.findFirst({
      where: { status: 'waiting', nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: 'asc' },
      select: { id: true },
    })
    if (!due) return
    console.log(`[hira-detail] 대기 잡 #${due.id} 재개`)
    void runDay(due.id, apiKey)
  } catch (err) {
    console.error('[hira-detail] 스케줄러 tick 실패:', err)
  }
}

/** instrumentation에서 기동. 재시작 고아 정리 후 호출할 것 */
export function startHiraDetailScheduler() {
  if (timer) return
  timer = setInterval(schedulerTick, SCHEDULER_TICK_MS)
  void schedulerTick()
  console.log('[hira-detail] 분할 실행 스케줄러 시작 (5분 tick)')
}
