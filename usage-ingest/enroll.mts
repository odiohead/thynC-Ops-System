/**
 * 수집 병원 등록 · 서버 키 발급 · 설치 파일 제공 (projects/usage_agent_enroll_design.md)
 *
 *  밖에서 부르는 것 (Nginx /api/usage-ingest/ 경유, 인증 없음 — IP 당 빈도 제한)
 *    GET  /agent/install.sh            설치 시작 스크립트 (설치 묶음을 받아 풀고 install.sh 를 실행)
 *    GET  /agent/latest                설치 묶음의 버전·파일 이름·SHA-256
 *    GET  /agent/<묶음 파일>            설치 묶음 (thync-usage-agent-<버전>.tar.gz)
 *    POST /v1/enroll/check             병원코드 확인 — 등록된 병원인지, 병원명, 남은 자리
 *    POST /v1/enroll                   서버 등록 — 등록된 병원이고 자리가 남았을 때만 그 서버 전용 키 발급
 *
 *  본체 앱만 부르는 것 (127.0.0.1 로 직접, Nginx 가 넘기지 않는 경로 + 원본 DB 에 있는 값으로 확인)
 *    POST /internal/v1/enrollments         병원 등록·수정 (병원명·서버 대수·메모). create_only 면 이미 있을 때 409
 *    POST /internal/v1/enrollments/remove  등록 해제 (서버가 하나도 없을 때만)
 *    POST /internal/v1/servers/action      서버 차단 · 차단 해제 · 재등록 허용
 *
 * 키 원문은 발급 응답에만 있다. DB 에는 SHA-256 만 둔다.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import type pg from 'pg'
import { BadRequest, int, reqBigint, reqStr, str } from './validate.mts'

type Db = pg.PoolClient

/** 상태 코드와 함께 설치 스크립트가 구분해 쓰는 사유 코드를 싣는다 */
export class EnrollError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

const HOSPITAL_RE = /^[A-Za-z0-9_-]{1,40}$/
const SERVER_RE = /^[\w.:@-]{1,100}$/

function hospitalCodeOf(v: unknown): string {
  const code = reqStr(v, 'hospital_code', 40).trim()
  if (!HOSPITAL_RE.test(code)) throw new BadRequest('hospital_code: 형식이 올바르지 않습니다')
  return code
}

// ── 등록 확인 · 서버 등록 ───────────────────────────────────────────────

type Enrollment = { hospital_code: string; hospital_name: string | null; expected_servers: number }

async function loadSlots(db: pg.Pool | Db, hospitalCode: string, lock: boolean) {
  const e = await db.query(`SELECT hospital_code, hospital_name, expected_servers FROM agent_enrollments WHERE hospital_code = $1${lock ? ' FOR UPDATE' : ''}`, [hospitalCode])
  const enrollment = e.rows[0] as Enrollment | undefined
  if (!enrollment) throw new EnrollError(404, 'not_registered', `등록되지 않은 병원코드입니다 (${hospitalCode}) — 운영관리시스템 [사용량 > 에이전트 관리]에서 병원을 먼저 등록하세요`)
  const s = await db.query(`SELECT server_id FROM agent_servers WHERE hospital_code = $1 AND blocked_at IS NULL ORDER BY id`, [hospitalCode])
  const servers = s.rows.map((r) => r.server_id as string)
  return { enrollment, servers, slotsLeft: Math.max(0, Number(enrollment.expected_servers) - servers.length) }
}

/** 병원코드 확인 — 아무것도 바꾸지 않는다 */
export async function enrollCheck(pool: pg.Pool, body: Record<string, unknown>) {
  const { enrollment, servers, slotsLeft } = await loadSlots(pool, hospitalCodeOf(body.hospital_code), false)
  return {
    hospital_code: enrollment.hospital_code,
    hospital_name: enrollment.hospital_name,
    expected_servers: Number(enrollment.expected_servers),
    registered_servers: servers,
    slots_left: slotsLeft,
  }
}

function newKey(): { key: string; hash: string; prefix: string } {
  const key = `tuk_${randomBytes(24).toString('hex')}`
  return { key, hash: createHash('sha256').update(key).digest('hex'), prefix: key.slice(0, 8) }
}

