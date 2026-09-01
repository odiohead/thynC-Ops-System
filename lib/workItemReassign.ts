import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { logAudit, type AuditActor } from './audit'
import { recomputeHospitalStatus } from './hospitalStatus'
import {
  syncMaintenanceToTicket,
  syncSiteVisitToTicket,
  syncInstallPlanToTicket,
  syncProjectToTicket,
} from './ticketDomain'

/**
 * 업무(프로젝트/답사/설치계획/유지보수)를 다른 병원으로 재지정(매핑 정정)한다.
 *
 * 사람이 등록 시 병원을 헷갈려 잘못 매핑한 경우를 바로잡기 위한 기능.
 * 한 트랜잭션으로 업무의 hospital_code + 연결 티켓(P13 — 병원·제목 동기화)을 갱신하고,
 * 이후 옛 병원은 완전 재계산(과진행 상태 하향), 새 병원은 전진 적용한다.
 * (P10에서 tasks 롤업 폐기 — Task 미러 갱신 코드는 P13에서 제거)
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
): Promise<{ id: number; hospitalCode: string | null; title: string | null } | null> {
  switch (type) {
    case 'PROJECT': {
      const p = await prisma.project.findUnique({
        where: { projectCode: code },
        select: { id: true, hospitalCode: true, projectName: true },
      })
      return p ? { id: p.id, hospitalCode: p.hospitalCode, title: p.projectName } : null
    }
    case 'SITE_VISIT': {
      const s = await prisma.siteVisit.findUnique({
        where: { siteVisitCode: code },
        select: { id: true, hospitalCode: true },
      })
      return s ? { id: s.id, hospitalCode: s.hospitalCode, title: null } : null
    }
    case 'INSTALL_PLAN': {
      const i = await prisma.installPlan.findUnique({
        where: { planCode: code },
        select: { id: true, hospitalCode: true },
      })
      return i ? { id: i.id, hospitalCode: i.hospitalCode, title: null } : null
    }
    case 'MAINTENANCE': {
      const m = await prisma.maintenance.findUnique({
        where: { maintenanceCode: code },
        select: { id: true, hospitalCode: true, title: true },
      })
      return m ? { id: m.id, hospitalCode: m.hospitalCode, title: m.title } : null
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

  // 트랜잭션: 업무 hospital_code(+프로젝트명) + 연결 티켓 동기화 (P13 — 병원·제목 반영)
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
          await syncProjectToTicket(tx, item.id, null)
          break
        case 'SITE_VISIT':
          await tx.siteVisit.update({
            where: { siteVisitCode: code },
            data: { hospitalCode: newHospitalCode },
          })
          await syncSiteVisitToTicket(tx, item.id, null)
          break
        case 'INSTALL_PLAN':
          await tx.installPlan.update({
            where: { planCode: code },
            data: { hospitalCode: newHospitalCode },
          })
          await syncInstallPlanToTicket(tx, item.id, null)
          break
        case 'MAINTENANCE':
          await tx.maintenance.update({
            where: { maintenanceCode: code },
            data: { hospitalCode: newHospitalCode },
          })
          await syncMaintenanceToTicket(tx, item.id, null)
          break
      }
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

export interface TransferAllMoved {
  projects: number
  siteVisits: number
  installPlans: number
  maintenances: number
  consultations: number
  /** 디바이스 원장(§9.6) — hospital_code 또는 last_hospital_code가 원본이던 개체 수 */
  devices: number
  /** 원본 병원 사건 이벤트 수 */
  deviceEvents: number
  /** 원본 병동 수(대상에 같은 이름이 있어 합쳐진 것 포함) */
  wards: number
  /** 대상 병원 동명 병동으로 합쳐지고 삭제된 원본 병동 수 */
  wardsMerged: number
  /** 이동 시 ext_ward_code 충돌로 값을 비운 병동 수 */
  wardsExtCodeCleared: number
  /** 임포트 배치 수 */
  importBatches: number
}

export interface TransferAllResult {
  ok: boolean
  status: number
  error?: string
  moved?: TransferAllMoved
}

