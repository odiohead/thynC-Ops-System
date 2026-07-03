import { prisma } from './prisma'
import { logAudit, type AuditActor } from './audit'
import { recomputeHospitalStatus } from './hospitalStatus'

/**
 * 업무(프로젝트/답사/설치계획/유지보수)를 다른 병원으로 재지정(매핑 정정)한다.
 *
 * 사람이 등록 시 병원을 헷갈려 잘못 매핑한 경우를 바로잡기 위한 기능.
 * 한 트랜잭션으로 업무의 hospital_code + Task 미러를 갱신하고,
 * 이후 옛 병원은 완전 재계산(과진행 상태 하향), 새 병원은 전진 적용한다.
 */

export type WorkItemType = 'PROJECT' | 'SITE_VISIT' | 'INSTALL_PLAN' | 'MAINTENANCE'

const TYPE_META: Record<
  WorkItemType,
  { auditResource: string; label: string }
> = {
  PROJECT: { auditResource: 'project', label: '프로젝트' },
  SITE_VISIT: { auditResource: 'site_visit', label: '답사' },
  INSTALL_PLAN: { auditResource: 'install_plan', label: '설치계획' },
  MAINTENANCE: { auditResource: 'maintenance', label: '유지보수' },
}

export interface ReassignParams {
  type: WorkItemType
  /** 업무 고유 코드 (projectCode / siteVisitCode / planCode / maintenanceCode = Task.refCode) */
  code: string
  newHospitalCode: string
  /** 프로젝트 전용: 이름에 포함된 옛 병원명을 새 병원명으로 교체 */
  updateProjectName?: boolean
  req?: Request | null
  actor?: AuditActor | null
}

export interface ReassignResult {
  ok: boolean
  status: number
  error?: string
  oldHospitalCode?: string | null
  newHospitalCode?: string
  newProjectName?: string
}

/** 업무 코드로 현재 상태(병원코드/제목)를 조회 */
async function loadItem(
  type: WorkItemType,
  code: string,
): Promise<{ hospitalCode: string | null; title: string | null } | null> {
  switch (type) {
    case 'PROJECT': {
      const p = await prisma.project.findUnique({
        where: { projectCode: code },
        select: { hospitalCode: true, projectName: true },
      })
      return p ? { hospitalCode: p.hospitalCode, title: p.projectName } : null
    }
    case 'SITE_VISIT': {
      const s = await prisma.siteVisit.findUnique({
        where: { siteVisitCode: code },
        select: { hospitalCode: true },
      })
      return s ? { hospitalCode: s.hospitalCode, title: null } : null
    }
    case 'INSTALL_PLAN': {
      const i = await prisma.installPlan.findUnique({
        where: { planCode: code },
        select: { hospitalCode: true },
      })
      return i ? { hospitalCode: i.hospitalCode, title: null } : null
    }
    case 'MAINTENANCE': {
      const m = await prisma.maintenance.findUnique({
        where: { maintenanceCode: code },
        select: { hospitalCode: true, title: true },
      })
      return m ? { hospitalCode: m.hospitalCode, title: m.title } : null
    }
  }
}