/** 서버 등록 — 트랜잭션 안에서 부른다 (병원 등록 행을 잠가 자리 수를 넘겨 받지 않는다) */
export async function enroll(db: Db, body: Record<string, unknown>, remoteIp: string | null) {
  const hospitalCode = hospitalCodeOf(body.hospital_code)
  const serverId = reqStr(body.server_id, 'server_id', 100).trim()
  if (!SERVER_RE.test(serverId)) throw new BadRequest('server_id: 영문·숫자와 . _ : @ - 만 쓸 수 있습니다')
  const hostname = str(body.hostname, 'hostname')
  const agentVersion = str(body.agent_version, 'agent_version', 50)

  const { enrollment, servers, slotsLeft } = await loadSlots(db, hospitalCode, true)
  const existing = (
    await db.query(`SELECT id, key_hash, reenroll_allowed_at, blocked_at FROM agent_servers WHERE hospital_code = $1 AND server_id = $2`, [hospitalCode, serverId])
  ).rows[0] as { id: string; key_hash: string | null; reenroll_allowed_at: string | null; blocked_at: string | null } | undefined

  const k = newKey()
  if (existing) {
    if (existing.blocked_at) throw new EnrollError(403, 'blocked', `차단된 서버 이름입니다 (${serverId}) — 에이전트 관리에서 차단을 풀어야 합니다`)
    // 이미 있는 이름은 관리자가 재등록을 허용했을 때만 키를 다시 준다 (병원 토큰으로 접속 중인 기존 서버의 이름을 가로채지 못하게)
    if (!existing.reenroll_allowed_at) {
      throw new EnrollError(409, 'name_taken', `이 병원에 같은 이름의 서버가 이미 등록되어 있습니다 (${serverId}) — 다른 이름을 쓰거나, 재설치라면 에이전트 관리에서 '재등록 허용'을 누르세요`)
    }
    await db.query(
      `UPDATE agent_servers SET key_hash = $2, key_prefix = $3, key_issued_at = now(), enrolled_at = now(), enroll_ip = $4,
              reenroll_allowed_at = NULL, hostname = COALESCE($5, hostname), agent_version = COALESCE($6, agent_version), last_seen_at = now()
       WHERE id = $1`,
      [existing.id, k.hash, k.prefix, remoteIp, hostname, agentVersion],
    )
  } else {
    if (slotsLeft <= 0) {
      throw new EnrollError(
        409,
        'no_slot',
        `이 병원에 등록할 수 있는 서버 자리가 없습니다 (${servers.length}/${enrollment.expected_servers}대 등록됨: ${servers.join(', ')}) — 에이전트 관리에서 서버 대수를 늘리세요`,
      )
    }
    await db.query(
      `INSERT INTO agent_servers (hospital_code, server_id, hostname, agent_version, key_hash, key_prefix, key_issued_at, enrolled_at, enroll_ip)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now(), $7)`,
      [hospitalCode, serverId, hostname, agentVersion, k.hash, k.prefix, remoteIp],
    )
  }
  return {
    hospital_code: hospitalCode,
    hospital_name: enrollment.hospital_name,
    server_id: serverId,
    server_key: k.key,
    expected_servers: Number(enrollment.expected_servers),
    registered_servers: existing ? servers.length : servers.length + 1,
  }
}

/** 서버 키로 접속한 서버 찾기 (없으면 null). 차단된 서버는 EnrollError(403) */
export async function findServerByKey(pool: pg.Pool, hash: string): Promise<{ serverPk: number; hospitalCode: string; serverId: string } | null> {
  const r = await pool.query(`SELECT id, hospital_code, server_id, blocked_at FROM agent_servers WHERE key_hash = $1`, [hash])
  const row = r.rows[0]
  if (!row) return null
  if (row.blocked_at) throw new EnrollError(403, 'blocked', '이 서버는 차단되어 있습니다 — 운영관리시스템 에이전트 관리에서 확인하세요')
  return { serverPk: Number(row.id), hospitalCode: row.hospital_code as string, serverId: row.server_id as string }
}

// ── 본체 앱의 관리 호출 ─────────────────────────────────────────────────

let adminSecret: string | null = null

