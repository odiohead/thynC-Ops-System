// pweb.kr 주차 웹할인 서버 클라이언트 (server-only)
// ─ 메인 서비스와 무관한 별도 유틸. 4개 계정(901~904)의 자격증명을 env로 보관하고,
//   서버가 액션마다 대신 로그인 → 검색 → 할인권 조회 → 등록을 수행한다(stateless).
// ─ 사이트 로그인 흐름: GET /login(세션 쿠키) → POST /login(userId, userPwd=sha256(pw)) → 302 /discount/registration
import { createHash } from 'crypto'

const BASE = (process.env.PARKING_BASE_URL || 'https://a18759.pweb.kr').replace(/\/$/, '')
const LOT_AREA = process.env.PARKING_LOT_AREA || '18759'

export interface ParkingAccount {
  label: string
  userId: string
  pw: string
  paid?: boolean // 유료 주차권 구매 계정만 true (유료권 노출·등록 허용)
}

/** env PARKING_ACCOUNTS(JSON 배열) 파싱. [{label,userId,pw}] */
export function getParkingAccounts(): ParkingAccount[] {
  const raw = process.env.PARKING_ACCOUNTS
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function findAccount(userId: string): ParkingAccount | undefined {
  return getParkingAccounts().find((a) => a.userId === userId)
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

// 외부(pweb.kr) 응답은 타입이 없어 unknown으로 받고 안전 접근자로 좁힌다.
function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
function str(v: unknown): string {
  return v == null ? '' : String(v)
}
function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** "14:13"(HH:MM) 또는 "N일 N시간 N분" → 분. 파싱 실패 시 null */
function parseDurationMin(s: string): number | null {
  const t = (s || '').trim()
  if (/^\d{1,4}:\d{2}$/.test(t)) {
    const [h, m] = t.split(':')
    return Number(h) * 60 + Number(m)
  }
  let min = 0
  let matched = false
  const day = t.match(/(\d+)\s*일/)
  if (day) {
    min += Number(day[1]) * 1440
    matched = true
  }
  const hr = t.match(/(\d+)\s*시간/)
  if (hr) {
    min += Number(hr[1]) * 60
    matched = true
  }
  const mi = t.match(/(\d+)\s*분/)
  if (mi) {
    min += Number(mi[1])
    matched = true
  }
  return matched ? min : null
}

/** dtInDate "YYYYMMDDHHMMSS"(KST 벽시계) 기준 현재까지 경과 분. 폴백용. */
function elapsedMinFromEntry(dtInDate: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec((dtInDate || '').trim())
  if (!m) return null
  const [, Y, Mo, D, H, Mi, S] = m
  const entryUtcMs = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S) - 9 * 3600 * 1000 // KST→UTC
  return Math.max(0, Math.floor((Date.now() - entryUtcMs) / 60000))
}

// ── 쿠키 잼(JSESSIONID 등) ──────────────────────────────────────────────
type Jar = Map<string, string>

function cookieHeader(jar: Jar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function updateJar(jar: Jar, res: Response) {
  // undici: getSetCookie() 로 다건 획득, 없으면 단건 헤더
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] }
  const list = anyHeaders.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : [])
  for (const line of list) {
    const first = line.split(';')[0]
    const eq = first.indexOf('=')
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim())
  }
}

const AJAX_HEADERS: Record<string, string> = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  ajax: 'true',
  amano_http_ajax: 'true',
  'X-Requested-With': 'XMLHttpRequest',
}

async function req(
  jar: Jar,
  path: string,
  opts: { method: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } = { method: 'GET' }
): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers || {}) }
  const cookie = cookieHeader(jar)
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method,
    headers,
    body: opts.body,
    redirect: 'manual',
    cache: 'no-store',
  })
  updateJar(jar, res)
  return res
}

