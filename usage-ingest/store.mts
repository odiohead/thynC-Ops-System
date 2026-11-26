/**
 * 원본 DB 저장 — 수신부가 실행하는 SQL 전부.
 * 모든 저장은 고유 키 기준 덮어쓰기(멱등)이고, 원본 행은 지우지 않는다.
 */
import type pg from 'pg'
import { BadRequest, Forbidden, asArray, asObject, bigint, int, reqBigint, reqStr, smallint, str, ts } from './validate.mts'

type Db = pg.PoolClient

export type RunCtx = { runId: number; hospitalCode: string; server: number; reconcile: boolean }

const FULL_DATASETS = ['organizations', 'wards', 'device_registers'] as const
type FullDataset = (typeof FULL_DATASETS)[number]
const FULL_TABLE: Record<FullDataset, string> = {
  organizations: 'raw_organizations',
  wards: 'raw_wards',
  device_registers: 'raw_device_registers',
}

export const MAX_ROWS = 5000
const RESEND_PAGE = 1000

// ── 시작 ────────────────────────────────────────────────────────────────

export type HandshakeInput = {
  serverId: string
  hostname: string | null
  agentVersion: string | null
  dbVersion: string | null
  dbTimeZone: string | null
  dbNow: string
  statusYears: number[]
  full: boolean
  rewindStatusTo: number | null
  dryRun: boolean
}

export function parseHandshake(body: unknown): HandshakeInput {
  const o = asObject(body, 'body')
  const serverId = reqStr(o.server_id, 'server_id', 100).trim()
  if (!/^[\w.:@-]{1,100}$/.test(serverId)) throw new BadRequest('server_id: letters, digits, . _ : @ - only')
  const dbNow = ts(o.db_now, 'db_now')
  if (!dbNow) throw new BadRequest('db_now: required')
  const years = asArray(o.status_years ?? [], 'status_years', 50).map((y) => {
    const n = int(y, 'status_years[]')
    if (n === null || n < 2000 || n > 2100) throw new BadRequest('status_years[]: bad year')
    return n
  })
  const rewind = bigint(o.rewind_status_to, 'rewind_status_to')
  if (rewind !== null && rewind < 0) throw new BadRequest('rewind_status_to: must be >= 0')
  return {
    serverId,
    hostname: str(o.hostname, 'hostname'),
    agentVersion: str(o.agent_version, 'agent_version', 50),
    dbVersion: str(o.db_version, 'db_version', 100),
    dbTimeZone: str(o.db_time_zone, 'db_time_zone', 100),
    dbNow,
    statusYears: Array.from(new Set(years)),
    full: o.full === true,
    rewindStatusTo: rewind,
    dryRun: o.dry_run === true,
  }
}

