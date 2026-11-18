/**
 * thynC 사용량 수신부 — 병원 서버의 thync-usage-agent 가 보내는 원본 행을 받아 원본 DB에 쌓는다.
 * 설계: projects/usage_collection_design.md §8
 *
 * 본체(Next 앱)와 별도 프로세스다. 본체 코드·Prisma·본체 DB를 쓰지 않는다.
 *   - 실행: PM2 thync-usage-ingest-dev / -prod  (node usage-ingest/dist/index.mjs)
 *   - 설정: usage-ingest/.env — USAGE_DATABASE_URL, USAGE_INGEST_PORT, USAGE_MAX_BYTES
 *   - 경로: Nginx 가 /api/usage-ingest/ 만 이 프로세스로 넘긴다
 *
 * 호출
 *   GET  /api/usage-ingest/health         상태 확인 (인증 없음)
 *   POST /api/usage-ingest/v1/handshake   실행 시작 — 이어 보낼 위치 응답
 *   POST /api/usage-ingest/v1/push        종류별 행 전송
 *   POST /api/usage-ingest/v1/finish      실행 결과 보고
 */
import http from 'node:http'
import zlib from 'node:zlib'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import dotenv from 'dotenv'
import pg from 'pg'
import { BadRequest, asObject, reqBigint } from './validate.mts'
import { finish, handshake, loadRun, parseHandshake, push } from './store.mts'

declare const __USAGE_INGEST_VERSION__: string
const VERSION = typeof __USAGE_INGEST_VERSION__ === 'string' ? __USAGE_INGEST_VERSION__ : 'dev'

const HERE = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(HERE, '..', '.env'), quiet: true })

const PORT = Number(process.env.USAGE_INGEST_PORT ?? 3110)
const HOST = process.env.USAGE_INGEST_HOST ?? '127.0.0.1' // 밖에서는 Nginx 를 거쳐서만 들어온다
const MAX_BYTES = Number(process.env.USAGE_MAX_BYTES ?? 0) // 0 = 상한 없음
const BODY_LIMIT = 8 * 1024 * 1024 // 압축된 본문
const INFLATED_LIMIT = 64 * 1024 * 1024 // 압축을 푼 본문
const PREFIX = '/api/usage-ingest'

if (!process.env.USAGE_DATABASE_URL) {
  console.error('[usage-ingest] USAGE_DATABASE_URL 이 없습니다 (usage-ingest/.env)')
  process.exit(1)
}

pg.types.setTypeParser(1114, (v) => v) // timestamp(시간대 없음)는 문자열 그대로
const pool = new pg.Pool({ connectionString: process.env.USAGE_DATABASE_URL, max: 8, idleTimeoutMillis: 30_000 })
pool.on('error', (e) => console.error('[usage-ingest] DB 연결 오류', e.message))

const gunzip = promisify(zlib.gunzip)

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// ── 빈도 제한 (프로세스 메모리) ─────────────────────────────────────────

const WINDOW_MS = 10 * 60 * 1000
const AUTH_FAIL_MAX = 20 // IP당 인증 실패
const TOKEN_REQ_MAX = 3000 // 토큰당 요청 (첫 실행의 나눠 보내기 포함)
const hits = new Map<string, number[]>()

function countHit(key: string, max: number, record: boolean): boolean {
  const now = Date.now()
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (record) list.push(now)
  hits.set(key, list)
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k)
  }
  return list.length > max
}

// ── 용량 안전장치 ──────────────────────────────────────────────────────

let sizeCache = { at: 0, bytes: 0 }
async function statusPaused(): Promise<boolean> {
  if (!MAX_BYTES) return false
  if (Date.now() - sizeCache.at > 60_000) {
    const r = await pool.query(`SELECT pg_database_size(current_database())::bigint AS n`)
    sizeCache = { at: Date.now(), bytes: Number(r.rows[0].n) }
  }
  return sizeCache.bytes > MAX_BYTES
}

// ── 요청 처리 ──────────────────────────────────────────────────────────

function remoteIp(req: http.IncomingMessage): string | null {
  const real = req.headers['x-real-ip']
  if (typeof real === 'string' && real) return real
  return req.socket.remoteAddress ?? null
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > BODY_LIMIT) throw new HttpError(413, 'body too large')
    chunks.push(chunk as Buffer)
  }
  let buf = Buffer.concat(chunks)
  if ((req.headers['content-encoding'] ?? '').toString().toLowerCase() === 'gzip') {
    try {
      buf = await gunzip(buf, { maxOutputLength: INFLATED_LIMIT })
    } catch {
      throw new HttpError(400, 'bad gzip body')
    }
  }
  try {
    return asObject(JSON.parse(buf.toString('utf8')), 'body')
  } catch {
    throw new HttpError(400, 'bad json body')
  }
}

