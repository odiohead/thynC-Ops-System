/**
 * 사용량 수집 — 병원·서버별 수신 현황 (projects/usage_collection_design.md §6.4, §8.3)
 *
 *   npx tsx scripts/usage-status.mts                 전체
 *   npx tsx scripts/usage-status.mts <병원코드>       한 병원 (최근 실행 10건 포함)
 *   npx tsx scripts/usage-status.mts --stale=48      마지막 성공이 48시간보다 오래된 서버만
 *
 * 읽기 전용. 병원 DB 에서 지워진 것은 다시 받을 수 없으므로(보관 기한 기본 90일), 오래 끊긴 서버를 여기서 찾는다.
 */
import { fmtBytes, fmtTime, opt, positional, usageDb } from './usage-lib.mts'

const hospital = positional[0]
const staleHours = opt('--stale') ? Number(opt('--stale')) : null
const db = usageDb()
await db.connect()

try {
  const size = await db.query(
    `SELECT current_database() AS db, pg_database_size(current_database()) AS bytes,
            (SELECT COALESCE(sum(pg_total_relation_size(inhrelid)), 0) FROM pg_inherits WHERE inhparent = 'raw_device_status'::regclass) AS status_bytes,
            (SELECT count(*) FROM pg_inherits WHERE inhparent = 'raw_device_status'::regclass) AS status_parts`,
  )
  const s = size.rows[0]
  console.log(`원본 DB ${s.db}: ${fmtBytes(s.bytes)} (기기 상태 이력 ${fmtBytes(s.status_bytes)}, 달 조각 ${s.status_parts}개)`)

  const servers = await db.query(
    `SELECT s.id, s.hospital_code, s.server_id, s.hostname, s.agent_version, s.db_time_zone,
            s.last_seen_at, s.last_success_at, s.measurements_synced_until, s.reconciled_at,
            EXTRACT(EPOCH FROM (now() - s.last_success_at)) / 3600 AS hours_since_success,
            (SELECT count(*) FROM raw_measurements m WHERE m.server = s.id) AS measurements,
            (SELECT count(*) FROM raw_measurements m WHERE m.server = s.id AND m.measurement_status = 2 AND m.source_gone_at IS NULL) AS active,
            (SELECT count(*) FROM raw_measurements m WHERE m.server = s.id AND m.source_gone_at IS NOT NULL) AS gone,
            (SELECT count(*) FROM raw_measurement_devices d WHERE d.server = s.id) AS devices,
            (SELECT json_agg(json_build_object('year', c.table_year, 'last_id', c.last_id, 'verified_id', c.verified_id) ORDER BY c.table_year)
               FROM status_cursors c WHERE c.server = s.id) AS cursors,
            (SELECT r.status FROM agent_runs r WHERE r.server = s.id ORDER BY r.id DESC LIMIT 1) AS last_run_status,
            (SELECT r.error FROM agent_runs r WHERE r.server = s.id ORDER BY r.id DESC LIMIT 1) AS last_run_error
     FROM agent_servers s
     WHERE ($1::text IS NULL OR s.hospital_code = $1)
     ORDER BY s.hospital_code, s.server_id`,
    [hospital ?? null],
  )
  const rows = servers.rows.filter(
    (r) => staleHours === null || r.hours_since_success === null || Number(r.hours_since_success) > staleHours,
  )
  if (rows.length === 0) console.log(staleHours !== null ? `마지막 성공이 ${staleHours}시간보다 오래된 서버가 없습니다` : '등록된 서버가 없습니다')

  for (const r of rows) {
    const hours = r.hours_since_success === null ? null : Number(r.hours_since_success)
    const lag = hours === null ? '성공한 적 없음' : hours < 1 ? '1시간 이내' : `${Math.round(hours)}시간 전`
    console.log('')
    console.log(`${r.hospital_code} / ${r.server_id}  (Agent ${r.agent_version ?? '?'}, 호스트 ${r.hostname ?? '?'}, DB 시간대 ${r.db_time_zone ?? '?'})`)
    console.log(`  마지막 성공: ${fmtTime(r.last_success_at)} (${lag})   마지막 접속: ${fmtTime(r.last_seen_at)}   최근 실행: ${r.last_run_status ?? '-'}`)
    if (r.last_run_status === 'failed' && r.last_run_error) console.log(`  최근 오류: ${String(r.last_run_error).slice(0, 200)}`)
    console.log(`  측정 ${r.measurements}건 (진행 중 ${r.active}, 병원에서 사라짐 ${r.gone}) · 측정 기기 ${r.devices}행`)
    console.log(`  측정 수신 기준 시각(병원 DB): ${r.measurements_synced_until ?? '없음 — 다음 실행에 전체 수신'}   마지막 대조: ${fmtTime(r.reconciled_at)}`)
    for (const c of r.cursors ?? []) {
      const n = await db.query(`SELECT count(*) AS n FROM raw_device_status WHERE server = $1 AND table_year = $2`, [r.id, c.year])
      console.log(`  상태 이력 ${c.year}: ${n.rows[0].n}행, 받은 번호 ${c.last_id}, 대조 완료 ${c.verified_id}`)
    }
  }

  if (hospital) {
    const runs = await db.query(
      `SELECT r.id, s.server_id, r.started_at, r.finished_at, r.status, r.full_sync, r.reconcile, r.stats, r.reconcile_result, r.error
       FROM agent_runs r JOIN agent_servers s ON s.id = r.server
       WHERE r.hospital_code = $1 ORDER BY r.id DESC LIMIT 10`,
      [hospital],
    )
    console.log('')
    console.log('최근 실행 10건')
    for (const r of runs.rows) {
      const secs = r.finished_at ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000) : null
      const tags = [r.full_sync ? '전체' : '', r.reconcile ? '대조' : ''].filter(Boolean).join('·')
      console.log(`  #${r.id} ${r.server_id} ${fmtTime(r.started_at)} ${r.status}${secs !== null ? ` ${secs}초` : ''}${tags ? ` [${tags}]` : ''}`)
      if (r.stats?.sent) console.log(`      전송: ${JSON.stringify(r.stats.sent)}`)
      if (r.reconcile_result) console.log(`      대조: ${JSON.stringify(r.reconcile_result)}`)
      if (r.error) console.log(`      오류: ${String(r.error).slice(0, 300)}`)
    }
  }
} finally {
  await db.end()
}