/**
 * 디바이스 원장 일괄 이전(§9.6 ①②) — 호출자의 트랜잭션 안에서 실행.
 *
 * ① 병동: 원본 병동의 name_norm이 대상 병원에 이미 있으면 → 그 병동을 참조하는 devices(ward_id, hospital_code)·
 *    events(from_ward_id, hospital_code)·events(to_ward_id, hospital_code)를 각각 한 문장으로 대상 병동에 재지정한 뒤 원본 병동 delete
 *    ('재지정 → 원본 삭제' — ON DELETE RESTRICT는 지연되지 않으므로 순서 필수).
 *    없으면 병동 행의 hospital_code만 이동 — 복합 FK ON UPDATE CASCADE로 소속 기기·이벤트가 함께 옮겨지는 것은 의도.
 *    ext_ward_code(병원별 부분 UNIQUE)가 대상과 충돌하면 원본 값을 NULL로 비우고 이동.
 * ② 병동 미지정(ward_id NULL) 개체·RECOVERED 개체(last_hospital_code)·병동 참조 없는 이벤트·임포트 배치의 hospital_code updateMany.
 *
 * 병동 id는 전역 PK라 참조 where에 hospital_code 조건을 겹치지 않는다 — 같은 이벤트 행이 from/to 양쪽 병동을 참조할 때
 * 앞선 재지정(또는 캐스케이드)이 hospital_code를 먼저 바꿔도 뒤의 병동 재지정이 그 행을 놓치지 않게 하기 위함.
 */
