/**
 * 사용량 — 에이전트 관리 (projects/usage_agent_enroll_design.md)
 *
 * 수집 병원 등록과 병원별 서버의 수집 상태. 읽기는 원본 DB(조회 전용)와 본체 DB 에서 하고,
 * 바꾸는 일(병원 등록·서버 대수·차단·재등록 허용)은 수신부의 관리 호출(/internal/v1/*)로 한다 —
 * 원본 DB 에 쓰는 것은 수신부뿐이다(CLAUDE.md 규칙 9). 관리 호출은 같은 서버의 수신부로 직접 가며,
 * 원본 DB 에 있는 값(agent_admin_secret)을 함께 낸다.
 *
 * 수집 중인 서버 = 차단되지 않았고 최근 AGENT_COLLECTING_HOURS 시간 안에 수신에 성공한 서버.
 * 병원 상태
 *   collecting  수집 서버 수 ≥ 등록한 서버 대수
 *   partial     일부 서버만 수집 (0 < 수집 서버 수 < 서버 대수)
 *   stopped     수신 끊김 — 받은 적이 있는데 지금 수집 중인 서버가 없음
 *   waiting     설치 대기 — 서버가 아직 없거나, 등록만 하고 한 번도 받지 못함
 */
import { prisma } from '@/lib/prisma'
import { usagePool } from './db'

export const AGENT_COLLECTING_HOURS = 24
/** '운영 중인 병원' = 병원 상태(hospitals.status)가 이 값인 병원 */
export const OPERATING_HOSPITAL_STATUS = '운영'
export const AGENT_INSTALL_PATH = '/api/usage-ingest/agent/install.sh'

export type AgentHospitalState = 'collecting' | 'partial' | 'stopped' | 'waiting'

export type AgentServer = {
  id: number
  serverId: string
  hostname: string | null
  agentVersion: string | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  lastSuccessAt: string | null
  /** key = 등록 때 받은 서버 키, token = 사람이 발급한 병원 토큰 */
  auth: 'key' | 'token'
  enrolledAt: string | null
  enrollIp: string | null
  blocked: boolean
  reenrollAllowed: boolean
  collecting: boolean
  lastRun: { status: string; startedAt: string; error: string | null } | null
}

export type AgentHospital = {
  hospitalCode: string
  hospitalName: string
  /** 본체의 병원 상태 (병원 목록에 없는 코드면 null) */
  hospitalStatus: string | null
  /** 등록한 서버 대수. 등록 없이 병원 토큰으로만 수집 중이면 null */
  expectedServers: number | null
  note: string | null
  /** 차단되지 않은 등록 서버 수 · 그중 수집 중인 서버 수 */
  registeredServers: number
  collectingServers: number
  state: AgentHospitalState
  servers: AgentServer[]
  createdAt: string | null
  createdBy: string | null
}

export type AgentSummary = {
  /** 운영 중인 병원 수 · 그중 수집 중(일부 수집 포함)인 병원 수 */
  operating: number
  operatingCollecting: number
  /** 운영 상태가 아닌데 수집 중인 병원 수 */
  otherCollecting: number
  registered: number
  collecting: number
  partial: number
  stopped: number
  waiting: number
}

