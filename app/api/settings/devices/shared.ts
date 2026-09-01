/**
 * 기기 모델 마스터(device_info) 5필드 — 파싱·검증·DTO (hospital_device_registry_design.md §5.1, §8.1)
 *
 * - deviceClass / onpremDeviceType / serialPattern / serialTracked / quantityTracked 는 ADMIN+ 전용.
 * - 값 어휘(WEARABLE/GATEWAY/THIRD_PARTY, 온프렘 코드표)는 `lib/deviceRegistryShared.ts` 단일 소스, DB CHECK 없음(§5c).
 * - 라우트 2개(`route.ts`, `[id]/route.ts`)가 공유하는 서버 전용 헬퍼 — API 경로로 노출되지 않음(`app/api/weekly/shared.ts` 선례).
 */
import type { DeviceInfo } from '@prisma/client'
import { DEVICE_CLASSES, type DeviceClass } from '@/lib/deviceRegistryShared'

export const ADMIN_ONLY_FIELD_KEYS = [
  'deviceClass',
  'onpremDeviceType',
  'serialPattern',
  'serialTracked',
  'quantityTracked',
] as const

export const ADMIN_ONLY_FIELDS_ERROR =
  '분류·온프렘 코드·시리얼 형식·원장 대상·수량 집계 대상은 관리자만 변경할 수 있습니다'

export const SERIAL_PATTERN_ERROR = '시리얼 형식 정규식이 올바르지 않습니다'

/** 요청 본문에 5필드 중 하나라도 포함되어 있는지 (값이 undefined여도 키가 있으면 포함으로 본다) */
export function hasAdminOnlyField(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  return ADMIN_ONLY_FIELD_KEYS.some((k) => k in (body as Record<string, unknown>))
}

export type AdminOnlyFieldsData = {
  deviceClass?: DeviceClass
  onpremDeviceType?: number | null
  serialPattern?: string | null
  serialTracked?: boolean
  quantityTracked?: boolean
}

type ParseResult = { ok: true; data: AdminOnlyFieldsData } | { ok: false; error: string }

/**
 * 5필드 부분 파싱 — 본문에 키가 있는 필드만 결과에 포함(PUT 부분 갱신 지원).
 * POST에서 미지정이면 DB 기본값(WEARABLE / NULL / NULL / false / true)이 적용된다.
 */
export function parseAdminOnlyFields(body: unknown): ParseResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const data: AdminOnlyFieldsData = {}

  if ('deviceClass' in b) {
    const v = typeof b.deviceClass === 'string' ? b.deviceClass.trim().toUpperCase() : ''
    if (!(DEVICE_CLASSES as readonly string[]).includes(v)) {
      return { ok: false, error: '분류는 WEARABLE·GATEWAY·THIRD_PARTY 중 하나여야 합니다.' }
    }
    data.deviceClass = v as DeviceClass
  }

  if ('onpremDeviceType' in b) {
    const raw = b.onpremDeviceType
    if (raw === null || raw === undefined || raw === '') {
      data.onpremDeviceType = null
    } else {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isInteger(n) || n < 0) {
        return { ok: false, error: '온프렘 코드는 0 이상의 정수여야 합니다.' }
      }
      data.onpremDeviceType = n
    }
  }

  if ('serialPattern' in b) {
    const raw = b.serialPattern
    const s = raw === null || raw === undefined ? '' : String(raw).trim()
    if (!s) {
      data.serialPattern = null
    } else {
      try {
        new RegExp(s)
      } catch {
        return { ok: false, error: SERIAL_PATTERN_ERROR }
      }
      data.serialPattern = s
    }
  }

  if ('serialTracked' in b) data.serialTracked = toBool(b.serialTracked)
  if ('quantityTracked' in b) data.quantityTracked = toBool(b.quantityTracked)

  return { ok: true, data }
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v === 'true' || v === '1'
  if (typeof v === 'number') return v !== 0
  return false
}

/** 클라이언트 응답 형상 — 기존 6필드 + 5필드 */
export function toDeviceInfoDto(d: DeviceInfo) {
  return {
    id: d.id,
    deviceModel: d.deviceModel,
    deviceName: d.deviceName,
    isActive: d.isActive,
    sortOrder: d.sortOrder,
    createdAt: d.createdAt,
    deviceClass: d.deviceClass,
    onpremDeviceType: d.onpremDeviceType,
    serialPattern: d.serialPattern,
    serialTracked: d.serialTracked,
    quantityTracked: d.quantityTracked,
  }
}
