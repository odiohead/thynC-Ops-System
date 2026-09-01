/**
 * 디바이스 원장 읽기 라우트 공용 헬퍼 (app/api/devices/** GET 전용)
 *
 * - 인증: 로그인 전체(§8.1 read) — 미로그인 401
 * - 쿼리 파싱: units/events 필터 → 서비스 where 빌더 입력(`UnitsQuery`/`EventsQuery`), 잘못된 값은 400
 * - xlsx 응답: `app/api/inventory/transactions/export/route.ts` 선례(json_to_sheet + filename*=UTF-8'')
 * - 읽기 라우트는 DB에 쓰지 않으며 logAudit 대상이 아니다(§8.3)
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getAuthUser, type JWTPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  isRegistryError,
  type EventsQuery,
  type UnitsQuery,
  type UnitsSort,
  type UnitsStatusFilter,
  type UnitsWmsFilter,
} from '@/lib/deviceRegistry'
import { DEVICE_EVENT_TYPES, PRODUCT_TYPE_FILTERS, REGISTRY_REF_TYPES, REGISTRY_SOURCES, USAGE_FILTERS, isYmd, todayKst, type ProductTypeFilter, type UsageFilter } from '@/lib/deviceRegistryShared'

// ─────────────────────────────────────────────────────────────────────────────
// 인증 · 오류
// ─────────────────────────────────────────────────────────────────────────────

/** 로그인 사용자 또는 401 응답 — `if (auth instanceof NextResponse) return auth` */
export async function authOr401(req: NextRequest): Promise<JWTPayload | NextResponse> {
  const user = await getAuthUser(req)
  return user ?? NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
}

export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 })

/** RegistryError → 그 status + toJSON(), 그 외 → 500 */
export function readErrorResponse(e: unknown, context: string): NextResponse {
  if (isRegistryError(e)) return NextResponse.json(e.toJSON(), { status: e.status })
  console.error(`[devices:${context}]`, e)
  return NextResponse.json({ error: '디바이스 원장 조회 중 오류가 발생했습니다.' }, { status: 500 })
}

// ─────────────────────────────────────────────────────────────────────────────
// 쿼리 파싱
// ─────────────────────────────────────────────────────────────────────────────

