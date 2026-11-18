/**
 * 사용량 수집 — 수신 위치 되돌리기 (수동 재전송, projects/usage_collection_design.md §6.3)
 *
 * 병원 서버에 접속하지 않고 중앙에서 위치만 되돌린다. Agent 의 다음 실행 때 그 지점부터 다시 들어온다.
 * 받은 행은 지우지 않는다 — 다시 받은 행은 같은 키로 덮어써진다.
 *
 *   npx tsx scripts/usage-rewind.mts <병원코드> [서버이름] --measurements          측정을 처음부터 전부 다시
 *   npx tsx scripts/usage-rewind.mts <병원코드> [서버이름] --status=<번호> [--year=2026]   상태 이력을 이 번호 다음부터 다시 (0 = 처음부터)
 *   npx tsx scripts/usage-rewind.mts <병원코드> [서버이름] --reconcile             다음 실행에서 대조를 다시
 *
 * 기본은 무엇이 바뀔지만 보여 준다. 실제로 바꾸려면 --apply.
 */
import { fail, flag, opt, positional, usageDb } from './usage-lib.mts'

const [hospital, serverId] = positional
if (!hospital) fail('병원코드를 지정하세요')
const doMeasurements = flag('--measurements')
const statusTo = opt('--status')
const year = opt('--year')
const doReconcile = flag('--reconcile')
const apply = flag('--apply')
if (!doMeasurements && statusTo === undefined && !doReconcile) fail('--measurements, --status=<번호>, --reconcile 중 하나 이상을 지정하세요')
if (statusTo !== undefined && (!/^\d+$/.test(statusTo) || Number(statusTo) < 0)) fail('--status 는 0 이상의 정수')
if (year !== undefined && !/^\d{4}$/.test(year)) fail('--year 는 4자리 연도')

const db = usageDb()
await db.connect()
try {
  const servers = await db.query(
    `SELECT id, server_id, measurements_synced_until, reconciled_at FROM agent_servers
     WHERE hospital_code = $1 AND ($2::text IS NULL OR server_id = $2) ORDER BY server_id`,
    [hospital, serverId ?? null],
  )
  if (servers.rowCount === 0) fail(`${hospital}${serverId ? ` / ${serverId}` : ''} 에 해당하는 서버가 없습니다`)

  await db.query('BEGIN')
  for (const s of servers.rows) {
    console.log(`${hospital} / ${s.server_id}`)
    if (doMeasurements) {
      console.log(`  측정 수신 기준 시각: ${s.measurements_synced_until ?? '없음'} → 없음 (다음 실행에 전체 수신)`)
      await db.query(`UPDATE agent_servers SET measurements_synced_until = NULL WHERE id = $1`, [s.id])
    }
    if (doReconcile) {
      console.log(`  마지막 대조: ${s.reconciled_at ? new Date(s.reconciled_at).toISOString() : '없음'} → 없음 (다음 실행에 대조)`)
      await db.query(`UPDATE agent_servers SET reconciled_at = NULL WHERE id = $1`, [s.id])
    }
    if (statusTo !== undefined) {
      const cur = await db.query(
        `SELECT table_year, last_id, verified_id FROM status_cursors WHERE server = $1 AND ($2::int IS NULL OR table_year = $2) ORDER BY table_year`,
        [s.id, year ? Number(year) : null],
      )
      if (cur.rowCount === 0) console.log('  상태 이력 수신 위치가 없습니다')
      for (const c of cur.rows) {
        const to = Math.min(c.last_id, Number(statusTo))
        console.log(`  상태 이력 ${c.table_year}: 받은 번호 ${c.last_id} → ${to}, 대조 완료 ${c.verified_id} → ${Math.min(c.verified_id, to)}`)
        await db.query(
          `UPDATE status_cursors SET last_id = LEAST(last_id, $3), verified_id = LEAST(verified_id, $3), updated_at = now()
           WHERE server = $1 AND table_year = $2`,
          [s.id, c.table_year, Number(statusTo)],
        )
      }
    }
  }
  if (apply) {
    await db.query('COMMIT')
    console.log('적용했습니다. Agent 의 다음 실행 때 다시 들어옵니다.')
  } else {
    await db.query('ROLLBACK')
    console.log('미리 보기입니다. 실제로 바꾸려면 --apply 를 붙이세요.')
  }
} catch (e) {
  await db.query('ROLLBACK').catch(() => {})
  throw e
} finally {
  await db.end()
}
