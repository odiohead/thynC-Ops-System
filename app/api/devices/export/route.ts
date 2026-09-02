import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { UNITS_EXPORT_MAX, listUnits, resolveUnitsWhere, type UnitListRow } from '@/lib/deviceRegistry'
import {
  DEVICE_EVENT_TYPE_LABELS,
  REGISTRY_REF_TYPE_LABELS,
  placementStatusLabel,
  toYmd,
  type DeviceEventType,
  type RegistryRefType,
} from '@/lib/deviceRegistryShared'
import { authOr401, badRequest, hospitalDisplayName, parseUnitsQuery, readErrorResponse, registryFileName, xlsxResponse } from '../_read'

export const dynamic = 'force-dynamic'

const STATUS_FILTER_LABEL = { active: '배치중', recovered: '회수됨', all: '전체' } as const

/** 기기 목록 열(§6.1 Excel) — 회수된 개체는 병원 열에 마지막 병원(last_hospital_code)을 적는다 */
function toRow(r: UnitListRow): Record<string, unknown> {
  const hospital = r.hospital ?? r.lastHospital
  const wms = r.wms
  return {
    병원코드: hospital?.hospitalCode ?? '',
    병원명: hospital?.hospitalName ?? '',
    시리얼: r.serialNo,
    원문: r.serialRaw ?? '',
    모델: r.deviceInfo.deviceModel,
    모델명: r.deviceInfo.deviceName,
    용도: r.usageType?.name ?? '',
    상품유형: r.productType ?? '',
    계약건: r.dealCode ?? '',
    병동: r.ward ? `${r.ward.name}${r.ward.isActive ? '' : ' (폐쇄)'}` : r.status === 'ACTIVE' ? '미지정' : '',
    상태: placementStatusLabel(r),
    'AS 접수일': toYmd(r.asStartedOn) ?? '',
    배치일: toYmd(r.placedOn) ?? '',
    회수일: toYmd(r.recoveredOn) ?? '',
    '회수 사유': r.recoverReason?.name ?? '',
    '교체 →': r.replacedBy?.serialNo ?? '',
    '최근 이벤트': r.lastEventType ? DEVICE_EVENT_TYPE_LABELS[r.lastEventType as DeviceEventType] ?? r.lastEventType : '',
    '최근 이벤트 일자': toYmd(r.lastEventOn) ?? '',
    연결: r.lastRef ? `${REGISTRY_REF_TYPE_LABELS[r.lastRef.type as RegistryRefType] ?? r.lastRef.type} ${r.lastRef.code}` : '',
    '창고 개체': wms ? `${wms.inventoryName} · ${wms.status} (자동 매칭)` : '',
    '창고 경고': r.wmsWarning ?? '',
    메모: r.memo ?? '',
  }
}

/**
 * 기기 목록 Excel — 목록과 같은 필터(where 빌더 공용), page/limit 무시, 10,000행 캡(초과 400)
 * 창고 개체 열은 export 1회당 배치 매칭 1쿼리(일시 계산, DB 쓰기 없음 §9.2). 로그인 전체
 */
export async function GET(req: NextRequest) {
  const auth = await authOr401(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const parsed = parseUnitsQuery(sp)
  if (parsed instanceof NextResponse) return parsed
  const { params, sort } = parsed

  try {
    const total = await prisma.hospitalDevice.count({ where: await resolveUnitsWhere(params) })
    if (total > UNITS_EXPORT_MAX) {
      return badRequest(`필터를 좁혀 ${UNITS_EXPORT_MAX.toLocaleString()}행 이하로 내보내세요 (현재 ${total.toLocaleString()}행)`)
    }
    const [{ data }, hospitalName] = await Promise.all([
      listUnits(params, { page: 1, limit: UNITS_EXPORT_MAX, sort, maxLimit: UNITS_EXPORT_MAX }),
      hospitalDisplayName(params.hospital),
    ])
    const rows = data.map(toRow)
    const filterLabel = STATUS_FILTER_LABEL[params.status ?? 'active']
    return xlsxResponse(rows, '기기 목록', registryFileName(hospitalName, filterLabel), [13, 20, 12, 16, 12, 16, 8, 8, 17, 12, 9, 11, 11, 11, 16, 12, 10, 12, 22, 26, 30, 24])
  } catch (e) {
    return readErrorResponse(e, 'export')
  }
}
