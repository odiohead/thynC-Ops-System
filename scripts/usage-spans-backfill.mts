/**
 * 기기 사용 구간 표 채우기 · 대조 (projects/usage_spans_design.md §3.3)
 *
 *   npx tsx scripts/usage-spans-backfill.mts --dry               달 조각별 행 수(추정)만 보여 준다 — 아무것도 쓰지 않는다
 *   npx tsx scripts/usage-spans-backfill.mts                     원본 상태 이력 전체를 달 조각마다 묶어 구간 표에 넣는다 (원본 DB 쓰기)
 *   npx tsx scripts/usage-spans-backfill.mts --partition=<이름>   그 조각만
 *   npx tsx scripts/usage-spans-backfill.mts --verify [병원코드]   구간 표 = 원본에서 다시 묶은 값 인가 (읽기 전용). 병원코드가 없으면 전 병원
 *
 * 수신부가 구간 표를 유지하기 전(스키마 0003 적용 전)에 받은 행을 한 번 변환하는 용도다. 구간 갱신은 LEAST / GREATEST 라
 * 수신부가 떠 있는 동안 돌려도, 여러 번 돌려도 결과가 같다. 원본에서 지운 달(보관 기간 정리 뒤)은 다시 만들 수 없다.
 * PROD 에서 채우기는 원본 DB 쓰기이므로 명시 허락 후에만 (CLAUDE.md 규칙 9).
 */
import { fail, flag, opt, positional, usageDb } from './usage-lib.mts'

const db = usageDb()
await db.connect()
const exists = await db.query(`SELECT to_regclass('device_usage_spans') AS t`)
if (!exists.rows[0].t) {
  await db.end()
  fail('device_usage_spans 표가 없습니다 — 먼저 npm run build:usage-ingest && node usage-ingest/dist/migrate.mjs')
}

const fmt = (n: number) => Math.round(n).toLocaleString()

if (flag('--verify')) {
  await db.query(`SET default_transaction_read_only = on`)
  const [only] = positional
  const hospitals: string[] = only
    ? [only]
    : (await db.query(`SELECT DISTINCT hospital_code FROM agent_servers ORDER BY 1`)).rows.map((r) => r.hospital_code as string)
  let bad = 0
  let spansTotal = 0
  const t0 = Date.now()
  for (const h of hospitals) {
    const r = await db.query(
      `WITH r AS (
         SELECT server, measurement_code, COALESCE(device_type, 0)::smallint AS dt, COALESCE(serial_number, '') AS sn,
                min(event_at) AS fe, max(event_at) AS le
           FROM raw_device_status
          WHERE hospital_code = $1 AND event_at >= timestamp '2000-01-01'
          GROUP BY 1, 2, 3, 4
       ), s AS (
         SELECT server, measurement_code, device_type AS dt, serial_number AS sn, first_event_at AS fe, last_event_at AS le
           FROM device_usage_spans WHERE hospital_code = $1
       )
       SELECT count(*) FILTER (WHERE r.server IS NOT NULL)::int AS raw_spans,
              count(*) FILTER (WHERE s.server IS NOT NULL)::int AS spans,
              count(*) FILTER (WHERE s.server IS NULL)::int AS missing,
              count(*) FILTER (WHERE r.server IS NULL)::int AS extra,
              count(*) FILTER (WHERE r.server IS NOT NULL AND s.server IS NOT NULL AND (r.fe <> s.fe OR r.le <> s.le))::int AS diff
         FROM r FULL JOIN s ON s.server = r.server AND s.measurement_code = r.measurement_code AND s.dt = r.dt AND s.sn = r.sn`,
      [h],
    )
    const x = r.rows[0]
    spansTotal += Number(x.spans)
    // extra = 원본에 없는 구간 — 원본 상태 이력을 보관 기간으로 정리한 뒤에는 정상이다
    const ok = Number(x.missing) === 0 && Number(x.diff) === 0
    if (!ok) bad++
    if (!ok || only || Number(x.extra) > 0) {
      console.log(`${ok ? '✓' : '✗'} ${h}: 구간 ${fmt(x.spans)} · 원본에서 다시 묶은 구간 ${fmt(x.raw_spans)} — 빠짐 ${x.missing} · 시각 다름 ${x.diff}${Number(x.extra) ? ` · 원본에 없는 구간 ${x.extra}(원본을 지운 달이면 정상)` : ''}`)
    }
  }
  console.log(`${bad === 0 ? '✓' : '✗'} 병원 ${hospitals.length}곳 · 구간 ${fmt(spansTotal)}개 — ${bad === 0 ? '모두 원본과 일치' : `${bad}곳 불일치`} (${Math.round((Date.now() - t0) / 1000)}초)`)
  await db.end()
  process.exit(bad === 0 ? 0 : 1)
}