export async function handshake(
  db: Db,
  hospitalCode: string,
  input: HandshakeInput,
  remoteIp: string | null,
  statusPaused: boolean,
) {
  let server: { id: string; since: string | null; reconciled_recent: boolean; blocked: boolean } | undefined
  if (input.dryRun) {
    // 점검(check)은 아무것도 바꾸지 않는다
    const r = await db.query(
      `SELECT id, to_char(measurements_synced_until - interval '2 days', 'YYYY-MM-DD HH24:MI:SS') AS since,
              (reconciled_at IS NOT NULL AND reconciled_at > now() - interval '23 hours') AS reconciled_recent,
              (blocked_at IS NOT NULL) AS blocked
       FROM agent_servers WHERE hospital_code = $1 AND server_id = $2`,
      [hospitalCode, input.serverId],
    )
    server = r.rows[0]
  } else {
    const r = await db.query(
      `INSERT INTO agent_servers (hospital_code, server_id, hostname, agent_version, db_version, db_time_zone)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (hospital_code, server_id) DO UPDATE SET
         hostname = EXCLUDED.hostname, agent_version = EXCLUDED.agent_version,
         db_version = EXCLUDED.db_version, db_time_zone = EXCLUDED.db_time_zone, last_seen_at = now()
       RETURNING id, to_char(measurements_synced_until - interval '2 days', 'YYYY-MM-DD HH24:MI:SS') AS since,
                 (reconciled_at IS NOT NULL AND reconciled_at > now() - interval '23 hours') AS reconciled_recent,
                 (blocked_at IS NOT NULL) AS blocked`,
      [hospitalCode, input.serverId, input.hostname, input.agentVersion, input.dbVersion, input.dbTimeZone],
    )
    server = r.rows[0]
  }
  // 관리자가 차단한 서버 — 병원 토큰으로 들어와도 받지 않는다 (던지면 위의 갱신도 되돌려진다)
  if (server?.blocked) throw new Forbidden('이 서버는 차단되어 있습니다 — 운영관리시스템 에이전트 관리에서 확인하세요')

  const serverPk = server ? Number(server.id) : null
  const cursors: Record<string, { last_id: number; verified_id: number }> = {}
  for (const y of input.statusYears) cursors[String(y)] = { last_id: 0, verified_id: 0 }

  let runId: number | null = null
  if (serverPk !== null && !input.dryRun) {
    if (input.rewindStatusTo !== null) {
      await db.query(
        `UPDATE status_cursors SET last_id = LEAST(last_id, $2), verified_id = LEAST(verified_id, $2), updated_at = now()
         WHERE server = $1`,
        [serverPk, input.rewindStatusTo],
      )
    }
    if (input.statusYears.length > 0) {
      await db.query(
        `INSERT INTO status_cursors (server, table_year) SELECT $1, unnest($2::smallint[])
         ON CONFLICT (server, table_year) DO NOTHING`,
        [serverPk, input.statusYears],
      )
    }
    // 끝맺지 못한 이전 실행은 실패로 닫는다 (Agent는 한 번에 하나만 돈다)
    await db.query(
      `UPDATE agent_runs SET status = 'failed', finished_at = now(), error = COALESCE(error, 'superseded by a newer run')
       WHERE server = $1 AND status = 'running'`,
      [serverPk],
    )
  }
  if (serverPk !== null) {
    const c = await db.query(`SELECT table_year, last_id, verified_id FROM status_cursors WHERE server = $1`, [serverPk])
    for (const row of c.rows) {
      if (String(row.table_year) in cursors) {
        cursors[String(row.table_year)] = { last_id: Number(row.last_id), verified_id: Number(row.verified_id) }
      }
    }
  }

  const since = input.full ? null : (server?.since ?? null)
  const reconcile = !(server?.reconciled_recent ?? false)
  if (serverPk !== null && !input.dryRun) {
    const run = await db.query(
      `INSERT INTO agent_runs (hospital_code, server, agent_version, source_now, full_sync, reconcile, remote_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [hospitalCode, serverPk, input.agentVersion, input.dbNow, since === null, reconcile, remoteIp],
    )
    runId = Number(run.rows[0].id)
  }

  return {
    run_id: runId,
    hospital_code: hospitalCode,
    measurements_since: since,
    status_cursors: cursors,
    reconcile,
    status_paused: statusPaused,
    limits: { push_rows: MAX_ROWS },
  }
}

export async function loadRun(db: Db, hospitalCode: string, runId: number): Promise<RunCtx> {
  const r = await db.query(`SELECT server, status, reconcile FROM agent_runs WHERE id = $1 AND hospital_code = $2`, [
    runId,
    hospitalCode,
  ])
  const row = r.rows[0]
  if (!row) throw new BadRequest('run_id: unknown run')
  if (row.status !== 'running') throw new BadRequest('run_id: run already finished')
  return { runId, hospitalCode, server: Number(row.server), reconcile: row.reconcile === true }
}

// ── 전송 ────────────────────────────────────────────────────────────────

export async function push(db: Db, ctx: RunCtx, body: Record<string, unknown>, statusPaused: boolean) {
  const dataset = reqStr(body.dataset, 'dataset', 40)
  switch (dataset) {
    case 'organizations':
      return pushOrganizations(db, ctx, rowsOf(body))
    case 'wards':
      return pushWards(db, ctx, rowsOf(body))
    case 'device_registers':
      return pushDeviceRegisters(db, ctx, rowsOf(body))
    case 'measurements':
      return pushMeasurements(db, ctx, rowsOf(body))
    case 'device_status':
      if (statusPaused) return { accepted: 0, paused: true }
      return pushDeviceStatus(db, ctx, rowsOf(body), body.year)
    case 'measurement_index':
      return pushMeasurementIndex(db, ctx, rowsOf(body))
    case 'reconcile_measurements':
      return reconcileMeasurements(db, ctx)
    case 'status_check':
      if (statusPaused) return { accepted: 0, paused: true }
      return checkStatusCounts(db, ctx, rowsOf(body))
    default:
      throw new BadRequest(`dataset: unknown (${dataset})`)
  }
}

function rowsOf(body: Record<string, unknown>): Record<string, unknown>[] {
  return asArray(body.rows, 'rows', MAX_ROWS).map((r, i) => asObject(r, `rows[${i}]`))
}

function dedupe<T>(rows: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>()
  for (const r of rows) m.set(key(r), r) // 같은 키가 여러 번 오면 마지막 값
  return Array.from(m.values())
}

async function pushOrganizations(db: Db, ctx: RunCtx, raw: Record<string, unknown>[]) {
  const rows = dedupe(
    raw.map((r) => ({
      organization_code: reqStr(r.organization_code, 'organization_code'),
      organization_name: str(r.organization_name, 'organization_name'),
      organization_type: int(r.organization_type, 'organization_type'),
      level: int(r.level, 'level'),
      expiration: int(r.expiration, 'expiration'),
      source_created_at: ts(r.source_created_at, 'source_created_at'),
    })),
    (r) => r.organization_code,
  )
  if (rows.length === 0) return { accepted: 0 }
  await db.query(
    `INSERT INTO raw_organizations (hospital_code, server, last_seen_run, organization_code, organization_name,
       organization_type, level, expiration, source_created_at)
     SELECT $1, $2, $3, x.organization_code, x.organization_name, x.organization_type, x.level, x.expiration, x.source_created_at
     FROM jsonb_to_recordset($4::jsonb) AS x(organization_code text, organization_name text, organization_type int,
       level int, expiration int, source_created_at timestamp)
     ON CONFLICT (server, organization_code) DO UPDATE SET
       organization_name = EXCLUDED.organization_name, organization_type = EXCLUDED.organization_type,
       level = EXCLUDED.level, expiration = EXCLUDED.expiration, source_created_at = EXCLUDED.source_created_at,
       last_seen_at = now(), last_seen_run = EXCLUDED.last_seen_run, gone_at = NULL`,
    [ctx.hospitalCode, ctx.server, ctx.runId, JSON.stringify(rows)],
  )
  return { accepted: rows.length }
}

async function pushWards(db: Db, ctx: RunCtx, raw: Record<string, unknown>[]) {
  const rows = dedupe(
    raw.map((r) => ({
      ward_code: reqStr(r.ward_code, 'ward_code'),
      organization_code: str(r.organization_code, 'organization_code'),
      ward_name: str(r.ward_name, 'ward_name'),
      deactivate: int(r.deactivate, 'deactivate'),
      bed_count: int(r.bed_count, 'bed_count'),
      bed_active_count: int(r.bed_active_count, 'bed_active_count'),
    })),
    (r) => r.ward_code,
  )
  if (rows.length === 0) return { accepted: 0 }
  await db.query(
    `INSERT INTO raw_wards (hospital_code, server, last_seen_run, ward_code, organization_code, ward_name, deactivate,
       bed_count, bed_active_count)
     SELECT $1, $2, $3, x.ward_code, x.organization_code, x.ward_name, x.deactivate, x.bed_count, x.bed_active_count
     FROM jsonb_to_recordset($4::jsonb) AS x(ward_code text, organization_code text, ward_name text, deactivate int,
       bed_count int, bed_active_count int)
     ON CONFLICT (server, ward_code) DO UPDATE SET
       organization_code = EXCLUDED.organization_code, ward_name = EXCLUDED.ward_name, deactivate = EXCLUDED.deactivate,
       bed_count = EXCLUDED.bed_count, bed_active_count = EXCLUDED.bed_active_count,
       last_seen_at = now(), last_seen_run = EXCLUDED.last_seen_run, gone_at = NULL`,
    [ctx.hospitalCode, ctx.server, ctx.runId, JSON.stringify(rows)],
  )
  return { accepted: rows.length }
}

async function pushDeviceRegisters(db: Db, ctx: RunCtx, raw: Record<string, unknown>[]) {
  const rows = dedupe(
    raw.map((r) => ({
      serial_number: reqStr(r.serial_number, 'serial_number'),
      organization_code: str(r.organization_code, 'organization_code'),
      device_type: int(r.device_type, 'device_type'),
      device_code: str(r.device_code, 'device_code'),
      ward_code: str(r.ward_code, 'ward_code'),
      premium: int(r.premium, 'premium'),
      return_status: int(r.return_status, 'return_status'),
      total_use_time: int(r.total_use_time, 'total_use_time'),
      total_use_count: int(r.total_use_count, 'total_use_count'),
      registered_at: ts(r.registered_at, 'registered_at'),
    })),
    (r) => r.serial_number,
  )
  if (rows.length === 0) return { accepted: 0 }
  await db.query(
    `INSERT INTO raw_device_registers (hospital_code, server, last_seen_run, serial_number, organization_code, device_type,
       device_code, ward_code, premium, return_status, total_use_time, total_use_count, registered_at)
     SELECT $1, $2, $3, x.serial_number, x.organization_code, x.device_type, x.device_code, x.ward_code, x.premium,
       x.return_status, x.total_use_time, x.total_use_count, x.registered_at
     FROM jsonb_to_recordset($4::jsonb) AS x(serial_number text, organization_code text, device_type int, device_code text,
       ward_code text, premium int, return_status int, total_use_time int, total_use_count int, registered_at timestamp)
     ON CONFLICT (server, serial_number) DO UPDATE SET
       organization_code = EXCLUDED.organization_code, device_type = EXCLUDED.device_type,
       device_code = EXCLUDED.device_code, ward_code = EXCLUDED.ward_code, premium = EXCLUDED.premium,
       return_status = EXCLUDED.return_status, total_use_time = EXCLUDED.total_use_time,
       total_use_count = EXCLUDED.total_use_count, registered_at = EXCLUDED.registered_at,
       last_seen_at = now(), last_seen_run = EXCLUDED.last_seen_run, gone_at = NULL`,
    [ctx.hospitalCode, ctx.server, ctx.runId, JSON.stringify(rows)],
  )
  return { accepted: rows.length }
}

const STATUS_DELETED = 10 // 보관 기한 경과 — 병원 DB에서 기기 행이 지워진 측정

async function pushMeasurements(db: Db, ctx: RunCtx, raw: Record<string, unknown>[]) {
  type Device = {
    measurement_code: string
    device_type: number
    serial_number: string
    source_device_info_id: number | null
    device_code: string | null
    lead: string | null
    attached_at: string | null
    premium: number | null
  }
  const devices: Device[] = []
  const liveCodes: string[] = [] // 기기 목록을 현재 상태로 맞출 측정 (상태 10 제외)
  const rows = dedupe(
    raw.map((r) => {
      const code = reqStr(r.measurement_code, 'measurement_code')
      const status = int(r.measurement_status, 'measurement_status')
      return {
        measurement_code: code,
        parent_measurement_code: str(r.parent_measurement_code, 'parent_measurement_code'),
        parent_type: int(r.parent_type, 'parent_type'),
        lead: int(r.lead, 'lead'),
        organization_code: str(r.organization_code, 'organization_code'),
        ward_code: str(r.ward_code, 'ward_code'),
        sickroom_code: str(r.sickroom_code, 'sickroom_code'),
        sickbed_code: str(r.sickbed_code, 'sickbed_code'),
        measurement_type: str(r.measurement_type, 'measurement_type', 32),
        measurement_status: status,
        patient_status: int(r.patient_status, 'patient_status'),
        start_at: ts(r.start_at, 'start_at'),
        end_at: ts(r.end_at, 'end_at'),
        duration_hours: int(r.duration_hours, 'duration_hours'),
        elapsed_seconds: bigint(r.elapsed_seconds, 'elapsed_seconds'),
        source_created_at: ts(r.source_created_at, 'source_created_at'),
        source_modified_at: ts(r.source_modified_at, 'source_modified_at'),
        shard: str(r.shard, 'shard', 32),
        _devices: asArray(r.devices ?? [], 'devices', 200),
      }
    }),
    (r) => r.measurement_code,
  )
  for (const m of rows) {
    if (m.measurement_status === STATUS_DELETED) continue // 받아 둔 기기 행을 건드리지 않는다
    liveCodes.push(m.measurement_code)
    for (const d0 of m._devices) {
      const d = asObject(d0, 'devices[]')
      devices.push({
        measurement_code: m.measurement_code,
        device_type: int(d.device_type, 'device_type') ?? 0,
        serial_number: str(d.serial_number, 'serial_number') ?? '',
        source_device_info_id: bigint(d.device_info_id, 'device_info_id'),
        device_code: str(d.device_code, 'device_code'),
        lead: str(d.lead, 'lead', 64),
        attached_at: ts(d.attached_at, 'attached_at'),
        premium: int(d.premium, 'premium'),
      })
    }
  }
  if (rows.length === 0) return { accepted: 0 }
  const measurementJson = JSON.stringify(rows.map(({ _devices, ...m }) => m))
  await db.query(
    `INSERT INTO raw_measurements AS r (hospital_code, server, measurement_code, parent_measurement_code, parent_type, lead,
       organization_code, ward_code, sickroom_code, sickbed_code, measurement_type, measurement_status, patient_status,
       start_at, end_at, duration_hours, elapsed_seconds, source_created_at, source_modified_at, shard)
     SELECT $1, $2, x.measurement_code, x.parent_measurement_code, x.parent_type, x.lead, x.organization_code, x.ward_code,
       x.sickroom_code, x.sickbed_code, x.measurement_type, x.measurement_status, x.patient_status, x.start_at, x.end_at,
       x.duration_hours, x.elapsed_seconds, x.source_created_at, x.source_modified_at, x.shard
     FROM jsonb_to_recordset($3::jsonb) AS x(measurement_code text, parent_measurement_code text, parent_type int, lead int,
       organization_code text, ward_code text, sickroom_code text, sickbed_code text, measurement_type text,
       measurement_status int, patient_status int, start_at timestamp, end_at timestamp, duration_hours int,
       elapsed_seconds bigint, source_created_at timestamp, source_modified_at timestamp, shard text)
     ON CONFLICT (server, measurement_code) DO UPDATE SET
       parent_measurement_code = EXCLUDED.parent_measurement_code, parent_type = EXCLUDED.parent_type, lead = EXCLUDED.lead,
       organization_code = EXCLUDED.organization_code, ward_code = EXCLUDED.ward_code, sickroom_code = EXCLUDED.sickroom_code,
       sickbed_code = EXCLUDED.sickbed_code, measurement_type = EXCLUDED.measurement_type,
       measurement_status = EXCLUDED.measurement_status, patient_status = EXCLUDED.patient_status,
       start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, duration_hours = EXCLUDED.duration_hours,
       elapsed_seconds = EXCLUDED.elapsed_seconds, source_created_at = EXCLUDED.source_created_at,
       source_modified_at = EXCLUDED.source_modified_at, shard = EXCLUDED.shard,
       last_seen_at = now(), source_gone_at = NULL,
       last_changed_at = CASE
         WHEN (r.measurement_status, r.start_at, r.end_at, r.ward_code, r.source_modified_at)
              IS DISTINCT FROM
              (EXCLUDED.measurement_status, EXCLUDED.start_at, EXCLUDED.end_at, EXCLUDED.ward_code, EXCLUDED.source_modified_at)
         THEN now() ELSE r.last_changed_at END`,
    [ctx.hospitalCode, ctx.server, measurementJson],
  )

  const uniqueDevices = dedupe(devices, (d) => `${d.measurement_code}\u0001${d.device_type}\u0001${d.serial_number}`)
  const deviceJson = JSON.stringify(uniqueDevices)
  if (uniqueDevices.length > 0) {
    await db.query(
      `INSERT INTO raw_measurement_devices (hospital_code, server, measurement_code, device_type, serial_number,
         source_device_info_id, device_code, lead, attached_at, premium)
       SELECT $1, $2, x.measurement_code, x.device_type, x.serial_number, x.source_device_info_id, x.device_code, x.lead,
         x.attached_at, x.premium
       FROM jsonb_to_recordset($3::jsonb) AS x(measurement_code text, device_type int, serial_number text,
         source_device_info_id bigint, device_code text, lead text, attached_at timestamp, premium int)
       ON CONFLICT (server, measurement_code, device_type, serial_number) DO UPDATE SET
         source_device_info_id = EXCLUDED.source_device_info_id, device_code = EXCLUDED.device_code, lead = EXCLUDED.lead,
         attached_at = EXCLUDED.attached_at, premium = EXCLUDED.premium, last_seen_at = now(), removed_at = NULL`,
      [ctx.hospitalCode, ctx.server, deviceJson],
    )
  }
  // 이번에 받은 측정의 현재 기기 목록에 없는 행 = 병원에서 빠지거나 교체된 기기
  let removed = 0
  if (liveCodes.length > 0) {
    const r = await db.query(
      `UPDATE raw_measurement_devices d SET removed_at = now()
       WHERE d.server = $1 AND d.removed_at IS NULL AND d.measurement_code = ANY($2::text[])
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS x(measurement_code text, device_type int, serial_number text)
           WHERE x.measurement_code = d.measurement_code AND x.device_type = d.device_type AND x.serial_number = d.serial_number)`,
      [ctx.server, liveCodes, deviceJson],
    )
    removed = r.rowCount ?? 0
  }
  // 대조 중이면, 다시 받은 측정의 대조용 값을 방금 받은 값으로 맞춘다 (같은 측정을 되풀이해 요청하지 않게)
  if (ctx.reconcile) {
    await db.query(
      `UPDATE recon_measurement_index i SET measurement_status = x.measurement_status, source_modified_at = x.source_modified_at
       FROM jsonb_to_recordset($2::jsonb) AS x(measurement_code text, measurement_status int, source_modified_at timestamp)
       WHERE i.run_id = $1 AND i.measurement_code = x.measurement_code`,
      [ctx.runId, measurementJson],
    )
  }
  return { accepted: rows.length, devices: uniqueDevices.length, devices_removed: removed }
}

// ── 기기 상태 이력 ─────────────────────────────────────────────────────

const NO_TIME = '1970-01-01 00:00:00'
const ensuredPartitions = new Set<string>()

function partitionRange(): { min: string; max: string } {
  const now = new Date()
  const max = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1))
  return { min: '2015-01', max: `${max.getUTCFullYear()}-${String(max.getUTCMonth() + 1).padStart(2, '0')}` }
}

/** 받을 행의 달 조각이 없으면 만든다. 범위를 벗어난 달은 기본 조각으로 간다. */
async function ensureStatusPartitions(db: Db, months: Set<string>) {
  const { min, max } = partitionRange()
  const todo = Array.from(months).filter((m) => !ensuredPartitions.has(m) && m >= min && m <= max)
  if (todo.length === 0) return
  await db.query(`SELECT pg_advisory_xact_lock(72700118)`) // 수신 요청끼리 같은 조각을 동시에 만들지 않게
  for (const m of todo.sort()) {
    const [y, mo] = m.split('-').map(Number)
    const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
    const name = `raw_device_status_y${y}m${String(mo).padStart(2, '0')}`
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF raw_device_status FOR VALUES FROM ('${m}-01') TO ('${next}-01')`,
    )
    ensuredPartitions.add(m)
  }
}

