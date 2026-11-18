/**
 * 사용량 수집 — 병원 토큰 발급·조회·폐기 (projects/usage_collection_design.md §7.1, §8.3)
 *
 *   npx tsx scripts/usage-issue-token.mts <병원코드> [메모]      발급 — 토큰 원문은 이때 한 번만 출력된다
 *   npx tsx scripts/usage-issue-token.mts --list [병원코드]      목록
 *   npx tsx scripts/usage-issue-token.mts --revoke=<앞 8자>      폐기
 *
 * 토큰은 병원에 속한다. 그 병원의 서버들은 같은 토큰을 쓴다. 교체할 때 끊기지 않도록 활성 토큰은 병원당 2개까지.
 * 원본 DB 에는 토큰의 SHA-256 만 저장한다.
 */
import { createHash, randomBytes } from 'node:crypto'
import { userInfo } from 'node:os'
import { fail, flag, fmtTime, mainDb, opt, positional, usageDb } from './usage-lib.mts'

const MAX_ACTIVE = 2
const usage = usageDb()
await usage.connect()

try {
  const revoke = opt('--revoke')
  if (revoke) {
    const r = await usage.query(
      `UPDATE agent_tokens SET active = false, revoked_at = now() WHERE token_prefix = $1 AND active RETURNING hospital_code, label`,
      [revoke],
    )
    if (r.rowCount === 0) fail(`활성 토큰 중 앞자리가 ${revoke} 인 것이 없습니다`)
    for (const row of r.rows) console.log(`폐기: ${revoke}…  ${row.hospital_code}  ${row.label ?? ''}`)
  } else if (flag('--list')) {
    const code = positional[0]
    const r = await usage.query(
      `SELECT hospital_code, token_prefix, label, active, created_by, created_at, revoked_at, last_used_at
       FROM agent_tokens ${code ? 'WHERE hospital_code = $1' : ''} ORDER BY hospital_code, created_at`,
      code ? [code] : [],
    )
    if (r.rowCount === 0) console.log('발급된 토큰이 없습니다')
    for (const t of r.rows) {
      console.log(
        `${t.hospital_code}  ${t.token_prefix}…  ${t.active ? '활성' : '폐기'}  발급 ${fmtTime(t.created_at)}  최근 사용 ${fmtTime(t.last_used_at)}  ${t.label ?? ''}`,
      )
    }
  } else {
    const [hospitalCode, ...labelParts] = positional
    if (!hospitalCode) fail('병원코드를 지정하세요 (예: HOSP-000026)')
    const label = labelParts.join(' ') || null

    // 본체 DB 에 있는 병원인지 확인한다 (DB 가 달라 참조 제약이 없다)
    const main = mainDb()
    await main.connect()
    let hospitalName: string
    try {
      const h = await main.query(`SELECT hospital_name FROM hospitals WHERE hospital_code = $1`, [hospitalCode])
      if (h.rowCount === 0) fail(`본체 DB 에 병원 ${hospitalCode} 이(가) 없습니다`)
      hospitalName = h.rows[0].hospital_name
    } finally {
      await main.end()
    }

    const active = await usage.query(`SELECT count(*)::int AS n FROM agent_tokens WHERE hospital_code = $1 AND active`, [
      hospitalCode,
    ])
    if (active.rows[0].n >= MAX_ACTIVE) {
      fail(`${hospitalCode} 의 활성 토큰이 이미 ${MAX_ACTIVE}개입니다. --list 로 확인하고 --revoke 로 정리한 뒤 발급하세요`)
    }

    const token = `tua_${randomBytes(24).toString('hex')}`
    const hash = createHash('sha256').update(token).digest('hex')
    await usage.query(
      `INSERT INTO agent_tokens (hospital_code, token_hash, token_prefix, label, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [hospitalCode, hash, token.slice(0, 8), label, userInfo().username],
    )
    const db = await usage.query(`SELECT current_database() AS db`)
    console.log(`병원: ${hospitalCode} ${hospitalName}`)
    console.log(`원본 DB: ${db.rows[0].db}`)
    console.log('')
    console.log(`USAGE_TOKEN=${token}`)
    console.log('')
    console.log('이 값은 다시 볼 수 없습니다. Agent 설정 파일(/etc/thync-usage-agent/agent.env)에 넣으세요.')
  }
} finally {
  await usage.end()
}