export async function reassignWorkItemHospital(params: ReassignParams): Promise<ReassignResult> {
  const { type, code, newHospitalCode, updateProjectName, req, actor } = params
  const meta = TYPE_META[type]

  const item = await loadItem(type, code)
  if (!item) return { ok: false, status: 404, error: `${meta.label}을(를) 찾을 수 없습니다.` }

  const oldHospitalCode = item.hospitalCode
  if (oldHospitalCode === newHospitalCode) {
    return { ok: false, status: 400, error: '현재와 동일한 병원입니다.' }
  }

  const [newHospital, oldHospital] = await Promise.all([
    prisma.hospital.findUnique({
      where: { hospitalCode: newHospitalCode },
      select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true },
    }),
    oldHospitalCode
      ? prisma.hospital.findUnique({
          where: { hospitalCode: oldHospitalCode },
          select: { hospitalName: true, hiraHospitalName: true },
        })
      : Promise.resolve(null),
  ])
  if (!newHospital) return { ok: false, status: 404, error: '대상 병원을 찾을 수 없습니다.' }

  const newHospitalName = newHospital.hospitalName || newHospital.hiraHospitalName || newHospitalCode

  // 프로젝트명 교체: 이름에 옛 병원명이 들어 있으면 새 병원명으로 치환
  let newProjectName: string | undefined
  if (type === 'PROJECT' && updateProjectName && item.title) {
    const oldNames = [oldHospital?.hospitalName, oldHospital?.hiraHospitalName].filter(
      (n): n is string => !!n,
    )
    let renamed = item.title
    for (const on of oldNames) {
      if (renamed.includes(on)) {
        renamed = renamed.split(on).join(newHospitalName)
        break
      }
    }
    if (renamed !== item.title) newProjectName = renamed
  }

  // 트랜잭션: 업무 hospital_code(+프로젝트명) + Task 미러 동기화
  try {
    await prisma.$transaction(async (tx) => {
      switch (type) {
        case 'PROJECT':
          await tx.project.update({
            where: { projectCode: code },
            data: {
              hospitalCode: newHospitalCode,
              ...(newProjectName !== undefined && { projectName: newProjectName }),
            },
          })
          break
        case 'SITE_VISIT':
          await tx.siteVisit.update({
            where: { siteVisitCode: code },
            data: { hospitalCode: newHospitalCode },
          })
          break
        case 'INSTALL_PLAN':
          await tx.installPlan.update({
            where: { planCode: code },
            data: { hospitalCode: newHospitalCode },
          })
          break
        case 'MAINTENANCE':
          await tx.maintenance.update({
            where: { maintenanceCode: code },
            data: { hospitalCode: newHospitalCode },
          })
          break
      }
      await tx.task.updateMany({
        where: { refCode: code, taskType: type },
        data: {
          hospitalCode: newHospitalCode,
          ...(newProjectName !== undefined && { title: newProjectName }),
        },
      })
    })
  } catch (err) {
    console.error('[reassign] transaction failed:', err)
    return { ok: false, status: 500, error: '재지정 처리 중 오류가 발생했습니다.' }
  }

  // 병원 상태 재계산 (트랜잭션 밖, best-effort) — 옛 병원 완전 재계산, 새 병원 전진
  await recomputeHospitalStatus({
    hospitalCode: oldHospitalCode,
    advanceOnly: false,
    req,
    actor,
    source: `${meta.label} 재지정`,
  })
  await recomputeHospitalStatus({
    hospitalCode: newHospitalCode,
    advanceOnly: true,
    req,
    actor,
    source: `${meta.label} 재지정`,
  })

  // 재지정 감사로그
  await logAudit({
    req: req ?? null,
    actor: actor ?? null,
    action: 'UPDATE',
    resource: meta.auditResource,
    resourceId: code,
    resourceLabel: `${newProjectName ?? item.title ?? code} (병원 재지정)`,
    before: { hospitalCode: oldHospitalCode, ...(newProjectName !== undefined && { name: item.title }) },
    after: {
      hospitalCode: newHospitalCode,
      ...(newProjectName !== undefined && { name: newProjectName }),
      reassigned: true,
    },
  })

  return {
    ok: true,
    status: 200,
    oldHospitalCode,
    newHospitalCode,
    newProjectName,
  }
}

// ──────────────────────────────────────────────────────────
// Phase 2: 병원 업무 일괄 이전 (한 병원의 모든 업무를 다른 병원으로)
// ──────────────────────────────────────────────────────────
export interface TransferAllParams {
  fromHospitalCode: string
  toHospitalCode: string
  /** 프로젝트명에 포함된 옛 병원명을 새 병원명으로 일괄 교체 */
  updateProjectNames?: boolean
  req?: Request | null
  actor?: AuditActor | null
}

export interface TransferAllResult {
  ok: boolean
  status: number
  error?: string
  moved?: { projects: number; siteVisits: number; installPlans: number; maintenances: number; consultations: number }
}

