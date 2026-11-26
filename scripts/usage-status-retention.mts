/**
 * 원본 기기 상태 이력 보관 기간 정리 (projects/usage_spans_design.md §3.5)
 *
 *   npx tsx scripts/usage-status-retention.mts                 미리 보기 — 보관 기간(기본 6개월) 밖의 달 조각과 크기만 보여 준다
 *   npx tsx scripts/usage-status-retention.mts --months=6      보관 개월 수 지정 (3 이상)
 *   npx tsx scripts/usage-status-retention.mts --apply         실제로 지운다 (원본 DB 쓰기 — 되돌릴 수 없다)
 *
 * 지우는 것은 raw_device_status 의 달 조각(raw_device_status_yYYYYmMM)뿐이다. 측정 · 측정 기기 · 기기 등록 · 기기 사용 구간 표는
 * 건드리지 않는다. 계산은 구간 표(device_usage_spans)를 읽으므로 화면의 값은 달라지지 않는다 — 다만 지운 달의 구간은 원본에서
 * 다시 만들 수 없다. 그래서 지우기 전에 그 조각의 구간이 구간 표에 모두 있는지 확인하고, 하나라도 빠져 있으면 멈춘다.
 * 이번 달을 포함해 보관 개월 수만큼의 달은 남긴다(--months=6 이고 지금이 11월이면 6월 조각부터 남는다).
 * PROD 에서 --apply 는 명시 허락 후에만 (CLAUDE.md 규칙 9). 자동으로 돌리지 않는다.
 */
import { fail, flag, fmtBytes, opt, usageDb } from './usage-lib.mts'

const months = Number(opt('--months') ?? 6)
if (!Number.isInteger(months) || months < 3) fail('--months 는 3 이상의 정수여야 합니다 (병원 서버가 기록을 90일 보관하므로 그보다 짧게 두지 않는다)')
const apply = flag('--apply')

const db = usageDb()
await db.connect()
if (!(await db.query(`SELECT to_regclass('device_usage_spans') AS t`)).rows[0].t) {
  await db.end()
  fail('device_usage_spans 표가 없습니다 — 구간 표를 먼저 만들고 채운 뒤에 정리할 수 있습니다')
}

// 남기는 첫 달: 이번 달에서 (months − 1)개월 전
const now = new Date(Date.now() + 9 * 3600_000)
const keepFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1))
const keepKey = keepFrom.getUTCFullYear() * 100 + (keepFrom.getUTCMonth() + 1)

const parts = (
  await db.query(
    `SELECT c.relname AS name, c.reltuples::bigint AS est, pg_total_relation_size(c.oid) AS bytes
       FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'raw_device_status' ORDER BY c.relname`,
  )
).rows as { name: string; est: number; bytes: number }[]
const targets = parts.filter((p) => {
  const m = /^raw_device_status_y(\d{4})m(\d{2})$/.exec(p.name)
  return m ? Number(m[1]) * 100 + Number(m[2]) < keepKey : false // 기본 조각 등 이름이 다른 것은 대상이 아니다
})
const total = parts.reduce((a, p) => a + Number(p.bytes), 0)
const freed = targets.reduce((a, p) => a + Number(p.bytes), 0)
console.log(`보관 ${months}개월 — ${keepFrom.toISOString().slice(0, 7)} 조각부터 남깁니다. 상태 이력 전체 ${fmtBytes(total)} (조각 ${parts.length}개)`)
if (targets.length === 0) {
  console.log('지울 달 조각이 없습니다.')
  await db.end()
  process.exit(0)
}
for (const p of targets) console.log(`  ${apply ? '삭제' : '대상'}  ${p.name.padEnd(30)} 약 ${Math.max(0, Number(p.est)).toLocaleString()}행 · ${fmtBytes(Number(p.bytes))}`)
console.log(`합계 ${fmtBytes(freed)} (조각 ${targets.length}개)`)
if (!apply) {
  console.log('미리 보기 — 아무것도 지우지 않았습니다. 지우려면 --apply')
  await db.end()
  process.exit(0)
}

for (const p of targets) {
  // 이 조각의 구간이 구간 표에 모두 있는가 — 하나라도 빠졌으면 지우지 않는다
  const miss = await db.query(
    `SELECT count(*)::int AS n FROM (
       SELECT ds.server, ds.measurement_code, COALESCE(ds.device_type, 0)::smallint AS dt, COALESCE(ds.serial_number, '') AS sn,
              min(ds.event_at) AS fe, max(ds.event_at) AS le
         FROM ${p.name} ds
        WHERE ds.event_at >= timestamp '2000-01-01' AND ds.server IN (SELECT id FROM agent_servers)
        GROUP BY 1, 2, 3, 4
     ) r
     WHERE NOT EXISTS (
       SELECT 1 FROM device_usage_spans s
        WHERE s.server = r.server AND s.measurement_code = r.measurement_code AND s.device_type = r.dt AND s.serial_number = r.sn
          AND s.first_event_at <= r.fe AND s.last_event_at >= r.le)`,
  )
  if (Number(miss.rows[0].n) > 0) {
    console.error(`중단 — ${p.name} 의 구간 ${miss.rows[0].n}개가 구간 표에 없습니다. 먼저 npx tsx scripts/usage-spans-backfill.mts --partition=${p.name}`)
    await db.end()
    process.exit(1)
  }
  await db.query('BEGIN')
  try {
    await db.query(`ALTER TABLE raw_device_status DETACH PARTITION ${p.name}`)
    await db.query(`DROP TABLE ${p.name}`)
    await db.query('COMMIT')
    console.log(`  지움  ${p.name}`)
  } catch (e) {
    await db.query('ROLLBACK')
    console.error(`실패 — ${p.name}: ${(e as Error).message}`)
    await db.end()
    process.exit(1)
  }
}
console.log(`끝 — ${fmtBytes(freed)} 비움`)
await db.end()
process.exit(0)
