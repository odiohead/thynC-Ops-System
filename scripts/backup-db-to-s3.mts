/**
 * DB 백업 덤프 → S3 보관 (2026-11-17)
 *
 * 배경: 일일 백업(pg_dump)이 DB와 같은 서버 디스크(~/backups/db, 7일 보관)에만 있어 볼륨 하나가 망가지면 DB와 백업을 함께 잃는다.
 *       서버 밖 사본을 앱이 쓰는 S3 버킷(S3_BUCKET_NAME)의 `db-backups/` 아래에 둔다.
 *
 * 키 구조: <prefix>/daily/<DB명>_YYYYMMDD_HHMMSS.dump   — 매일 1개, DAILY_KEEP_DAYS(30)일 보관 (시각은 덤프를 뜬 셸이 붙인 값 — KST)
 *          <prefix>/monthly/<DB명>_YYYYMM.dump          — 그 달 첫 백업의 사본, MONTHLY_KEEP_MONTHS(12)개월 보관
 *          <prefix>/env/env_YYYYMMDD_HHMMSS                 — 레포 루트 .env **평문** 사본(2026-11-17 사용자 결정 — 암호화 권고했으나 임시로 평문).
 *                                                             내용이 직전 사본과 다를 때만 올리고 최신 ENV_KEEP(10)개 보관.
 *                                                             ⚠ 같은 버킷·키를 쓰는 환경(dev2 등)에서 PROD 비밀키를 읽을 수 있다 — 제대로 된 비밀 관리 도구로 옮기면 이 단계 제거
 *
 * 환경 구분(2026-11-18): **업로드는 `.env`에 `DB_BACKUP_S3_PREFIX`가 있는 환경에서만** 동작한다(운영 = `db-backups`). 설정이 없는 환경(DEV·dev2)에서
 *   업로드를 호출하면 올리지 않고 종료 코드 3 — 다른 환경의 덤프가 운영 백업 폴더에 섞이는 것을 막는다. 코드가 서버를 추측하지 않고 설정으로 명시한다.
 *   DEV도 백업하려면 그 환경 `.env`에 다른 접두(예: `db-backups-dev`)를 적는다 — 보관 정리가 접두 단위라 운영과 같은 접두를 쓰면 안 된다.
 *   목록·내려받기(`--list`·`--download`)는 어느 환경에서나 가능(기본 접두 `db-backups` — 복원·데이터 동기화용).
 *
 * 사용 (`scripts/backup-db.sh`가 pg_dump 성공 직후 호출 — cwd 무관, .env는 이 파일 기준 레포 루트에서 읽음):
 *   npx tsx scripts/backup-db-to-s3.mts <덤프 파일>          업로드 → 크기 대조 → 월 사본 → 보관 기간 지난 것 정리
 *   npx tsx scripts/backup-db-to-s3.mts --list               S3에 있는 백업 목록
 *   npx tsx scripts/backup-db-to-s3.mts --download <키> <저장 경로>   복원용 내려받기 (크기 대조)
 *   npx tsx scripts/backup-db-to-s3.mts --alert "<메시지>"   실패 알림만 발송 (pg_dump 자체가 실패했을 때 셸에서 호출)
 * 옵션: --prefix=<접두>(env DB_BACKUP_S3_PREFIX보다 우선 — 시험용) · --no-prune(정리 생략) · --no-env(.env 사본 생략) · --env-source=<경로>(기본 레포 루트 .env — Node 자체 옵션 --env-file과 겹치지 않게 다른 이름)
 *
 * 실패 시: 종료 코드 1 + Slack 알림(env BACKUP_ALERT_SLACK_CHANNEL — 채널 ID·사용자 ID 또는 이메일(그 사용자에게 DM). 미설정이면 로그만).
 *          Slack 모드(off/test/live)는 앱과 같은 규칙(lib/slack) — 운영 서버 cron에서는 NODE_ENV=production 으로 실행해야 live가 유지된다.
 * 정리 안전장치: 이름이 규칙에 맞는 키만 지우고, 일일 백업은 날짜와 무관하게 최신 7개는 항상 남긴다. 업로드·대조가 실패한 실행에서는 정리하지 않는다.
 */