async function isAdminCall(pool: pg.Pool, req: http.IncomingMessage): Promise<boolean> {
  // Nginx 를 거친 요청에는 이 헤더들이 붙는다 — 관리 호출은 같은 서버에서 직접 들어온 것만 받는다
  if (req.headers['x-real-ip'] || req.headers['x-forwarded-for']) return false
  const remote = req.socket.remoteAddress ?? ''
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return false
  const given = req.headers['x-usage-admin']
  if (typeof given !== 'string' || given.length < 32) return false
  const same = (secret: string) => secret.length === given.length && timingSafeEqual(Buffer.from(secret), Buffer.from(given))
  if (adminSecret && same(adminSecret)) return true
  // 값이 바뀌었을 수 있으니 한 번 다시 읽는다
  const r = await pool.query(`SELECT secret FROM agent_admin_secret LIMIT 1`)
  adminSecret = (r.rows[0]?.secret as string | undefined) ?? null
  return !!adminSecret && same(adminSecret)
}

/** /internal/v1/* 처리. 관리 호출이 아니면 404 로 보이게 null 을 돌려준다 */
export async function adminRoute(pool: pg.Pool, req: http.IncomingMessage, p: string, readBody: () => Promise<Record<string, unknown>>): Promise<unknown | null> {
  if (req.method !== 'POST' || !(await isAdminCall(pool, req))) return null
  const body = await readBody()
  const by = str(body.by, 'by', 100)

  if (p === '/enrollments') {
    const hospitalCode = hospitalCodeOf(body.hospital_code)
    const name = str(body.hospital_name, 'hospital_name', 200)
    const expected = body.expected_servers === undefined ? null : int(body.expected_servers, 'expected_servers', 1, 50)
    const note = body.note === undefined ? undefined : str(body.note, 'note', 500)
    const cur = (await pool.query(`SELECT 1 FROM agent_enrollments WHERE hospital_code = $1`, [hospitalCode])).rows[0]
    // 새로 등록하는 호출(create_only)은 이미 있는 등록을 바꾸지 않는다
    if (cur && body.create_only === true) throw new EnrollError(409, 'already_registered', '이미 등록된 병원입니다')
    if (!cur) {
      if (expected === null) throw new BadRequest('expected_servers: 필요합니다')
      await pool.query(`INSERT INTO agent_enrollments (hospital_code, hospital_name, expected_servers, note, created_by) VALUES ($1, $2, $3, $4, $5)`, [hospitalCode, name, expected, note ?? null, by])
      console.log(`[usage-ingest] 병원 등록 ${hospitalCode} (${name ?? '-'}) 서버 ${expected}대 by ${by ?? '-'}`)
      return { ok: true, created: true }
    }
    await pool.query(
      `UPDATE agent_enrollments SET hospital_name = COALESCE($2, hospital_name), expected_servers = COALESCE($3, expected_servers),
              note = CASE WHEN $4::boolean THEN $5 ELSE note END, updated_at = now()
       WHERE hospital_code = $1`,
      [hospitalCode, name, expected, note !== undefined, note ?? null],
    )
    return { ok: true, created: false }
  }

  if (p === '/enrollments/remove') {
    const hospitalCode = hospitalCodeOf(body.hospital_code)
    const n = Number((await pool.query(`SELECT count(*)::int AS n FROM agent_servers WHERE hospital_code = $1`, [hospitalCode])).rows[0].n)
    if (n > 0) throw new EnrollError(409, 'has_servers', `서버가 ${n}대 등록되어 있어 등록을 해제할 수 없습니다 — 받은 기록은 지우지 않습니다. 더 받지 않으려면 서버를 차단하세요`)
    const r = await pool.query(`DELETE FROM agent_enrollments WHERE hospital_code = $1`, [hospitalCode])
    console.log(`[usage-ingest] 병원 등록 해제 ${hospitalCode} by ${by ?? '-'}`)
    return { ok: true, removed: r.rowCount ?? 0 }
  }

  if (p === '/servers/action') {
    const server = reqBigint(body.server, 'server')
    const action = reqStr(body.action, 'action', 30)
    const set =
      action === 'block'
        ? `blocked_at = now(), reenroll_allowed_at = NULL`
        : action === 'unblock'
          ? `blocked_at = NULL`
          : action === 'allow_reenroll'
            ? `reenroll_allowed_at = now()`
            : action === 'cancel_reenroll'
              ? `reenroll_allowed_at = NULL`
              : null
    if (!set) throw new BadRequest('action: block · unblock · allow_reenroll · cancel_reenroll 중 하나')
    const r = await pool.query(`UPDATE agent_servers SET ${set} WHERE id = $1 RETURNING hospital_code, server_id`, [server])
    if (!r.rows[0]) throw new EnrollError(404, 'unknown_server', '서버를 찾을 수 없습니다')
    console.log(`[usage-ingest] 서버 ${action} ${r.rows[0].hospital_code}/${r.rows[0].server_id} by ${by ?? '-'}`)
    return { ok: true }
  }
  return null
}

