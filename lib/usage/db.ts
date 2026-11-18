/**
 * 사용량 원본 DB 접속 (본체 앱용 — 조회 전용)
 *
 * 원본 DB(thync_usage / thync_usage_dev)는 본체 DB와 다른 DB다. Prisma 모델이 없고 SQL로 읽는다.
 * 본체 앱은 원본을 읽기만 한다 — 세션을 읽기 전용으로 열어, 이 풀로는 쓰기가 되지 않는다.
 * (쓰기는 수신부 usage-ingest/ 와 운영 스크립트 scripts/usage-*.mts 만 한다. CLAUDE.md 규칙 9)
 */
import { Pool } from 'pg'

export class UsageDbUnavailable extends Error {
  constructor() {
    super('사용량 원본 DB가 설정되지 않았습니다 (.env USAGE_DATABASE_URL)')
  }
}

const globalForUsage = globalThis as unknown as { usagePool?: Pool }

export function usagePool(): Pool {
  const url = process.env.USAGE_DATABASE_URL
  if (!url) throw new UsageDbUnavailable()
  if (!globalForUsage.usagePool) {
    const pool = new Pool({
      connectionString: url,
      max: 4,
      idleTimeoutMillis: 30_000,
      // 읽기 전용 + 화면 조회가 오래 걸리지 않게 상한
      options: '-c default_transaction_read_only=on -c statement_timeout=20000',
    })
    pool.on('error', (e) => console.error('[usage] 원본 DB 연결 오류', e.message))
    globalForUsage.usagePool = pool
  }
  return globalForUsage.usagePool
}

export function isUsageConfigured(): boolean {
  return !!process.env.USAGE_DATABASE_URL
}
