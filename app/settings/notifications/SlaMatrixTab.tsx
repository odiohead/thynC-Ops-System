'use client'

/**
 * SLA 정책 편집 탭 (v2 재편 — projects/notification_v2_design.md)
 *
 * 처리 목표 매트릭스 (정책 행 × metric 열) 단일 화면.
 * 상태 지연(DWELL) 매트릭스는 v2에서 UI 제거 (2026-08-03 사용자 결정 — 실사용 0건·임박 알림이 별도 배선됨.
 * 엔진의 DWELL metric은 유지되며 기존 타깃도 저장 시 보존 — 필요해지면 UI만 복원).
 *
 * 저장 단위는 **정책 1행** — 그 행의 모든 셀(타깃)을 한 번에 PUT한다(빈 셀 = 감지 안 함).
 * 저장 시 적용 범위를 고르게 하고(신규 티켓부터 / 열린 티켓에 지금 적용), 후자는 quiet 재계산이라
 * 저장 버튼 한 번에 알림이 쏟아지지 않는다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { refTypeLabelMap } from '@/lib/ticket-domains/meta'

const GOAL_METRICS = [
  { metric: 'ASSIGN', label: '배정까지', hint: '생성 → 담당자 지정. CS 미배정 방치 감지' },
  { metric: 'FIRST_RESPONSE', label: '첫 응답', hint: '생성 → 첫 코멘트 또는 처리중 진입' },
  { metric: 'RESOLVE', label: '해결까지', hint: '생성 → 해결/종결' },
  { metric: 'UPDATE_STALE', label: '무응답', hint: '마지막 활동 후 경과. 활동이 생기면 리셋' },
] as const

const REF_TYPE_LABELS: Record<string, string> = refTypeLabelMap('NONE')
const ALL_REF_TYPES = Object.keys(REF_TYPE_LABELS)

interface Target {
  id: number
  metric: string
  statusScope: string | null
  severity: string | null
  thresholdMin: number
  warnRatio: number
  isActive: boolean
}
interface Policy {
  id: number
  name: string
  description: string | null
  priority: number
  refTypes: string[]
  queueIds: number[]
  ctiIds: number[]
  severities: string[]
  clockType: string
  isActive: boolean
  targets: Target[]
  notifyChannel: { id: number; name: string } | null // 정책별 초과·임박 알림 채널 (v2 P3)
  _count?: { clocks: number }
}
interface Masters {
  queues: { id: number; name: string }[]
  ctiNodes: { id: number; parentId: number | null; level: number; name: string; isActive: boolean }[]
  channels: { id: number; name: string }[]
  statuses: string[]
  severities: string[]
  metrics: string[]
  domainDueRefTypes: string[]
}

/** 분 → { value, unit } 사람이 읽는 단위로 분해 (일 > 시간 > 분 순으로 딱 맞는 것) */
function splitMinutes(min: number): { value: number; unit: 'm' | 'h' | 'd' } {
  if (min > 0 && min % 1440 === 0) return { value: min / 1440, unit: 'd' }
  if (min > 0 && min % 60 === 0) return { value: min / 60, unit: 'h' }
  return { value: min, unit: 'm' }
}
function toMinutes(value: number, unit: 'm' | 'h' | 'd'): number {
  return unit === 'd' ? value * 1440 : unit === 'h' ? value * 60 : value
}
const UNIT_LABEL: Record<'m' | 'h' | 'd', string> = { m: '분', h: '시간', d: '일' }

/** 정책 스코프를 사람이 읽는 한 줄로 */
function scopeLabel(p: Policy, masters: Masters | null): string {
  const parts: string[] = []
  if (p.refTypes.length) parts.push(p.refTypes.map((r) => REF_TYPE_LABELS[r] ?? r).join('·'))
  if (p.queueIds.length) {
    const names = p.queueIds.map((id) => masters?.queues.find((q) => q.id === id)?.name ?? `#${id}`)
    parts.push(`그룹: ${names.join('·')}`)
  }
  if (p.ctiIds.length) {
    const names = p.ctiIds.map((id) => masters?.ctiNodes.find((n) => n.id === id)?.name ?? `#${id}`)
    parts.push(`CTI: ${names.join('·')}`)
  }
  if (p.severities.length) parts.push(p.severities.join('·'))
  return parts.length ? parts.join(' / ') : '전체'
}