export async function transferAllWorkItems(params: TransferAllParams): Promise<TransferAllResult> {
  const { fromHospitalCode, toHospitalCode, updateProjectNames, req, actor } = params
  if (fromHospitalCode === toHospitalCode) {
    return { ok: false, status: 400, error: '같은 병원입니다.' }
  }

  const [fromH, toH] = await Promise.all([
    prisma.hospital.findUnique({
      where: { hospitalCode: fromHospitalCode },
      select: { hospitalName: true, hiraHospitalName: true },
    }),
    prisma.hospital.findUnique({
      where: { hospitalCode: toHospitalCode },
      select: { hospitalName: true, hiraHospitalName: true },
    }),
  ])
  if (!fromH) return { ok: false, status: 404, error: '원본 병원을 찾을 수 없습니다.' }
  if (!toH) return { ok: false, status: 404, error: '대상 병원을 찾을 수 없습니다.' }
  const toName = toH.hospitalName || toH.hiraHospitalName || toHospitalCode
  const oldNames = [fromH.hospitalName, fromH.hiraHospitalName].filter((n): n is string => !!n)

  const moved = { projects: 0, siteVisits: 0, installPlans: 0, maintenances: 0, consultations: 0 }

  try {
    await prisma.$transaction(async (tx) => {
      // 프로젝트명 교체가 필요하면 개별 처리, 아니면 일괄
      if (updateProjectNames) {
        const projects = await tx.project.findMany({
          where: { hospitalCode: fromHospitalCode },
          select: { projectCode: true, projectName: true },
        })
        for (const p of projects) {
          let renamed = p.projectName
          for (const on of oldNames) {
            if (renamed.includes(on)) {
              renamed = renamed.split(on).join(toName)
              break
            }
          }
          await tx.project.update({
            where: { projectCode: p.projectCode },
            data: { hospitalCode: toHospitalCode, projectName: renamed },
          })
          if (renamed !== p.projectName) {
            await tx.task.updateMany({
              where: { refCode: p.projectCode, taskType: 'PROJECT' },
              data: { hospitalCode: toHospitalCode, title: renamed },
            })
          } else {
            await tx.task.updateMany({
              where: { refCode: p.projectCode, taskType: 'PROJECT' },
              data: { hospitalCode: toHospitalCode },
            })
          }
        }
        moved.projects = projects.length
      } else {
        moved.projects = (
          await tx.project.updateMany({
            where: { hospitalCode: fromHospitalCode },
            data: { hospitalCode: toHospitalCode },
          })
        ).count
      }

      moved.siteVisits = (
        await tx.siteVisit.updateMany({
          where: { hospitalCode: fromHospitalCode },
          data: { hospitalCode: toHospitalCode },
        })
      ).count
      moved.installPlans = (
        await tx.installPlan.updateMany({
          where: { hospitalCode: fromHospitalCode },
          data: { hospitalCode: toHospitalCode },
        })
      ).count
      moved.maintenances = (
        await tx.maintenance.updateMany({
          where: { hospitalCode: fromHospitalCode },
          data: { hospitalCode: toHospitalCode },
        })
      ).count
      moved.consultations = (
        await tx.consultationQueue.updateMany({
          where: { hospitalCode: fromHospitalCode },
          data: { hospitalCode: toHospitalCode },
        })
      ).count

      // Task 미러 일괄 이전 (프로젝트 미변경분 + 나머지 유형 전부)
      await tx.task.updateMany({
        where: { hospitalCode: fromHospitalCode },
        data: { hospitalCode: toHospitalCode },
      })
    })
  } catch (err) {
    console.error('[reassign] transferAll transaction failed:', err)
    return { ok: false, status: 500, error: '일괄 이전 처리 중 오류가 발생했습니다.' }
  }

  await recomputeHospitalStatus({ hospitalCode: fromHospitalCode, advanceOnly: false, req, actor, source: '일괄 이전(원본)' })
  await recomputeHospitalStatus({ hospitalCode: toHospitalCode, advanceOnly: true, req, actor, source: '일괄 이전(대상)' })

  await logAudit({
    req: req ?? null,
    actor: actor ?? null,
    action: 'UPDATE',
    resource: 'hospital',
    resourceId: fromHospitalCode,
    resourceLabel: `${fromH.hospitalName || fromHospitalCode} → ${toName} (업무 일괄 이전)`,
    before: { hospitalCode: fromHospitalCode },
    after: { transferredTo: toHospitalCode, moved },
  })

  return { ok: true, status: 200, moved }
}