const parts = (
  await db.query(
    `SELECT c.relname AS name, c.reltuples::bigint AS est, pg_total_relation_size(c.oid) AS bytes
       FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'raw_device_status' ORDER BY c.relname`,
  )
).rows as { name: string; est: number; bytes: number }[]
const onlyPart = opt('--partition')
const todo = onlyPart ? parts.filter((p) => p.name === onlyPart) : parts
if (onlyPart && todo.length === 0) {
  await db.end()
  fail(`달 조각 ${onlyPart} 이 없습니다`)
}

const before = Number((await db.query(`SELECT count(*)::bigint AS n FROM device_usage_spans`)).rows[0].n)
console.log(`구간 표 현재 ${fmt(before)}행 · 대상 달 조각 ${todo.length}개`)
if (flag('--dry')) {
  for (const p of todo) console.log(`  ${p.name.padEnd(30)} 약 ${fmt(Math.max(0, Number(p.est)))}행 · ${(Number(p.bytes) / 1024 ** 2).toFixed(0)} MB`)
  console.log('미리 보기 — 아무것도 쓰지 않았습니다.')
  await db.end()
  process.exit(0)
}

const t0 = Date.now()
for (const p of todo) {
  if (!/^raw_device_status_[a-z0-9_]+$/.test(p.name)) fail(`조각 이름이 이상합니다: ${p.name}`)
  const t = Date.now()
  // 등록이 지워진 서버의 행(있다면)은 건너뛴다 — 구간 표는 agent_servers 를 참조한다
  const r = await db.query(
    `INSERT INTO device_usage_spans (hospital_code, server, measurement_code, device_type, serial_number, first_event_at, last_event_at)
     SELECT max(ds.hospital_code), ds.server, ds.measurement_code, COALESCE(ds.device_type, 0), COALESCE(ds.serial_number, ''),
            min(ds.event_at), max(ds.event_at)
       FROM ${p.name} ds
      WHERE ds.event_at >= timestamp '2000-01-01' AND ds.server IN (SELECT id FROM agent_servers)
      GROUP BY ds.server, ds.measurement_code, COALESCE(ds.device_type, 0), COALESCE(ds.serial_number, '')
     ON CONFLICT (server, measurement_code, device_type, serial_number) DO UPDATE SET
       first_event_at = LEAST(device_usage_spans.first_event_at, EXCLUDED.first_event_at),
       last_event_at = GREATEST(device_usage_spans.last_event_at, EXCLUDED.last_event_at),
       updated_at = now()`,
  )
  console.log(`  ${p.name.padEnd(30)} 구간 ${fmt(r.rowCount ?? 0)}개 반영 — ${((Date.now() - t) / 1000).toFixed(1)}초`)
}
const after = Number((await db.query(`SELECT count(*)::bigint AS n FROM device_usage_spans`)).rows[0].n)
await db.query(`ANALYZE device_usage_spans`)
console.log(`끝 — 구간 표 ${fmt(before)} → ${fmt(after)}행 (${Math.round((Date.now() - t0) / 1000)}초). 대조: npx tsx scripts/usage-spans-backfill.mts --verify`)
await db.end()
process.exit(0)