async function pushDeviceStatus(db: Db, ctx: RunCtx, raw: Record<string, unknown>[], yearRaw: unknown) {
  const year = int(yearRaw, 'year')
  if (year === null || year < 2000 || year > 2100) throw new BadRequest('year: required')
  let maxId = 0
  const months = new Set<string>()
  const rows = raw.map((r) => {
    const id = reqBigint(r.id, 'id')
    if (id > maxId) maxId = id
    const eventAt = ts(r.event_at, 'event_at') ?? NO_TIME
    months.add(eventAt.slice(0, 7))
    return {
      source_id: id,
      measurement_code: reqStr(r.measurement_code, 'measurement_code'),
      device_type: smallint(r.device_type, 'device_type'),
      serial_number: str(r.serial_number, 'serial_number'),
      status: smallint(r.status, 'status'),
      battery_value: smallint(r.battery_value, 'battery_value'),
      device_kind: smallint(r.device_kind, 'device_kind'),
      event_at: eventAt,
    }
  })
  if (rows.length === 0) return { accepted: 0, cursor: null }
  await ensureStatusPartitions(db, months)
  // 원본 저장과 함께 기기 사용 구간 표를 갱신한다 (projects/usage_spans_design.md) — 새로 들어간 행만 구간에 반영하고,
  // 다시 받은 행(이미 있는 행)은 ins 에 나오지 않는다. 구간 갱신은 LEAST / GREATEST 라 순서와 무관하다.
  const ins = await db.query(
    `WITH ins AS (
       INSERT INTO raw_device_status (hospital_code, server, table_year, source_id, measurement_code, device_type,
         serial_number, status, battery_value, device_kind, event_at)
       SELECT $1, $2, $3, x.source_id, x.measurement_code, x.device_type, x.serial_number, x.status, x.battery_value,
         x.device_kind, x.event_at
       FROM jsonb_to_recordset($4::jsonb) AS x(source_id bigint, measurement_code text, device_type smallint,
         serial_number text, status smallint, battery_value smallint, device_kind smallint, event_at timestamp(3))
       ON CONFLICT (server, table_year, source_id, event_at) DO NOTHING
       RETURNING measurement_code, device_type, serial_number, event_at
     ), sp AS (
       INSERT INTO device_usage_spans (hospital_code, server, measurement_code, device_type, serial_number, first_event_at, last_event_at)
       SELECT $1, $2, i.measurement_code, COALESCE(i.device_type, 0), COALESCE(i.serial_number, ''), min(i.event_at), max(i.event_at)
       FROM ins i
       WHERE i.event_at >= timestamp '2000-01-01'
       GROUP BY i.measurement_code, COALESCE(i.device_type, 0), COALESCE(i.serial_number, '')
       ON CONFLICT (server, measurement_code, device_type, serial_number) DO UPDATE SET
         first_event_at = LEAST(device_usage_spans.first_event_at, EXCLUDED.first_event_at),
         last_event_at = GREATEST(device_usage_spans.last_event_at, EXCLUDED.last_event_at),
         updated_at = now()
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM ins)::int AS inserted, (SELECT count(*) FROM sp)::int AS spans`,
    [ctx.hospitalCode, ctx.server, year, JSON.stringify(rows)],
  )
  // 저장이 끝난 뒤에만 위치를 앞으로 옮긴다 (같은 트랜잭션)
  const cur = await db.query(
    `INSERT INTO status_cursors (server, table_year, last_id) VALUES ($1, $2, $3)
     ON CONFLICT (server, table_year) DO UPDATE SET last_id = GREATEST(status_cursors.last_id, EXCLUDED.last_id), updated_at = now()
     RETURNING last_id`,
    [ctx.server, year, maxId],
  )
  return { accepted: rows.length, inserted: Number(ins.rows[0]?.inserted ?? 0), cursor: Number(cur.rows[0].last_id) }
}