/**
 * 이 행에 "해결 기한" 성격의 목표(RESOLVE 또는 DOMAIN_DUE)가 있는지.
 * 정책은 우선순위 1개만 승리하고 병합하지 않으므로, 이 행이 이기면 기본 행의 RESOLVE는 적용되지 않는다.
 * 관리자가 유형 행을 추가하면서 해결 목표를 빼면 그 유형은 해결 SLA가 사라지는데,
 * 그 사실이 화면에 드러나지 않으면 "설정했는데 SLA가 없어졌다"는 사고가 된다.
 */
function hasResolveGoal(p: Policy): boolean {
  return p.targets.some((t) => (t.metric === 'RESOLVE' || t.metric === 'DOMAIN_DUE') && t.isActive)
}

type CellKey = string // `${policyId}|${metric}|${statusScope}|${severity}`
const cellKey = (policyId: number, metric: string, scope: string | null, sev: string | null) =>
  `${policyId}|${metric}|${scope ?? ''}|${sev ?? ''}`

interface CellDraft { value: string; unit: 'm' | 'h' | 'd' }

export default function SlaMatrixTab() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [masters, setMasters] = useState<Masters | null>(null)
  const [loading, setLoading] = useState(true)
  const [advanced, setAdvanced] = useState(false) // Sev별 세분 편집
  const [drafts, setDrafts] = useState<Record<CellKey, CellDraft>>({})
  const [busyRow, setBusyRow] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [applyToOpen, setApplyToOpen] = useState(false)
  const [preview, setPreview] = useState<{ policyId: number; matchedOpen: number; wouldBreachNow: number; sample: { ticketCode: string; title: string; metric: string; overdueMin: number }[] } | null>(null)

  // 행 추가 폼
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPriority, setNewPriority] = useState(50)
  const [newRefTypes, setNewRefTypes] = useState<string[]>([])
  const [newQueueIds, setNewQueueIds] = useState<number[]>([])
  const [newCtiIds, setNewCtiIds] = useState<number[]>([]) // CTI 스코프 (v2 P3 — 하위 분류 상속)
  const [newSeverities, setNewSeverities] = useState<string[]>([])
  const [newChannelId, setNewChannelId] = useState<number | ''>('') // 정책 알림 채널 (v2 P3)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/sla-policies')
    if (res.ok) {
      const d = await res.json()
      setPolicies(d.policies ?? [])
      setMasters(d.masters ?? null)
      setDrafts({})
    } else if (res.status === 403) {
      setMsg('SLA 기준은 ADMIN 이상만 편집할 수 있습니다.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function flash(m: string) {
    setMsg(m)
    setTimeout(() => setMsg(null), 4000)
  }

  /** 셀 현재값 — draft 우선, 없으면 저장된 타깃 */
  function cellOf(p: Policy, metric: string, scope: string | null, sev: string | null): CellDraft {
    const key = cellKey(p.id, metric, scope, sev)
    if (drafts[key]) return drafts[key]
    const t = p.targets.find((x) => x.metric === metric && (x.statusScope ?? null) === scope && (x.severity ?? null) === sev)
    if (!t) return { value: '', unit: 'd' }
    const s = splitMinutes(t.thresholdMin)
    return { value: String(s.value), unit: s.unit }
  }

  function setCell(p: Policy, metric: string, scope: string | null, sev: string | null, patch: Partial<CellDraft>) {
    const cur = cellOf(p, metric, scope, sev)
    setDrafts((d) => ({ ...d, [cellKey(p.id, metric, scope, sev)]: { ...cur, ...patch } }))
  }

  /** Sev별로 값이 갈린 metric인지 (고급 토글 OFF일 때 요약 표시) */
  function sevSplit(p: Policy, metric: string): Target[] {
    return p.targets.filter((t) => t.metric === metric && t.severity)
  }

  /** 이 행의 저장 payload — 화면에 보이는 모든 셀을 훑어 타깃 배열을 만든다(빈 셀 = 제외 = 감지 안 함) */
  function buildTargets(p: Policy): { metric: string; statusScope: string | null; severity: string | null; thresholdMin: number; warnRatio: number }[] {
    const out: { metric: string; statusScope: string | null; severity: string | null; thresholdMin: number; warnRatio: number }[] = []
    const sevList = advanced ? (masters?.severities ?? []) : [null]

    const push = (metric: string, scope: string | null, sev: string | null) => {
      const c = cellOf(p, metric, scope, sev)
      const v = parseFloat(c.value)
      if (!c.value.trim() || !Number.isFinite(v) || v <= 0) return
      const existing = p.targets.find((x) => x.metric === metric && (x.statusScope ?? null) === scope && (x.severity ?? null) === sev)
      out.push({ metric, statusScope: scope, severity: sev, thresholdMin: toMinutes(v, c.unit), warnRatio: existing?.warnRatio ?? 80 })
    }

    for (const sev of sevList) {
      for (const g of GOAL_METRICS) push(g.metric, null, sev)
    }

    // DWELL(상태 체류)은 v2에서 UI 제거 — 기존 타깃이 있다면 저장 시 그대로 보존(전체 재설정 의미론에서 유실 방지)
    for (const t of p.targets) {
      if (t.metric === 'DWELL') out.push({ metric: t.metric, statusScope: t.statusScope, severity: t.severity, thresholdMin: t.thresholdMin, warnRatio: t.warnRatio })
    }

    // 고급 토글 OFF에서는 편집하지 않은 Sev별 타깃을 보존한다(폴백 정책의 RESOLVE Sev별 1/1/3/7일 등)
    if (!advanced) {
      for (const t of p.targets) {
        if (!t.severity) continue
        const dup = out.some((o) => o.metric === t.metric && o.statusScope === (t.statusScope ?? null) && o.severity === t.severity)
        if (!dup) out.push({ metric: t.metric, statusScope: t.statusScope, severity: t.severity, thresholdMin: t.thresholdMin, warnRatio: t.warnRatio })
      }
    }

    // DOMAIN_DUE는 체크박스로 관리 (셀 편집 대상 아님)
    const dd = p.targets.find((t) => t.metric === 'DOMAIN_DUE')
    if (dd) out.push({ metric: 'DOMAIN_DUE', statusScope: null, severity: null, thresholdMin: dd.thresholdMin, warnRatio: dd.warnRatio })

    return out
  }

  async function runPreview(p: Policy) {
    const res = await fetch('/api/settings/sla-policies/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refTypes: p.refTypes, queueIds: p.queueIds, ctiIds: p.ctiIds, severities: p.severities, targets: buildTargets(p) }),
    })
    if (!res.ok) { flash('미리보기 실패'); return }
    const d = await res.json()
    setPreview({ policyId: p.id, ...d })
  }

  async function saveRow(p: Policy) {
    setBusyRow(p.id)
    const res = await fetch(`/api/settings/sla-policies/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: buildTargets(p), applyToOpen }),
    })
    const d = await res.json().catch(() => ({}))
    setBusyRow(null)
    if (!res.ok) { flash(d.error ?? '저장 실패'); return }
    flash(`'${p.name}' 기준을 저장했습니다.${applyToOpen ? ` 열린 티켓 ${d.recalculated}건 재계산(알림 없음).` : ' 신규 티켓부터 적용됩니다.'}`)
    setPreview(null)
    await load()
  }

  async function toggleActive(p: Policy) {
    setBusyRow(p.id)
    await fetch(`/api/settings/sla-policies/${p.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !p.isActive }),
    })
    setBusyRow(null)
    await load()
  }

  async function movePriority(p: Policy, dir: -1 | 1) {
    const sorted = [...policies].sort((a, b) => a.priority - b.priority)
    const idx = sorted.findIndex((x) => x.id === p.id)
    const swap = sorted[idx + dir]
    if (!swap) return
    setBusyRow(p.id)
    await Promise.all([
      fetch(`/api/settings/sla-policies/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: swap.priority }) }),
      fetch(`/api/settings/sla-policies/${swap.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: p.priority }) }),
    ])
    setBusyRow(null)
    await load()
  }

  async function removePolicy(p: Policy) {
    if (!confirm(`'${p.name}' 정책을 삭제하시겠습니까? 이 정책으로 돌던 시계는 다음 갱신 때 취소됩니다.`)) return
    setBusyRow(p.id)
    const res = await fetch(`/api/settings/sla-policies/${p.id}`, { method: 'DELETE' })
    setBusyRow(null)
    if (!res.ok) { flash('삭제 실패'); return }
    await load()
  }

  async function addPolicy() {
    if (!newName.trim()) { flash('정책 이름을 입력하세요.'); return }
    const res = await fetch('/api/settings/sla-policies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName.trim(), priority: newPriority, refTypes: newRefTypes, queueIds: newQueueIds,
        ctiIds: newCtiIds, severities: newSeverities, targets: [],
        ...(newChannelId ? { notifyChannelId: newChannelId } : {}),
      }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { flash(d.error ?? '추가 실패'); return }
    setAddOpen(false); setNewName(''); setNewRefTypes([]); setNewQueueIds([]); setNewCtiIds([]); setNewSeverities([]); setNewPriority(50); setNewChannelId('')
    flash('정책 행을 추가했습니다. 셀에 시간을 입력하고 저장하세요.')
    await load()
  }

  /** 정책 알림 채널 변경 (v2 P3) — 즉시 저장 */
  async function changeChannel(p: Policy, value: string) {
    setBusyRow(p.id)
    const res = await fetch(`/api/settings/sla-policies/${p.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifyChannelId: value ? Number(value) : null }),
    })
    setBusyRow(null)
    if (!res.ok) { flash((await res.json().catch(() => ({}))).error ?? '채널 변경 실패'); return }
    await load()
  }

  async function toggleDomainDue(p: Policy) {
    const has = p.targets.some((t) => t.metric === 'DOMAIN_DUE')
    const base = buildTargets(p).filter((t) => t.metric !== 'DOMAIN_DUE')
    const targets = has ? base : [...base, { metric: 'DOMAIN_DUE', statusScope: null, severity: null, thresholdMin: 0, warnRatio: 80 }]
    setBusyRow(p.id)
    const res = await fetch(`/api/settings/sla-policies/${p.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets, applyToOpen }),
    })
    const d = await res.json().catch(() => ({}))
    setBusyRow(null)
    if (!res.ok) { flash(d.error ?? '변경 실패'); return }
    await load()
  }

  const sorted = useMemo(() => [...policies].sort((a, b) => a.priority - b.priority || a.id - b.id), [policies])
  const sevList = advanced ? (masters?.severities ?? []) : [null]

  const cellInput = (p: Policy, metric: string, scope: string | null, sev: string | null) => {
    const c = cellOf(p, metric, scope, sev)
    return (
      <div className="flex items-center gap-1">
        <input
          type="number" min={0} value={c.value} disabled={!p.isActive}
          onChange={(e) => setCell(p, metric, scope, sev, { value: e.target.value })}
          placeholder="—"
          className="w-14 rounded border border-border bg-background px-1.5 py-1 text-right text-xs disabled:opacity-40"
        />
        <select
          value={c.unit} disabled={!p.isActive || !c.value}
          onChange={(e) => setCell(p, metric, scope, sev, { unit: e.target.value as 'm' | 'h' | 'd' })}
          className="rounded border border-border bg-background px-1 py-1 text-xs disabled:opacity-40"
        >
          {(['m', 'h', 'd'] as const).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
        </select>
      </div>
    )
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</p>

  return (
    <div className="space-y-6">
      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          {msg}
        </div>
      )}

      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">SLA 기준</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              행 = 적용 대상(유형·Assignment Group·CTI·Sev), 셀 = 목표 시간. <b>빈 셀은 감지하지 않습니다.</b>
              여러 행이 매칭되면 <b>위(우선순위 낮은 숫자) 행이 이깁니다.</b>
            </p>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={advanced} onChange={(e) => { setAdvanced(e.target.checked); setDrafts({}) }} />
            고급: Sev별 세분
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">저장 시 적용 범위</span>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="radio" checked={!applyToOpen} onChange={() => setApplyToOpen(false)} />
            신규 티켓부터 <span className="text-muted-foreground">(권장 — 진행 중 시계 불변)</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="radio" checked={applyToOpen} onChange={() => setApplyToOpen(true)} />
            열린 티켓에 지금 적용 <span className="text-muted-foreground">(재계산 · 알림은 발송하지 않음)</span>
          </label>
        </div>
      </div>

      {/* 처리 목표 매트릭스 — v2 단일 화면 (상태 지연 매트릭스는 제거, 정책 관리 컨트롤을 이 표로 통합) */}
      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">처리 목표 (SLA)</h3>
          <span className="text-xs text-muted-foreground">대기(PENDING) 상태에서는 시계가 멈춥니다</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2">적용 대상</th>
                {GOAL_METRICS.map((g) => (
                  <th key={g.metric} className="px-2 py-2 whitespace-nowrap" title={g.hint}>{g.label}</th>
                ))}
                <th className="px-2 py-2 whitespace-nowrap">도메인 기한</th>
                <th className="px-2 py-2">저장</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const ddSupported = p.refTypes.length > 0 && p.refTypes.every((r) => masters?.domainDueRefTypes.includes(r))
                const hasDd = p.targets.some((t) => t.metric === 'DOMAIN_DUE')
                return sevList.map((sev, si) => (
                  <tr key={`g-${p.id}-${sev ?? 'all'}`} className={`border-b last:border-0 ${p.isActive ? '' : 'opacity-50'}`}>
                    {si === 0 && (
                      <td rowSpan={sevList.length} className="px-3 py-2 align-top">
                        <div className="flex items-start gap-1.5">
                          <div className="flex flex-col">
                            <button type="button" onClick={() => movePriority(p, -1)} className="text-[10px] leading-none text-muted-foreground hover:text-foreground">▲</button>
                            <button type="button" onClick={() => movePriority(p, 1)} className="text-[10px] leading-none text-muted-foreground hover:text-foreground">▼</button>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{scopeLabel(p, masters)}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              우선순위 {p.priority} · 시계 {p._count?.clocks ?? 0}
                            </p>
                            {/* 정책별 초과·임박 알림 채널 (v2 P3) — 없으면 SLA_BREACH/WARNING 라우팅 규칙 폴백 */}
                            <select
                              value={p.notifyChannel?.id ?? ''}
                              onChange={(e) => changeChannel(p, e.target.value)}
                              disabled={busyRow === p.id}
                              title="이 정책의 초과·임박 알림을 보낼 채널 (없으면 발송 규칙 폴백)"
                              className="mt-1 w-full max-w-[10rem] rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground disabled:opacity-40"
                            >
                              <option value="">채널: 규칙 폴백</option>
                              {(masters?.channels ?? []).map((c) => <option key={c.id} value={c.id}>채널: {c.name}</option>)}
                            </select>
                            <div className="mt-1 flex gap-1.5">
                              <button type="button" onClick={() => toggleActive(p)} className="text-[11px] text-muted-foreground hover:text-foreground">
                                {p.isActive ? '비활성' : '활성'}
                              </button>
                              <button type="button" onClick={() => removePolicy(p)} className="text-[11px] text-red-400 hover:text-red-600">삭제</button>
                            </div>
                            {/* 정책은 1개만 승리(병합 없음) → 이 행이 이기면 기본 행의 해결 목표는 적용되지 않는다 */}
                            {!hasResolveGoal(p) && (
                              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                                ⚠ 해결 목표 없음 — 이 대상은 해결 SLA가 적용되지 않습니다(기본 행 값은 상속되지 않음)
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                    )}
                    {GOAL_METRICS.map((g) => {
                      const split = sevSplit(p, g.metric)
                      if (!advanced && split.length > 0) {
                        return (
                          <td key={g.metric} className="px-2 py-2 text-xs text-muted-foreground">
                            Sev별 {split.sort((a, b) => (a.severity ?? '').localeCompare(b.severity ?? '')).map((t) => splitMinutes(t.thresholdMin)).map((s) => `${s.value}${UNIT_LABEL[s.unit]}`).join('/')}
                            <span className="ml-1 opacity-60">(고급에서 편집)</span>
                          </td>
                        )
                      }
                      return (
                        <td key={g.metric} className="px-2 py-2">
                          {advanced && <span className="mr-1 text-[10px] text-muted-foreground">{sev}</span>}
                          {cellInput(p, g.metric, null, sev)}
                        </td>
                      )
                    })}
                    {si === 0 && (
                      <td rowSpan={sevList.length} className="px-2 py-2 align-top">
                        <label className="flex items-center gap-1 text-xs" title={ddSupported ? '완료예정일·방문일·회신일을 기한으로 사용' : '프로젝트·답사·설치계획 유형에만 지정 가능'}>
                          <input type="checkbox" checked={hasDd} disabled={!ddSupported || busyRow === p.id} onChange={() => toggleDomainDue(p)} />
                          {ddSupported ? '사용' : '해당 없음'}
                        </label>
                      </td>
                    )}
                    {si === 0 && (
                      <td rowSpan={sevList.length} className="px-2 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          <button type="button" onClick={() => saveRow(p)} disabled={busyRow === p.id}
                            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                            {busyRow === p.id ? '저장 중' : '행 저장'}
                          </button>
                          <button type="button" onClick={() => runPreview(p)} className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent">
                            영향 보기
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 영향 미리보기 결과 */}
      {preview && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">영향 미리보기</h3>
            <button type="button" onClick={() => setPreview(null)} className="text-xs text-amber-700 hover:underline dark:text-amber-300">닫기</button>
          </div>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
            매칭되는 열린 티켓 <b>{preview.matchedOpen}건</b> · 이 기준이면 지금 즉시 초과 상태가 되는 티켓 <b>{preview.wouldBreachNow}건</b>
          </p>
          {preview.sample.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-300">
              {preview.sample.map((s) => (
                <li key={`${s.ticketCode}-${s.metric}`}>
                  <span className="font-mono">{s.ticketCode}</span> {s.title} — {s.metric} {Math.floor(s.overdueMin / 60)}시간 초과
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            &quot;열린 티켓에 지금 적용&quot;을 선택해 저장하면 위 건들이 초과로 표시되지만, <b>알림은 발송되지 않습니다</b>(다음 일일 요약에 포함).
          </p>
        </section>
      )}

      {/* 행 추가 */}
      <section className="rounded-xl border bg-card p-4">
        {!addOpen ? (
          <button type="button" onClick={() => setAddOpen(true)} className="rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:border-blue-400 hover:text-blue-600">
            + 적용 대상 행 추가
          </button>
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">적용 대상 행 추가</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">
                이름
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: CS 긴급 대응"
                  className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground" />
              </label>
              <label className="text-xs text-muted-foreground">
                우선순위 <span className="opacity-70">(낮을수록 먼저 적용)</span>
                <input type="number" value={newPriority} onChange={(e) => setNewPriority(parseInt(e.target.value) || 50)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground" />
              </label>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">업무 유형 <span className="opacity-70">(선택 없음 = 전체)</span></p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {ALL_REF_TYPES.map((r) => (
                  <button key={r} type="button"
                    onClick={() => setNewRefTypes((cur) => cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r])}
                    className={`rounded-full border px-2.5 py-1 text-xs ${newRefTypes.includes(r) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'text-muted-foreground'}`}>
                    {REF_TYPE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Assignment Group <span className="opacity-70">(선택 없음 = 전체)</span></p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(masters?.queues ?? []).map((q) => (
                  <button key={q.id} type="button"
                    onClick={() => setNewQueueIds((cur) => cur.includes(q.id) ? cur.filter((x) => x !== q.id) : [...cur, q.id])}
                    className={`rounded-full border px-2.5 py-1 text-xs ${newQueueIds.includes(q.id) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'text-muted-foreground'}`}>
                    {q.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Severity <span className="opacity-70">(선택 없음 = 전체)</span></p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(masters?.severities ?? []).map((s) => (
                  <button key={s} type="button"
                    onClick={() => setNewSeverities((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])}
                    className={`rounded-full border px-2.5 py-1 text-xs ${newSeverities.includes(s) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'text-muted-foreground'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {/* CTI 스코프 (v2 P3 — 요구 5 "특정 CTI마다 상세 SLA") — 선택 분류의 하위 분류까지 상속 적용 */}
            <div>
              <p className="text-xs text-muted-foreground">티켓 분류(CTI) <span className="opacity-70">(선택 없음 = 전체 · 하위 분류 자동 포함)</span></p>
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border p-2">
                {(masters?.ctiNodes ?? []).filter((n) => n.isActive).map((n) => (
                  <label key={n.id} className="flex items-center gap-1.5 py-0.5 text-xs text-foreground" style={{ paddingLeft: `${(n.level - 1) * 16}px` }}>
                    <input
                      type="checkbox"
                      checked={newCtiIds.includes(n.id)}
                      onChange={() => setNewCtiIds((cur) => cur.includes(n.id) ? cur.filter((x) => x !== n.id) : [...cur, n.id])}
                    />
                    <span className={n.level === 1 ? 'font-medium' : n.level === 2 ? '' : 'text-muted-foreground'}>{n.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="block text-xs text-muted-foreground">
              초과·임박 알림 채널 <span className="opacity-70">(비우면 발송 규칙 폴백)</span>
              <select value={newChannelId} onChange={(e) => setNewChannelId(e.target.value ? Number(e.target.value) : '')}
                className="mt-1 w-full max-w-xs rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground">
                <option value="">발송 규칙 폴백</option>
                {(masters?.channels ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={addPolicy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">추가</button>
              <button type="button" onClick={() => setAddOpen(false)} className="rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">취소</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
