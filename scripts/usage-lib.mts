/**
 * 사용량 수집 운영 스크립트 공용 — 원본 DB / 본체 DB 접속.
 * 원본 DB 는 본체 .env 의 USAGE_DATABASE_URL (본체 DB 와 다른 DB, projects/usage_collection_design.md §7.4)
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
dotenv.config({ path: [path.join(ROOT, '.env.local'), path.join(ROOT, '.env')], quiet: true })

pg.types.setTypeParser(1114, (v) => v) // timestamp(시간대 없음)는 문자열 그대로
pg.types.setTypeParser(20, (v) => Number(v)) // bigint → number (이 스크립트들이 다루는 범위에서는 안전)

export function usageDb(): pg.Client {
  const url = process.env.USAGE_DATABASE_URL
  if (!url) fail('USAGE_DATABASE_URL 이 .env 에 없습니다')
  return new pg.Client({ connectionString: url })
}

export function mainDb(): pg.Client {
  const url = process.env.DATABASE_URL
  if (!url) fail('DATABASE_URL 이 .env 에 없습니다')
  return new pg.Client({ connectionString: url })
}

export function fail(message: string): never {
  console.error(`오류: ${message}`)
  process.exit(1)
}

export const args = process.argv.slice(2)
export const flag = (name: string) => args.includes(name)
export const opt = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
export const positional = args.filter((a) => !a.startsWith('--'))

export function fmtTime(v: unknown): string {
  if (!v) return '-'
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

/** 원본 테이블 — 병원 코드를 가진 테이블 전부 (병원 코드 변경·집계에 쓴다) */
export const HOSPITAL_TABLES = [
  'agent_enrollments',
  'agent_tokens',
  'agent_servers',
  'agent_runs',
  'raw_organizations',
  'raw_wards',
  'raw_device_registers',
  'raw_measurements',
  'raw_measurement_devices',
  'raw_device_status',
] as const
