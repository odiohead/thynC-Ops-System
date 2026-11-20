/**
 * 수집 병원 등록 · 서버 키 · 설치 스크립트 검증 (projects/usage_agent_enroll_design.md) — dev2 전용
 *
 *   npx tsx scripts/usage-enroll-smoke.mts
 *
 * 필요한 것: PM2 수신부(thync-usage-ingest-dev, 새 빌드) · 원본 DB thync_usage_dev(0002 적용) ·
 *           로컬 MySQL 의 가상 제품 DB thync(usage-collect-smoke.mts 가 만든 것) · Agent 빌드(agents/thync-usage-agent/build.sh) · sudo
 * 원본 DB 에서는 검증용 병원 코드(HOSP-SMOKE*) 행만 만들고 지운다. 시스템에는 설치하지 않는다 —
 * 설치 스크립트는 임시 디렉토리(DESTDIR) 아래에 --no-service 로 실행한다(계정·systemd 를 건드리지 않음).
 * 로컬 MySQL 에는 조회 전용 계정(thync_usage_ro)을 만들었다가 끝나면 지운다.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../lib/prisma'
import { getAgentOverview, ingestAdmin } from '../lib/usage/agents'
import { getUsageOverview } from '../lib/usage/overview'
import { HOSPITAL_TABLES, fail, usageDb } from './usage-lib.mts'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const AGENT = path.join(ROOT, 'agents/thync-usage-agent/dist/thync-usage-agent')
const BASE = `http://127.0.0.1:${process.env.USAGE_INGEST_PORT ?? 3110}/api/usage-ingest`
const INTERNAL = BASE.replace('/api/usage-ingest', '/internal/v1')
const H = 'HOSP-SMOKE3'
const RO_USER = 'thync_usage_ro'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
const my = (sql: string) => execFileSync('sudo', ['-n', 'mysql', '-N', '-B', '-e', sql], { encoding: 'utf8' }).trim()
async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}
const agent = (...args: string[]) => {
  const r = spawnSync(AGENT, args, { encoding: 'utf8', timeout: 90_000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const valueOf = (text: string, key: string) => text.split('\n').find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1) ?? ''
const handshake = (key: string, serverId: string) => post(`${BASE}/v1/handshake`, { server_id: serverId, db_now: '2026-11-20 10:00:00', dry_run: true }, { authorization: `Bearer ${key}` })

const db = usageDb()
await db.connect()
const where = await db.query(`SELECT current_database() AS db`)
if (where.rows[0].db !== 'thync_usage_dev') fail(`원본 DB 가 thync_usage_dev 가 아닙니다 (${where.rows[0].db}) — dev2 전용 스크립트입니다`)
if (spawnSync(AGENT, ['version']).status !== 0) fail(`Agent 가 없습니다: ${AGENT} (agents/thync-usage-agent/build.sh)`)
if (my(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='thync' AND table_name='measurement_info'`) !== '1') fail('로컬 MySQL 에 가상 제품 DB thync 가 없습니다 (usage-collect-smoke.mts 를 먼저 한 번 실행)')

async function wipe() {
  for (const t of [...HOSPITAL_TABLES].reverse()) {
    if (t === 'agent_servers') await db.query(`DELETE FROM status_cursors WHERE server IN (SELECT id FROM agent_servers WHERE hospital_code LIKE 'HOSP-SMOKE%')`)
    await db.query(`DELETE FROM ${t} WHERE hospital_code LIKE 'HOSP-SMOKE%'`)
  }
  await db.query(`DELETE FROM recon_measurement_index WHERE run_id NOT IN (SELECT id FROM agent_runs)`)
}
const dropRoUser = () => my(`DROP USER IF EXISTS '${RO_USER}'@'localhost'; DROP USER IF EXISTS '${RO_USER}'@'127.0.0.1'`)
await wipe()
dropRoUser()
const othersBefore = Number((await db.query(`SELECT count(*)::int AS n FROM agent_servers WHERE hospital_code NOT LIKE 'HOSP-SMOKE%'`)).rows[0].n)
const dest = mkdtempSync(path.join(os.tmpdir(), 'tua-enroll-'))

try {
  console.log('■ 등록 전 · 관리 호출의 문지기')
  {
    const r = await post(`${BASE}/v1/enroll/check`, { hospital_code: H })
    check('등록하지 않은 병원코드 → 404 not_registered', r.status === 404 && r.body.code === 'not_registered', r)
    check('Agent enroll-check: 등록하지 않은 병원 → 종료 코드 3', agent('enroll-check', '--endpoint', `${BASE}/v1`, '--hospital', H).code === 3)
    const e = await post(`${BASE}/v1/enroll`, { hospital_code: H, server_id: 'smoke-a' })
    check('등록하지 않은 병원에는 서버를 등록할 수 없다', e.status === 404 && e.body.code === 'not_registered', e)
    const secret = (await db.query(`SELECT secret FROM agent_admin_secret`)).rows[0].secret as string
    const body = { hospital_code: H, hospital_name: '스모크병원', expected_servers: 2 }
    check('관리 호출: 값 없이 → 404', (await post(`${INTERNAL}/enrollments`, body)).status === 404)
    check('관리 호출: 틀린 값 → 404', (await post(`${INTERNAL}/enrollments`, body, { 'x-usage-admin': 'x'.repeat(64) })).status === 404)
    check('관리 호출: 맞는 값이라도 프록시를 거친 요청(x-real-ip)이면 → 404', (await post(`${INTERNAL}/enrollments`, body, { 'x-usage-admin': secret, 'x-real-ip': '1.2.3.4' })).status === 404)
    check('관리 호출은 밖으로 열린 경로(/api/usage-ingest/internal/…)에 없다', (await post(`${BASE}/internal/v1/enrollments`, body, { 'x-usage-admin': secret })).status === 404)
    check('위 시도로 등록이 생기지 않았다', Number((await db.query(`SELECT count(*)::int AS n FROM agent_enrollments WHERE hospital_code = $1`, [H])).rows[0].n) === 0)
  }

  console.log('\n■ 병원 등록 → 병원코드 확인')
  {
    const out = await ingestAdmin('/enrollments', { hospital_code: H, hospital_name: '스모크병원', expected_servers: 2, by: 'smoke' })
    check('병원 등록 (서버 2대)', out.created === true, out)
    let dup = ''
    await ingestAdmin('/enrollments', { hospital_code: H, hospital_name: '다른이름', expected_servers: 9, by: 'smoke', create_only: true }).catch((e) => (dup = (e as Error).message))
    check('새 등록 호출(create_only)은 이미 등록된 병원을 바꾸지 않고 거부', /이미 등록된 병원/.test(dup), dup)
    const r = await post(`${BASE}/v1/enroll/check`, { hospital_code: H })
    check('확인: 병원명·자리 2', r.status === 200 && r.body.hospital_name === '스모크병원' && r.body.slots_left === 2 && r.body.expected_servers === 2, r)
    const a = agent('enroll-check', '--endpoint', `${BASE}/v1`, '--hospital', H)
    check('Agent enroll-check: 병원명·자리 출력', a.code === 0 && valueOf(a.out, 'hospital_name') === '스모크병원' && valueOf(a.out, 'slots_left') === '2', a)
  }

  console.log('\n■ 설치 스크립트 — 내려받아 실행 (임시 디렉토리, 시스템 미설치)')
  let keyA = ''
  const conf = path.join(dest, 'etc/thync-usage-agent/agent.env')
  {
    const latest = (await (await fetch(`${BASE}/agent/latest`)).json()) as { version: string; file: string; sha256: string }
    const script = await (await fetch(`${BASE}/agent/install.sh`)).text()
    const tarball = Buffer.from(await (await fetch(`${BASE}/agent/${latest.file}`)).arrayBuffer())
    check('설치 스크립트에 적힌 SHA-256 = 실제 설치 묶음의 SHA-256', script.includes(`SHA='${createHash('sha256').update(tarball).digest('hex')}'`) && latest.sha256 === createHash('sha256').update(tarball).digest('hex'))
    check('설치 스크립트에 수신 주소가 들어 있다', script.includes(`BASE='${BASE}'`), script.split('\n').find((l) => l.startsWith('BASE=')))
    check('설치 묶음 버전 = 빌드한 Agent 버전', latest.version === agent('version').out.trim(), latest)
    const boot = path.join(dest, 'install.sh')
    writeFileSync(boot, script)

    const before = my(`SELECT GROUP_CONCAT(CONCAT(user,'@',host,':',authentication_string) ORDER BY user, host SEPARATOR '|') FROM mysql.user WHERE user <> '${RO_USER}'`)
    const run = (...args: string[]) => spawnSync('sudo', ['-n', 'env', `DESTDIR=${dest}`, 'bash', boot, '--no-service', ...args], { encoding: 'utf8', timeout: 120_000 })
    const bad = run('--hospital', 'HOSP-SMOKE9', '--server', 'smoke-a', '--yes')
    check('등록하지 않은 병원코드로 실행 → 멈춤(설정 파일 없음)', bad.status !== 0 && /등록되지 않은 병원코드/.test(bad.stderr) && spawnSync('sudo', ['-n', 'test', '-e', conf]).status !== 0, bad.stderr.slice(-300))
    check('멈춘 실행은 DB 계정도 서버 자리도 쓰지 않았다', my(`SELECT COUNT(*) FROM mysql.user WHERE user='${RO_USER}'`) === '0' && Number((await db.query(`SELECT count(*)::int AS n FROM agent_servers WHERE hospital_code LIKE 'HOSP-SMOKE%'`)).rows[0].n) === 0)

    const ok = run('--hospital', H, '--server', 'smoke-a', '--yes')
    check('병원코드 + 서버 이름으로 설치 완료', ok.status === 0 && /설치 완료/.test(ok.stdout), (ok.stdout + ok.stderr).slice(-600))
    check('확인 문구에 병원명과 등록 현황', /스모크병원\(HOSP-SMOKE3\)에 등록합니다/.test(ok.stdout) && /0\/2대 등록됨/.test(ok.stdout), ok.stdout.slice(0, 600))
    check('점검(check)이 설치 중에 통과', /\[정상\]/.test(ok.stdout) && !/\[실패\]/.test(ok.stdout), ok.stdout.slice(-800))
    const env = execFileSync('sudo', ['-n', 'cat', conf], { encoding: 'utf8' })
    keyA = valueOf(env, 'USAGE_TOKEN')
    check('설정 파일: 서버 키 · 서버 이름 · 수신 주소 · DB 계정', keyA.startsWith('tuk_') && valueOf(env, 'USAGE_SERVER_ID') === 'smoke-a' && valueOf(env, 'USAGE_ENDPOINT') === `${BASE}/v1` && valueOf(env, 'DB_USER') === RO_USER && valueOf(env, 'DB_PASSWORD').length >= 20)
    check('설정 파일 권한 0640', execFileSync('sudo', ['-n', 'stat', '-c', '%a', conf], { encoding: 'utf8' }).trim() === '640')

    // DB 계정: 새 계정만 생기고, 조회만 된다
    const after = my(`SELECT GROUP_CONCAT(CONCAT(user,'@',host,':',authentication_string) ORDER BY user, host SEPARATOR '|') FROM mysql.user WHERE user <> '${RO_USER}'`)
    check('DB: 다른 계정은 그대로 (계정 목록·비밀번호 해시 동일)', before === after)
    check('DB: 새 계정 2개(localhost · 127.0.0.1), 권한은 SELECT 뿐', my(`SELECT COUNT(*) FROM mysql.user WHERE user='${RO_USER}'`) === '2' && my(`SELECT COUNT(*) FROM mysql.tables_priv WHERE User='${RO_USER}' AND Table_priv <> 'Select'`) === '0' && my(`SELECT COUNT(*) FROM mysql.db WHERE User='${RO_USER}'`) === '0')
    const asRo = (sql: string) => spawnSync('mysql', ['-N', '-B', '-h', '127.0.0.1', '-u', RO_USER, `-p${valueOf(env, 'DB_PASSWORD')}`, 'thync', '-e', sql], { encoding: 'utf8' })
    check('DB: 새 계정으로 조회는 되고 쓰기는 거부', asRo('SELECT COUNT(*) FROM measurement_info').status === 0 && asRo('DELETE FROM measurement_info').status !== 0 && asRo('CREATE TABLE device_status_info_2033 (a int)').status !== 0)

    const server = (await db.query(`SELECT key_hash, key_prefix, enrolled_at, blocked_at FROM agent_servers WHERE hospital_code = $1 AND server_id = 'smoke-a'`, [H])).rows[0]
    check('수신부: 서버가 등록되고 키는 해시로만 저장', !!server && server.key_hash === createHash('sha256').update(keyA).digest('hex') && server.key_prefix === keyA.slice(0, 8) && !!server.enrolled_at)

    const again = run('--hospital', H, '--server', 'smoke-a', '--yes')
    const env2 = execFileSync('sudo', ['-n', 'cat', conf], { encoding: 'utf8' })
    check('다시 실행 → 기존 설정 유지 (등록을 다시 하지 않음, 키 그대로)', again.status === 0 && /기존 설정 유지/.test(again.stdout) && valueOf(env2, 'USAGE_TOKEN') === keyA, (again.stdout + again.stderr).slice(-300))
  }

  console.log('\n■ 설치한 설정으로 수집 실행')
  {
    const run = spawnSync('sudo', ['-n', AGENT, 'run', '--config', conf], { encoding: 'utf8' })
    check('Agent run 성공', run.status === 0, (run.stdout + run.stderr).slice(-400))
    // 빈도 제한: 프록시를 거친 요청(x-real-ip)은 IP 당 10분에 30회까지
    let limited = 0
    for (let i = 0; i < 35; i++) if ((await post(`${BASE}/v1/enroll/check`, { hospital_code: 'HOSP-SMOKE9' }, { 'x-real-ip': '203.0.113.9' })).status === 429) limited++
    check('등록 확인 빈도 제한 — 같은 IP 에서 35회 중 5회는 거부', limited === 5, limited)
    const r = (await db.query(`SELECT r.status, s.last_success_at FROM agent_runs r JOIN agent_servers s ON s.id = r.server WHERE r.hospital_code = $1 ORDER BY r.id DESC LIMIT 1`, [H])).rows[0]
    check('수신부: 실행 기록 ok · 서버의 마지막 수신 시각 기록', r?.status === 'ok' && !!r.last_success_at, r)
    const sent = Number((await db.query(`SELECT count(*)::int AS n FROM raw_measurements WHERE hospital_code = $1`, [H])).rows[0].n)
    const source = Number(my(`SELECT COUNT(*) FROM thync.measurement_info WHERE organization_code <> 'REF_ORG' OR organization_code IS NULL`))
    check(`원본 행 도착 (측정 ${sent}건 = 제품 DB ${source}건)`, sent === source && sent > 0, { sent, source })
  }

  console.log('\n■ 자리 수 · 서버 이름 · 키와 서버 이름의 묶음')
  let keyB = ''
  {
    const b = agent('enroll', '--endpoint', `${BASE}/v1`, '--hospital', H, '--server', 'smoke-b')
    keyB = valueOf(b.out, 'server_key')
    check('두 번째 서버 등록 (2/2)', b.code === 0 && keyB.startsWith('tuk_') && valueOf(b.out, 'registered_servers') === '2', b)
    const c = agent('enroll', '--endpoint', `${BASE}/v1`, '--hospital', H, '--server', 'smoke-c')
    check('세 번째 서버 → 자리 없음 (종료 코드 4)', c.code === 4 && /자리가 없습니다/.test(c.err), c)
    const a = agent('enroll', '--endpoint', `${BASE}/v1`, '--hospital', H, '--server', 'smoke-a')
    check('같은 이름으로 다시 등록 → 거부 (종료 코드 5)', a.code === 5 && /이미 등록/.test(a.err), a)
    check('자기 이름으로 접속 → 통과', (await handshake(keyB, 'smoke-b')).status === 200)
    const wrong = await handshake(keyB, 'smoke-a')
    check('다른 서버 이름으로 접속 → 403', wrong.status === 403, wrong)
    check('없는 키 → 401', (await handshake('tuk_' + '0'.repeat(48), 'smoke-b')).status === 401)
    const o = await getAgentOverview()
    const h = o.hospitals.find((x) => x.hospitalCode === H)
    check('에이전트 관리 조회: 서버 2대 중 1대만 수집 → 일부 수집', h?.state === 'partial' && h.collectingServers === 1 && h.registeredServers === 2 && h.expectedServers === 2, h && { state: h.state, c: h.collectingServers, r: h.registeredServers })
    check('에이전트 관리 조회: 서버별 인증 방식·수집 여부', h?.servers.find((s) => s.serverId === 'smoke-a')?.collecting === true && h?.servers.find((s) => s.serverId === 'smoke-b')?.collecting === false && h?.servers.every((s) => s.auth === 'key') === true)
    const ov = (await getUsageOverview('ecg', 'all')).rows.find((x) => x.hospitalCode === H)
    check('전체 병원 화면 조회: 일부 수집 표시용 값 (수집 1 / 대수 2)', ov?.receive.collecting === 1 && ov.receive.expected === 2, ov?.receive)
  }

  console.log('\n■ 차단 · 재등록 허용 · 대수 변경 · 등록 해제')
  {
    const idOf = async (name: string) => Number((await db.query(`SELECT id FROM agent_servers WHERE hospital_code = $1 AND server_id = $2`, [H, name])).rows[0].id)
    await ingestAdmin('/servers/action', { server: await idOf('smoke-b'), action: 'block', by: 'smoke' })
    check('차단한 서버의 키 → 403', (await handshake(keyB, 'smoke-b')).status === 403)
    const c = agent('enroll', '--endpoint', `${BASE}/v1`, '--hospital', H, '--server', 'smoke-c')
    check('차단하면 자리가 다시 열린다 → 세 번째 서버 등록', c.code === 0, c)
    const b2 = agent('enroll', '--endpoint', `${BASE}/v1`, '--hospital', H, '--server', 'smoke-b')
    check('차단된 이름으로는 등록할 수 없다 (종료 코드 6)', b2.code === 6, b2)
    await ingestAdmin('/servers/action', { server: await idOf('smoke-b'), action: 'unblock', by: 'smoke' })
    check('차단 해제 → 다시 접속', (await handshake(keyB, 'smoke-b')).status === 200)

    await ingestAdmin('/servers/action', { server: await idOf('smoke-a'), action: 'allow_reenroll', by: 'smoke' })
    const a = agent('enroll', '--endpoint', `${BASE}/v1`, '--hospital', H, '--server', 'smoke-a')
    const keyA2 = valueOf(a.out, 'server_key')
    check('재등록 허용 → 같은 이름으로 새 키', a.code === 0 && keyA2.startsWith('tuk_') && keyA2 !== keyA, a)
    check('이전 키는 못 쓰고 새 키로 접속', (await handshake(keyA, 'smoke-a')).status === 401 && (await handshake(keyA2, 'smoke-a')).status === 200)
    check('재등록은 한 번만 — 다시 요청하면 거부', agent('enroll', '--endpoint', `${BASE}/v1`, '--hospital', H, '--server', 'smoke-a').code === 5)
    check('재등록으로 받은 기록은 그대로 (같은 서버 행)', Number((await db.query(`SELECT count(*)::int AS n FROM raw_measurements WHERE hospital_code = $1`, [H])).rows[0].n) > 0)

    const up = await ingestAdmin('/enrollments', { hospital_code: H, expected_servers: 4, by: 'smoke' })
    const chk = await post(`${BASE}/v1/enroll/check`, { hospital_code: H })
    check('서버 대수 2 → 4: 자리 1 (등록 3대)', up.created === false && chk.body.slots_left === 1 && chk.body.hospital_name === '스모크병원', chk)
    let removeError = ''
    await ingestAdmin('/enrollments/remove', { hospital_code: H, by: 'smoke' }).catch((e) => (removeError = (e as Error).message))
    check('서버가 있는 병원은 등록 해제 불가', /등록을 해제할 수 없습니다/.test(removeError), removeError)
  }

  console.log('\n■ 설치 스크립트 — 터미널에서 직접 입력')
  if (spawnSync('which', ['script']).status !== 0) {
    console.log('  (script 명령이 없어 건너뜀)')
  } else {
    // 가짜 터미널을 붙여 사람이 치는 것처럼 넣는다: 틀린 병원코드 → 다시 물음 → 맞는 코드 → 확인 Enter → 서버 이름 Enter(기본값 = 호스트명)
    const dest2 = mkdtempSync(path.join(os.tmpdir(), 'tua-enroll-tty-'))
    try {
      const boot = path.join(dest, 'install.sh')
      const r = spawnSync('script', ['-qec', `sudo -n env DESTDIR=${dest2} bash ${boot} --no-service`, '/dev/null'], { input: `HOSP-SMOKE9\n${H}\n\n\n`, encoding: 'utf8', timeout: 120_000 })
      const text = r.stdout.replace(/\r/g, '')
      check('틀린 병원코드 → 안내 뒤 다시 묻는다', /등록되지 않은 병원코드입니다 \(HOSP-SMOKE9\)/.test(text) && (text.match(/병원코드 \(예: HOSP-000038\)/g) ?? []).length === 2, text.slice(0, 900))
      check("확인 문구 '스모크병원(HOSP-SMOKE3)에 등록합니다. 맞습니까? [Y/n]'", /스모크병원\(HOSP-SMOKE3\)에 등록합니다\. 맞습니까\? \[Y\/n\]/.test(text), text.slice(0, 900))
      const host = os.hostname()
      check(`서버 이름을 묻고 기본값은 호스트명 (${host})`, text.includes(`서버 이름 [${host}]:`) && r.status === 0 && /설치 완료/.test(text), text.slice(-700))
      const env = execFileSync('sudo', ['-n', 'cat', path.join(dest2, 'etc/thync-usage-agent/agent.env')], { encoding: 'utf8' })
      check('Enter 만 누르면 호스트명으로 등록', valueOf(env, 'USAGE_SERVER_ID') === host && Number((await db.query(`SELECT count(*)::int AS n FROM agent_servers WHERE hospital_code = $1 AND server_id = $2 AND key_hash IS NOT NULL`, [H, host])).rows[0].n) === 1)
    } finally {
      spawnSync('sudo', ['-n', 'rm', '-rf', dest2])
    }
  }

  console.log('\n■ 병원 토큰(기존 방식)')
  {
    const token = `tua_${createHash('sha256').update(`smoke-${Date.now()}`).digest('hex')}`
    await db.query(`INSERT INTO agent_tokens (hospital_code, token_hash, token_prefix, label, created_by) VALUES ($1, $2, $3, 'smoke', 'smoke')`, [H, createHash('sha256').update(token).digest('hex'), token.slice(0, 8)])
    check('병원 토큰은 그 병원의 어느 서버 이름으로든 접속', (await handshake(token, 'smoke-b')).status === 200 && (await handshake(token, 'smoke-new')).status === 200)
    const id = Number((await db.query(`SELECT id FROM agent_servers WHERE hospital_code = $1 AND server_id = 'smoke-c'`, [H])).rows[0].id)
    await ingestAdmin('/servers/action', { server: id, action: 'block', by: 'smoke' })
    check('차단한 서버는 병원 토큰으로도 거부', (await handshake(token, 'smoke-c')).status === 403)
  }

  check('다른 병원의 서버는 건드리지 않았다', Number((await db.query(`SELECT count(*)::int AS n FROM agent_servers WHERE hospital_code NOT LIKE 'HOSP-SMOKE%'`)).rows[0].n) === othersBefore)
} finally {
  await wipe()
  dropRoUser()
  spawnSync('sudo', ['-n', 'rm', '-rf', dest])
  await db.end()
  await prisma.$disconnect()
}

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`)
process.exit(failed > 0 ? 1 : 0)
