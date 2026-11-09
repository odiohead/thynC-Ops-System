'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 레포트 전용 AI 설정 (최고관리자 — 레포트 메뉴와 같은 권한). 어시스턴트와 별도 (projects/hospital_report_design.md §7.1)
 * 권한이 없으면(403) 섹션 자체를 그리지 않는다.
 */

interface Payload {
  settings: { model: string; effort: string }
  defaults: { model: string; effort: string }
  options: { models: { id: string; label: string; note: string }[]; efforts: string[] }
}

const EFFORT_DESC: Record<string, string> = {
  low: '가장 저렴·빠름. 반복 주제 묶음이 얕아질 수 있습니다.',
  medium: '비용 절감용. 대부분의 병원에서 무난합니다.',
  high: '권장값. 본문을 충분히 읽고 주제·이슈를 묶습니다. 건당 약 0.3~0.6달러(Opus 5.5 기준 추정).',
  max: '가장 깊게 분석합니다. 비용·시간이 크게 늘어납니다.',
}

export default function ReportAiSettings() {
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/ai-report', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Payload | null) => {
        if (!j) return
        setData(j)
        setModel(j.settings.model)
        setEffort(j.settings.effort)
      })
      .catch(() => {})
  }, [])

  if (!data) return null
  const dirty = model !== data.settings.model || effort !== data.settings.effort

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings/ai-report', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, effort }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '저장에 실패했습니다.')
      const json = await res.json()
      router.refresh()
      setData((d) => (d ? { ...d, settings: json.settings } : d))
      setMessage({ type: 'ok', text: '저장했습니다. 다음 보고서 생성부터 적용됩니다.' })
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : '오류가 발생했습니다.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-10 border-t pt-6">
      <h2 className="mb-1 text-lg font-bold text-foreground">레포트</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        고객 운영 이력 레포트의 AI 분석에만 적용됩니다(어시스턴트 설정과 별개). 최고관리자 전용입니다.
      </p>

      <div className="mb-4 rounded-xl border bg-card p-4">
        <label className="mb-1 block text-sm font-medium text-foreground">모델</label>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-foreground">
          {data.options.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.id}){m.id === data.defaults.model ? ' — 권장' : ''}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">{data.options.models.find((m) => m.id === model)?.note}</p>
      </div>

      <div className="mb-6 rounded-xl border bg-card p-4">
        <label className="mb-1 block text-sm font-medium text-foreground">사고 깊이 (effort)</label>
        <select value={effort} onChange={(e) => setEffort(e.target.value)} className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-foreground">
          {data.options.efforts.map((v) => (
            <option key={v} value={v}>
              {v}
              {v === data.defaults.effort ? ' (권장)' : ''}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">{EFFORT_DESC[effort]}</p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !dirty} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? '저장 중...' : '레포트 설정 저장'}
        </button>
        {message && <span className={`text-sm ${message.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{message.text}</span>}
      </div>
    </div>
  )
}