/** 관대한 파서 — listForDiscount 응답이 JSON 배열 텍스트로 옴 */
function parseLoose(text: string): unknown {
  const t = text.trim()
  if (!t) return []
  try {
    return JSON.parse(t)
  } catch {
    // JS 배열 리터럴 형태 폴백 (서버 신뢰 응답)
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${t});`)()
  }
}

// ── 로그인 ──────────────────────────────────────────────────────────────
async function login(account: ParkingAccount): Promise<Jar> {
  const jar: Jar = new Map()
  await req(jar, '/login', { method: 'GET' }) // 세션 쿠키 확보
  const body = new URLSearchParams({ userId: account.userId, userPwd: sha256(account.pw) }).toString()
  const res = await req(jar, '/login', { method: 'POST', body, headers: AJAX_HEADERS })
  const loc = res.headers.get('location') || ''
  const ok = (res.status === 302 && !loc.includes('/login')) || res.status === 200
  if (!ok) {
    // 사이트는 실패 시 {errorMsg} JSON(500) 또는 401(개인정보 동의)로 응답
    let detail = `status=${res.status}`
    try {
      const j = asRec(await res.json())
      if (j.errorMsg) detail = str(j.errorMsg)
    } catch {
      /* noop */
    }
    if (res.status === 401) detail = '개인정보 동의 필요(사이트에서 최초 로그인·동의 필요)'
    throw new Error(`로그인 실패(${account.userId}): ${detail}`)
  }
  return jar
}

/** 등록 페이지 기본 영업일(entryDate) 파싱. 실패 시 오늘(KST) */
async function fetchEntryDate(jar: Jar): Promise<string> {
  const res = await req(jar, '/discount/registration', { method: 'GET' })
  const html = await res.text()
  const m = html.match(/name="entryDate"[^>]*value="(\d{4}-\d{2}-\d{2})"/)
  if (m) return m[1]
  const kst = new Date(Date.now() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 10)
}

export interface ParkedCar {
  id: string // 입차ID (park entry id)
  carNo: string
  entryTime: string // 입차시각 문자열
  elapsed: string // 주차 경과시간 (예: "07:41")
  dscntCnt: number // 이미 등록된 할인 건수
}

async function listCars(jar: Jar, carNo: string, entryDate: string): Promise<ParkedCar[]> {
  const body = new URLSearchParams({
    iLotArea: LOT_AREA,
    entryDate: entryDate.replace(/-/g, ''),
    carNo,
  }).toString()
  const res = await req(jar, '/discount/registration/listForDiscount', { method: 'POST', body, headers: AJAX_HEADERS })
  const arr = parseLoose(await res.text())
  if (!Array.isArray(arr)) return []
  return arr.map((raw) => {
    const j = asRec(raw)
    return {
      id: str(j.id ?? j.iID),
      carNo: str(j.carNo ?? j.acPlate1),
      entryTime: str(j.entryDateToString),
      elapsed: str(j.differentTime),
      dscntCnt: num(j.dscnt_cnt),
    }
  })
}

export interface DiscountType {
  id: string
  name: string
  price: number
  value: number // 할인 시간(분 등)
  free: boolean
}

export interface CouponInfo {
  discountTypes: DiscountType[]
  remainBasic: number | null
  remainCharge: number | null
}

/** getForDiscount 원시 파싱 결과 (parkEntry·parkVisitCar 포함) */
async function getForDiscountRaw(jar: Jar, carId: string, userId: string): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ id: carId, member_id: userId }).toString()
  const res = await req(jar, '/discount/registration/getForDiscount', { method: 'POST', body, headers: AJAX_HEADERS })
  return asRec(await res.json().catch(() => ({})))
}

// 무료권을 사용하면 함께 쓸 수 없는 유료권(사이트 규칙) — UI·자동계산에서 제외.
// 무료+나머지 6종(일반요금 30분/1시간/2시간/3시간 + 유료 24시간·72시간)만 사용.
const BLOCKED_WITH_FREE = new Set(['유료 30분 할인권', '유료 1시간 할인', '유료 2시간 할인', '유료 3시간 할인'])

/** 무료권과 함께 사용 가능한 유료권인지 (무료 제외·차단 4종 제외) */
function isUsablePaid(d: DiscountType): boolean {
  return !d.free && d.value > 0 && !BLOCKED_WITH_FREE.has(d.name)
}

function discountTypesFrom(data: Record<string, unknown>): DiscountType[] {
  const list = Array.isArray(data.listDiscountType) ? data.listDiscountType : []
  return list.map((raw) => {
    const d = asRec(raw)
    return {
      id: str(d.id),
      name: str(d.discount_name),
      price: num(d.discount_price),
      value: num(d.discount_value),
      free: num(d.discount_price) === 0,
    }
  })
}

async function getCoupons(jar: Jar, carId: string, userId: string): Promise<CouponInfo> {
  const data = await getForDiscountRaw(jar, carId, userId)
  const member = asRec(data.member)
  return {
    discountTypes: discountTypesFrom(data),
    remainBasic: member.dcTimeRemainBasic != null ? num(member.dcTimeRemainBasic) : null,
    remainCharge: member.dcTimeRemainCharge != null ? num(member.dcTimeRemainCharge) : null,
  }
}

// ── 공개 API ─────────────────────────────────────────────────────────────

export interface SearchResult {
  entryDate: string
  cars: ParkedCar[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 차량번호로 입차 차량 검색 (읽기 전용). 대표 계정 1개로 조회.
 *  entryDate(YYYY-MM-DD) 지정 시 그 날짜로, 없으면 사이트 기본 영업일로 검색. */
export async function searchCars(carNo: string, entryDate?: string): Promise<SearchResult> {
  const accounts = getParkingAccounts()
  if (accounts.length === 0) throw new Error('PARKING_ACCOUNTS 미설정')
  const jar = await login(accounts[0])
  const date = entryDate && DATE_RE.test(entryDate) ? entryDate : await fetchEntryDate(jar)
  const cars = await listCars(jar, carNo, date)
  return { entryDate: date, cars }
}

export interface AccountState {
  userId: string
  label: string
  ok: boolean
  error?: string
  remainBasic: number | null
  remainCharge: number | null // 충전 잔액(원) — 유료권 계정 잔액
  discountTypes: DiscountType[]
  hasFree: boolean // 무료권이 목록에 있는지
  freeApplied: boolean // 이 차량에 이 계정이 무료권을 이미 등록했는지
  paidEnabled: boolean // 유료권 구매 계정 여부 (유료권 노출 대상)
}

export interface AppliedDiscount {
  seq: number
  discountName: string
  account: string // 등록 호실(account_no)
  name: string // 등록자 이름
  time: string // 등록시각
  free: boolean
  minutes: number // 이 할인권이 커버하는 분 (카탈로그 매칭)
}

export interface CarInfo {
  carNo: string
  entryTime: string // 입차시각
  elapsed: string // 주차시간 표시 (예: "7시간 42분")
  elapsedMin: number // 주차시간(분)
  gate: string // 입차 게이트/장비명
}

export interface CarDiscountState {
  car: CarInfo | null
  appliedDiscounts: AppliedDiscount[]
  accounts: AccountState[]
  paidUnlocked: boolean // 4개 계정 무료권을 모두 등록해야 true (유료 노출 게이트)
}

/** 특정 차량(carId)에 대해 4개 계정 상태 + 할인내역 + 주차정보 종합 (읽기 전용). */
export async function carDiscountState(carId: string): Promise<CarDiscountState> {
  const accounts = getParkingAccounts()
  const raw = await Promise.all(
    accounts.map(async (a) => {
      try {
        const jar = await login(a)
        const data = await getForDiscountRaw(jar, carId, a.userId)
        return { a, data, ok: true as const }
      } catch (e) {
        return { a, error: errMsg(e) || '조회 실패', ok: false as const }
      }
    })
  )

  // 무료권 이름 집합 + 이름→분 카탈로그 (할인내역 행의 무료/커버 분 판정용)
  const freeNames = new Set<string>()
  const minutesByName = new Map<string, number>()
  for (const r of raw) {
    if (!r.ok) continue
    for (const d of discountTypesFrom(r.data)) {
      if (d.free) freeNames.add(d.name)
      if (!minutesByName.has(d.name)) minutesByName.set(d.name, d.value)
    }
  }

  // 차량정보·할인내역은 차량 단위 — 첫 성공 계정 응답에서 취함
  const firstOk = raw.find((r) => r.ok)
  let car: CarInfo | null = null
  let appliedDiscounts: AppliedDiscount[] = []
  if (firstOk && firstOk.ok) {
    const pe = asRec(firstOk.data.parkEntry)
    const elapsedStr = str(pe.different_time)
    const elapsedMin = parseDurationMin(elapsedStr) ?? elapsedMinFromEntry(str(pe.dtInDate)) ?? 0
    car = {
      carNo: str(pe.acPlate1),
      entryTime: str(pe.dtInDateStr || pe.dtInDate),
      elapsed: elapsedStr,
      elapsedMin,
      gate: str(pe.iInEqpmNm),
    }
    const pvc = Array.isArray(firstOk.data.parkVisitCar) ? firstOk.data.parkVisitCar : []
    appliedDiscounts = pvc.map((row) => {
      const x = asRec(row)
      const dn = str(x.discount_name)
      return {
        seq: num(x.rownum),
        discountName: dn,
        account: str(x.account_no),
        name: str(x.name),
        time: str(x.create_tm),
        free: freeNames.has(dn),
        minutes: minutesByName.get(dn) ?? 0,
      }
    })
  }

  const accountStates: AccountState[] = raw.map((r) => {
    if (!r.ok) {
      return {
        userId: r.a.userId,
        label: r.a.label,
        ok: false,
        error: r.error,
        remainBasic: null,
        remainCharge: null,
        discountTypes: [],
        hasFree: false,
        freeApplied: false,
        paidEnabled: !!r.a.paid,
      }
    }
    // 무료 + 사용 가능한 유료권만 노출(차단 4종 제외). 분 매핑은 위에서 전체로 이미 구성됨.
    const dts = discountTypesFrom(r.data).filter((d) => d.free || isUsablePaid(d))
    const member = asRec(r.data.member)
    const freeApplied = appliedDiscounts.some((ad) => ad.account === r.a.userId && ad.free)
    return {
      userId: r.a.userId,
      label: r.a.label,
      ok: true,
      remainBasic: member.dcTimeRemainBasic != null ? num(member.dcTimeRemainBasic) : null,
      remainCharge: member.dcTimeRemainCharge != null ? num(member.dcTimeRemainCharge) : null,
      discountTypes: dts,
      hasFree: dts.some((d) => d.free),
      freeApplied,
      paidEnabled: !!r.a.paid,
    }
  })

  // 유료 게이트: (로그인 성공한) 모든 계정이 무료권을 등록했거나, 무료권이 아예 없을 때만 해제
  const paidUnlocked = accountStates
    .filter((a) => a.ok)
    .every((a) => a.freeApplied || !a.hasFree)

  return { car, appliedDiscounts, accounts: accountStates, paidUnlocked }
}

export interface RegisterResult {
  ok: boolean
  message: string
}

/**
 * 한 계정으로 특정 차량에 할인권 1건 등록.
 * carId 우선, 없으면 carNo 재검색으로 입차ID 재확인(세션 무관하게 안전).
 */
export async function registerDiscount(params: {
  userId: string
  carNo: string
  carId?: string
  discountType: string
  entryDate?: string
  assumeUnlocked?: boolean // 자동적용이 무료 선등록을 보장할 때 게이트 재조회 생략
}): Promise<RegisterResult> {
  const account = findAccount(params.userId)
  if (!account) return { ok: false, message: `계정(${params.userId}) 미설정` }

  const jar = await login(account)
  const entryDate =
    params.entryDate && DATE_RE.test(params.entryDate) ? params.entryDate : await fetchEntryDate(jar)
  const cars = await listCars(jar, params.carNo, entryDate)
  if (cars.length === 0) return { ok: false, message: '입차 차량을 찾지 못했습니다(출차되었을 수 있음).' }

  const target =
    (params.carId && cars.find((c) => c.id === params.carId)) ||
    cars.find((c) => c.carNo === params.carNo) ||
    (cars.length === 1 ? cars[0] : undefined)
  if (!target) return { ok: false, message: '대상 차량이 여러 건이라 특정할 수 없습니다.' }

  // 할인권 유효성 확인
  const info = await getCoupons(jar, target.id, params.userId)
  const dt = info.discountTypes.find((d) => d.id === params.discountType)
  if (!dt) return { ok: false, message: '해당 계정에서 사용할 수 없는 할인권입니다.' }

  // 유료권 게이트: 구매 계정(paid)만 + 4개 계정 무료권 모두 등록 후에만 유료 등록 허용(프론트 우회 방지)
  if (dt.price > 0) {
    if (!account.paid) {
      return { ok: false, message: `${account.label}호는 유료 주차권 구매 계정이 아닙니다.` }
    }
    if (!params.assumeUnlocked) {
      const state = await carDiscountState(target.id)
      if (!state.paidUnlocked) {
        return { ok: false, message: '먼저 모든 호실의 무료 1시간할인을 등록해야 유료권을 사용할 수 있습니다.' }
      }
    }
  }

  const body = new URLSearchParams({
    peId: target.id,
    discountType: params.discountType,
    saveCnt: '1',
    carNo: target.carNo,
    acPlate2: '',
    memo: '',
  }).toString()
  const res = await req(jar, '/discount/registration/save', { method: 'POST', body, headers: AJAX_HEADERS })
  const text = (await res.text()).trim()
  if (text === 'true') return { ok: true, message: `${dt.name} 등록 완료` }
  return { ok: false, message: `등록 실패(세션 만료 또는 잔여 소진). 응답: ${text.slice(0, 80)}` }
}

// ── 자동 계산 (주차시간 기반 최적 할인권 조합) ────────────────────────────

/** 주차장 기본 무료시간(분) — 최초 30분은 요금 미부과이므로 차감 대상에서 제외 */
export const FREE_BASE_MIN = 30
/** 등록 후 출차까지 여유시간(분) — 등록 시점 주차시간에 더해 커버 목표를 잡음 */
export const EXIT_BUFFER_MIN = 10

/** 자동계산 유료권 대상: 무료와 함께 쓸 수 있는 6종(일반요금 4종 + 유료 24/72시간) */
function isPaidEligible(d: DiscountType): boolean {
  return isUsablePaid(d)
}

export interface PlanStep {
  userId: string
  label: string
  discountType: string
  name: string
  minutes: number
  price: number
}

export interface AutoPlan {
  ok: boolean
  reason?: string
  elapsedMin: number
  targetMin: number // 커버 목표 시간 = 주차시간 + 출차 여유 10분
  chargeableMin: number // 요금 부과 대상 = 목표 − 무료 30분
  alreadyMin: number
  deficitMin: number
  steps: PlanStep[] // 무료 먼저, 그 뒤 903 유료
  freeCount: number
  paidCount: number
  addMin: number
  coveredAfterMin: number
  totalCost: number
  balance: number | null
  insufficientBalance: boolean
}

/** 유료권 최소 비용 커버(>= need) — DP 후 재구성 */
function coverPaid(
  need: number,
  cats: { id: string; name: string; minutes: number; price: number }[]
): { id: string; name: string; minutes: number; price: number }[] | null {
  if (need <= 0) return []
  const usable = cats.filter((c) => c.minutes > 0)
  if (usable.length === 0) return null
  const cost = new Array(need + 1).fill(Infinity)
  const cnt = new Array(need + 1).fill(Infinity)
  const pick = new Array(need + 1).fill(-1)
  cost[0] = 0
  cnt[0] = 0
  for (let t = 1; t <= need; t++) {
    for (let i = 0; i < usable.length; i++) {
      const prev = Math.max(0, t - usable[i].minutes)
      const c = usable[i].price + cost[prev]
      const k = 1 + cnt[prev]
      // 비용 최소 우선, 동률이면 장수(등록 횟수) 최소
      if (c < cost[t] || (c === cost[t] && k < cnt[t])) {
        cost[t] = c
        cnt[t] = k
        pick[t] = i
      }
    }
  }
  if (!isFinite(cost[need])) return null
  const out: { id: string; name: string; minutes: number; price: number }[] = []
  let t = need
  while (t > 0) {
    const i = pick[t]
    if (i < 0) break
    out.push(usable[i])
    t = Math.max(0, t - usable[i].minutes)
  }
  return out
}

/** 주차시간·기적용분 기준으로 무료+유료 최적 조합 계획 (부작용 없음)
 *  커버 목표 = 주차시간 + 출차 여유 10분, 차감 대상 = 목표 − 무료 30분 − 기적용분 */
export async function planAutoDiscount(carId: string): Promise<AutoPlan> {
  const state = await carDiscountState(carId)
  const elapsedMin = state.car?.elapsedMin ?? 0
  const targetMin = elapsedMin + EXIT_BUFFER_MIN
  const chargeableMin = Math.max(0, targetMin - FREE_BASE_MIN)
  const alreadyMin = state.appliedDiscounts.reduce((s, a) => s + (a.minutes || 0), 0)
  const deficitMin = Math.max(0, chargeableMin - alreadyMin)
  const balance = state.accounts.find((a) => a.paidEnabled)?.remainCharge ?? null
  const empty = {
    elapsedMin,
    targetMin,
    chargeableMin,
    alreadyMin,
    deficitMin,
    balance,
    freeCount: 0,
    paidCount: 0,
    addMin: 0,
    coveredAfterMin: alreadyMin,
    totalCost: 0,
    insufficientBalance: false,
  }

  if (elapsedMin === 0) {
    return { ok: false, reason: '주차시간을 확인할 수 없습니다.', steps: [], ...empty }
  }
  if (chargeableMin === 0) {
    return {
      ok: true,
      reason: `기본 무료 ${FREE_BASE_MIN}분 이내 — 등록이 필요 없습니다 (주차 ${elapsedMin}분 + 여유 ${EXIT_BUFFER_MIN}분)`,
      steps: [],
      ...empty,
    }
  }
  if (deficitMin === 0) {
    return {
      ok: true,
      reason: `이미 충분히 적용됨 (적용 ${alreadyMin}분 ≥ 부과 대상 ${chargeableMin}분)`,
      steps: [],
      ...empty,
    }
  }

  // 무료: 이 차량에 아직 무료 미등록 + 무료권 보유 계정, 필요한 만큼만
  const freeAccts = state.accounts.filter((a) => a.ok && a.hasFree && !a.freeApplied)
  const freeUse = Math.min(Math.ceil(deficitMin / 60), freeAccts.length)
  const steps: PlanStep[] = []
  for (let i = 0; i < freeUse; i++) {
    const a = freeAccts[i]
    const f = a.discountTypes.find((d) => d.free)
    if (f) steps.push({ userId: a.userId, label: a.label, discountType: f.id, name: f.name, minutes: f.value, price: 0 })
  }
  const remainder = Math.max(0, deficitMin - freeUse * 60)

  // 유료: 903(paidEnabled)의 '유료XX시간'만으로 잔여 커버
  const paidAcct = state.accounts.find((a) => a.ok && a.paidEnabled)
  let paidCount = 0
  if (remainder > 0) {
    if (!paidAcct) {
      return { ok: false, reason: '유료권 계정(903) 조회 실패로 잔여 시간을 커버할 수 없습니다.', steps, ...empty, freeCount: freeUse, addMin: freeUse * 60, coveredAfterMin: alreadyMin + freeUse * 60 }
    }
    const cats = paidAcct.discountTypes.filter(isPaidEligible).map((d) => ({ id: d.id, name: d.name, minutes: d.value, price: d.price }))
    const picked = coverPaid(remainder, cats)
    if (!picked) {
      return { ok: false, reason: '유료권으로 잔여 시간을 커버할 수 없습니다.', steps, ...empty, freeCount: freeUse, addMin: freeUse * 60, coveredAfterMin: alreadyMin + freeUse * 60 }
    }
    paidCount = picked.length
    for (const p of picked) {
      steps.push({ userId: paidAcct.userId, label: paidAcct.label, discountType: p.id, name: p.name, minutes: p.minutes, price: p.price })
    }
  }

  const addMin = steps.reduce((s, x) => s + x.minutes, 0)
  const totalCost = steps.reduce((s, x) => s + x.price, 0)
  return {
    ok: true,
    elapsedMin,
    targetMin,
    chargeableMin,
    alreadyMin,
    deficitMin,
    steps,
    freeCount: freeUse,
    paidCount,
    addMin,
    coveredAfterMin: alreadyMin + addMin,
    totalCost,
    balance,
    insufficientBalance: balance != null && totalCost > balance,
  }
}

export interface AutoApplyStep extends PlanStep {
  applied: boolean
  message: string
}

export interface AutoApplyResult {
  ok: boolean
  plan: AutoPlan
  results: AutoApplyStep[]
  finalState: CarDiscountState | null
  message: string
}

/** 계획을 순차 실행(무료 먼저 → 903 유료). 실패 시 중단하고 결과 보고. */
export async function autoApplyDiscount(carId: string, carNo: string): Promise<AutoApplyResult> {
  const plan = await planAutoDiscount(carId)
  if (!plan.ok || plan.steps.length === 0) {
    return { ok: false, plan, results: [], finalState: await carDiscountState(carId), message: plan.reason || '적용할 항목이 없습니다.' }
  }
  if (plan.insufficientBalance) {
    return { ok: false, plan, results: [], finalState: await carDiscountState(carId), message: '903호 잔액이 부족합니다. 유료권을 등록할 수 없습니다.' }
  }

  const results: AutoApplyStep[] = []
  let allOk = true
  for (const s of plan.steps) {
    const r = await registerDiscount({
      userId: s.userId,
      carNo,
      carId,
      discountType: s.discountType,
      assumeUnlocked: true, // 무료를 먼저 순차 등록하므로 유료 게이트 재조회 생략
    })
    results.push({ ...s, applied: r.ok, message: r.message })
    if (!r.ok) {
      allOk = false
      break // 이후 유료 실패 방지 위해 중단
    }
  }

  const finalState = await carDiscountState(carId)
  return {
    ok: allOk,
    plan,
    results,
    finalState,
    message: allOk
      ? `자동 등록 완료 (${results.length}건, ${plan.totalCost.toLocaleString()}원)`
      : `일부 실패로 중단 (${results.filter((r) => r.applied).length}/${plan.steps.length}건 성공)`,
  }
}
