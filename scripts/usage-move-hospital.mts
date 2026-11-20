/**
 * 사용량 수집 — 병원 코드 변경 반영 (projects/usage_collection_design.md §7.2)
 *
 * 본체에서 병원 코드가 바뀌면(중복 병원 정리 등) 원본 DB 의 병원 코드도 따로 바꿔야 한다. DB 가 달라 자동으로 따라오지 않는다.
 *
 *   npx tsx scripts/usage-move-hospital.mts <이전 코드> <새 코드>            무엇이 바뀔지만 표시
 *   npx tsx scripts/usage-move-hospital.mts <이전 코드> <새 코드> --apply    적용
 *
 * 새 코드가 본체 DB 에 있어야 한다. 두 병원에 같은 이름의 서버가 있으면 멈춘다(원본 행의 서버 구분이 겹친다).
 */
import { HOSPITAL_TABLES, fail, flag, mainDb, positional, usageDb } from './usage-lib.mts'

const [from, to] = positional
if (!from || !to) fail('이전 코드와 새 코드를 지정하세요')
if (from === to) fail('두 코드가 같습니다')
const apply = flag('--apply')

const main = mainDb()
await main.connect()
try {
  const h = await main.query(`SELECT hospital_name FROM hospitals WHERE hospital_code = $1`, [to])
  if (h.rowCount === 0) fail(`본체 DB 에 병원 ${to} 이(가) 없습니다`)
  console.log(`${from} → ${to} (${h.rows[0].hospital_name})`)
} finally {
  await main.end()
}

const db = usageDb()
await db.connect()
try {
  const clash = await db.query(
    `SELECT a.server_id FROM agent_servers a JOIN agent_servers b ON b.server_id = a.server_id
     WHERE a.hospital_code = $1 AND b.hospital_code = $2`,
    [from, to],
  )
  if ((clash.rowCount ?? 0) > 0) {
    fail(`두 병원에 같은 이름의 서버가 있습니다: ${clash.rows.map((r) => r.server_id).join(', ')} — 서버 이름을 먼저 정리해야 합니다`)
  }
  await db.query('BEGIN')
  let total = 0
  for (const t of HOSPITAL_TABLES) {
    if (t === 'agent_enrollments') {
      // 새 코드에 이미 수집 등록이 있으면 서버 대수를 합치고 이전 등록 행은 지운다 (병원코드가 기본 키라 그대로 옮기면 충돌)
      const merged = await db.query(
        `UPDATE agent_enrollments n SET expected_servers = LEAST(50, n.expected_servers + o.expected_servers), updated_at = now()
           FROM agent_enrollments o WHERE n.hospital_code = $2 AND o.hospital_code = $1`,
        [from, to],
      )
      if (merged.rowCount) {
        await db.query(`DELETE FROM agent_enrollments WHERE hospital_code = $1`, [from])
        console.log(`  ${t}: 등록 합침 (서버 대수 합산)`)
        total += 1
        continue
      }
    }
    const r = await db.query(`UPDATE ${t} SET hospital_code = $2 WHERE hospital_code = $1`, [from, to])
    console.log(`  ${t}: ${r.rowCount}행`)
    total += r.rowCount ?? 0
  }
  if (total === 0) console.log(`원본 DB 에 ${from} 의 행이 없습니다`)
  if (apply) {
    await db.query('COMMIT')
    console.log('적용했습니다.')
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
