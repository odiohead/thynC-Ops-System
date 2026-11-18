/**
 * 사용량 수집 끝단 검증 — Agent ↔ 수신부 ↔ 원본 DB (dev2 전용)
 *
 *   npx tsx scripts/usage-collect-smoke.mts            전체 시나리오
 *   npx tsx scripts/usage-collect-smoke.mts --keep     끝난 뒤 검증용 원본 행을 지우지 않는다 (들여다볼 때)
 *
 * 전제 (dev2 에만 있다)
 *   · 로컬 MySQL 8 에 제품 초기 구성 SQL 로 만든 빈 DB `thync` — 이 스크립트가 가상 데이터를 넣고 지운다.
 *     가상 데이터가 아닌 기관이 하나라도 있으면 실제 제품 DB 로 보고 멈춘다.
 *   · 원본 DB 가 thync_usage_dev (localhost)
 *   · 수신부가 떠 있다: pm2 thync-usage-ingest-dev (127.0.0.1:3110)
 *   · Agent 빌드: agents/thync-usage-agent/dist/thync-usage-agent
 *
 * 원본 DB 에서는 검증용 병원 코드(HOSP-SMOKE*) 행만 만들고 지운다. 다른 병원의 행은 건드리지 않는다.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { HOSPITAL_TABLES, fail, flag, usageDb } from './usage-lib.mts'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const AGENT = path.join(ROOT, 'agents/thync-usage-agent/dist/thync-usage-agent')
const INGEST = 'http://127.0.0.1:3110/api/usage-ingest'
const H1 = 'HOSP-SMOKE1'
const H2 = 'HOSP-SMOKE2'
const TEST_ORGS = ['REF_ORG', 'SMOKE_A', 'SMOKE_B']
const RO_USER = 'thync_usage_ro'
const RO_PASS = `smoke_${randomBytes(6).toString('hex')}`
// 가상 측정에 넣어 두는 환자 식별 정보 — 원본 DB 어디에도 나타나면 안 된다
const SECRETS = ['홍길동', '김철수', 'PT-0001', 'PT-0002', '900101-1234567', '010-1234-5678', '010-9999-0000', '서울시 강남구', '1990-01-01', 'memo-secret', 'status-secret', 'AA:BB:CC']

// ── 도구 ────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
  }
}
function section(title: string) {
  console.log(`\n■ ${title}`)
}

function my(sql: string): string {
  return execFileSync('sudo', ['mysql', '-N', '-B', 'thync', '-e', sql], { encoding: 'utf8' }).trim()
}
function myNum(sql: string): number {
  return Number(my(sql))
}
function myRo(sql: string): { ok: boolean; out: string } {
  const r = spawnSync('mysql', ['-N', '-B', '-h', '127.0.0.1', '-u', RO_USER, `-p${RO_PASS}`, 'thync', '-e', sql], { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }
}

const db = usageDb()
async function pg<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[]
}
async function pgNum(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pg(sql, params)
  return Number(Object.values(r[0])[0])
}

const work = mkdtempSync(path.join(tmpdir(), 'usage-smoke-'))
function writeConfig(name: string, token: string, extra: Record<string, string> = {}): string {
  const file = path.join(work, `${name}.env`)
  const lines = {
    USAGE_ENDPOINT: `${INGEST}/v1`,
    USAGE_TOKEN: token,
    USAGE_SERVER_ID: name,
    DB_HOST: '127.0.0.1',
    DB_USER: RO_USER,
    DB_PASSWORD: RO_PASS,
    ...extra,
  }
  writeFileSync(file, Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
  return file
}
function agent(config: string, args: string[] = ['run'], env: Record<string, string> = {}) {
  const r = spawnSync(AGENT, [args[0], '--config', config, ...args.slice(1)], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env }, // 본체 .env 의 값이 섞이지 않게 환경을 비운다
    timeout: 180_000,
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
async function issueToken(hospital: string): Promise<string> {
  const token = `tua_${randomBytes(24).toString('hex')}`
  await db.query(`INSERT INTO agent_tokens (hospital_code, token_hash, token_prefix, label, created_by) VALUES ($1, $2, $3, 'smoke', 'smoke')`, [
    hospital,
    createHash('sha256').update(token).digest('hex'),
    token.slice(0, 8),
  ])
  return token
}
async function wipeUsage() {
  for (const t of [...HOSPITAL_TABLES].reverse()) {
    if (t === 'agent_servers') await db.query(`DELETE FROM status_cursors WHERE server IN (SELECT id FROM agent_servers WHERE hospital_code LIKE 'HOSP-SMOKE%')`)
    await db.query(`DELETE FROM ${t} WHERE hospital_code LIKE 'HOSP-SMOKE%'`)
  }
  await db.query(`DELETE FROM recon_measurement_index WHERE run_id NOT IN (SELECT id FROM agent_runs)`)
}
async function lastRun(hospital: string, serverId: string) {
  const r = await pg(
    `SELECT r.* FROM agent_runs r JOIN agent_servers s ON s.id = r.server WHERE r.hospital_code = $1 AND s.server_id = $2 ORDER BY r.id DESC LIMIT 1`,
    [hospital, serverId],
  )
  return r[0]
}
async function http(method: string, p: string, opts: { token?: string; body?: unknown; raw?: Buffer; gzip?: boolean } = {}) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: Buffer | undefined
  if (opts.raw) body = opts.raw
  else if (opts.body !== undefined) body = Buffer.from(JSON.stringify(opts.body))
  if (body && opts.gzip !== false && !opts.raw) {
    body = gzipSync(body)
    headers['content-encoding'] = 'gzip'
  }
  if (opts.raw && opts.gzip) headers['content-encoding'] = 'gzip'
  const res = await fetch(`${INGEST}${p}`, { method, headers, body: body ? new Uint8Array(body) : undefined })
  let json: any = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}
const CLEAN_ENV = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } // 본체 .env 값이 수신부 프로세스에 섞이지 않게
function restartIngest(maxBytes: string) {
  execFileSync('pm2', ['restart', 'thync-usage-ingest-dev', '--update-env'], { env: { ...CLEAN_ENV, USAGE_MAX_BYTES: maxBytes }, stdio: 'ignore' })
}
/** 시험이 끝나면 수신부를 깨끗한 환경으로 다시 등록한다 (PM2 에 남은 USAGE_MAX_BYTES 가 .env 를 가리지 않게) */
function resetIngest() {
  spawnSync('pm2', ['delete', 'thync-usage-ingest-dev'], { env: CLEAN_ENV, stdio: 'ignore' })
  execFileSync('pm2', ['start', 'usage-ingest/dist/index.mjs', '--name', 'thync-usage-ingest-dev', '--time'], { cwd: ROOT, env: CLEAN_ENV, stdio: 'ignore' })
}
async function waitIngest(up: boolean) {
  for (let i = 0; i < 40; i++) {
    const ok = await fetch(`${INGEST}/health`).then((r) => r.ok).catch(() => false)
    if (ok === up) return
    await new Promise((r) => setTimeout(r, 250))
  }
  fail(`수신부가 ${up ? '뜨지' : '내려가지'} 않습니다`)
}