/** 상태 이력 대조 — 병원 쪽 구간 행 수보다 받은 행 수가 적으면 그 구간부터 다시 받도록 위치를 되돌린다 */
async function checkStatusCounts(db: Db, ctx: RunCtx, raw: Record<string, unknown>[]) {
  const results: { year: number; from_id: number; to_id: number; source: number; received: number; ok: boolean }[] = []
  for (const r of raw) {
    const year = int(r.year, 'year')
    const from = reqBigint(r.from_id, 'from_id')
    const to = reqBigint(r.to_id, 'to_id')
    const source = reqBigint(r.count, 'count')
    if (year === null || year < 2000 || year > 2100 || from < 0 || to < from) throw new BadRequest('status_check: bad range')
    const c = await db.query(
      `SELECT count(*)::bigint AS n FROM raw_device_status WHERE server = $1 AND table_year = $2 AND source_id > $3 AND source_id <= $4`,
      [ctx.server, year, from, to],
    )
    const received = Number(c.rows[0].n)
    const ok = received >= source
    if (ok) {
      await db.query(
        `UPDATE status_cursors SET verified_id = GREATEST(verified_id, $3), updated_at = now() WHERE server = $1 AND table_year = $2`,
        [ctx.server, year, to],
      )
    } else {
      await db.query(
        `UPDATE status_cursors SET last_id = LEAST(last_id, $3), updated_at = now() WHERE server = $1 AND table_year = $2`,
        [ctx.server, year, from],
      )
    }
    results.push({ year, from_id: from, to_id: to, source, received, ok })
  }
  await mergeReconcileResult(db, ctx, { status_check: results })
  return { accepted: raw.length, results }
}

