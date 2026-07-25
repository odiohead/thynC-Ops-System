'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * AI 어시스턴트 설정 (ADMIN 이상)
 * 모델 ID는 코드 고정(읽기 전용)이고, 비용·품질 트레이드오프 축인 effort와 캐시 TTL만 조절한다.
 */

interface Settings {
  effort: string
  cacheTtl: string
}
interface Payload {
  settings: Settings
  defaults: Settings
  options: { efforts: string[]; cacheTtls: string[] }
  models: { chat: string; summarize: string }
}

const EFFORT_DESC: Record<string, string> = {
  low: '짧고 단순한 조회용. 가장 저렴하고 빠르지만 복잡한 질문에서 얕게 답할 수 있습니다.',
  medium: '권장값. 대부분의 질문에서 품질을 유지하면서 사고 토큰을 아낍니다.',
  high: 'API 기본값. 사고를 많이 하며 출력 토큰 비용이 올라갑니다.',
  max: '가장 깊게 사고합니다. 정확도가 비용보다 중요한 경우에만 사용하세요.',
}

const TTL_DESC: Record<string, string> = {
  '5m': '권장값. 캐시 쓰기 1.25배. 대화가 이어지는 동안 유지됩니다.',
  '1h': '대화 간격이 길 때 적중률이 오르지만 캐시 쓰기가 2배입니다.',
}

export default function AiAssistantSettingsPage() {
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [effort, setEffort] = useState('medium')
  const [cacheTtl, setCacheTtl] = useState('5m')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/settings/ai-assistant')
        if (!res.ok) throw new Error('설정을 불러오지 못했습니다.')
        const json: Payload = await res.json()
        setData(json)
        setEffort(json.settings.effort)
        setCacheTtl(json.settings.cacheTtl)
      } catch (e) {
        setMessage({ type: 'err', text: e instanceof Error ? e.message : '오류가 발생했습니다.' })
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings/ai-assistant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effort, cacheTtl }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '저장에 실패했습니다.')
      const json = await res.json()
      router.refresh()
      setData((d) => (d ? { ...d, settings: json.settings } : d))
      setMessage({ type: 'ok', text: '저장했습니다. 다음 질문부터 적용됩니다.' })
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : '오류가 발생했습니다.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>
  }
  if (!data) {
    return <div className="p-6 text-sm text-red-600">{message?.text ?? '설정을 불러오지 못했습니다.'}</div>
  }

  const dirty = effort !== data.settings.effort || cacheTtl !== data.settings.cacheTtl

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">AI 어시스턴트 설정</h1>
        <p className="text-sm text-muted-foreground">
          사고 깊이와 프롬프트 캐시 수명을 조절합니다. 변경은 다음 질문부터 적용되며, 사용량 변화는{' '}
          <a href="/settings/ai-usage" className="underline">
            AI 사용 현황
          </a>
          에서 확인할 수 있습니다.
        </p>
      </div>

      {/* 모델 — 읽기 전용 */}
      <div className="mb-4 rounded-xl border bg-card p-4">
        <p className="text-sm font-medium text-foreground mb-2">사용 모델</p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">채팅 (도구 사용·추론)</dt>
            <dd className="font-mono text-xs text-foreground">{data.models.chat}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">상담 정리 (요약)</dt>
            <dd className="font-mono text-xs text-foreground">{data.models.summarize}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          모델 ID는 코드에 고정되어 있습니다(오타 하나로 전 요청이 실패하므로 설정으로 열지 않음).
        </p>
      </div>

      {/* effort */}
      <div className="mb-4 rounded-xl border bg-card p-4">
        <label className="block text-sm font-medium text-foreground mb-1">
          사고 깊이 (effort)
        </label>
        <select
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
          className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          {data.options.efforts.map((v) => (
            <option key={v} value={v}>
              {v}
              {v === data.defaults.effort ? ' (권장)' : ''}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">{EFFORT_DESC[effort]}</p>
      </div>

      {/* 캐시 TTL */}
      <div className="mb-6 rounded-xl border bg-card p-4">
        <label className="block text-sm font-medium text-foreground mb-1">
          프롬프트 캐시 수명 (TTL)
        </label>
        <select
          value={cacheTtl}
          onChange={(e) => setCacheTtl(e.target.value)}
          className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          {data.options.cacheTtls.map((v) => (
            <option key={v} value={v}>
              {v}
              {v === data.defaults.cacheTtl ? ' (권장)' : ''}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">{TTL_DESC[cacheTtl]}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
        {message && (
          <span className={`text-sm ${message.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}
