import { prisma } from './prisma'
import { logAudit, type AuditActor } from './audit'

/**
 * 심평원 요양기호 변경 대응 (2026-11-12)
 *
 * 심평원 공공 API의 암호화 요양기호(ykiho)가 바뀌면 같은 병원이 `hira_hospitals`에 새 레코드로 들어온다.
 * 예전에는 '병원 등록 동기화'가 병원 없는 심평원 레코드를 전부 미계약 병원으로 만들어, 운영 중인 병원 옆에
 * 같은 주소의 미계약 병원이 생겼다(HOSP-000026 ↔ HOSP-079746 등 4쌍, 2026-11-12 수동 정리).
 *
 * - 폐기된 키 판정: 목록 동기화가 받은 레코드마다 `last_seen_at`을 찍는다. 전 종별이 성공한 최근 동기화
 *   (`hira_sync_jobs.params.complete`)의 시작 시각보다 이전이면(또는 NULL이면) 더 이상 내려오지 않는 키.
 *   완전한 동기화 이력이 없으면 판정 불가('unknown') — 자동 처리하지 않는다.
 * - 쌍둥이: 시군구·개설일이 같고 주소 또는 전화가 같은, 이미 병원에 연결된 다른 심평원 레코드.
 * - 병원 등록 동기화: 쌍둥이 없음 → 미계약 병원 생성(종전) / 쌍둥이 1건이 폐기된 키이고 새 레코드가 살아 있음 →
 *   병원을 만들지 않고 기존 병원의 연결만 교체(구 레코드는 `superseded_by_id` 표시) / 그 외 → '확인 필요'(사람이 결정) /
 *   새 레코드 자신이 폐기된 키 → 건너뜀.
 */

export type HiraLiveness = 'alive' | 'dead' | 'unknown'

/** 최근 '완전한'(전 종별 성공) 목록 동기화의 시작 시각 — 없으면 null */
export async function latestCompleteBasisSyncAt(): Promise<Date | null> {
  const job = await prisma.hiraSyncJob.findFirst({
    where: { jobType: 'basis', status: 'done', params: { path: ['complete'], equals: true } },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  })
  return job?.startedAt ?? null
}

export function hiraLiveness(lastSeenAt: Date | null, syncAt: Date | null): HiraLiveness {
  if (!syncAt) return 'unknown'
  return lastSeenAt && lastSeenAt >= syncAt ? 'alive' : 'dead'
}

const UNLINKED_SELECT = {
  id: true, hiraId: true, name: true, typeName: true, typeCode: true,
  sidoCode: true, sidoName: true, sigunguCode: true, sigunguName: true, eupmyeondong: true,
  postalCode: true, address: true, coordinateX: true, coordinateY: true,
  phone: true, openedAt: true, lastSeenAt: true,
} as const

type Unlinked = {
  id: number; hiraId: string; name: string; typeName: string; typeCode: string
  sidoCode: string; sidoName: string; sigunguCode: string; sigunguName: string; eupmyeondong: string | null
  postalCode: string | null; address: string | null; coordinateX: string | null; coordinateY: string | null
  phone: string | null; openedAt: string | null; lastSeenAt: Date | null
}

type LinkedTwin = {
  id: number; name: string; sigunguCode: string; openedAt: string | null; address: string | null; phone: string | null
  lastSeenAt: Date | null
  hospital: { hospitalCode: string; hospitalName: string; status: string } | null
}

export type HiraReviewReason = 'TWIN_ALIVE' | 'LIVENESS_UNKNOWN' | 'MULTIPLE'

const REVIEW_REASON_TEXT: Record<HiraReviewReason, string> = {
  TWIN_ALIVE: '기존 병원의 심평원 레코드도 아직 심평원에서 내려옵니다',
  LIVENESS_UNKNOWN: '심평원 목록 동기화 이력이 없어 어느 쪽이 현행인지 알 수 없습니다',
  MULTIPLE: '같은 병원으로 보이는 후보가 여러 건입니다',
}

export interface HiraSyncCandidate {
  hospitalCode: string
  hospitalName: string
  status: string
  hiraName: string
}