// ── 측정 대조 ──────────────────────────────────────────────────────────

async function pushMeasurementIndex(db: Db, ctx: RunCtx, raw: Record<string, unknown>[]) {
  const rows = dedupe(
    raw.map((r) => ({
      measurement_code: reqStr(r.measurement_code, 'measurement_code'),
      measurement_status: int(r.measurement_status, 'measurement_status'),
      source_modified_at: ts(r.source_modified_at, 'source_modified_at'),
    })),
    (r) => r.measurement_code,
  )
  if (rows.length === 0) return { accepted: 0 }
  await db.query(
    `INSERT INTO recon_measurement_index (run_id, measurement_code, measurement_status, source_modified_at)
     SELECT $1, x.measurement_code, x.measurement_status, x.source_modified_at
     FROM jsonb_to_recordset($2::jsonb) AS x(measurement_code text, measurement_status int, source_modified_at timestamp)
     ON CONFLICT (run_id, measurement_code) DO UPDATE SET
       measurement_status = EXCLUDED.measurement_status, source_modified_at = EXCLUDED.source_modified_at`,
    [ctx.runId, JSON.stringify(rows)],
  )
  return { accepted: rows.length }
}

/**
 * 병원 쪽 전체 목록(recon_measurement_index)과 받아 둔 측정을 비교한다.
 *  - 중앙에 없거나 상태·수정 시각이 다른 측정 → 다시 보내라고 응답
 *  - 중앙에만 있는 측정 → 병원에서 사라진 것으로 표시 (목록이 비정상적으로 작으면 표시하지 않는다)
 */