export type AgentOverview = {
  summary: AgentSummary
  hospitals: AgentHospital[]
  /** 수신부가 내려주는 설치 묶음 (서버에 없으면 null) */
  package: { version: string; file: string } | null
  collectingHours: number
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

/**
 * 병원 상태 판정 (순수 함수)
 * @param everReceived 이 병원의 서버 중 한 대라도 수신에 성공한 적이 있는가
 */
export function agentHospitalState(expected: number | null, registered: number, collecting: number, everReceived: boolean): AgentHospitalState {
  if (collecting === 0) return registered > 0 && everReceived ? 'stopped' : 'waiting'
  return collecting >= (expected ?? registered) ? 'collecting' : 'partial'
}

export async function getAgentOverview(nowMs: number = Date.now()): Promise<AgentOverview> {
  const pool = usagePool()
  const [enrollments, servers, operating, pkg] = await Promise.all([
    pool.query(`SELECT hospital_code, hospital_name, expected_servers, note, created_by, created_at FROM agent_enrollments`),
    pool.query(
      `SELECT s.id, s.hospital_code, s.server_id, s.hostname, s.agent_version, s.first_seen_at, s.last_seen_at, s.last_success_at,
              (s.key_hash IS NOT NULL) AS has_key, s.enrolled_at, s.enroll_ip, s.blocked_at, s.reenroll_allowed_at,
              r.status AS run_status, r.started_at AS run_started_at, r.error AS run_error
         FROM agent_servers s
         LEFT JOIN LATERAL (SELECT status, started_at, error FROM agent_runs WHERE server = s.id ORDER BY id DESC LIMIT 1) r ON true
        ORDER BY s.hospital_code, s.id`,
    ),
    prisma.hospital.count({ where: { status: OPERATING_HOSPITAL_STATUS } }),
    fetchLatestPackage(),
  ])

  const codes = Array.from(new Set([...enrollments.rows.map((r) => r.hospital_code as string), ...servers.rows.map((r) => r.hospital_code as string)]))
  const rows = await prisma.hospital.findMany({ where: { hospitalCode: { in: codes } }, select: { hospitalCode: true, hospitalName: true, status: true } })
  const main = new Map(rows.map((r) => [r.hospitalCode, r]))

  const serversOf = new Map<string, AgentServer[]>()
  for (const r of servers.rows) {
    const last = r.last_success_at ? new Date(r.last_success_at).getTime() : null
    const blocked = !!r.blocked_at
    const list = serversOf.get(r.hospital_code) ?? []
    list.push({
      id: Number(r.id),
      serverId: r.server_id,
      hostname: r.hostname,
      agentVersion: r.agent_version,
      firstSeenAt: iso(r.first_seen_at),
      lastSeenAt: iso(r.last_seen_at),
      lastSuccessAt: iso(r.last_success_at),
      auth: r.has_key ? 'key' : 'token',
      enrolledAt: iso(r.enrolled_at),
      enrollIp: r.enroll_ip,
      blocked,
      reenrollAllowed: !!r.reenroll_allowed_at,
      collecting: !blocked && last !== null && nowMs - last <= AGENT_COLLECTING_HOURS * 3600 * 1000,
      lastRun: r.run_status ? { status: r.run_status, startedAt: iso(r.run_started_at)!, error: r.run_error } : null,
    })
    serversOf.set(r.hospital_code, list)
  }
  const enrollmentOf = new Map(enrollments.rows.map((r) => [r.hospital_code as string, r]))

  const hospitals: AgentHospital[] = codes.map((code) => {
    const e = enrollmentOf.get(code)
    const list = serversOf.get(code) ?? []
    const registered = list.filter((s) => !s.blocked).length
    const collecting = list.filter((s) => s.collecting).length
    const expected = e ? Number(e.expected_servers) : null
    return {
      hospitalCode: code,
      hospitalName: main.get(code)?.hospitalName ?? (e?.hospital_name as string | null) ?? code,
      hospitalStatus: main.get(code)?.status ?? null,
      expectedServers: expected,
      note: (e?.note as string | null) ?? null,
      registeredServers: registered,
      collectingServers: collecting,
      state: agentHospitalState(expected, registered, collecting, list.some((s) => !s.blocked && s.lastSuccessAt !== null)),
      servers: list,
      createdAt: e ? iso(e.created_at) : null,
      createdBy: (e?.created_by as string | null) ?? null,
    }
  })
  // 손봐야 할 병원이 위로: 일부 수집 → 수신 끊김 → 설치 대기 → 수집 중, 그 안에서는 이름순
  const order: Record<AgentHospitalState, number> = { partial: 0, stopped: 1, waiting: 2, collecting: 3 }
  hospitals.sort((a, b) => order[a.state] - order[b.state] || a.hospitalName.localeCompare(b.hospitalName, 'ko'))

  // 설치 중 확인 문구에 쓰는 병원명 사본을 본체 값에 맞춘다 (병원명이 바뀌었거나 아직 없는 경우 — 실패해도 조회는 계속)
  for (const e of enrollments.rows) {
    const name = main.get(e.hospital_code)?.hospitalName
    if (name && name !== e.hospital_name) {
      await ingestAdmin('/enrollments', { hospital_code: e.hospital_code, hospital_name: name, by: 'name-sync' }).catch(() => {})
    }
  }

  const active = (h: AgentHospital) => h.state === 'collecting' || h.state === 'partial'
  const isOperating = (h: AgentHospital) => h.hospitalStatus === OPERATING_HOSPITAL_STATUS
  return {
    summary: {
      operating,
      operatingCollecting: hospitals.filter((h) => active(h) && isOperating(h)).length,
      otherCollecting: hospitals.filter((h) => active(h) && !isOperating(h)).length,
      registered: hospitals.length,
      collecting: hospitals.filter((h) => h.state === 'collecting').length,
      partial: hospitals.filter((h) => h.state === 'partial').length,
      stopped: hospitals.filter((h) => h.state === 'stopped').length,
      waiting: hospitals.filter((h) => h.state === 'waiting').length,
    },
    hospitals,
    package: pkg,
    collectingHours: AGENT_COLLECTING_HOURS,
  }
}

/** 등록할 병원 찾기 — 병원 목록(본체)에서 이름·코드로. 이미 등록한 병원은 뺀다. 운영 중인 병원이 먼저 */
export async function searchHospitalsToEnroll(q: string): Promise<{ hospitalCode: string; hospitalName: string; status: string }[]> {
  const enrolled = (await usagePool().query(`SELECT hospital_code FROM agent_enrollments`)).rows.map((r) => r.hospital_code as string)
  const text = q.trim()
  const base = { hospitalCode: { notIn: enrolled } }
  const search = text ? { OR: [{ hospitalName: { contains: text, mode: 'insensitive' as const } }, { hospitalCode: { contains: text, mode: 'insensitive' as const } }] } : {}
  const select = { hospitalCode: true, hospitalName: true, status: true }
  const operating = await prisma.hospital.findMany({ where: { ...base, ...search, status: OPERATING_HOSPITAL_STATUS }, select, orderBy: { hospitalName: 'asc' }, take: 20 })
  if (!text || operating.length >= 20) return operating
  // 검색어가 있으면 운영 중이 아닌 병원도 뒤에 보여 준다 (도입 전 시범 설치 등)
  const others = await prisma.hospital.findMany({
    where: { ...base, ...search, status: { not: OPERATING_HOSPITAL_STATUS } },
    select,
    orderBy: { hospitalName: 'asc' },
    take: 20 - operating.length,
  })
  return [...operating, ...others]
}

// ── 수신부 관리 호출 ────────────────────────────────────────────────────

export class AgentAdminError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function ingestBase(): string {
  return (process.env.USAGE_INGEST_URL ?? `http://127.0.0.1:${process.env.USAGE_INGEST_PORT ?? 3110}`).replace(/\/+$/, '')
}

/** 수신부의 관리 호출 — 거부되면 AgentAdminError(수신부가 준 메시지) */
export async function ingestAdmin(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const secret = (await usagePool().query(`SELECT secret FROM agent_admin_secret LIMIT 1`)).rows[0]?.secret as string | undefined
  if (!secret) throw new AgentAdminError(503, '수신부 관리 값이 없습니다 — 원본 DB 스키마(0002_enrollment)를 적용했는지 확인하세요')
  let res: Response
  try {
    res = await fetch(`${ingestBase()}/internal/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-usage-admin': secret },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new AgentAdminError(503, '사용량 수신부에 연결할 수 없습니다 — 수신부 프로세스(thync-usage-ingest)가 떠 있는지 확인하세요')
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    // 404 는 수신부가 관리 호출을 모르는 것(구버전)이거나 값이 맞지 않는 것
    const fallback = res.status === 404 ? '수신부가 관리 호출을 받지 않습니다 — 수신부를 새 버전으로 다시 시작했는지 확인하세요' : '수신부가 요청을 거부했습니다'
    throw new AgentAdminError(res.status === 404 ? 502 : res.status, typeof data.error === 'string' && res.status !== 404 ? data.error : fallback)
  }
  return data
}

async function fetchLatestPackage(): Promise<{ version: string; file: string } | null> {
  try {
    const res = await fetch(`${ingestBase()}/api/usage-ingest/agent/latest`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const d = (await res.json()) as { version?: string; file?: string }
    return d.version && d.file ? { version: d.version, file: d.file } : null
  } catch {
    return null
  }
}