// ── 설치 파일 ───────────────────────────────────────────────────────────

const PKG_RE = /^thync-usage-agent-(\d+)\.(\d+)\.(\d+)\.tar\.gz$/
let pkgCache: { key: string; file: string; version: string; sha256: string; size: number } | null = null

/** 설치 묶음 디렉토리에서 가장 높은 버전의 묶음 (없으면 null) */
export function latestPackage(dir: string) {
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => PKG_RE.test(n))
  } catch {
    return null
  }
  if (names.length === 0) return null
  const ver = (n: string) => PKG_RE.exec(n)!.slice(1, 4).map(Number)
  names.sort((a, b) => {
    const x = ver(a)
    const y = ver(b)
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
  })
  const file = names[names.length - 1]
  const st = statSync(path.join(dir, file))
  const key = `${file}|${st.size}|${st.mtimeMs}`
  if (pkgCache?.key !== key) {
    pkgCache = { key, file, version: ver(file).join('.'), sha256: createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex'), size: st.size }
  }
  return pkgCache
}

/** 설치 시작 스크립트 — 묶음을 받아 SHA-256 을 확인하고 풀어서 그 안의 install.sh 를 실행한다 */
export function bootstrapScript(base: string, pkg: { file: string; version: string; sha256: string }): string {
  return `#!/usr/bin/env bash
# thync-usage-agent 설치 — 운영관리시스템에서 내려받아 실행한다 (Ubuntu, systemd)
#   wget -qO install.sh ${base}/agent/install.sh && sudo bash install.sh
# 설치 묶음(${pkg.file})을 받아 손상 여부를 확인한 뒤, 그 안의 설치 스크립트를 실행한다.
set -euo pipefail
BASE='${base}'
FILE='${pkg.file}'
SHA='${pkg.sha256}'
[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요: sudo bash install.sh" >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "thync-usage-agent ${pkg.version} 내려받는 중..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$BASE/agent/$FILE" -o "$TMP/$FILE"
else
  wget -q "$BASE/agent/$FILE" -O "$TMP/$FILE"
fi
echo "$SHA  $TMP/$FILE" | sha256sum -c --quiet - || { echo "내려받은 파일이 손상됐습니다 — 다시 시도하세요" >&2; exit 1; }
tar -C "$TMP" -xzf "$TMP/$FILE"
bash "$TMP/\${FILE%.tar.gz}/install.sh" --endpoint "$BASE/v1" "$@"
`
}

/**
 * GET /agent/* — JSON 이 아닌 응답이라 여기서 바로 내보낸다. 처리했으면 true.
 * base = 밖에서 보이는 수신부 주소 (https://호스트/api/usage-ingest)
 */
export function serveAgentFile(req: http.IncomingMessage, res: http.ServerResponse, p: string, dir: string, base: string): boolean {
  if (!p.startsWith('/agent/')) return false
  const plain = (status: number, text: string) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    plain(405, 'method not allowed\n')
    return true
  }
  const pkg = latestPackage(dir)
  if (!pkg) {
    plain(404, '설치 묶음이 서버에 없습니다 (agents/thync-usage-agent/dist/thync-usage-agent-<버전>.tar.gz)\n')
    return true
  }
  const name = p.slice('/agent/'.length)
  if (name === 'install.sh') {
    const text = bootstrapScript(base, pkg)
    res.writeHead(200, { 'content-type': 'text/x-shellscript; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
    res.end(req.method === 'HEAD' ? undefined : text)
    return true
  }
  if (name === 'latest') {
    const text = JSON.stringify({ version: pkg.version, file: pkg.file, sha256: pkg.sha256, size: pkg.size })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
    return true
  }
  if (name === pkg.file) {
    res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': pkg.size, 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${pkg.file}"` })
    if (req.method === 'HEAD') res.end()
    else createReadStream(path.join(dir, pkg.file)).on('error', () => res.destroy()).pipe(res)
    return true
  }
  plain(404, 'not found\n')
  return true
}