export interface HiraSyncReviewRow {
  hiraHospitalId: number
  name: string
  address: string | null
  reason: HiraReviewReason
  reasonText: string
  candidates: HiraSyncCandidate[]
}

export interface HiraSyncRelinkRow {
  hiraHospitalId: number
  name: string
  oldHiraHospitalId: number
  oldName: string
  hospitalCode: string
  hospitalName: string
}

export interface HiraSyncPlan {
  /** 폐기 키 판정 기준 시각 (최근 완전한 목록 동기화 시작) */
  syncAt: Date | null
  create: Unlinked[]
  relink: HiraSyncRelinkRow[]
  review: HiraSyncReviewRow[]
  /** 병원이 없고 심평원에서도 더 이상 내려오지 않는 레코드 수 — 병원을 만들지 않는다 */
  skippedDead: number
}

function isTwin(u: Unlinked, c: LinkedTwin): boolean {
  if (c.id === u.id || !u.openedAt || c.openedAt !== u.openedAt || c.sigunguCode !== u.sigunguCode) return false
  return (!!u.address && c.address === u.address) || (!!u.phone && c.phone === u.phone)
}

/** 병원 등록 동기화 계획 — 읽기 전용 */
export async function planHospitalSyncFromHira(): Promise<HiraSyncPlan> {
  const [syncAt, unlinked] = await Promise.all([
    latestCompleteBasisSyncAt(),
    prisma.hiraHospital.findMany({ where: { hospital: null, supersededById: null }, select: UNLINKED_SELECT, orderBy: { id: 'asc' } }),
  ])
  const plan: HiraSyncPlan = { syncAt, create: [], relink: [], review: [], skippedDead: 0 }
  if (unlinked.length === 0) return plan

  // 쌍둥이 후보 — 개설일이 같은, 병원에 연결된 심평원 레코드를 한꺼번에 읽어 (시군구|개설일)로 묶는다
  const openedDates = Array.from(new Set(unlinked.map((u) => u.openedAt).filter((d): d is string => !!d)))
  const byKey = new Map<string, LinkedTwin[]>()
  for (let i = 0; i < openedDates.length; i += 2000) {
    const rows = await prisma.hiraHospital.findMany({
      where: { openedAt: { in: openedDates.slice(i, i + 2000) }, hospital: { isNot: null } },
      select: {
        id: true, name: true, sigunguCode: true, openedAt: true, address: true, phone: true, lastSeenAt: true,
        hospital: { select: { hospitalCode: true, hospitalName: true, status: true } },
      },
    })
    for (const r of rows) {
      const k = `${r.sigunguCode}|${r.openedAt}`
      const arr = byKey.get(k)
      if (arr) arr.push(r)
      else byKey.set(k, [r])
    }
  }

  const relinkedHospitals = new Set<string>()
  for (const u of unlinked) {
    const uLive = hiraLiveness(u.lastSeenAt, syncAt)
    if (uLive === 'dead') { plan.skippedDead += 1; continue }
    const twins = (byKey.get(`${u.sigunguCode}|${u.openedAt}`) ?? []).filter((c) => c.hospital && isTwin(u, c))
    if (twins.length === 0) { plan.create.push(u); continue }

    const only = twins.length === 1 ? twins[0] : null
    const twinLive = only ? hiraLiveness(only.lastSeenAt, syncAt) : 'unknown'
    if (only && uLive === 'alive' && twinLive === 'dead' && !relinkedHospitals.has(only.hospital!.hospitalCode)) {
      relinkedHospitals.add(only.hospital!.hospitalCode)
      plan.relink.push({
        hiraHospitalId: u.id, name: u.name, oldHiraHospitalId: only.id, oldName: only.name,
        hospitalCode: only.hospital!.hospitalCode, hospitalName: only.hospital!.hospitalName,
      })
      continue
    }
    const reason: HiraReviewReason = !only || relinkedHospitals.has(only.hospital!.hospitalCode)
      ? 'MULTIPLE'
      : syncAt === null ? 'LIVENESS_UNKNOWN' : 'TWIN_ALIVE'
    plan.review.push({
      hiraHospitalId: u.id, name: u.name, address: u.address, reason, reasonText: REVIEW_REASON_TEXT[reason],
      candidates: twins.map((c) => ({
        hospitalCode: c.hospital!.hospitalCode, hospitalName: c.hospital!.hospitalName, status: c.hospital!.status, hiraName: c.name,
      })),
    })
  }
  return plan
}