async function reconcileMeasurements(db: Db, ctx: RunCtx) {
  const counts = await db.query(
    `SELECT (SELECT count(*) FROM recon_measurement_index WHERE run_id = $1)::bigint AS index_rows,
            (SELECT count(*) FROM raw_measurements WHERE server = $2 AND source_gone_at IS NULL)::bigint AS live_rows`,
    [ctx.runId, ctx.server],
  )
  const indexRows = Number(counts.rows[0].index_rows)
  const liveRows = Number(counts.rows[0].live_rows)

  const goneCandidates = await db.query(
    `SELECT count(*)::bigint AS n FROM raw_measurements r
     WHERE r.server = $2 AND r.source_gone_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM recon_measurement_index i WHERE i.run_id = $1 AND i.measurement_code = r.measurement_code)`,
    [ctx.runId, ctx.server],
  )
  const candidates = Number(goneCandidates.rows[0].n)
  // 목록이 비었거나 받아 둔 측정의 절반 넘게 사라진 것으로 나오면 Agent 쪽 문제일 수 있다 — 표시하지 않고 기록만 남긴다
  const suspicious = candidates > 0 && (indexRows === 0 || (candidates > 100 && candidates * 2 > liveRows))
  let goneMarked = 0
  if (candidates > 0 && !suspicious) {
    const g = await db.query(
      `UPDATE raw_measurements r SET source_gone_at = now()
       WHERE r.server = $2 AND r.source_gone_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM recon_measurement_index i WHERE i.run_id = $1 AND i.measurement_code = r.measurement_code)`,
      [ctx.runId, ctx.server],
    )
    goneMarked = g.rowCount ?? 0
  }

  const diff = await db.query(
    `SELECT i.measurement_code, count(*) OVER ()::bigint AS total
     FROM recon_measurement_index i
     LEFT JOIN raw_measurements r ON r.server = $2 AND r.measurement_code = i.measurement_code
     WHERE i.run_id = $1
       AND (r.measurement_code IS NULL
            OR r.source_gone_at IS NOT NULL
            OR r.measurement_status IS DISTINCT FROM i.measurement_status
            OR r.source_modified_at IS DISTINCT FROM i.source_modified_at)
     ORDER BY i.measurement_code
     LIMIT ${RESEND_PAGE}`,
    [ctx.runId, ctx.server],
  )
  const resend = diff.rows.map((r) => r.measurement_code as string)
  const missingTotal = diff.rows.length > 0 ? Number(diff.rows[0].total) : 0
  await mergeReconcileResult(db, ctx, {
    measurements: { index_rows: indexRows, missing: missingTotal, gone_marked: goneMarked, gone_skipped: suspicious ? candidates : 0 },
  })
  return { resend_codes: resend, missing_total: missingTotal, gone_marked: goneMarked, gone_skipped: suspicious ? candidates : 0 }
}