import dotenv from 'dotenv'
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'
import { S3Client, PutObjectCommand, HeadObjectCommand, CopyObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { slackPostMessage, slackLookupUserByEmail, resolveTargetChannel } from '../lib/slack'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
dotenv.config({ path: [path.join(ROOT, '.env.local'), path.join(ROOT, '.env')], quiet: true })

const DAILY_KEEP_DAYS = Number(process.env.DB_BACKUP_DAILY_KEEP_DAYS ?? 30)
const MONTHLY_KEEP_MONTHS = Number(process.env.DB_BACKUP_MONTHLY_KEEP_MONTHS ?? 12)
const DAILY_KEEP_MIN = 7 // 날짜와 무관하게 항상 남기는 최신 일일 백업 수
const ENV_KEEP = 10 // .env 사본 보관 개수(내용이 바뀔 때만 1개씩 늘어난다)
const MIN_DUMP_BYTES = 1024 * 1024 // 이보다 작으면 깨진 덤프로 본다
const DUMP_NAME_RE = /^([A-Za-z0-9_]+?)_(\d{8})_(\d{6})\.dump$/ // <DB명>_YYYYMMDD_HHMMSS.dump
const DAILY_RE = /\/daily\/[A-Za-z0-9_]+_(\d{8})_\d{6}\.dump$/
const MONTHLY_RE = /\/monthly\/[A-Za-z0-9_]+_(\d{6})\.dump$/
const ENV_RE = /\/env\/env_\d{8}_\d{6}$/

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const opt = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
const positional = args.filter((a) => !a.startsWith('--'))
/** 명시된 접두(옵션 > .env). 업로드는 이것이 있어야만 한다 — 없으면 이 환경은 백업 대상이 아님 */
const PREFIX_EXPLICIT = (opt('--prefix') ?? process.env.DB_BACKUP_S3_PREFIX ?? '').trim().replace(/^\/+|\/+$/g, '')
const PREFIX = PREFIX_EXPLICIT || 'db-backups' // 목록·내려받기 기본값
class NotBackupTarget extends Error {}
const BUCKET = process.env.S3_BUCKET_NAME ?? ''
const log = (msg: string) => console.log(`[${new Date(Date.now() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 19)}] [s3-backup] ${msg}`) // KST
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`

function client(): S3Client {
  const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env
  if (!BUCKET || !AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) throw new Error('S3 설정 없음 (.env의 AWS_REGION·AWS_ACCESS_KEY_ID·AWS_SECRET_ACCESS_KEY·S3_BUCKET_NAME)')
  if (!PREFIX) throw new Error('접두(prefix)가 비어 있습니다')
  return new S3Client({ region: AWS_REGION, credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } })
}

async function alert(message: string) {
  const text = `🚨 [thynC Ops] DB 백업 실패 (${hostname()})\n${message}`
  // 대상: 채널 ID·사용자 ID 또는 이메일(이메일이면 Slack 사용자로 조회해 DM)
  const raw = (process.env.BACKUP_ALERT_SLACK_CHANNEL ?? '').trim()
  let intended = raw
  if (raw.includes('@')) {
    intended = (await slackLookupUserByEmail(raw)) ?? ''
    if (!intended) log(`Slack에서 사용자를 찾지 못했습니다: ${raw}`)
  }
  const target = resolveTargetChannel(intended)
  if (!target) { log('알림 대상 없음(BACKUP_ALERT_SLACK_CHANNEL 미설정·조회 실패 또는 Slack off) — 로그만 남김'); return }
  const r = await slackPostMessage(target, { text })
  log(r.ok ? 'Slack 실패 알림 발송' : `Slack 알림 발송 실패: ${r.error}`)
}

async function listAll(s3: S3Client, prefix: string) {
  const out: { key: string; size: number; modified: Date }[] = []
  let token: string | undefined
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }))
    for (const c of r.Contents ?? []) if (c.Key) out.push({ key: c.Key, size: c.Size ?? 0, modified: c.LastModified ?? new Date(0) })
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * 덤프가 끝까지 읽히는지 — 전체를 SQL로 풀어 버려 보고(잘린 파일은 여기서 실패), 목차의 테이블 데이터 수를 센다.
 * 목차(--list)만 보면 파일 앞부분만 읽어 잘린 덤프를 못 잡는다. pg_restore가 없는 환경이면 생략(null)
 */
function dumpTableCount(file: string): number | null {
  try {
    execFileSync('pg_restore', ['-f', '/dev/null', file], { stdio: ['ignore', 'ignore', 'pipe'] })
    const toc = execFileSync('pg_restore', ['--list', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    return toc.split('\n').filter((l) => l.includes(' TABLE DATA ')).length
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    const stderr = String((e as { stderr?: Buffer }).stderr ?? '').trim().split('\n').pop()
    throw new Error(`덤프를 끝까지 읽을 수 없습니다(pg_restore 실패): ${stderr || String((e as Error).message).split('\n')[0]}`)
  }
}

async function upload(file: string) {
  if (!PREFIX_EXPLICIT) throw new NotBackupTarget('이 환경은 백업 업로드 대상이 아닙니다 — .env에 DB_BACKUP_S3_PREFIX가 없습니다 (운영 서버에만 설정). 올리지 않고 종료합니다')
  if (!existsSync(file)) throw new Error(`덤프 파일 없음: ${file}`)
  const size = statSync(file).size
  if (size < MIN_DUMP_BYTES) throw new Error(`덤프가 너무 작습니다(${size}바이트) — 깨진 백업으로 판단`)
  const tables = dumpTableCount(file)
  if (tables !== null && tables === 0) throw new Error('덤프에 테이블 데이터가 없습니다')

  const s3 = client()
  const base = path.basename(file)
  const m = DUMP_NAME_RE.exec(base)
  if (!m) throw new Error(`파일명이 <DB명>_YYYYMMDD_HHMMSS.dump 형식이 아닙니다: ${base}`)
  const dbName = m[1]
  const ym = m[2].slice(0, 6)
  const dailyKey = `${PREFIX}/daily/${base}`
  const monthlyKey = `${PREFIX}/monthly/${dbName}_${ym}.dump`

  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: dailyKey, Body: createReadStream(file), ContentLength: size, ContentType: 'application/octet-stream', ServerSideEncryption: 'AES256' }))
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: dailyKey }))
  if (head.ContentLength !== size) throw new Error(`업로드 크기 불일치: 원본 ${size} · S3 ${head.ContentLength} (${dailyKey})`)
  log(`업로드 완료 s3://${BUCKET}/${dailyKey} (${mb(size)}${tables !== null ? ` · 테이블 ${tables}` : ''})`)

  // 월 사본 — 그 달 첫 백업만
  const hasMonthly = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: monthlyKey })).then(() => true).catch((e) => {
    if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false
    throw e
  })
  if (!hasMonthly) {
    await s3.send(new CopyObjectCommand({ Bucket: BUCKET, Key: monthlyKey, CopySource: encodeURI(`${BUCKET}/${dailyKey}`), ServerSideEncryption: 'AES256' }))
    log(`월 사본 생성 s3://${BUCKET}/${monthlyKey}`)
  }

  if (!flag('--no-env')) await backupEnv(s3, `${m[2]}_${m[3]}`)
  if (!flag('--no-prune')) await prune(s3)
}

