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

export interface RecomputeHospitalStatusInput {
  hospitalCode: string | null | undefined
  /** true면 전진만 적용(현재보다 높을 때만 status 갱신, 계약일은 NULL일 때만 채움).
   *  false(기본)면 실제 업무 기준으로 완전 재계산(하향 포함, 계약일도 재산정). */
  advanceOnly?: boolean
  req?: Request | null
  actor?: AuditActor | null
  source?: string
}

/**
 * 병원의 실제 업무(프로젝트·답사·설치계획)로부터 thynC 현황 상태를 정방향 재계산한다.
 * advanceHospitalStatus(전진 전용)와 달리 하향도 가능 → 업무를 다른 병원으로 재지정한 뒤
 * 원래 병원의 과(過)진행 상태를 바로잡는 데 사용.
 *
 * 판정 규칙(단방향 매핑의 역산):
 *  - 구축완료(라벨에 '완료' 포함) 프로젝트 있음 → 운영
 *  - 계약일 있는 프로젝트 있음 → 계약완료
 *  - 답사 있음 → 답사요청
 *  - 설치계획(가안) 있음 → 가견적요청
 *  - 아무 업무 없음 → 미계약
 *  - 현재 '해지'는 수동 상태라 재계산으로 덮지 않음
 * 계약일은 프로젝트 계약일 중 최솟값(없으면 NULL)으로 재산정.
 */
export async function recomputeHospitalStatus(input: RecomputeHospitalStatusInput): Promise<void> {
  const { hospitalCode, advanceOnly = false, req, actor, source } = input
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
    if (hospital.status === '해지') return // 수동 상태 보존

    const [projects, siteVisitCount, installPlanCount] = await Promise.all([
      prisma.project.findMany({
        where: { hospitalCode },
        select: { contractDate: true, buildStatus: { select: { label: true } } },
      }),
      prisma.siteVisit.count({ where: { hospitalCode } }),
      prisma.installPlan.count({ where: { hospitalCode } }),
    ])

    const hasCompletedBuild = projects.some((p) => (p.buildStatus?.label ?? '').includes('완료'))
    const contractDates = projects
      .map((p) => p.contractDate)
      .filter((d): d is Date => d != null)

    let computed: HospitalStatusName
    if (hasCompletedBuild) computed = '운영'
    else if (contractDates.length > 0) computed = '계약완료'
    else if (siteVisitCount > 0) computed = '답사요청'
    else if (installPlanCount > 0) computed = '가견적요청'
    else computed = '미계약'

    const earliestContract = contractDates.length
      ? contractDates.reduce((a, b) => (a.getTime() < b.getTime() ? a : b))
      : null

    const currentRank = HOSPITAL_STATUS_RANK[hospital.status] ?? 0
    const computedRank = HOSPITAL_STATUS_RANK[computed] ?? 0

    let nextStatus = hospital.status
    let nextContract: Date | null = hospital.contractDate
    if (advanceOnly) {
      if (computedRank > currentRank) nextStatus = computed
      if (earliestContract && hospital.contractDate == null) nextContract = earliestContract
    } else {
      nextStatus = computed
      nextContract = earliestContract
    }

    const statusChanged = nextStatus !== hospital.status
    const contractChanged =
      (nextContract?.getTime() ?? null) !== (hospital.contractDate?.getTime() ?? null)
    if (!statusChanged && !contractChanged) return

    await prisma.hospital.update({
      where: { hospitalCode },
      data: { status: nextStatus, contractDate: nextContract },
    })

    const labelName = hospital.hospitalName || hospital.hiraHospitalName || hospitalCode
    await logAudit({
      req: req ?? null,
      actor: actor ?? null,
      action: 'UPDATE',
      resource: 'hospital',
      resourceId: hospitalCode,
      resourceLabel: `${labelName} (자동재계산${source ? `: ${source}` : ''})`,
      before: { status: hospital.status, contractDate: hospital.contractDate },
      after: { status: nextStatus, contractDate: nextContract },
    })
  } catch (err) {
    console.error('[hospitalStatus] recomputeHospitalStatus failed:', err)
  }
}