/** 대조 결과는 실행 기록에 남긴다. 측정 대조는 여러 번 불리므로 처음 본 누락 수를 유지한다 */
async function mergeReconcileResult(db: Db, ctx: RunCtx, patch: Record<string, unknown>) {
  const cur = await db.query(`SELECT reconcile_result FROM agent_runs WHERE id = $1`, [ctx.runId])
  const prev = (cur.rows[0]?.reconcile_result ?? {}) as Record<string, any>
  const next: Record<string, any> = { ...prev }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'measurements' && prev.measurements) {
      const p = prev.measurements
      const n = v as any
      next.measurements = {
        index_rows: n.index_rows,
        missing: p.missing, // 첫 비교 때의 누락 수
        gone_marked: (p.gone_marked ?? 0) + n.gone_marked,
        gone_skipped: Math.max(p.gone_skipped ?? 0, n.gone_skipped),
        rounds: (p.rounds ?? 1) + 1,
        remaining: n.missing,
      }
    } else {
      next[k] = v
    }
  }
  await db.query(`UPDATE agent_runs SET reconcile_result = $2::jsonb WHERE id = $1`, [ctx.runId, JSON.stringify(next)])
}

// ── 종료 ────────────────────────────────────────────────────────────────

export async function finish(db: Db, ctx: RunCtx, body: Record<string, unknown>) {
  const status = reqStr(body.status, 'status', 10)
  if (status !== 'ok' && status !== 'failed') throw new BadRequest('status: ok | failed')
  const stats = body.stats === undefined || body.stats === null ? {} : asObject(body.stats, 'stats')
  const error = str(body.error, 'error', 4000)
  const complete = new Set(asArray(body.complete ?? [], 'complete', 20).map((c) => reqStr(c, 'complete[]', 40)))
  const goneMarked: Record<string, number> = {}
  const goneSkipped: Record<string, number> = {}

  if (status === 'ok') {
    // 전체를 다 보낸 종류만, 이번 실행에서 오지 않은 행을 "사라짐"으로 표시한다
    for (const ds of FULL_DATASETS) {
      if (!complete.has(ds)) continue
      const table = FULL_TABLE[ds]
      const c = await db.query(
        `SELECT count(*) FILTER (WHERE last_seen_run = $2)::bigint AS seen,
                count(*) FILTER (WHERE gone_at IS NULL AND last_seen_run IS DISTINCT FROM $2)::bigint AS missing
         FROM ${table} WHERE server = $1`,
        [ctx.server, ctx.runId],
      )
      const seen = Number(c.rows[0].seen)
      const missing = Number(c.rows[0].missing)
      if (missing === 0) continue
      if (seen === 0) {
        goneSkipped[ds] = missing // 한 건도 오지 않았는데 전부 사라졌다고 표시하지 않는다
        continue
      }
      const g = await db.query(
        `UPDATE ${table} SET gone_at = now() WHERE server = $1 AND gone_at IS NULL AND last_seen_run IS DISTINCT FROM $2`,
        [ctx.server, ctx.runId],
      )
      goneMarked[ds] = g.rowCount ?? 0
    }
    await db.query(
      `UPDATE agent_servers s SET
         last_success_at = now(), last_seen_at = now(),
         measurements_synced_until = CASE WHEN $2 THEN r.source_now ELSE s.measurements_synced_until END,
         reconciled_at = CASE WHEN $3 THEN now() ELSE s.reconciled_at END
       FROM agent_runs r WHERE r.id = $4 AND s.id = $1`,
      [ctx.server, complete.has('measurements'), complete.has('reconcile'), ctx.runId],
    )
  }
  await db.query(
    `UPDATE agent_runs SET status = $2, finished_at = now(), stats = $3::jsonb, error = $4 WHERE id = $1`,
    [ctx.runId, status, JSON.stringify({ ...stats, gone_marked: goneMarked, gone_skipped: goneSkipped }), error],
  )
  await db.query(`DELETE FROM recon_measurement_index WHERE run_id = $1 OR run_id < $1 - 1000`, [ctx.runId])
  return { ok: true, gone_marked: goneMarked, gone_skipped: goneSkipped }
}