export async function transferDeviceRegistry(
  tx: Prisma.TransactionClient,
  fromHospitalCode: string,
  toHospitalCode: string,
  moved: TransferAllMoved,
): Promise<void> {
  // 이동 대상 규모는 사전 집계 — 캐스케이드로 옮겨지는 행은 updateMany count에 잡히지 않는다
  const [deviceCount, eventCount, batchCount, srcWards, dstWards] = await Promise.all([
    tx.hospitalDevice.count({
      where: { OR: [{ hospitalCode: fromHospitalCode }, { lastHospitalCode: fromHospitalCode }] },
    }),
    tx.hospitalDeviceEvent.count({ where: { hospitalCode: fromHospitalCode } }),
    tx.hospitalDeviceImportBatch.count({ where: { hospitalCode: fromHospitalCode } }),
    tx.hospitalWard.findMany({
      where: { hospitalCode: fromHospitalCode },
      select: { id: true, name: true, nameNorm: true, extWardCode: true },
      orderBy: { id: 'asc' },
    }),
    tx.hospitalWard.findMany({
      where: { hospitalCode: toHospitalCode },
      select: { id: true, nameNorm: true, extWardCode: true },
    }),
  ])
  moved.devices = deviceCount
  moved.deviceEvents = eventCount
  moved.importBatches = batchCount
  moved.wards = srcWards.length

  if (deviceCount === 0 && eventCount === 0 && batchCount === 0 && srcWards.length === 0) return

  const dstByNorm = new Map(dstWards.map((w) => [w.nameNorm, w.id]))
  const dstExtCodes = new Set(dstWards.map((w) => w.extWardCode).filter((c): c is string => !!c))

  // ① 병동 — 동명 병동은 합치기(재지정 → 원본 삭제)부터 처리하고, 나머지는 hospital_code 이동(캐스케이드)
  const merges = srcWards.filter((w) => dstByNorm.has(w.nameNorm))
  const relocations = srcWards.filter((w) => !dstByNorm.has(w.nameNorm))

  for (const sw of merges) {
    const targetWardId = dstByNorm.get(sw.nameNorm)!
    await tx.hospitalDevice.updateMany({
      where: { wardId: sw.id },
      data: { wardId: targetWardId, hospitalCode: toHospitalCode },
    })
    await tx.hospitalDeviceEvent.updateMany({
      where: { fromWardId: sw.id },
      data: { fromWardId: targetWardId, hospitalCode: toHospitalCode },
    })
    await tx.hospitalDeviceEvent.updateMany({
      where: { toWardId: sw.id },
      data: { toWardId: targetWardId, hospitalCode: toHospitalCode },
    })
    await tx.hospitalWard.delete({ where: { id: sw.id } })
    moved.wardsMerged += 1
  }

  for (const sw of relocations) {
    const extCollides = !!sw.extWardCode && dstExtCodes.has(sw.extWardCode)
    await tx.hospitalWard.update({
      where: { id: sw.id },
      data: { hospitalCode: toHospitalCode, ...(extCollides && { extWardCode: null }) },
    })
    if (extCollides) moved.wardsExtCodeCleared += 1
    else if (sw.extWardCode) dstExtCodes.add(sw.extWardCode)
  }

  // ② 병동을 거치지 않은 나머지 — 이 시점에 원본 병동은 전부 삭제됐거나 대상 병원 소속이므로 hospital_code만 바꿔도 복합 FK가 성립한다
  await tx.hospitalDevice.updateMany({
    where: { hospitalCode: fromHospitalCode },
    data: { hospitalCode: toHospitalCode },
  })
  await tx.hospitalDevice.updateMany({
    where: { lastHospitalCode: fromHospitalCode },
    data: { lastHospitalCode: toHospitalCode },
  })
  await tx.hospitalDeviceEvent.updateMany({
    where: { hospitalCode: fromHospitalCode },
    data: { hospitalCode: toHospitalCode },
  })
  await tx.hospitalDeviceImportBatch.updateMany({
    where: { hospitalCode: fromHospitalCode },
    data: { hospitalCode: toHospitalCode },
  })
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

  const moved: TransferAllMoved = {
    projects: 0,
    siteVisits: 0,
    installPlans: 0,
    maintenances: 0,
    consultations: 0,
    devices: 0,
    deviceEvents: 0,
    wards: 0,
    wardsMerged: 0,
    wardsExtCodeCleared: 0,
    importBatches: 0,
  }

  try {
    // 디바이스 원장(§9.6)까지 한 트랜잭션 — 기본 5s로는 대형 병원 이전이 잘릴 수 있어 여유를 둔다
    await prisma.$transaction(async (tx) => {
      // 프로젝트명 교체가 필요하면 개별 처리, 아니면 일괄
      if (updateProjectNames) {
        const projects = await tx.project.findMany({
          where: { hospitalCode: fromHospitalCode },
          select: { projectCode: true, projectName: true, ticketId: true },
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
          // 연결 티켓 제목 동기화 (병원코드는 아래 일괄 UPDATE에서 처리)
          if (renamed !== p.projectName && p.ticketId) {
            await tx.ticket.update({
              where: { id: p.ticketId },
              data: { title: `[프로젝트] ${renamed}` },
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
      // 상담이력 — 현행 `consultations` + 동결된 구 대기열(consultation_queue) 양쪽 이전
      moved.consultations =
        (
          await tx.consultation.updateMany({
            where: { hospitalCode: fromHospitalCode },
            data: { hospitalCode: toHospitalCode },
          })
        ).count +
        (
          await tx.consultationQueue.updateMany({
            where: { hospitalCode: fromHospitalCode },
            data: { hospitalCode: toHospitalCode },
          })
        ).count

      // 병원명이 제목에 들어가는 유형은 제목 먼저 갱신 (이관 대상=from 병원 티켓만 — 기존 to 병원 티켓 미접촉)
      await tx.ticket.updateMany({
        where: { refType: 'SITE_VISIT', hospitalCode: fromHospitalCode },
        data: { title: `[답사] ${toName}` },
      })
      await tx.ticket.updateMany({
        where: { refType: 'INSTALL_PLAN', hospitalCode: fromHospitalCode },
        data: { title: `[설치계획] ${toName}` },
      })
      // 연결 티켓 일괄 이전 (P13 — 도메인 5종 + 순수 티켓 포함)
      await tx.ticket.updateMany({
        where: { hospitalCode: fromHospitalCode },
        data: { hospitalCode: toHospitalCode },
      })

      // 디바이스 원장 — 병동 합치기/이동 → 개체·이벤트·배치 hospital_code (§9.6 ①②). 딜은 이동하지 않는다(계약 대조 차이는 대상 병원에서 확인)
      await transferDeviceRegistry(tx, fromHospitalCode, toHospitalCode, moved)
    }, { timeout: 60_000, maxWait: 10_000 })
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
