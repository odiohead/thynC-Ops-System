/**
 * AS접수 라인 조회 공용 (서버) — 상세 include·라인 정형화(2026-09-17 유닛 형상 체인)와 수리대기 큐 where (2026-09-28, as_repair_queue_design.md §3·§5)
 * route.ts는 HTTP 메서드 외 export가 막혀 있어(Next 14) 상세 라우트에서 이곳으로 옮겼다. 복제 금지 — 상세·큐가 같은 select를 쓴다.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { AsQueueBucket, AsDeviceGroupCode } from '@/lib/asReceiptShared'

export const asDetailItemSelect = {
  id: true, serialNo: true, deviceId: true, newDeviceId: true, deviceKind: true, wardName: true,
  symptom: true, processNote: true, outcome: true, newSerialNo: true, draftOutcome: true, draftNewSerialNo: true, // 초안 (2026-09-14)
  shipMethod: true, shipTrackingNo: true, shippedAt: true,
  intakeState: true, receivedAt: true, receiptSerialNo: true, intakeSource: true, // 입고 대조 (2026-09-11)
  repairedAt: true, repairedBy: { select: { id: true, name: true } }, // 수리완료 체크 (2026-09-17 — 제3축)
  device: {
    select: {
      id: true,
      condition: true, locationHospitalCode: true, locationSite: { select: { value: true } }, locationHospital: { select: { hospitalName: true } }, // 기기 상태·위치 축 (2026-09-17) → 응답 `device.unit`으로 정형화
      deviceInfo: { select: { deviceName: true } },
      placement: { select: { status: true, hospitalCode: true, asStartedOn: true, asRefCode: true, ward: { select: { name: true } } } },
    },
  },
  newDevice: { select: { id: true, serialNo: true } },
} satisfies Prisma.AsReceiptItemSelect

export const asDetailInclude = {
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  status: { select: { id: true, name: true, color: true, ticketStatus: true } },
  createdBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, ticketCode: true, status: true, owner: { select: { id: true, name: true } } } },
  items: { select: asDetailItemSelect, orderBy: { id: 'asc' as const } },
} as const

export type AsDetailReceipt = NonNullable<Prisma.Result<typeof prisma.asReceipt, { include: typeof asDetailInclude }, 'findUnique'>>
export type AsDetailItem = Prisma.Result<typeof prisma.asReceiptItem, { select: typeof asDetailItemSelect }, 'findFirstOrThrow'>

/**
 * 라인 정형화 (2026-09-17) — `device.unit { condition, locationSiteValue, locationHospitalCode, locationHospitalName }`(설계 §7.1 계약 + 병원명 표시용).
 * 유닛 형상 체인(§5.1)에 맞춰 select에서 빠지면 UI가 조용히 '미확인'으로 보이므로 이 한 곳에서 조립한다.
 */
export function shapeAsDetailItems<T extends AsDetailItem>(items: T[]) {
  return items.map((i) => ({
    ...i,
    device: i.device
      ? { ...i.device, unit: { condition: i.device.condition, locationSiteValue: i.device.locationSite?.value ?? null, locationHospitalCode: i.device.locationHospitalCode, locationHospitalName: i.device.locationHospital?.hospitalName ?? null } }
      : i.device,
  }))
}

/**
 * 기기군 where (목록 ?group= 필터와 동일 규칙 — 원장 모델명 → 미등록 기기종류 → 시리얼 접두 A 심전계 / P 산소포화도).
 * ETC는 두 군 어디에도 안 잡히는 라인. 클라이언트 `asDeviceGroupOf`와 같은 판정이어야 한다(건수 대조 검증 항목).
 */
export function asDeviceGroupWhere(group: AsDeviceGroupCode): Prisma.AsReceiptItemWhereInput {
  const of = (nameKey: string, prefix: string): Prisma.AsReceiptItemWhereInput => ({
    OR: [
      { device: { deviceInfo: { deviceName: { contains: nameKey } } } },
      { deviceId: null, deviceKind: { contains: nameKey } },
      { deviceId: null, deviceKind: null, serialNo: { startsWith: prefix } },
    ],
  })
  if (group === 'ECG') return of('심전', 'A')
  if (group === 'SPO2') return of('산소', 'P')
  return { NOT: [of('심전', 'A'), of('산소', 'P')] }
}

/** 접수 헤더 미종결 (상태 없음 포함 — summary·overdue2w와 동일 정의) */
const OPEN_RECEIPT: Prisma.AsReceiptWhereInput = {
  OR: [{ statusId: null }, { status: { ticketStatus: null } }, { status: { ticketStatus: { notIn: ['RESOLVED', 'CLOSED'] } } }],
}

/** 수리대기 큐 버킷 where (설계 §3.1·§3.2) */
export function asQueueBucketWhere(bucket: AsQueueBucket): Prisma.AsReceiptItemWhereInput {
  if (bucket === 'WAITING') {
    // 정상입고 ∧ 수리완료 미체크 ∧ 결과 없음 또는 교체(선교체 구기기 — 사후 입고). 수리반환 확정은 이미 병원으로 돌아간 기기라 제외. 접수 종결 무관(A-2)
    return { intakeState: 'RECEIVED', repairedAt: null, OR: [{ outcome: null }, { outcome: 'REPLACE' }] }
  }
  // 입고 대기·미입고 ∧ 결과 없음 ∧ 접수 미종결 ∧ 회수할 기기가 있는 접수(분실·수거없음 제외)
  return {
    intakeState: { in: ['PENDING', 'MISMATCH'] },
    outcome: null,
    receipt: { AND: [OPEN_RECEIPT, { category: { not: 'LOST' } }, { OR: [{ pickupMethod: null }, { pickupMethod: { not: 'NONE' } }] }] },
  }
}

/** 버킷별 정렬 — 수리 대기: 우선수리 태그 먼저 → 입고 오래된 순 / 입고 예정: 접수일 오래된 순 */
export function asQueueOrderBy(bucket: AsQueueBucket): Prisma.AsReceiptItemOrderByWithRelationInput[] {
  return bucket === 'WAITING'
    ? [{ receipt: { priorityRepair: 'desc' } }, { receivedAt: 'asc' }, { id: 'asc' }]
    : [{ receipt: { receiptDate: 'asc' } }, { id: 'asc' }]
}