/** .env 평문 사본 — 직전 사본과 내용(sha256)이 같으면 생략, 다르면 새 키로 올리고 최신 ENV_KEEP개만 남긴다 */
async function backupEnv(s3: S3Client, stamp: string) {
  const file = opt('--env-source') ?? path.join(ROOT, '.env')
  if (!existsSync(file)) throw new Error(`.env 파일 없음: ${file}`)
  const body = readFileSync(file)
  if (!body.length) throw new Error(`.env 파일이 비어 있습니다: ${file}`)
  const sha = createHash('sha256').update(body).digest('hex')
  const existing = (await listAll(s3, `${PREFIX}/env/`)).filter((o) => ENV_RE.test(o.key))
  const latest = existing.at(-1)
  if (latest) {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: latest.key }))
    if (head.Metadata?.sha256 === sha) { log(`.env 변경 없음 — 사본 유지 (${latest.key})`); return }
  }
  const key = `${PREFIX}/env/env_${stamp}`
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'text/plain; charset=utf-8', ServerSideEncryption: 'AES256', Metadata: { sha256: sha } }))
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
  if (head.ContentLength !== body.length) throw new Error(`.env 업로드 크기 불일치: 원본 ${body.length} · S3 ${head.ContentLength}`)
  const old = Array.from(new Set([...existing.map((o) => o.key), key])).sort().slice(0, -ENV_KEEP)
  if (old.length) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: old.map((Key) => ({ Key })) } }))
  log(`.env 사본 업로드 s3://${BUCKET}/${key} (${body.length}바이트${old.length ? ` · 옛 사본 ${old.length}개 삭제` : ''})`)
}