interface ActorCtx { req?: Request | null; actor?: AuditActor | null }

async function nextHospitalCodeNumber(): Promise<number> {
  const allCodes = await prisma.hospital.findMany({ where: { hospitalCode: { startsWith: 'HOSP-' } }, select: { hospitalCode: true } })
  return allCodes.reduce((max, h) => {
    const m = h.hospitalCode.match(/^HOSP-(\d+)$/)
    return m ? Math.max(max, parseInt(m[1])) : max
  }, 0)
}

async function createHospitalFromHira(u: Unlinked, num: number): Promise<string> {
  const hospitalCode = `HOSP-${String(num).padStart(6, '0')}`
  await prisma.hospital.create({
    data: {
      hospitalCode,
      hiraId: u.hiraId,
      hiraHospitalName: u.name,
      hospitalName: u.name,
      type: u.typeName ?? u.typeCode ?? '',
      sidoCode: u.sidoCode ?? null,
      sidoName: u.sidoName ?? null,
      sigunguCode: u.sigunguCode ?? null,
      sigunguName: u.sigunguName ?? null,
      eupmyeondong: u.eupmyeondong ?? null,
      postalCode: u.postalCode ?? null,
      address: u.address ?? null,
      coordinateX: u.coordinateX ?? null,
      coordinateY: u.coordinateY ?? null,
      status: '미계약',
    },
  })
  return hospitalCode
}

/**
 * 병원의 심평원 연결을 새 레코드로 교체 — 병원코드·업무 데이터는 그대로, `hira_id`·심평원 명칭만 바뀐다.
 * 종전 레코드는 `superseded_by_id`로 표시해 이후 병원 등록 동기화에서 제외한다.
 */
export async function relinkHospitalToHira(p: { hospitalCode: string; hiraHospitalId: number; source: 'auto' | 'manual' } & ActorCtx): Promise<{ ok: boolean; status: number; error?: string }> {
  const [nw, h] = await Promise.all([
    prisma.hiraHospital.findUnique({ where: { id: p.hiraHospitalId }, select: { id: true, hiraId: true, name: true, hospital: { select: { hospitalCode: true } } } }),
    prisma.hospital.findUnique({ where: { hospitalCode: p.hospitalCode }, select: { hospitalCode: true, hospitalName: true, hiraId: true, hiraHospitalName: true } }),
  ])
  if (!nw) return { ok: false, status: 404, error: '심평원 레코드를 찾을 수 없습니다.' }
  if (!h) return { ok: false, status: 404, error: '병원을 찾을 수 없습니다.' }
  if (nw.hospital) return { ok: false, status: 409, error: `이미 ${nw.hospital.hospitalCode}에 연결된 심평원 레코드입니다.` }
  const old = h.hiraId ? await prisma.hiraHospital.findUnique({ where: { hiraId: h.hiraId }, select: { id: true } }) : null

  await prisma.$transaction(async (tx) => {
    await tx.hospital.update({ where: { hospitalCode: h.hospitalCode }, data: { hiraId: nw.hiraId, hiraHospitalName: nw.name } })
    if (old) await tx.hiraHospital.update({ where: { id: old.id }, data: { supersededById: nw.id } })
  })

  await logAudit({
    req: p.req ?? null,
    actor: p.actor ?? null,
    action: 'UPDATE',
    resource: 'hospital',
    resourceId: h.hospitalCode,
    resourceLabel: `${h.hospitalName} 심평원 연결 교체 (${p.source === 'auto' ? '자동 — 요양기호 변경' : '수동 확인'})`,
    before: { hiraId: h.hiraId, hiraHospitalName: h.hiraHospitalName },
    after: { hiraId: nw.hiraId, hiraHospitalName: nw.name, hiraHospitalId: nw.id, supersededHiraHospitalId: old?.id ?? null },
  })
  return { ok: true, status: 200 }
}