/** 양의 정수 파라미터 — 없음 null / 잘못됨 undefined */
export function positiveInt(v: string | null): number | null | undefined {
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export function pageLimit(sp: URLSearchParams, defaults: { limit: number; max: number }): { page: number; limit: number } {
  const page = Math.max(1, positiveInt(sp.get('page')) ?? 1)
  const limit = Math.min(defaults.max, Math.max(1, positiveInt(sp.get('limit')) ?? defaults.limit))
  return { page, limit }
}

const UNITS_STATUS: readonly UnitsStatusFilter[] = ['active', 'recovered', 'all']
const UNITS_WMS: readonly UnitsWmsFilter[] = ['linked', 'unlinked', 'in_stock']
const UNITS_SORT: readonly UnitsSort[] = ['ward', 'serial', 'placedOn', 'lastEvent']

/** `GET /api/devices/units`·`/export` 공용 — hospital/model/ward/status/q/wms/usage(SALE|EVAL|none)/productType(일반|라이트|none)/sort (§7.1) */
export function parseUnitsQuery(sp: URLSearchParams): { params: UnitsQuery; sort: UnitsSort } | NextResponse {
  const model = positiveInt(sp.get('model'))
  if (model === undefined) return badRequest('model은 기기 모델 id(양의 정수)여야 합니다.')

  const wardRaw = sp.get('ward')
  let ward: UnitsQuery['ward'] = null
  if (wardRaw && wardRaw.trim()) {
    if (wardRaw === 'unassigned') ward = 'unassigned'
    else {
      const id = positiveInt(wardRaw)
      if (id === undefined) return badRequest("ward는 병동 id 또는 'unassigned'여야 합니다.")
      ward = id
    }
  }

  const statusRaw = sp.get('status')
  const status = statusRaw ? (UNITS_STATUS.find((s) => s === statusRaw) ?? undefined) : 'active'
  if (status === undefined) return badRequest('status는 active | recovered | all 중 하나여야 합니다.')

  const wmsRaw = sp.get('wms')
  const wms = wmsRaw ? (UNITS_WMS.find((s) => s === wmsRaw) ?? undefined) : null
  if (wms === undefined) return badRequest('wms는 linked | unlinked | in_stock 중 하나여야 합니다.')

  const usageRaw = sp.get('usage')
  const usage: UsageFilter | null | undefined = usageRaw ? (USAGE_FILTERS.find((s) => s === usageRaw) ?? undefined) : null
  if (usage === undefined) return badRequest('usage는 SALE | EVAL | none 중 하나여야 합니다.')

  const ptRaw = sp.get('productType')
  const productType: ProductTypeFilter | null | undefined = ptRaw ? (PRODUCT_TYPE_FILTERS.find((s) => s === ptRaw) ?? undefined) : null
  if (productType === undefined) return badRequest('productType은 일반 | 라이트 | none 중 하나여야 합니다.')

  const sortRaw = sp.get('sort')
  const sort = sortRaw ? (UNITS_SORT.find((s) => s === sortRaw) ?? undefined) : 'ward'
  if (sort === undefined) return badRequest('sort는 ward | serial | placedOn | lastEvent 중 하나여야 합니다.')

  const hospital = sp.get('hospital')?.trim() || null
  const q = sp.get('q')?.trim() || null
  return { params: { hospital, model, ward, status, q, wms, usage, productType }, sort }
}

/** `GET /api/devices/events`·`/events/export` 공용 — hospital/device/type/from/to/refType/refCode/batch/actionGroup/source/q */
export function parseEventsQuery(sp: URLSearchParams): EventsQuery | NextResponse {
  const device = positiveInt(sp.get('device'))
  if (device === undefined) return badRequest('device는 기기 id(양의 정수)여야 합니다.')
  const batch = positiveInt(sp.get('batch'))
  if (batch === undefined) return badRequest('batch는 임포트 배치 id(양의 정수)여야 합니다.')

  const type = sp.get('type')?.trim() || null
  if (type && !(DEVICE_EVENT_TYPES as readonly string[]).includes(type)) {
    return badRequest(`type은 ${DEVICE_EVENT_TYPES.join(' | ')} 중 하나여야 합니다.`)
  }
  const from = sp.get('from')?.trim() || null
  if (from && !isYmd(from)) return badRequest('from은 YYYY-MM-DD 형식이어야 합니다.')
  const to = sp.get('to')?.trim() || null
  if (to && !isYmd(to)) return badRequest('to는 YYYY-MM-DD 형식이어야 합니다.')
  if (from && to && from > to) return badRequest('from은 to보다 늦을 수 없습니다.')

  const refType = sp.get('refType')?.trim() || null
  if (refType && !(REGISTRY_REF_TYPES as readonly string[]).includes(refType)) {
    return badRequest(`refType은 ${REGISTRY_REF_TYPES.join(' | ')} 중 하나여야 합니다.`)
  }
  const source = sp.get('source')?.trim() || null
  if (source && !(REGISTRY_SOURCES as readonly string[]).includes(source)) {
    return badRequest(`source는 ${REGISTRY_SOURCES.join(' | ')} 중 하나여야 합니다.`)
  }
  const actionGroup = sp.get('actionGroup')?.trim() || null
  if (actionGroup && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actionGroup)) {
    return badRequest('actionGroup은 UUID 형식이어야 합니다.')
  }

  return {
    hospital: sp.get('hospital')?.trim() || null,
    device,
    type,
    from,
    to,
    refType,
    refCode: sp.get('refCode')?.trim() || null,
    batch,
    actionGroup,
    source,
    q: sp.get('q')?.trim() || null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// xlsx
// ─────────────────────────────────────────────────────────────────────────────

/** Excel 파일명 조각 — 병원명 등에 섞일 수 있는 경로·예약 문자 제거 */
export function safeFilePart(s: string | null | undefined, fallback: string): string {
  const t = (s ?? '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '')
  return t || fallback
}

/** 병원 코드 → 표시명(없으면 코드 그대로) — 파일명·헤더용 */
export async function hospitalDisplayName(code: string | null | undefined): Promise<string | null> {
  if (!code) return null
  const h = await prisma.hospital.findUnique({ where: { hospitalCode: code }, select: { hospitalName: true } })
  return h?.hospitalName ?? code
}

/** `디바이스원장_<병원명>_<필터>_YYYYMMDD.xlsx` (§6.1 Excel) */
export function registryFileName(hospitalName: string | null, filterLabel: string): string {
  const ymd = todayKst().replace(/-/g, '')
  return `디바이스원장_${safeFilePart(hospitalName, '전체')}_${safeFilePart(filterLabel, '전체')}_${ymd}.xlsx`
}

export function xlsxResponse(rows: Record<string, unknown>[], sheetName: string, filename: string, colWidths?: number[]): NextResponse {
  const ws = XLSX.utils.json_to_sheet(rows)
  if (colWidths && colWidths.length > 0) ws['!cols'] = colWidths.map((wch) => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}

/** 기록 시각 표시 — 처리일시 KST (`inventory/transactions/export` 선례) */
export function fmtKst(v: Date | string | null | undefined): string {
  if (!v) return ''
  const d = typeof v === 'string' ? new Date(v) : v
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}