async function authenticate(req: http.IncomingMessage): Promise<{ hospitalCode: string; tokenId: number }> {
  const ip = remoteIp(req) ?? 'unknown'
  if (countHit(`fail:${ip}`, AUTH_FAIL_MAX, false)) throw new HttpError(429, 'too many failed attempts')
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (token.length < 20 || token.length > 200) {
    countHit(`fail:${ip}`, AUTH_FAIL_MAX, true)
    throw new HttpError(401, 'invalid token')
  }
  const hash = createHash('sha256').update(token).digest('hex')
  const r = await pool.query(`SELECT id, hospital_code FROM agent_tokens WHERE token_hash = $1 AND active`, [hash])
  const row = r.rows[0]
  if (!row) {
    countHit(`fail:${ip}`, AUTH_FAIL_MAX, true)
    throw new HttpError(401, 'invalid token')
  }
  if (countHit(`token:${row.id}`, TOKEN_REQ_MAX, true)) throw new HttpError(429, 'too many requests')
  return { hospitalCode: row.hospital_code as string, tokenId: Number(row.id) }
}

async function inTransaction<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const out = await fn(db)
    await db.query('COMMIT')
    return out
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    db.release()
  }
}

async function route(req: http.IncomingMessage): Promise<unknown> {
  const url = (req.url ?? '').split('?')[0]
  if (!url.startsWith(PREFIX)) throw new HttpError(404, 'not found')
  const p = url.slice(PREFIX.length)

  if (p === '/health') {
    if (req.method !== 'GET') throw new HttpError(405, 'method not allowed')
    let db = false
    try {
      await pool.query('SELECT 1')
      db = true
    } catch {
      db = false
    }
    if (!db) throw new HttpError(503, 'database unavailable')
    return { ok: true, version: VERSION, db, status_paused: await statusPaused() }
  }

  if (p !== '/v1/handshake' && p !== '/v1/push' && p !== '/v1/finish') throw new HttpError(404, 'not found')
  if (req.method !== 'POST') throw new HttpError(405, 'method not allowed')
  const auth = await authenticate(req)
  const body = await readJson(req)
  const paused = await statusPaused()

  if (p === '/v1/handshake') {
    const input = parseHandshake(body)
    const out = await inTransaction((db) => handshake(db, auth.hospitalCode, input, remoteIp(req), paused))
    if (!input.dryRun) {
      await pool.query(`UPDATE agent_tokens SET last_used_at = now() WHERE id = $1`, [auth.tokenId])
      console.log(
        `[usage-ingest] handshake ${auth.hospitalCode}/${input.serverId} run=${out.run_id} since=${out.measurements_since ?? '전체'} reconcile=${out.reconcile}${paused ? ' status_paused' : ''}`,
      )
    }
    return { ...out, server_time: new Date().toISOString(), version: VERSION }
  }

  const runId = reqBigint(body.run_id, 'run_id')
  if (p === '/v1/push') {
    return inTransaction(async (db) => push(db, await loadRun(db, auth.hospitalCode, runId), body, paused))
  }
  const out = await inTransaction(async (db) => finish(db, await loadRun(db, auth.hospitalCode, runId), body))
  console.log(`[usage-ingest] finish ${auth.hospitalCode} run=${runId} status=${String(body.status)}`)
  return out
}

const server = http.createServer((req, res) => {
  route(req)
    .then((out) => send(res, 200, out))
    .catch((e: unknown) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message })
      if (e instanceof BadRequest) return send(res, 400, { error: e.message })
      console.error('[usage-ingest] 처리 오류', req.method, req.url, e)
      send(res, 500, { error: 'internal error' })
    })
})

function send(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

server.requestTimeout = 120_000
server.listen(PORT, HOST, () => {
  console.log(`[usage-ingest] ${VERSION} listening on ${HOST}:${PORT}${MAX_BYTES ? ` (용량 상한 ${MAX_BYTES} bytes)` : ''}`)
})

function shutdown() {
  server.close(() => {
    pool.end().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(0), 10_000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