// ── 가상 데이터 ────────────────────────────────────────────────────────

function seed() {
  my(`SET FOREIGN_KEY_CHECKS = 0;
      DELETE FROM device_status_info_2026; DELETE FROM device_info; DELETE FROM measurement_info;
      DELETE FROM device_register; DELETE FROM sickbed; DELETE FROM sickroom; DELETE FROM ward;
      DELETE FROM global_setting; DELETE FROM organization;
      ALTER TABLE device_status_info_2026 AUTO_INCREMENT = 1;
      SET FOREIGN_KEY_CHECKS = 1;`)
  my(`INSERT INTO organization (organization_code, organization_name, organization_type, level, expiration, date_time) VALUES
        ('REF_ORG', '템플릿', 0, 0, 0, '2024-01-01 00:00:00'),
        ('SMOKE_A', '검증병원 본관', 1, 1, 0, '2025-03-01 09:00:00'),
        ('SMOKE_B', '검증병원 별관', 1, 1, 0, '2025-06-01 09:00:00');
      INSERT INTO global_setting (organization_code, backup_day) VALUES ('REF_ORG', 90);
      INSERT INTO ward (organization_code, ward_code, ward, deactivate) VALUES
        ('SMOKE_A', 'WA1', '51병동', 0), ('SMOKE_A', 'WA2', '62병동', 0), ('SMOKE_B', 'WB1', '별관 3병동', 0), ('REF_ORG', 'WR1', '템플릿 병동', 0);
      INSERT INTO sickroom (organization_code, ward_code, sickroom_code, sickroom) VALUES
        ('SMOKE_A', 'WA1', 'RA1', '501호'), ('SMOKE_A', 'WA2', 'RA2', '601호'), ('SMOKE_B', 'WB1', 'RB1', '301호');
      INSERT INTO sickbed (organization_code, ward_code, sickroom_code, sickbed_code, sickbed, deactivate) VALUES
        ('SMOKE_A', 'WA1', 'RA1', 'BA1', '1', 0), ('SMOKE_A', 'WA1', 'RA1', 'BA2', '2', 0), ('SMOKE_A', 'WA1', 'RA1', 'BA3', '3', 1),
        ('SMOKE_A', 'WA2', 'RA2', 'BA4', '1', 0), ('SMOKE_B', 'WB1', 'RB1', 'BB1', '1', 0);
      INSERT INTO device_register (organization_code, device_type, device_code, serial_number, ward_code, mac_address, date_time, total_use_time, total_use_count, device_return_status, premium) VALUES
        ('SMOKE_A', 1, 'DC1', 'E001', 'WA1', 'AA:BB:CC:00:00:01', '2025-03-02 10:00:00', 1200, 12, 0, 1),
        ('SMOKE_A', 1, 'DC2', 'E002', 'WA1', 'AA:BB:CC:00:00:02', '2025-03-02 10:00:00', 300, 3, 0, 0),
        ('SMOKE_A', 1, 'DC3', 'E003', 'WA1', 'AA:BB:CC:00:00:03', '2025-03-02 10:00:00', 0, 0, 0, 1),
        ('SMOKE_A', 3, 'DC4', 'S001', 'WA1', 'AA:BB:CC:00:00:04', '2025-03-02 10:00:00', 50, 1, 0, NULL),
        ('SMOKE_A', 1, 'DC5', 'E005', 'WA2', 'AA:BB:CC:00:00:05', '2025-03-02 10:00:00', 0, 0, 0, 1),
        ('SMOKE_A', 1, 'DC6', 'E006', 'WA2', 'AA:BB:CC:00:00:06', '2025-03-02 10:00:00', 0, 0, 0, 1),
        ('SMOKE_B', 1, 'DC7', 'E101', 'WB1', 'AA:BB:CC:00:00:07', '2025-06-02 10:00:00', 0, 0, 0, 0);`)
  const phi = (n: number) =>
    n === 1
      ? `'홍길동', 1, 36, '1990-01-01', '900101-1234567', '010-1234-5678', '010-9999-0000', '서울시 강남구', 'memo-secret'`
      : `'김철수', 1, 50, '1976-05-05', NULL, '010-1234-5678', NULL, '서울시 강남구', NULL`
  const m = (code: string, parent: string, ptype: number, lead: number, org: string, pc: string, ward: string, room: string, bed: string, status: number, start: string, end: string, modified: string, who: number) =>
    `('${code}', '${parent}', ${ptype}, ${lead}, '${org}', '2026', 1, '${pc}', '${ward}', '${room}', '${bed}', 'BM', ${status}, 3, ${phi(who)}, ${start}, ${end}, 168, 604800, ${start}, ${modified})`
  my(`INSERT INTO measurement_info (measurement_code, parent_measurement_code, parent_type, \`lead\`, organization_code, shard, part, patient_code,
        ward_code, sickroom_code, sickbed_code, measurement_type, measurement_status, patient_status,
        name, gender, age, birthday, ssn, phone_number, guardian_phone_number, address, etc,
        start_date_time, end_date_time, duration, elapsed_time, date_time, modify_date_time) VALUES
      ${m('M1', 'M1', 0, 2, 'SMOKE_A', 'PT-0001', 'WA1', 'RA1', 'BA1', 2, 'NOW() - INTERVAL 2 DAY', 'NOW() + INTERVAL 5 DAY', 'NOW() - INTERVAL 2 DAY', 1)},
      ${m('M2', 'M2', 0, 2, 'SMOKE_A', 'PT-0002', 'WA1', 'RA1', 'BA2', 3, 'NOW() - INTERVAL 20 DAY', 'NOW() - INTERVAL 10 DAY', 'NOW() - INTERVAL 10 DAY', 2)},
      ${m('M3', 'M3', 0, 2, 'SMOKE_A', 'PT-0001', 'WA2', 'RA2', 'BA4', 1, 'NOW() - INTERVAL 1 HOUR', 'NOW() + INTERVAL 7 DAY', 'NOW() - INTERVAL 1 HOUR', 1)},
      ${m('M4', 'M4', 0, 2, 'SMOKE_A', 'PT-0002', 'WA1', 'RA1', 'BA1', 10, 'NOW() - INTERVAL 130 DAY', 'NOW() - INTERVAL 120 DAY', 'NOW() - INTERVAL 30 DAY', 2)},
      ${m('M5', 'M5', 0, 2, 'SMOKE_A', 'PT-0002', 'WA2', 'RA2', 'BA4', 2, 'NOW() - INTERVAL 1 DAY', 'NOW() + INTERVAL 6 DAY', 'NOW() - INTERVAL 1 DAY', 2)},
      ${m('M5C', 'M5', 1, 1, 'SMOKE_A', 'PT-0002', 'WA2', 'RA2', 'BA4', 2, 'NOW() - INTERVAL 1 DAY', 'NOW() + INTERVAL 6 DAY', 'NOW() - INTERVAL 1 DAY', 2)},
      ${m('MB1', 'MB1', 0, 2, 'SMOKE_B', 'PT-0001', 'WB1', 'RB1', 'BB1', 2, 'NOW() - INTERVAL 3 DAY', 'NOW() + INTERVAL 4 DAY', 'NOW() - INTERVAL 3 DAY', 1)},
      ${m('MREF', 'MREF', 0, 2, 'REF_ORG', 'PT-0001', 'WR1', 'RA1', 'BA1', 2, 'NOW() - INTERVAL 3 DAY', 'NOW() + INTERVAL 4 DAY', 'NOW() - INTERVAL 3 DAY', 1)};
      INSERT INTO device_info (measurement_code, parent_measurement_code, \`lead\`, device_type, device_code, serial_number, mac_address, date_time) VALUES
        ('M1', 'M1', '2', 1, 'DC1', 'E001', 'AA:BB:CC:00:00:01', NOW() - INTERVAL 2 DAY),
        ('M1', 'M1', NULL, 3, 'DC4', 'S001', 'AA:BB:CC:00:00:04', NOW() - INTERVAL 2 DAY),
        ('M2', 'M2', '2', 1, 'DC2', 'E002', 'AA:BB:CC:00:00:02', NOW() - INTERVAL 20 DAY),
        ('M5', 'M5', '2', 1, 'DC5', 'E005', 'AA:BB:CC:00:00:05', NOW() - INTERVAL 1 DAY),
        ('M5C', 'M5', '1', 1, 'DC6', 'E006', 'AA:BB:CC:00:00:06', NOW() - INTERVAL 1 DAY),
        ('M5', 'M5', NULL, 6, NULL, 'X999', 'AA:BB:CC:00:00:99', NOW() - INTERVAL 1 DAY),
        ('MB1', 'MB1', '2', 1, 'DC7', 'E101', 'AA:BB:CC:00:00:07', NOW() - INTERVAL 3 DAY),
        ('MREF', 'MREF', '2', 1, 'DC1', 'E001', 'AA:BB:CC:00:00:01', NOW() - INTERVAL 3 DAY);`)
  addStatus('M1', 1, 'E001', 1200)
  addStatus('M1', 3, 'S001', 100)
  addStatus('M2', 1, 'E002', 50)
  addStatus('MB1', 1, 'E101', 30)
  addStatus('MREF', 1, 'E001', 20)
  // 연도 테이블은 측정을 만든 해 기준이라 다른 해의 시각이 섞일 수 있다 + 시각이 없는 행
  my(`INSERT INTO device_status_info_2026 (measurement_code, device_type, serial_number, mac_address, device_kind, status, battery_value, message, date_time) VALUES
        ('M2', 1, 'E002', 'AA:BB:CC:00:00:02', 2, 2, 90, NULL, '2025-12-31 23:59:59.123'),
        ('M2', 1, 'E002', 'AA:BB:CC:00:00:02', 2, 5, 90, 'status-secret', NULL)`)
}
function addStatus(code: string, type: number, serial: string, n: number) {
  my(`SET SESSION cte_max_recursion_depth = 100000;
      INSERT INTO device_status_info_2026 (measurement_code, device_type, serial_number, mac_address, device_kind, status, battery_value, message, date_time)
      WITH RECURSIVE seq AS (SELECT 1 AS i UNION ALL SELECT i + 1 FROM seq WHERE i < ${n})
      SELECT '${code}', ${type}, '${serial}', 'AA:BB:CC:00:00:01', 2, 1 + (i % 7), 100 - (i % 60), IF(i % 97 = 0, 'status-secret', NULL),
             NOW(3) - INTERVAL (${n} - i) MINUTE FROM seq`)
}
/** 병원 쪽에서 Agent 가 보내야 하는 상태 이력 행 수 (템플릿 기관 제외) */
function sourceStatusCount(orgs = `'SMOKE_A','SMOKE_B'`): number {
  return myNum(`SELECT COUNT(*) FROM device_status_info_2026 d JOIN measurement_info m ON m.measurement_code = d.measurement_code WHERE m.organization_code IN (${orgs})`)
}

