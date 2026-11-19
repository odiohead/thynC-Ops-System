/**
 * 사용량 일별 집계 수동 실행 (projects/usage_overview_design.md §5)
 *
 *   npx tsx scripts/usage-stats-rebuild.mts                전 병원 — 스케줄러가 1시간마다 하는 것과 같다
 *   npx tsx scripts/usage-stats-rebuild.mts <병원코드>      그 병원만
 *   npx tsx scripts/usage-stats-rebuild.mts --check        다시 계산하지 않고, 저장된 집계와 병원별 화면 계산을 대조 (읽기 전용)
 *
 * 본체 DB 의 usage_daily_stats · usage_daily_device_stats 에 쓴다(원본 DB 는 읽기만). 산정 기준을 바꾼 뒤 과거분을
 * 바로 맞추고 싶을 때, 스케줄러를 꺼 둔 환경에서 집계를 채울 때 쓴다.
 */
import { prisma } from '../lib/prisma'
import { USAGE_MODELS, getUsageDailyAllModels, listUsageHospitals } from '../lib/usage/metrics'
import { getUsageOverview } from '../lib/usage/overview'
import { USAGE_STATS_DAYS, getUsageStatsRun, rebuildAllUsageStats, rebuildUsageStats } from '../lib/usage/stats'
import { flag, positional } from './usage-lib.mts'

const [only] = positional
const pct = (v: number | null) => (v === null ? '-' : `${Math.round(v)}%`)

if (flag('--check')) {
  // 저장된 집계 = 지금 원본에서 다시 낸 값 인가 (오늘은 시각이 흐르고, 마지막 집계 뒤에 들어온 데이터는 다를 수 있다)
  const hospitals = only ? [{ hospitalCode: only }] : await listUsageHospitals()
  let diffTotal = 0
  for (const h of hospitals) {
    const live = await getUsageDailyAllModels(h.hospitalCode, USAGE_STATS_DAYS)
    const [stats, devices] = await Promise.all([
      prisma.usageDailyStat.findMany({ where: { hospitalCode: h.hospitalCode } }),
      prisma.usageDailyDeviceStat.findMany({ where: { hospitalCode: h.hospitalCode } }),
    ])
    const key = (date: Date | string, ...rest: (string | number)[]) => [typeof date === 'string' ? date : date.toISOString().slice(0, 10), ...rest].join('|')
    const statOf = new Map(stats.map((r) => [key(r.date, r.model), r]))
    const devOf = new Map(devices.map((r) => [key(r.date, r.model, r.deviceType), r]))
    const diffs: string[] = []
    for (const m of USAGE_MODELS) {
      const d = live[m.key]
      for (const r of d.days) {
        if (r.today) continue
        const s = statOf.get(key(r.date, m.key))
        if (!s || s.measured !== r.measured || s.started !== r.started || s.peak !== r.peak) diffs.push(`${r.date} ${m.key} 측정 ${s ? `${s.measured}/${s.started}/${s.peak}` : '없음'} ≠ ${r.measured}/${r.started}/${r.peak}`)
      }
      for (const dv of d.devices) {
        for (const r of dv.days.slice(0, -1)) {
          const s = devOf.get(key(r.date, m.key, dv.type))
          if (!s || s.uses !== r.uses || s.peak !== r.peak || s.capacity !== r.capacity) diffs.push(`${r.date} ${m.key} ${dv.label} ${s ? `${s.uses}/${s.peak}/${s.capacity}` : '없음'} ≠ ${r.uses}/${r.peak}/${r.capacity}`)
        }
      }
    }
    diffTotal += diffs.length
    console.log(`${diffs.length === 0 ? '✓' : '✗'} ${h.hospitalCode}: 저장된 집계 ${stats.length}행 · 기기 ${devices.length}행 — 다시 낸 값과 ${diffs.length === 0 ? '일치' : `${diffs.length}건 다름`}`)
    for (const x of diffs.slice(0, 5)) console.log(`    ${x}`)
  }
  await prisma.$disconnect()
  process.exit(diffTotal > 0 ? 1 : 0)
}

if (only) {
  const t0 = Date.now()
  const r = await rebuildUsageStats(only)
  console.log(`${only}: ${r.from} ~ ${r.to} (${r.days}일) 집계 저장 — ${Date.now() - t0}ms`)
} else {
  const r = await rebuildAllUsageStats()
  console.log(`병원 ${r.hospitals}곳 집계 저장 — ${r.ms}ms${r.removed ? ` · 원본에 없는 병원의 행 ${r.removed}개 삭제` : ''}`)
  for (const f of r.failed) console.log(`  실패 ${f.hospitalCode}: ${f.error}`)
}

const run = await getUsageStatsRun()
if (run) console.log(`마지막 전체 집계: ${run.finishedAt} (${run.ms}ms, 병원 ${run.hospitals}곳, 실패 ${run.failed.length})`)
for (const device of ['ecg', 'spo2', 'cart'] as const) {
  const o = await getUsageOverview(device, 'all')
  console.log(`\n[${device}] 전체 ${pct(o.total.rate)} (${o.total.peakSum === null ? '-' : Math.round(o.total.peakSum)} / ${o.total.capacitySum ?? '-'}) · 증가 ${o.total.up} · 감소 ${o.total.down} · 유지 ${o.total.flat} · 보류 ${o.total.hold}`)
  for (const row of o.rows) {
    console.log(
      `  ${row.hospitalName.padEnd(12)} 최근 ${pct(row.rate)} (${row.validDays}일) · 이전 ${pct(row.prevRate)} (${row.prevValidDays}일) · 변화 ${row.change === null ? '-' : row.change.toFixed(1) + '%p'} · ${row.verdict}${row.hold ? `(${row.hold})` : ''}` +
        `${row.capacityChange ? ` · 수량 ${row.capacityChange.from}→${row.capacityChange.to}` : ''}${row.receive.delayed ? ' · 수신 지연' : ''} · 12주 ${row.weeks.map((w) => (w.rate === null ? '-' : Math.round(w.rate))).join(' ')}`,
    )
  }
}
await prisma.$disconnect()
process.exit(0)
