'use client'

/**
 * 출고 품목 관리 > '입력 가이드' 탭 — 출고요청(영업 유형) 폼의 항목 제목 아래 안내 문구, 모바일·PC 공용 (ADMIN 이상 수정)
 * 비워 두면 기본 문구가 표시된다 (stock_out_sales_request_design.md §5).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { STOCK_OUT_GUIDE_FIELDS } from '@/lib/stockOutShared'

export default function GuidesTab({ canEdit }: { canEdit: boolean }) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/stock-out-guides', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { saved: {} }))
      .then((d) => setValues(d.saved ?? {}))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setMsg(null)
    const res = await fetch('/api/settings/stock-out-guides', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guides: values }),
    })
    setSaving(false)
    if (!res.ok) { setMsg({ tone: 'error', text: (await res.json().catch(() => ({}))).error ?? '저장에 실패했습니다.' }); return }
    setValues((await res.json()).saved ?? {})
    router.refresh()
    setMsg({ tone: 'ok', text: '저장했습니다. 출고요청 화면(모바일·PC)에 바로 반영됩니다.' })
  }

  if (loading) return <p className="py-12 text-center text-sm text-gray-400">불러오는 중...</p>

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <p className="text-sm text-gray-500">
        평가용·판매용·오산영업소 출고요청 화면(모바일 앱·PC 출고업무 [출고요청])에서 각 항목 제목 아래에 보이는 안내 문구입니다. 비워 두면 기본 문구가 표시됩니다.
      </p>
      <div className="mt-4 space-y-4">
        {STOCK_OUT_GUIDE_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-gray-800" htmlFor={`guide-${f.key}`}>{f.label}</label>
            <textarea
              id={`guide-${f.key}`}
              rows={2}
              maxLength={300}
              value={values[f.key] ?? ''}
              disabled={!canEdit}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={`기본: ${f.fallback}`}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
            />
          </div>
        ))}
      </div>
      {msg && (
        <div className={`mt-4 rounded-lg border px-4 py-2.5 text-sm ${msg.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>
      )}
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      )}
    </div>
  )
}