async function prune(s3: S3Client) {
  const now = new Date()
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')
  const dailyCutoff = ymd(new Date(now.getTime() - DAILY_KEEP_DAYS * 86400_000))
  const monthlyCutoff = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHLY_KEEP_MONTHS, 1))).slice(0, 6)

  const daily = (await listAll(s3, `${PREFIX}/daily/`)).filter((o) => DAILY_RE.test(o.key)).sort((a, b) => b.key.localeCompare(a.key))
  const monthly = (await listAll(s3, `${PREFIX}/monthly/`)).filter((o) => MONTHLY_RE.test(o.key))
  const del = [
    ...daily.slice(DAILY_KEEP_MIN).filter((o) => DAILY_RE.exec(o.key)![1] < dailyCutoff),
    ...monthly.filter((o) => MONTHLY_RE.exec(o.key)![1] < monthlyCutoff),
  ].map((o) => o.key)
  for (let i = 0; i < del.length; i += 500) {
    const r = await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: del.slice(i, i + 500).map((Key) => ({ Key })) } }))
    if (r.Errors?.length) throw new Error(`보관 정리 실패 ${r.Errors.length}건: ${r.Errors[0].Key} ${r.Errors[0].Message}`)
  }
  log(`보관 정리 — 삭제 ${del.length} · 남은 일일 ${daily.length - del.filter((k) => DAILY_RE.test(k)).length} · 월 ${monthly.length - del.filter((k) => MONTHLY_RE.test(k)).length} (일일 ${DAILY_KEEP_DAYS}일·월 ${MONTHLY_KEEP_MONTHS}개월)`)
}

async function list() {
  const all = await listAll(client(), `${PREFIX}/`)
  for (const o of all) console.log(`${o.modified.toISOString().slice(0, 19)}Z  ${mb(o.size).padStart(8)}  ${o.key}`)
  console.log(`${all.length}개 · 합계 ${mb(all.reduce((a, o) => a + o.size, 0))} · s3://${BUCKET}/${PREFIX}/`)
}

async function download(key: string, dest: string) {
  if (!key || !dest) throw new Error('--download <키> <저장 경로>')
  const r = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  await pipeline(r.Body as Readable, createWriteStream(dest))
  const size = statSync(dest).size
  if (r.ContentLength !== undefined && r.ContentLength !== size) throw new Error(`내려받기 크기 불일치: S3 ${r.ContentLength} · 파일 ${size}`)
  log(`내려받기 완료 ${dest} (${mb(size)})`)
}

try {
  if (flag('--alert')) { await alert(positional[0] ?? '백업 스크립트가 실패를 보고했습니다'); process.exit(0) }
  else if (flag('--list')) await list()
  else if (flag('--download')) await download(positional[0], positional[1])
  else if (positional[0]) await upload(positional[0])
  else { console.error('usage: backup-db-to-s3.mts <덤프 파일> | --list | --download <키> <저장 경로> | --alert "<메시지>"'); process.exit(2) }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  if (e instanceof NotBackupTarget) { log(msg); process.exit(3) } // 설정 없는 환경 — 알림 없이 종료
  log(`실패: ${msg}`)
  if (!flag('--list') && !flag('--download')) await alert(`S3 보관 단계 실패 — ${msg}`)
  process.exit(1)
}