// ── 시작 전 확인 ────────────────────────────────────────────────────────

await db.connect()
const where = await pg(`SELECT current_database() AS db, inet_server_addr()::text AS addr`)
if (where[0].db !== 'thync_usage_dev') fail(`원본 DB 가 thync_usage_dev 가 아닙니다 (${where[0].db}) — dev2 전용 스크립트입니다`)
const foreign = myNum(`SELECT COUNT(*) FROM organization WHERE organization_code NOT IN (${TEST_ORGS.map((o) => `'${o}'`).join(',')})`)
if (foreign > 0) fail(`로컬 MySQL thync 에 가상 데이터가 아닌 기관이 ${foreign}개 있습니다 — 실제 제품 DB 로 보고 멈춥니다`)
await waitIngest(true)
if (spawnSync(AGENT, ['version']).status !== 0) fail(`Agent 가 없습니다: ${AGENT} (agents/thync-usage-agent/build.sh)`)

my(`DROP USER IF EXISTS '${RO_USER}'@'localhost'; DROP USER IF EXISTS '${RO_USER}'@'127.0.0.1'`)
const grantSql = execFileSync('sed', ['-e', `s/여기에_비밀번호/${RO_PASS}/g`, path.join(ROOT, 'agents/thync-usage-agent/deploy/create-db-user.sql')], { encoding: 'utf8' })
execFileSync('sudo', ['mysql'], { input: grantSql, stdio: ['pipe', 'ignore', 'inherit'] })

await wipeUsage()
seed()
const token1 = await issueToken(H1)
const token2 = await issueToken(H2)
const cfgA = writeConfig('smoke-a', token1)
const before = { others: await pgNum(`SELECT count(*) FROM raw_measurements WHERE hospital_code NOT LIKE 'HOSP-SMOKE%'`) }

