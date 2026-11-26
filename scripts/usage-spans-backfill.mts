/**
 * 기기 사용 구간 표 채우기 · 대조 (projects/usage_spans_design.md §3.3)
 *
 *   npx tsx scripts/usage-spans-backfill.mts --dry               달 조각별 행 수(추정)만 보여 준다 — 아무것도 쓰지 않는다
 *   npx tsx scripts/usage-spans-backfill.mts                     원본 상태 이력 전체를 달 조각마다 묶어 구간 표에 넣는다 (원본 DB 쓰기)
 *   npx tsx scripts/usage-spans-backfill.mts --partition=<이름>   그 조각만
 *   npx tsx scripts/usage-spans-backfill.mts --verify             구간 표 = 원본에서 다시 묶은 값 인가 (읽기 전용, 전 병원)
 *   npx tsx scripts/usage-spans-backfill.mts --verify <병원코드>   그 병원만
 *   npx tsx scripts/usage-spans-backfill.mts --verify --partition=<이름>   그 달 조각의 구간이 구간 표에 들어 있는가만 (가장 가볍다)
 *
 * 대조는 운영 중에 돌려도 되게 만들었다: 한 시점으로 고정해 읽고(수신 중에도 정확), 병렬 읽기를 끄고, 전 병원일 때는 달 조각을
 * 하나씩 차례로 한 번만 읽어 스크립트에서 합친다(2026-11-26 — 병원마다 색인으로 읽던 방식은 PROD 에서 20분 넘게 끝나지 않고
 * 부하를 올렸다). 그래도 원본 전체를 한 번 읽는 일이므로 정시 수신 직후(매시 0~10분)는 피하는 편이 낫다.
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
  // 한 시점으로 고정해 읽는다 — 수신 중에 돌려도 원본과 구간 표가 같은 순간으로 비교된다 (읽기 전용)
  await db.query(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`)
  // 병렬 읽기를 끈다 — 대조는 급하지 않고, 운영 중인 수신 · 집계와 디스크를 다투지 않게 한 번에 한 줄기로만 읽는다
  await db.query(`SET LOCAL max_parallel_workers_per_gather = 0`)
  const [only] = positional
  const onlyPartV = opt('--partition')
  const t0 = Date.now()
  type Span = { h: string; fe: number; le: number }
  const SEP = '\u0001'
  const keyOf = (r: { server: string; mc: string; dt: number; sn: string }) => [r.server, r.mc, r.dt, r.sn].join(SEP)
  const MS = (col: string) => `(extract(epoch FROM ${col}) * 1000)::bigint`
  const servers = new Set((await db.query(`SELECT id::text AS id FROM agent_servers`)).rows.map((r) => r.id as string))

  // 원본에서 다시 묶은 구간. 전 병원이면 달 조각을 하나씩 차례로 읽어 여기서 합친다 —
  // 병원마다 색인으로 읽으면 원본 전체를 흩어진 순서로 여러 번 읽게 된다(PROD 8,290만 행에서 20분 넘게 끝나지 않았다)
  const raw = new Map<string, Span>()
  let skipped = 0
  const take = (rows: { server: string; mc: string; dt: number; sn: string; h: string; fe: string; le: string }[]) => {
    for (const r of rows) {
      if (!servers.has(r.server)) {
        skipped++ // 등록이 지워진 서버의 행 — 변환도 건너뛴다
        continue
      }
      const k = keyOf(r)
      const fe = Number(r.fe)
      const le = Number(r.le)
      const cur = raw.get(k)
      if (!cur) raw.set(k, { h: r.h, fe, le })
      else {
        if (fe < cur.fe) cur.fe = fe
        if (le > cur.le) cur.le = le
      }
    }
  }
  const groupSql = (from: string, where: string) =>
    `SELECT ds.server::text AS server, ds.measurement_code AS mc, COALESCE(ds.device_type, 0)::int AS dt, COALESCE(ds.serial_number, '') AS sn,
            max(ds.hospital_code) AS h, ${MS('min(ds.event_at)')} AS fe, ${MS('max(ds.event_at)')} AS le
       FROM ${from} ds
      WHERE ds.event_at >= timestamp '2000-01-01'${where}
      GROUP BY 1, 2, 3, 4`
  if (only) {
    take((await db.query(groupSql('raw_device_status', ` AND ds.hospital_code = $1`), [only])).rows)
  } else {
    const partsV = (
      await db.query(
        `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
          WHERE p.relname = 'raw_device_status' ORDER BY c.relname`,
      )
    ).rows.map((r) => r.name as string)
    const todoV = onlyPartV ? partsV.filter((n) => n === onlyPartV) : partsV
    if (onlyPartV && todoV.length === 0) {
      await db.end()
      fail(`달 조각 ${onlyPartV} 이 없습니다`)
    }
    for (const name of todoV) {
      if (!/^raw_device_status_[a-z0-9_]+$/.test(name)) fail(`조각 이름이 이상합니다: ${name}`)
      const t = Date.now()
      const r = await db.query(groupSql(name, ''))
      take(r.rows)
      console.log(`  ${name.padEnd(30)} 구간 ${fmt(r.rowCount ?? 0)}개 읽음 — ${((Date.now() - t) / 1000).toFixed(1)}초`)
    }
  }

  const spanRows = (
    await db.query(
      `SELECT server::text AS server, measurement_code AS mc, device_type::int AS dt, serial_number AS sn, hospital_code AS h,
              ${MS('first_event_at')} AS fe, ${MS('last_event_at')} AS le
         FROM device_usage_spans${only ? ' WHERE hospital_code = $1' : ''}`,
      only ? [only] : [],
    )
  ).rows as { server: string; mc: string; dt: number; sn: string; h: string; fe: string; le: string }[]
  await db.query(`COMMIT`)

  // 달 조각 하나만 볼 때는 '그 조각의 구간이 구간 표에 들어 있는가'만 본다(구간 표의 시각은 다른 달까지 걸쳐 있을 수 있다)
  const partial = !!onlyPartV && !only
  type Tally = { spans: number; raw: number; missing: number; diff: number; extra: number }
  const byHospital = new Map<string, Tally>()
  const tally = (h: string) => {
    let x = byHospital.get(h)
    if (!x) byHospital.set(h, (x = { spans: 0, raw: 0, missing: 0, diff: 0, extra: 0 }))
    return x
  }
  const seen = new Set<string>()
  for (const s of spanRows) {
    const k = keyOf(s)
    const r = raw.get(k)
    const x = tally(s.h)
    x.spans++
    if (!r) {
      if (!partial) x.extra++
      continue
    }
    seen.add(k)
    if (partial ? Number(s.fe) > r.fe || Number(s.le) < r.le : Number(s.fe) !== r.fe || Number(s.le) !== r.le || s.h !== r.h) x.diff++
  }
  for (const [k, r] of Array.from(raw.entries())) {
    const x = tally(r.h)
    x.raw++
    if (!seen.has(k)) x.missing++
  }
  let bad = 0
  for (const [h, x] of Array.from(byHospital.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    // extra = 원본에 없는 구간 — 원본 상태 이력을 보관 기간으로 정리한 뒤에는 정상이다
    const ok = x.missing === 0 && x.diff === 0
    if (!ok) bad++
    if (!ok || only || x.extra > 0) {
      console.log(`${ok ? '✓' : '✗'} ${h}: 구간 ${fmt(x.spans)} · 원본에서 다시 묶은 구간 ${fmt(x.raw)} — 빠짐 ${x.missing} · 시각 다름 ${x.diff}${x.extra ? ` · 원본에 없는 구간 ${x.extra}(원본을 지운 달이면 정상)` : ''}`)
    }
  }
  const scope = only ? `병원 ${only}` : partial ? `달 조각 ${onlyPartV} (그 조각의 구간이 구간 표에 들어 있는지만)` : `병원 ${byHospital.size}곳`
  console.log(
    `${bad === 0 ? '✓' : '✗'} ${scope} · 구간 표 ${fmt(spanRows.length)}개 · 원본에서 다시 묶은 구간 ${fmt(raw.size)}개 — ${bad === 0 ? '모두 원본과 일치' : `${bad}곳 불일치`}` +
      `${skipped ? ` · 등록이 지워진 서버의 구간 ${fmt(skipped)}개 제외` : ''} (${Math.round((Date.now() - t0) / 1000)}초)`,
  )
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
