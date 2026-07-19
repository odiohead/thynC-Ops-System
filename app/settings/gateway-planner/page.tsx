'use client'

import { useEffect, useState } from 'react'
import { GwRules, SPACE_TYPE_LABELS, SpaceType } from '@/lib/gateway-planner/types'

const EXCLUDABLE_TYPES: SpaceType[] = ['stairs', 'elevator', 'outdoor', 'machine', 'storage', 'nurse_station']

export default function GatewayPlannerSettingsPage() {
  const [rules, setRules] = useState<GwRules | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/gateway-planner')
      .then((r) => r.json())
      .then((d) => setRules(d.rules))
      .catch(() => setMsg({ type: 'err', text: '규칙을 불러오지 못했습니다.' }))
  }, [])

  const save = async () => {
    if (!rules) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/settings/gateway-planner', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '저장 실패')
      setRules(data.rules)
      setMsg({ type: 'ok', text: '저장되었습니다. 기존 잡은 "현재 규칙으로 재배치"를 실행하면 반영됩니다.' })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : '저장 실패' })
    } finally {
      setSaving(false)
    }
  }

  const set = (patch: Partial<GwRules>) => setRules((r) => (r ? { ...r, ...patch } : r))
  const toggleExcluded = (t: SpaceType) =>
    setRules((r) => {
      if (!r) return r
      const has = r.excludedSpaceTypes.includes(t)
      return { ...r, excludedSpaceTypes: has ? r.excludedSpaceTypes.filter((x) => x !== t) : [...r.excludedSpaceTypes, t] }
    })

  if (!rules) return <div className="p-10 text-center text-sm text-gray-400">불러오는 중...</div>

  const spacingM = (rules.coverageDiameterM * rules.corridorOverlapFactor).toFixed(1)

  const numField = (label: string, value: number, onChange: (v: number) => void, opts?: { step?: number; suffix?: string; hint?: string }) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step={opts?.step ?? 1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
        {opts?.suffix && <span className="text-xs text-gray-400">{opts.suffix}</span>}
      </div>
      {opts?.hint && <p className="mt-1 text-xs text-gray-400">{opts.hint}</p>}
    </div>
  )

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">GW 배치 규칙</h1>
      <p className="mt-1 mb-6 text-sm text-gray-500">
        게이트웨이 배치 플래너의 자동 배치 규칙입니다. 변경 후 기존 잡은 상세 화면의 &quot;현재 규칙으로 재배치&quot;로 재계산할 수 있습니다 (AI 재호출 없음).
      </p>

      {msg && (
        <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${msg.type === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      <div className="space-y-6">
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">커버리지 · 복도</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {numField('게이트웨이 커버리지 직경', rules.coverageDiameterM, (v) => set({ coverageDiameterM: v }), { suffix: 'm' })}
            {numField('복도 간격 계수', rules.corridorOverlapFactor, (v) => set({ corridorOverlapFactor: v }), {
              step: 0.05, suffix: `× 직경 → 점 간격 ${spacingM}m`, hint: '음영 방지를 위한 중첩 계수 (1이면 커버리지 직경 그대로)',
            })}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">실별 설치 수</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {numField('병실 기본 설치 수', rules.wardDefaultCount, (v) => set({ wardDefaultCount: Math.round(v) }), { suffix: '개' })}
            {numField('소형 병실 설치 수', rules.wardSmallCount, (v) => set({ wardSmallCount: Math.round(v) }), { suffix: '개' })}
            {numField('소형 병실 기준 면적', rules.wardSmallThresholdM2, (v) => set({ wardSmallThresholdM2: v }), {
              suffix: '㎡ 미만', hint: '이 면적 미만인 실은 소형으로 판정',
            })}
            {numField('공용화장실 설치 수', rules.toiletCount, (v) => set({ toiletCount: Math.round(v) }), { suffix: '개' })}
            {numField('최소 배치 면적', rules.minRoomAreaM2, (v) => set({ minRoomAreaM2: v }), {
              suffix: '㎡', hint: '이보다 작은 실(PS 샤프트 등)은 배치 제외',
            })}
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={rules.placeUnknownRooms} onChange={(e) => set({ placeUnknownRooms: e.target.checked })} />
            미분류 실에도 배치 (사람이 PPT에서 삭제하는 방식)
          </label>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">배치 제외 공간</h2>
          <div className="flex flex-wrap gap-3">
            {EXCLUDABLE_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={rules.excludedSpaceTypes.includes(t)} onChange={() => toggleExcluded(t)} />
                {SPACE_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">PPT 표시</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {numField('점 직경', rules.dotDiameterCm, (v) => set({ dotDiameterCm: v }), { step: 0.05, suffix: 'cm' })}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">점 색상</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={`#${rules.dotColor}`}
                  onChange={(e) => set({ dotColor: e.target.value.slice(1).toUpperCase() })}
                  className="h-8 w-14 cursor-pointer rounded border border-gray-300"
                />
                <span className="text-xs text-gray-400">#{rules.dotColor}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6">
        <button onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}
