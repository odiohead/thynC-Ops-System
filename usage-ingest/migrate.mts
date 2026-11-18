/**
 * 원본 DB 스키마 적용 — usage-ingest/migrations/*.sql 을 이름순으로, 아직 적용하지 않은 것만 실행한다.
 * 본체의 Prisma 마이그레이션과 별개다 (대상 DB가 다르다).
 *
 *   node usage-ingest/dist/migrate.mjs            적용
 *   node usage-ingest/dist/migrate.mjs --status   적용 여부만 표시
 *
 * 파일 하나가 트랜잭션 하나다. 실패하면 그 파일은 적용되지 않은 채로 멈춘다.
 */
import path from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import pg from 'pg'

const HERE = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(HERE, '..', '.env'), quiet: true })
const DIR = path.join(HERE, '..', 'migrations')
const statusOnly = process.argv.includes('--status')

if (!process.env.USAGE_DATABASE_URL) {
  console.error('USAGE_DATABASE_URL 이 없습니다 (usage-ingest/.env)')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.USAGE_DATABASE_URL })
await client.connect()
try {
  const who = await client.query(`SELECT current_database() AS db, current_user AS usr`)
  console.log(`대상: ${who.rows[0].db} (계정 ${who.rows[0].usr})`)
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  )
  const done = new Set((await client.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name as string))
  const files = readdirSync(DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
  let applied = 0
  for (const f of files) {
    if (done.has(f)) {
      console.log(`  적용됨  ${f}`)
      continue
    }
    if (statusOnly) {
      console.log(`  미적용  ${f}`)
      continue
    }
    const sql = readFileSync(path.join(DIR, f), 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f])
      await client.query('COMMIT')
      console.log(`  적용    ${f}`)
      applied++
    } catch (e) {
      await client.query('ROLLBACK')
      console.error(`  실패    ${f}: ${(e as Error).message}`)
      process.exitCode = 1
      break
    }
  }
  if (!statusOnly) console.log(applied > 0 ? `${applied}개 적용` : '적용할 것이 없습니다')
} finally {
  await client.end()
}
