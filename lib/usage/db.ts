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

const globalForUsage = globalThis as unknown as { usagePool?: Pool; usageBatchPool?: Pool }

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

/**
 * 일별 집계(lib/usage/stats.ts)용 — 읽기 전용은 같고 조회 시간 상한만 길다.
 * 화면 조회는 20초 상한으로 보호하지만, 병원 하나의 91일을 다시 계산하는 집계는 큰 병원에서 그보다 오래 걸린다
 * (2026-11-26 PROD 목포중앙 — 상태 이력 167만 행, 24초 → 매번 실패). 화면이 쓰는 풀과 따로 두어 화면 조회를 밀어내지 않는다.
 */
export function usageBatchPool(): Pool {
  const url = process.env.USAGE_DATABASE_URL
  if (!url) throw new UsageDbUnavailable()
  if (!globalForUsage.usageBatchPool) {
    const pool = new Pool({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 30_000,
      options: '-c default_transaction_read_only=on -c statement_timeout=120000',
    })
    pool.on('error', (e) => console.error('[usage] 원본 DB 연결 오류(집계)', e.message))
    globalForUsage.usageBatchPool = pool
  }
  return globalForUsage.usageBatchPool
}

export function isUsageConfigured(): boolean {
  return !!process.env.USAGE_DATABASE_URL
}