try {
  // ── 0. 점검 명령 ─────────────────────────────────────────────────────
  section('0. check — 아무것도 보내지 않는 점검')
  {
    const r = agent(cfgA, ['check'])
    check('점검 통과 (종료 코드 0)', r.code === 0, r.out.slice(-400))
    check('병원 코드 표시', r.out.includes(H1))
    check('토큰 원문이 출력에 없다', !r.out.includes(token1))
    check('기관 2개 (템플릿 제외)', r.out.includes('기관 2개') && !r.out.includes('REF_ORG('))
    check('수신 서버에 실행 기록이 생기지 않았다', (await pgNum(`SELECT count(*) FROM agent_runs WHERE hospital_code = $1`, [H1])) === 0)
    check('서버도 등록되지 않았다', (await pgNum(`SELECT count(*) FROM agent_servers WHERE hospital_code = $1`, [H1])) === 0)
  }

  // ── 1. 첫 실행 ──────────────────────────────────────────────────────
  section('1. 첫 실행 — 전체 수신')
  const srcStatus = sourceStatusCount()
  {
    const r = agent(cfgA, ['run'], { STATUS_BATCH_ROWS: '500' }) // 여러 번에 나눠 보내는 경로
    check('성공 (종료 코드 0)', r.code === 0, r.out.slice(-600))
    const run = await lastRun(H1, 'smoke-a')
    check('실행 기록 ok · 전체 수신 · 대조 포함', run?.status === 'ok' && run.full_sync === true && run.reconcile === true, run)
    const srv = (await pg(`SELECT * FROM agent_servers WHERE hospital_code = $1 AND server_id = 'smoke-a'`, [H1]))[0]
    check('서버 등록 (병원 아래)', !!srv && srv.last_success_at !== null && srv.measurements_synced_until !== null && srv.reconciled_at !== null, srv)
    check('기관 2개 (템플릿 기관 제외)', (await pgNum(`SELECT count(*) FROM raw_organizations WHERE hospital_code = $1`, [H1])) === 2)
    const ward = (await pg(`SELECT * FROM raw_wards WHERE hospital_code = $1 AND ward_code = 'WA1'`, [H1]))[0]
    check('병동 3개 · 병상 수(전체 3, 활성 2) · 병동명', (await pgNum(`SELECT count(*) FROM raw_wards WHERE hospital_code = $1`, [H1])) === 3 && ward?.bed_count === 3 && ward?.bed_active_count === 2 && ward?.ward_name === '51병동', ward)
    const reg = await pg(`SELECT serial_number, premium, device_type FROM raw_device_registers WHERE hospital_code = $1 ORDER BY 1`, [H1])
    check('등록 기기 7대 · 구독형 값(1 / 0 / 없음) 그대로', reg.length === 7 && reg.find((x) => x.serial_number === 'E001')?.premium === 1 && reg.find((x) => x.serial_number === 'E002')?.premium === 0 && reg.find((x) => x.serial_number === 'S001')?.premium === null, reg)
    const ms = await pg(`SELECT measurement_code, measurement_status, parent_type, parent_measurement_code FROM raw_measurements WHERE hospital_code = $1 ORDER BY 1`, [H1])
    check('측정 7건 (대기·진행·종료·삭제 상태 모두, 템플릿 기관 제외)', ms.length === 7 && !ms.some((x) => x.measurement_code === 'MREF'), ms.map((x) => `${x.measurement_code}:${x.measurement_status}`))
    check('멀티리드 자식 측정이 부모와 구분된다', ms.find((x) => x.measurement_code === 'M5C')?.parent_type === 1 && ms.find((x) => x.measurement_code === 'M5C')?.parent_measurement_code === 'M5')
    const srcTimes = my(`SELECT CONCAT(DATE_FORMAT(start_date_time, '%Y-%m-%d %H:%i:%s'), '|', DATE_FORMAT(end_date_time, '%Y-%m-%d %H:%i:%s'), '|', DATE_FORMAT(modify_date_time, '%Y-%m-%d %H:%i:%s')) FROM measurement_info WHERE measurement_code = 'M1'`)
    const dstTimes = (await pg(`SELECT to_char(start_at, 'YYYY-MM-DD HH24:MI:SS') || '|' || to_char(end_at, 'YYYY-MM-DD HH24:MI:SS') || '|' || to_char(source_modified_at, 'YYYY-MM-DD HH24:MI:SS') AS t FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M1'`, [H1]))[0]?.t
    check('시각이 병원 DB 값 그대로 (변환 없음)', srcTimes === dstTimes, { srcTimes, dstTimes })
    const dev = await pg(`SELECT measurement_code, device_type, serial_number, premium, removed_at FROM raw_measurement_devices WHERE hospital_code = $1 ORDER BY 1, 2, 3`, [H1])
    check('측정 기기 7행 — 한 측정에 기기 2개면 2행', dev.length === 7 && dev.filter((x) => x.measurement_code === 'M1').length === 2, dev.map((x) => `${x.measurement_code}/${x.device_type}/${x.serial_number}`))
    check('측정 기기의 구독형 여부: 등록값 1 → 1, 등록값 없음 → 0, 미등록 기기 → 없음', dev.find((x) => x.serial_number === 'E001')?.premium === 1 && dev.find((x) => x.serial_number === 'S001')?.premium === 0 && dev.find((x) => x.serial_number === 'X999')?.premium === null, dev)
    const st = await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])
    check(`기기 상태 이력 ${srcStatus}행 전부 (템플릿 기관 제외)`, st === srcStatus, { st, srcStatus })
    const cur = (await pg(`SELECT c.* FROM status_cursors c JOIN agent_servers s ON s.id = c.server WHERE s.hospital_code = $1`, [H1]))[0]
    check('수신 위치 = 병원의 마지막 번호', cur?.last_id === myNum(`SELECT MAX(d.device_status_info_id) FROM device_status_info_2026 d JOIN measurement_info m ON m.measurement_code = d.measurement_code WHERE m.organization_code <> 'REF_ORG'`), cur)
    const parts = await pg(`SELECT tableoid::regclass::text AS part, count(*)::int AS n FROM raw_device_status WHERE hospital_code = $1 GROUP BY 1 ORDER BY 1`, [H1])
    check('달 조각에 나뉘어 들어갔다 (2025-12 포함), 시각 없는 1행만 기본 조각', parts.some((p) => p.part === 'raw_device_status_y2025m12') && parts.find((p) => p.part === 'raw_device_status_default')?.n === 1, parts)
    check('전송 건수 기록', run?.stats?.sent?.measurements === 7 && run?.stats?.sent?.device_status === srcStatus, run?.stats)
  }

  section('1-1. 환자 식별 정보가 넘어오지 않았다')
  {
    let dump = ''
    for (const t of HOSPITAL_TABLES) {
      const r = await pg(`SELECT COALESCE(string_agg(to_jsonb(x)::text, ' '), '') AS j FROM ${t} x WHERE hospital_code LIKE 'HOSP-SMOKE%'`)
      dump += r[0].j
    }
    const leaked = SECRETS.filter((s) => dump.includes(s))
    check(`원본 DB 전체(${Math.round(dump.length / 1024)}KB)에 이름·환자코드·주민번호·연락처·주소·생년월일·메모·MAC 이 없다`, leaked.length === 0, leaked)
    check('조회 전용 계정은 환자 테이블을 읽지 못한다', !myRo(`SELECT 1 FROM patient LIMIT 1`).ok)
    check('조회 전용 계정은 쓰지 못한다', !myRo(`UPDATE measurement_info SET duration = 1 WHERE measurement_code = 'M1'`).ok)
    check('조회 전용 계정은 필요한 테이블은 읽는다', myRo(`SELECT measurement_code FROM measurement_info LIMIT 1`).ok)
  }

  // ── 2. 다시 실행 ────────────────────────────────────────────────────
  section('2. 바로 다시 실행 — 같은 결과 (멱등)')
  {
    const snap = async () => JSON.stringify(await pg(`SELECT (SELECT count(*) FROM raw_measurements WHERE hospital_code = $1) m, (SELECT count(*) FROM raw_measurement_devices WHERE hospital_code = $1) d, (SELECT count(*) FROM raw_device_status WHERE hospital_code = $1) s, (SELECT count(*) FROM raw_measurement_devices WHERE hospital_code = $1 AND removed_at IS NOT NULL) rm`, [H1]))
    const b = await snap()
    const r = agent(cfgA)
    const run = await lastRun(H1, 'smoke-a')
    check('성공', r.code === 0, r.out.slice(-400))
    check('행 수 불변', b === (await snap()), { b, a: await snap() })
    check('변동분만 보냈다 (전체 아님, 대조 없음)', run?.full_sync === false && run?.reconcile === false, run)
    check('상태 이력 새로 보낸 것 0행', (run?.stats?.sent?.device_status ?? 0) === 0, run?.stats)
  }

  // ── 3. 기기 교체 ────────────────────────────────────────────────────
  section('3. 기기 교체 — 이전 기기가 남는다')
  {
    my(`UPDATE device_info SET serial_number = 'E003', device_code = 'DC3' WHERE measurement_code = 'M1' AND device_type = 1`)
    addStatus('M1', 1, 'E003', 40)
    const r = agent(cfgA)
    const dev = await pg(`SELECT serial_number, removed_at, premium FROM raw_measurement_devices WHERE hospital_code = $1 AND measurement_code = 'M1' ORDER BY 1`, [H1])
    check('성공', r.code === 0, r.out.slice(-400))
    check('M1 기기 3행: 이전 E001 은 빠진 시각만 기록, 새 E003·S001 은 현재', dev.length === 3 && dev.find((x) => x.serial_number === 'E001')?.removed_at !== null && dev.find((x) => x.serial_number === 'E003')?.removed_at === null && dev.find((x) => x.serial_number === 'S001')?.removed_at === null, dev)
    check('새 기기의 상태 이력 40행 도착', (await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1 AND serial_number = 'E003'`, [H1])) === 40)
    check('이전 기기의 상태 이력은 그대로', (await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1 AND serial_number = 'E001'`, [H1])) === 1200)
  }

  // ── 4. 측정 종료·새 측정 ─────────────────────────────────────────────
  section('4. 측정 종료, 새 측정')
  {
    my(`UPDATE measurement_info SET measurement_status = 3, end_date_time = NOW(), modify_date_time = NOW() WHERE measurement_code = 'M1';
        INSERT INTO measurement_info (measurement_code, parent_measurement_code, parent_type, \`lead\`, organization_code, shard, part, patient_code, ward_code, sickroom_code, sickbed_code, measurement_type, measurement_status, patient_status, name, start_date_time, end_date_time, duration, date_time, modify_date_time)
        VALUES ('M6', 'M6', 0, 2, 'SMOKE_A', '2026', 1, 'PT-0001', 'WA1', 'RA1', 'BA1', 'BM', 2, 3, '홍길동', NOW(), NOW() + INTERVAL 3 DAY, 72, NOW(), NOW());
        INSERT INTO device_info (measurement_code, parent_measurement_code, \`lead\`, device_type, device_code, serial_number, date_time) VALUES ('M6', 'M6', '2', 1, 'DC1', 'E001', NOW())`)
    const r = agent(cfgA)
    const m1 = (await pg(`SELECT measurement_status, last_changed_at > first_seen_at AS changed FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M1'`, [H1]))[0]
    check('성공', r.code === 0, r.out.slice(-400))
    check('M1 종료 반영 (상태 3, 변경 시각 갱신)', m1?.measurement_status === 3 && m1?.changed === true, m1)
    check('새 측정 M6 과 기기 도착', (await pgNum(`SELECT count(*) FROM raw_measurement_devices WHERE hospital_code = $1 AND measurement_code = 'M6'`, [H1])) === 1)
    check('종료된 M1 의 기기 행은 그대로 (빠진 것으로 표시되지 않음)', (await pgNum(`SELECT count(*) FROM raw_measurement_devices WHERE hospital_code = $1 AND measurement_code = 'M1' AND removed_at IS NULL`, [H1])) === 2)
  }

  // ── 5. 보관 기한 삭제 ────────────────────────────────────────────────
  section('5. 보관 기한 삭제 — 병원에서 기기 정보가 지워져도 중앙에는 남는다')
  {
    const stBefore = await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1 AND measurement_code = 'M2'`, [H1])
    my(`DELETE FROM device_status_info_2026 WHERE measurement_code = 'M2'; DELETE FROM device_info WHERE measurement_code = 'M2';
        UPDATE measurement_info SET measurement_status = 10, modify_date_time = NOW() WHERE measurement_code = 'M2'`)
    const r = agent(cfgA)
    const m2 = (await pg(`SELECT measurement_status, source_gone_at FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M2'`, [H1]))[0]
    const dev = await pg(`SELECT serial_number, removed_at FROM raw_measurement_devices WHERE hospital_code = $1 AND measurement_code = 'M2'`, [H1])
    check('성공', r.code === 0, r.out.slice(-400))
    check('M2 상태 10 으로 갱신, 사라짐 표시는 없음', m2?.measurement_status === 10 && m2?.source_gone_at === null, m2)
    check('M2 의 기기 행이 남아 있고 빠진 것으로 표시되지 않았다', dev.length === 1 && dev[0].removed_at === null, dev)
    check(`M2 의 상태 이력 ${stBefore}행이 남아 있다`, stBefore > 0 && (await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1 AND measurement_code = 'M2'`, [H1])) === stBefore)
  }

  // ── 6. 측정 삭제 감지 ────────────────────────────────────────────────
  section('6. 병원에서 삭제된 측정 — 대조로 찾아 표시만 한다')
  {
    my(`DELETE FROM device_info WHERE measurement_code = 'M3'; DELETE FROM measurement_info WHERE measurement_code = 'M3'`)
    const r0 = agent(cfgA) // 대조가 없는 실행에서는 모른다
    check('대조 없는 실행에서는 표시되지 않는다', r0.code === 0 && (await pgNum(`SELECT count(*) FROM raw_measurements WHERE hospital_code = $1 AND source_gone_at IS NOT NULL`, [H1])) === 0)
    const rw = spawnSync('npx', ['tsx', 'scripts/usage-rewind.mts', H1, 'smoke-a', '--reconcile', '--apply'], { cwd: ROOT, encoding: 'utf8' })
    check('되돌리기 스크립트: 다음 실행에 대조', rw.status === 0, rw.stdout + rw.stderr)
    const r = agent(cfgA)
    const gone = await pg(`SELECT measurement_code FROM raw_measurements WHERE hospital_code = $1 AND source_gone_at IS NOT NULL`, [H1])
    const run = await lastRun(H1, 'smoke-a')
    check('성공', r.code === 0, r.out.slice(-400))
    check('M3 만 "병원에서 사라짐" 으로 표시, 행은 남아 있다', gone.length === 1 && gone[0].measurement_code === 'M3', gone)
    check('대조 결과 기록 (사라짐 1, 누락 0)', run?.reconcile_result?.measurements?.gone_marked === 1 && run?.reconcile_result?.measurements?.missing === 0, run?.reconcile_result)
  }

  // ── 7. 누락 복구 ────────────────────────────────────────────────────
  section('7. 중앙에서 빠진 데이터 — 대조로 다시 받는다')
  {
    // 지난 대조 이후에 새로 받은 구간을 만든다 (대조를 마친 구간은 다시 세지 않는다)
    addStatus('M5', 1, 'E005', 400)
    check('새 상태 이력 400행 수신', agent(cfgA).code === 0 && (await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1 AND serial_number = 'E005'`, [H1])) === 400)
    const stTotal = await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])
    const devTotal = await pgNum(`SELECT count(*) FROM raw_measurement_devices WHERE hospital_code = $1`, [H1])
    // 누락 재현 ① 진행 중인 측정: M5 를 기기째 지우고, M6 의 상태 값을 틀리게 한다 → 매 실행의 변동분 전송으로 돌아온다
    await db.query(`DELETE FROM raw_measurement_devices WHERE hospital_code = $1 AND measurement_code = 'M5'`, [H1])
    await db.query(`DELETE FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M5'`, [H1])
    await db.query(`UPDATE raw_measurements SET measurement_status = 99 WHERE hospital_code = $1 AND measurement_code = 'M6'`, [H1])
    // 누락 재현 ② 오래전에 끝난 측정(변동분에 들지 않는다): M4 를 지우고, M2 의 상태 값을 틀리게 한다 → 대조로만 돌아온다
    my(`UPDATE measurement_info SET modify_date_time = NOW() - INTERVAL 30 DAY WHERE measurement_code = 'M2'`)
    await db.query(`DELETE FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M4'`, [H1])
    await db.query(`UPDATE raw_measurements SET measurement_status = 99 WHERE hospital_code = $1 AND measurement_code = 'M2'`, [H1])
    // 누락 재현 ③ 상태 이력 300행
    await db.query(
      `DELETE FROM raw_device_status WHERE hospital_code = $1 AND serial_number = 'E005'
         AND source_id IN (SELECT source_id FROM raw_device_status WHERE hospital_code = $1 AND serial_number = 'E005' ORDER BY source_id LIMIT 300)`,
      [H1],
    )
    await db.query(`UPDATE agent_servers SET reconciled_at = NULL WHERE hospital_code = $1`, [H1])
    const r = agent(cfgA)
    const run = await lastRun(H1, 'smoke-a')
    check('성공', r.code === 0, r.out.slice(-600))
    check('진행 중 측정: 빠진 M5 가 기기와 함께 다시 들어왔다', (await pgNum(`SELECT count(*) FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M5'`, [H1])) === 1 && (await pgNum(`SELECT count(*) FROM raw_measurement_devices WHERE hospital_code = $1`, [H1])) === devTotal)
    check('진행 중 측정: 값이 달랐던 M6 이 바로잡혔다', (await pgNum(`SELECT measurement_status FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M6'`, [H1])) === 2)
    check('오래된 측정: 대조가 누락 2건을 찾아 다시 받았다 (M4 복구, M2 바로잡힘)', run?.reconcile_result?.measurements?.missing === 2 && run?.stats?.sent?.measurements_resent === 2 && (await pgNum(`SELECT count(*) FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M4'`, [H1])) === 1 && (await pgNum(`SELECT measurement_status FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M2'`, [H1])) === 10, { rr: run?.reconcile_result, sent: run?.stats?.sent })
    check('대조로 다시 받은 M2 의 기기 행은 여전히 남아 있다 (상태 10 은 기기를 건드리지 않는다)', (await pgNum(`SELECT count(*) FROM raw_measurement_devices WHERE hospital_code = $1 AND measurement_code = 'M2' AND removed_at IS NULL`, [H1])) === 1)
    const sc = run?.reconcile_result?.status_check?.[0]
    check('대조 결과: 상태 이력 행 수 부족 발견 → 수신 위치 되돌림', sc?.ok === false && sc?.source - sc?.received === 300, sc)
    const r2 = agent(cfgA)
    check('다음 실행에서 상태 이력 300행 복구', r2.code === 0 && (await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])) === stTotal, { now: await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1]), stTotal })
    await db.query(`UPDATE agent_servers SET reconciled_at = NULL WHERE hospital_code = $1`, [H1])
    const r3 = agent(cfgA)
    const run3 = await lastRun(H1, 'smoke-a')
    check('그다음 대조는 차이 없음 → 대조 완료 번호 전진', r3.code === 0 && run3?.reconcile_result?.status_check?.[0]?.ok === true && run3?.reconcile_result?.measurements?.missing === 0, run3?.reconcile_result)
  }

  // ── 8. 수동 재전송 ──────────────────────────────────────────────────
  section('8. 수동 재전송 — 중앙에서 위치 되돌리기 / 현장 옵션')
  {
    const total = await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])
    const dry = spawnSync('npx', ['tsx', 'scripts/usage-rewind.mts', H1, '--status=0', '--measurements'], { cwd: ROOT, encoding: 'utf8' })
    const cur0 = (await pg(`SELECT c.last_id FROM status_cursors c JOIN agent_servers s ON s.id = c.server WHERE s.hospital_code = $1`, [H1]))[0]?.last_id
    check('되돌리기 미리 보기는 아무것도 바꾸지 않는다', dry.status === 0 && dry.stdout.includes('미리 보기') && cur0 > 0, dry.stdout)
    const ap = spawnSync('npx', ['tsx', 'scripts/usage-rewind.mts', H1, '--status=0', '--measurements', '--apply'], { cwd: ROOT, encoding: 'utf8' })
    check('되돌리기 적용', ap.status === 0, ap.stdout + ap.stderr)
    const r = agent(cfgA)
    const run = await lastRun(H1, 'smoke-a')
    check('다음 실행이 측정 전체·상태 이력 전체를 다시 보냈다', r.code === 0 && run?.full_sync === true && run?.stats?.sent?.device_status === sourceStatusCount(`'SMOKE_A','SMOKE_B'`), run?.stats)
    check('다시 받아도 행 수 불변', (await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])) === total)
    const r2 = agent(cfgA, ['run', '--full', '--status-from', '100'])
    const run2 = await lastRun(H1, 'smoke-a')
    const expectFrom100 = myNum(`SELECT COUNT(*) FROM device_status_info_2026 d JOIN measurement_info m ON m.measurement_code = d.measurement_code WHERE m.organization_code <> 'REF_ORG' AND d.device_status_info_id >= 100`)
    check('현장 옵션 --full --status-from 100', r2.code === 0 && run2?.full_sync === true && run2?.stats?.sent?.device_status === expectFrom100, { sent: run2?.stats?.sent, expectFrom100 })
  }

  // ── 9. 전송 중단·재개 ────────────────────────────────────────────────
  section('9. 전송 중단 후 재개')
  {
    const centerBefore = await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])
    addStatus('M5', 1, 'E005', 450)
    const total = centerBefore + 450
    const r1 = agent(cfgA, ['run'], { STATUS_BATCH_ROWS: '100', STATUS_MAX_BATCHES: '2' })
    const run1 = await lastRun(H1, 'smoke-a')
    check('전송 상한(2회 × 100행)에서 멈추고 성공으로 끝난다', r1.code === 0 && run1?.stats?.sent?.device_status === 200 && run1?.stats?.status_behind === true, run1?.stats)
    const bad = writeConfig('smoke-a-bad', token1, { USAGE_ENDPOINT: 'http://127.0.0.1:3999/api/usage-ingest/v1', USAGE_SERVER_ID: 'smoke-a' })
    const t0 = Date.now()
    const rBad = agent(bad)
    check(`수신 서버에 연결할 수 없으면 실패 (종료 코드 1, 재시도 ${Math.round((Date.now() - t0) / 1000)}초)`, rBad.code === 1 && rBad.out.includes('연결할 수 없습니다'), rBad.out.slice(-200))
    execFileSync('pm2', ['stop', 'thync-usage-ingest-dev'], { env: CLEAN_ENV, stdio: 'ignore' })
    await waitIngest(false)
    const rDown = agent(cfgA)
    execFileSync('pm2', ['start', 'thync-usage-ingest-dev'], { env: CLEAN_ENV, stdio: 'ignore' })
    await waitIngest(true)
    check('수신부가 내려가 있는 동안의 실행은 실패', rDown.code === 1, rDown.out.slice(-200))
    const r2 = agent(cfgA)
    const got = await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])
    check('수신부가 올라온 뒤 실행 — 끊긴 지점부터 이어서 전부 도착', r2.code === 0 && got === total, { got, total })
    const badTok = writeConfig('smoke-a-tok', 'tua_' + 'f'.repeat(48), { USAGE_SERVER_ID: 'smoke-a' })
    const rTok = agent(badTok)
    check('잘못된 토큰은 거부 (다시 시도하지 않고 바로 실패)', rTok.code === 1 && rTok.out.includes('401'), rTok.out.slice(-200))
  }

  // ── 10. 용량 안전장치 ────────────────────────────────────────────────
  section('10. 용량 안전장치 — 상한을 넘으면 상태 이력만 멈춘다')
  {
    restartIngest('1')
    await waitIngest(true)
    addStatus('M6', 1, 'E001', 120)
    my(`UPDATE measurement_info SET ward_code = 'WA2', modify_date_time = NOW() WHERE measurement_code = 'M6'`)
    const stBefore = await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])
    const r = agent(cfgA)
    const run = await lastRun(H1, 'smoke-a')
    check('성공으로 끝나고 상태 이력은 건너뜀', r.code === 0 && run?.stats?.status_paused === true && (await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])) === stBefore, run?.stats)
    check('측정은 계속 받는다 (M6 병동 변경 반영)', (await pg(`SELECT ward_code FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'M6'`, [H1]))[0]?.ward_code === 'WA2')
    resetIngest()
    await waitIngest(true)
    const r2 = agent(cfgA)
    check('상한을 풀면 멈춘 동안의 상태 이력 120행이 이어서 들어온다', r2.code === 0 && (await pgNum(`SELECT count(*) FROM raw_device_status WHERE hospital_code = $1`, [H1])) === stBefore + 120)
  }

  // ── 11. 병원 구분 ────────────────────────────────────────────────────
  section('11. 병원·서버 구분')
  {
    const cfgB = writeConfig('smoke-b', token1, { ORG_INCLUDE: 'SMOKE_B' })
    const rB = agent(cfgB)
    const srvB = (await pg(`SELECT id FROM agent_servers WHERE hospital_code = $1 AND server_id = 'smoke-b'`, [H1]))[0]
    check('같은 병원의 두 번째 서버가 따로 등록된다', rB.code === 0 && !!srvB, rB.out.slice(-300))
    const bOrgs = await pg(`SELECT DISTINCT organization_code FROM raw_measurements WHERE server = $1`, [srvB?.id])
    check('기관 지정(ORG_INCLUDE) — 그 기관의 행만 보낸다', bOrgs.length === 1 && bOrgs[0].organization_code === 'SMOKE_B' && (await pgNum(`SELECT count(*) FROM raw_device_status WHERE server = $1`, [srvB?.id])) === sourceStatusCount(`'SMOKE_B'`), bOrgs)
    check('같은 측정코드가 두 서버에 있어도 섞이지 않는다 (MB1 2행)', (await pgNum(`SELECT count(*) FROM raw_measurements WHERE hospital_code = $1 AND measurement_code = 'MB1'`, [H1])) === 2)
    const cfgH2 = writeConfig('smoke-a-h2', token2, { USAGE_SERVER_ID: 'smoke-a' })
    const rH2 = agent(cfgH2)
    check('다른 병원 토큰 — 같은 서버 이름이어도 다른 병원으로 들어간다', rH2.code === 0 && (await pgNum(`SELECT count(*) FROM raw_measurements WHERE hospital_code = $1`, [H2])) === myNum(`SELECT COUNT(*) FROM measurement_info WHERE organization_code <> 'REF_ORG'`), rH2.out.slice(-300))
    const nullHosp = await pgNum(`SELECT (SELECT count(*) FROM raw_measurements WHERE hospital_code IS NULL) + (SELECT count(*) FROM raw_device_status WHERE hospital_code IS NULL) + (SELECT count(*) FROM raw_measurement_devices WHERE hospital_code IS NULL)`)
    check('모든 원본 행에 병원 코드가 있다', nullHosp === 0)
    const cross = await pgNum(`SELECT count(*) FROM raw_measurements m JOIN agent_servers s ON s.id = m.server WHERE m.hospital_code <> s.hospital_code`)
    check('행의 병원 코드 = 서버가 속한 병원', cross === 0)
    const run1 = await lastRun(H1, 'smoke-a')
    const steal = await http('POST', '/v1/push', { token: token2, body: { run_id: Number(run1.id), dataset: 'organizations', rows: [{ organization_code: 'HACK' }] } })
    check('다른 병원의 실행 번호로는 보낼 수 없다', steal.status === 400 && (await pgNum(`SELECT count(*) FROM raw_organizations WHERE organization_code = 'HACK'`)) === 0, steal)
  }

  // ── 12. 수신부 방어 ──────────────────────────────────────────────────
  section('12. 수신부 요청 검사')
  {
    const hs = { server_id: 'guard', db_now: '2026-11-18 10:00:00', status_years: [2026] }
    check('토큰 없음 → 401', (await http('POST', '/v1/handshake', { body: hs })).status === 401)
    check('GET 으로 호출 → 405', (await http('GET', '/v1/handshake', { token: token1 })).status === 405)
    check('없는 경로 → 404', (await http('POST', '/v1/nope', { token: token1, body: {} })).status === 404)
    check('깨진 압축 본문 → 400', (await http('POST', '/v1/handshake', { token: token1, raw: Buffer.from('not gzip'), gzip: true })).status === 400)
    check('JSON 이 아닌 본문 → 400', (await http('POST', '/v1/handshake', { token: token1, raw: Buffer.from('{oops') })).status === 400)
    check('서버 이름에 허용되지 않는 문자 → 400', (await http('POST', '/v1/handshake', { token: token1, body: { ...hs, server_id: 'a b;drop' } })).status === 400)
    const ok = await http('POST', '/v1/handshake', { token: token1, body: hs })
    check('정상 시작 → 실행 번호', ok.status === 200 && typeof ok.json?.run_id === 'number', ok)
    const runId = ok.json?.run_id
    check('알 수 없는 종류 → 400', (await http('POST', '/v1/push', { token: token1, body: { run_id: runId, dataset: 'users', rows: [] } })).status === 400)
    check('행 수 상한 초과(5,001행) → 400', (await http('POST', '/v1/push', { token: token1, body: { run_id: runId, dataset: 'wards', rows: Array.from({ length: 5001 }, (_, i) => ({ ward_code: `W${i}` })) } })).status === 400)
    check('시각 형식이 아닌 값 → 400', (await http('POST', '/v1/push', { token: token1, body: { run_id: runId, dataset: 'measurements', rows: [{ measurement_code: 'X', start_at: "2026-11-18'; DROP TABLE x;--" }] } })).status === 400)
    const inj = await http('POST', '/v1/push', { token: token1, body: { run_id: runId, dataset: 'wards', rows: [{ ward_code: "W'); DROP TABLE raw_wards;--", ward_name: 'x' }] } })
    check('SQL 로 보이는 문자열은 값으로만 저장된다', inj.status === 200 && (await pgNum(`SELECT count(*) FROM raw_wards WHERE ward_code LIKE '%DROP TABLE%'`)) === 1 && (await pgNum(`SELECT count(*) FROM raw_wards`)) > 1)
    const fin = await http('POST', '/v1/finish', { token: token1, body: { run_id: runId, status: 'failed', error: 'smoke', complete: [] } })
    check('종료 보고 → 이후 같은 실행 번호로는 보낼 수 없다', fin.status === 200 && (await http('POST', '/v1/push', { token: token1, body: { run_id: runId, dataset: 'wards', rows: [] } })).status === 400)
    await db.query(`UPDATE agent_tokens SET active = false WHERE hospital_code = $1`, [H2])
    check('폐기한 토큰 → 401', (await http('POST', '/v1/handshake', { token: token2, body: hs })).status === 401)
  }

  // ── 13. 운영 스크립트 ────────────────────────────────────────────────
  section('13. 운영 스크립트')
  {
    const st = spawnSync('npx', ['tsx', 'scripts/usage-status.mts', H1], { cwd: ROOT, encoding: 'utf8' })
    check('수신 현황: 병원의 서버 2대와 최근 실행 표시', st.status === 0 && st.stdout.includes(`${H1} / smoke-a`) && st.stdout.includes(`${H1} / smoke-b`) && st.stdout.includes('최근 실행 10건'), st.stdout.slice(0, 600) + st.stderr)
    const mv = spawnSync('npx', ['tsx', 'scripts/usage-move-hospital.mts', H1, 'HOSP-000026'], { cwd: ROOT, encoding: 'utf8' })
    check('병원 코드 변경 미리 보기 — 테이블별 행 수 표시, 실제 변경 없음', mv.status === 0 && mv.stdout.includes('미리 보기') && (await pgNum(`SELECT count(*) FROM raw_measurements WHERE hospital_code = $1`, [H1])) > 0, mv.stdout + mv.stderr)
    const mvBad = spawnSync('npx', ['tsx', 'scripts/usage-move-hospital.mts', H1, 'HOSP-NOPE'], { cwd: ROOT, encoding: 'utf8' })
    check('본체에 없는 병원 코드로는 바꿀 수 없다', mvBad.status === 1)
    const tk = spawnSync('npx', ['tsx', 'scripts/usage-issue-token.mts', 'HOSP-NOPE'], { cwd: ROOT, encoding: 'utf8' })
    check('본체에 없는 병원에는 토큰을 발급하지 않는다', tk.status === 1)
  }

  section('14. 다른 병원의 행')
  check('검증용 병원 밖의 원본 행 수 불변', (await pgNum(`SELECT count(*) FROM raw_measurements WHERE hospital_code NOT LIKE 'HOSP-SMOKE%'`)) === before.others)
} finally {
  resetIngest()
  await waitIngest(true).catch(() => {})
  if (!flag('--keep')) await wipeUsage()
  my(`DROP USER IF EXISTS '${RO_USER}'@'localhost'; DROP USER IF EXISTS '${RO_USER}'@'127.0.0.1'`)
  rmSync(work, { recursive: true, force: true })
  await db.end()
}

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`)
process.exit(failed > 0 ? 1 : 0)
