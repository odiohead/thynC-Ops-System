import { prisma } from './prisma'
import { logAudit, type AuditActor } from './audit'

export type HospitalStatusName =
  | '미계약'
  | '가견적요청'
  | '답사요청'
  | '계약완료'
  | '운영'
  | '해지'

/**
 * 병원 상태 진행 단계 — 큰 값일수록 후행 단계.
 * 단방향 규칙: 항상 현재 단계보다 앞 단계(큰 rank)로만 이동, 뒤로 가는 변경은 무시한다.
 */
export const HOSPITAL_STATUS_RANK: Record<string, number> = {
  '미계약': 1,
  '가견적요청': 2,
  '답사요청': 3,
  '계약완료': 4,
  '운영': 5,
  '해지': 6,
}

export interface AdvanceHospitalStatusInput {
  hospitalCode: string | null | undefined
  targetStatus: HospitalStatusName
  /** 입력 시 Hospital.contractDate가 비어 있을 때만 채운다(추가도입 시 기존 계약일 보존). */
  newContractDate?: Date | null
  req?: Request | null
  actor?: AuditActor | null
  /** 트리거 출처(설치계획·답사·프로젝트 등) — 감사로그 라벨에 사용 */
  source?: string
}

/**
 * 업무 등록·상태 변경에 따라 병원의 thynC 현황 상태를 단방향으로 진행시킨다.
 * - 현재 status의 rank보다 targetStatus의 rank가 크지 않으면 변경하지 않음(후퇴 무시).
 * - newContractDate가 주어졌고 Hospital.contractDate가 NULL이면 함께 갱신(이미 있으면 보존).
 * - 변경이 발생한 경우에만 AuditLog UPDATE를 기록.
 * - 모든 실패는 try-catch로 흡수해 본 작업을 차단하지 않는다.
 */
export async function advanceHospitalStatus(input: AdvanceHospitalStatusInput): Promise<void> {
  const { hospitalCode, targetStatus, newContractDate, req, actor, source } = input
  if (!hospitalCode) return

  try {
    const hospital = await prisma.hospital.findUnique({
      where: { hospitalCode },
      select: {
        hospitalCode: true,
        hospitalName: true,
        hiraHospitalName: true,
        status: true,
        contractDate: true,
      },
    })
    if (!hospital) return

    const currentRank = HOSPITAL_STATUS_RANK[hospital.status] ?? 0
    const targetRank = HOSPITAL_STATUS_RANK[targetStatus] ?? 0

    const shouldUpdateStatus = targetRank > currentRank
    const shouldFillContractDate =
      newContractDate != null && hospital.contractDate == null

    if (!shouldUpdateStatus && !shouldFillContractDate) return

    const data: { status?: string; contractDate?: Date } = {}
    if (shouldUpdateStatus) data.status = targetStatus
    if (shouldFillContractDate) data.contractDate = newContractDate!

    await prisma.hospital.update({
      where: { hospitalCode },
      data,
    })

    const labelName = hospital.hospitalName || hospital.hiraHospitalName || hospitalCode
    await logAudit({
      req: req ?? null,
      actor: actor ?? null,
      action: 'UPDATE',
      resource: 'hospital',
      resourceId: hospitalCode,
      resourceLabel: source ? `${labelName} (자동: ${source})` : labelName,
      before: {
        status: hospital.status,
        contractDate: hospital.contractDate,
      },
      after: {
        status: shouldUpdateStatus ? targetStatus : hospital.status,
        contractDate: shouldFillContractDate ? newContractDate : hospital.contractDate,
      },
    })
  } catch (err) {
    console.error('[hospitalStatus] advanceHospitalStatus failed:', err)
  }
}
