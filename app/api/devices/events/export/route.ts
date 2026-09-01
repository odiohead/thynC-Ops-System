import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { EVENTS_EXPORT_MAX, buildEventsWhere, listEvents, type EventListRow } from '@/lib/deviceRegistry'
import {
  DEVICE_EVENT_TYPE_LABELS,
  REGISTRY_REF_TYPE_LABELS,
  REGISTRY_SOURCE_LABELS,
  toYmd,
  type DeviceEventType,
  type RegistryRefType,
  type RegistrySource,
} from '@/lib/deviceRegistryShared'
import { authOr401, badRequest, fmtKst, hospitalDisplayName, parseEventsQuery, readErrorResponse, registryFileName, xlsxResponse } from '../../_read'

export const dynamic = 'force-dynamic'

const CORRECT_FIELD_LABELS: Record<string, string> = { deviceInfoId: '모델', serialNo: '시리얼', serialRaw: '원문', macAddress: 'MAC', extDeviceCode: '닉네임' }

/** 이력 탭 '내용' 열 — 병동 from→to · 교체/이관 상대 · CORRECT 변경 요약 */
function contentOf(e: EventListRow): string {
  const from = e.fromWard?.name ?? '미지정'
  const to = e.toWard?.name ?? '미지정'
  const rel = e.relatedDevice?.serialNo
  switch (e.eventType) {
    case 'REGISTER':
      return `→ ${to}${rel ? ` · ${rel} 대체(교체 등록)` : ''}`
    case 'MOVE_WARD':
      return `${from} → ${to}`
    case 'RECOVER':
      return `${from} 회수${rel ? ` → 교체 ${rel}` : ''}`
    case 'CORRECT': {
      const ch = e.changes
      if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return ''
      return Object.entries(ch as Record<string, unknown>)
        .map(([field, v]) => {
          const pair = v && typeof v === 'object' ? (v as { before?: unknown; after?: unknown }) : {}
          return `${CORRECT_FIELD_LABELS[field] ?? field}: ${pair.before ?? '—'} → ${pair.after ?? '—'}`
        })
        .join(', ')
    }
    default:
      return ''
  }
}

/** 이력 탭 컬럼(§6.1) + 기록자·기록 시각·배치 # — 교체·이관 쌍도 이벤트 1건당 1행(action_group으로 묶어 볼 수 있음) */
function toRow(e: EventListRow): Record<string, unknown> {
  return {
    업무일자: toYmd(e.occurredOn) ?? '',
    유형: DEVICE_EVENT_TYPE_LABELS[e.eventType as DeviceEventType] ?? e.eventType,
    병원코드: e.hospitalCode ?? e.device.hospitalCode ?? '',
    병원명: e.hospital?.hospitalName ?? '',
    시리얼: e.device.serialNo,
    원문: e.device.serialRaw ?? '',
    모델: e.device.deviceInfo.deviceModel,
    내용: contentOf(e),
    사유: e.reasonCode?.name ?? '',
    연결: e.refType && e.refCode ? `${REGISTRY_REF_TYPE_LABELS[e.refType as RegistryRefType] ?? e.refType} ${e.refCode}` : '',
    메모: e.memo ?? '',
    출처: REGISTRY_SOURCE_LABELS[e.source as RegistrySource] ?? e.source,
    기록자: e.actorName ?? '',
    기록시각: fmtKst(e.createdAt),
    정정시각: fmtKst(e.editedAt),
    '배치 #': e.importBatchId ?? '',
    액션그룹: e.actionGroup ?? '',
    이벤트ID: e.id,
  }
}

/** 이력 Excel — 목록과 같은 필터(where 빌더 공용), page/limit 무시, 10,000행 캡(초과 400). 로그인 전체 */
export async function GET(req: NextRequest) {
  const auth = await authOr401(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const params = parseEventsQuery(sp)
  if (params instanceof NextResponse) return params

  try {
    const total = await prisma.hospitalDeviceEvent.count({ where: buildEventsWhere(params) })
    if (total > EVENTS_EXPORT_MAX) {
      return badRequest(`필터를 좁혀 ${EVENTS_EXPORT_MAX.toLocaleString()}행 이하로 내보내세요 (현재 ${total.toLocaleString()}행)`)
    }
    const [{ data }, hospitalName] = await Promise.all([
      listEvents(params, { page: 1, limit: EVENTS_EXPORT_MAX, maxLimit: EVENTS_EXPORT_MAX }),
      hospitalDisplayName(params.hospital),
    ])
    const rows = data.map(toRow)
    const filterLabel = params.type ? `이력_${DEVICE_EVENT_TYPE_LABELS[params.type as DeviceEventType] ?? params.type}` : '이력'
    return xlsxResponse(rows, '이벤트 이력', registryFileName(hospitalName, filterLabel), [11, 8, 13, 20, 12, 16, 12, 30, 14, 22, 24, 6, 10, 20, 20, 7, 38, 8])
  } catch (e) {
    return readErrorResponse(e, 'events/export')
  }
}