export interface HiraSyncExecuteResult {
  created: number
  relinked: HiraSyncRelinkRow[]
  review: HiraSyncReviewRow[]
  skippedDead: number
  message: string
}

export function hiraSyncSummaryText(r: { created: number; relinked: number; review: number; skippedDead: number }): string {
  const parts = [`신규 등록 ${r.created}건`]
  if (r.relinked > 0) parts.push(`심평원 연결 교체 ${r.relinked}건`)
  if (r.review > 0) parts.push(`확인 필요 ${r.review}건`)
  if (r.skippedDead > 0) parts.push(`폐기된 요양기호 건너뜀 ${r.skippedDead}건`)
  return parts.join(' · ')
}

/** 병원 등록 동기화 실행 — 신규 생성 + 요양기호 변경 자동 재연결. '확인 필요'는 건드리지 않고 돌려준다 */
export async function executeHospitalSyncFromHira(ctx: ActorCtx = {}): Promise<HiraSyncExecuteResult> {
  const plan = await planHospitalSyncFromHira()

  let created = 0
  if (plan.create.length > 0) {
    let num = await nextHospitalCodeNumber()
    for (const u of plan.create) {
      num += 1
      await createHospitalFromHira(u, num)
      created += 1
    }
  }

  const relinked: HiraSyncRelinkRow[] = []
  for (const r of plan.relink) {
    const res = await relinkHospitalToHira({ hospitalCode: r.hospitalCode, hiraHospitalId: r.hiraHospitalId, source: 'auto', ...ctx })
    if (res.ok) relinked.push(r)
    else console.error(`[hira-twin] 자동 재연결 실패 ${r.hospitalCode} ← ${r.hiraHospitalId}: ${res.error}`)
  }

  return {
    created, relinked, review: plan.review, skippedDead: plan.skippedDead,
    message: hiraSyncSummaryText({ created, relinked: relinked.length, review: plan.review.length, skippedDead: plan.skippedDead }),
  }
}

/** '확인 필요' 1건 처리 — relink: 후보 병원에 연결 / create: 다른 병원이므로 새 미계약 병원으로 등록 */
export async function resolveHiraSyncReview(p: { hiraHospitalId: number; action: 'relink' | 'create'; hospitalCode?: string } & ActorCtx): Promise<{ ok: boolean; status: number; error?: string; hospitalCode?: string }> {
  const plan = await planHospitalSyncFromHira()
  const row = plan.review.find((r) => r.hiraHospitalId === p.hiraHospitalId)
  if (!row) return { ok: false, status: 404, error: '확인 필요 목록에 없는 심평원 레코드입니다. 새로고침 후 다시 시도하세요.' }

  if (p.action === 'relink') {
    if (!p.hospitalCode || !row.candidates.some((c) => c.hospitalCode === p.hospitalCode)) {
      return { ok: false, status: 400, error: '후보 병원이 아닙니다.' }
    }
    const res = await relinkHospitalToHira({ hospitalCode: p.hospitalCode, hiraHospitalId: p.hiraHospitalId, source: 'manual', req: p.req, actor: p.actor })
    return res.ok ? { ...res, hospitalCode: p.hospitalCode } : res
  }

  const u = await prisma.hiraHospital.findFirst({ where: { id: p.hiraHospitalId, hospital: null }, select: UNLINKED_SELECT })
  if (!u) return { ok: false, status: 404, error: '심평원 레코드를 찾을 수 없습니다.' }
  const hospitalCode = await createHospitalFromHira(u, (await nextHospitalCodeNumber()) + 1)
  await logAudit({
    req: p.req ?? null,
    actor: p.actor ?? null,
    action: 'CREATE',
    resource: 'hospital',
    resourceId: hospitalCode,
    resourceLabel: `${u.name} (심평원 동기화 확인 필요 → 새 병원으로 등록)`,
    after: { hospitalCode, hiraId: u.hiraId, hospitalName: u.name, status: '미계약', similarTo: row.candidates.map((c) => c.hospitalCode) },
  })
  return { ok: true, status: 200, hospitalCode }
}
