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

async function getCoupons(jar: Jar, carId: string, userId: string): Promise<CouponInfo> {
  const body = new URLSearchParams({ id: carId, member_id: userId }).toString()
  const res = await req(jar, '/discount/registration/getForDiscount', { method: 'POST', body, headers: AJAX_HEADERS })
  const data = asRec(await res.json().catch(() => ({})))
  const list = Array.isArray(data.listDiscountType) ? data.listDiscountType : []
  const discountTypes: DiscountType[] = list.map((raw) => {
    const d = asRec(raw)
    return {
      id: str(d.id),
      name: str(d.discount_name),
      price: num(d.discount_price),
      value: num(d.discount_value),
      free: num(d.discount_price) === 0,
    }
  })
  const member = asRec(data.member)
  return {
    discountTypes,
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

export interface AccountCoupons {
  userId: string
  label: string
  ok: boolean
  error?: string
  remainBasic: number | null
  remainCharge: number | null
  discountTypes: DiscountType[]
}

/** 특정 차량(carId)에 대해 4개 계정의 사용 가능 할인권·잔여를 병렬 조회 (읽기 전용). */
export async function couponsForCar(carId: string): Promise<AccountCoupons[]> {
  const accounts = getParkingAccounts()
  return Promise.all(
    accounts.map(async (a): Promise<AccountCoupons> => {
      try {
        const jar = await login(a)
        const info = await getCoupons(jar, carId, a.userId)
        return { userId: a.userId, label: a.label, ok: true, ...info }
      } catch (e) {
        return {
          userId: a.userId,
          label: a.label,
          ok: false,
          error: errMsg(e) || '조회 실패',
          remainBasic: null,
          remainCharge: null,
          discountTypes: [],
        }
      }
    })
  )
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
