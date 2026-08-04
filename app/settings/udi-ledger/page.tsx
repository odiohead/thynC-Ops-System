'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Revision {
  rev: string
  date: string
  note: string
}

interface DocMeta {
  docNumber: string
  formNumber: string
  revision: string
  effectiveFrom: string
  companyName: string
  revisions: Revision[]
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function UdiLedgerSettingsPage() {
  const router = useRouter()
  const [meta, setMeta] = useState<DocMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/settings/udi-ledger')
      if (res.ok) setMeta((await res.json()).meta)
      else setError((await res.json()).error ?? '불러오지 못했습니다.')
      setLoading(false)
    })()
  }, [])

  async function save() {
    if (!meta) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/settings/udi-ledger', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    })
    if (res.ok) {
      router.refresh()
      setMeta((await res.json()).meta)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } else {
      setError((await res.json()).error)
    }
    setBusy(false)
  }

  function patch(p: Partial<DocMeta>) {
    setMeta((m) => m && { ...m, ...p })
  }

  function patchRevision(i: number, p: Partial<Revision>) {
    setMeta((m) => m && { ...m, revisions: m.revisions.map((r, idx) => (idx === i ? { ...r, ...p } : r)) })
  }

  if (loading) return <p className="py-16 text-center text-sm text-gray-400">불러오는 중...</p>

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">입출고대장 문서 설정</h1>
        <p className="mt-1 text-sm text-gray-500">
          자재관리 &gt; 입출고대장 docx의 머리글·바닥글에 인쇄되는 문서 정보입니다.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {saved && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          저장되었습니다.
        </div>
      )}

      {meta && (
        <div className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">문서 정보</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">문서번호</label>
                <input value={meta.docNumber} onChange={(e) => patch({ docNumber: e.target.value })} className={inputCls} />
                <p className="mt-1 text-xs text-gray-400">머리글 &apos;문서번호 : ○○&apos;</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">문서양식 변경적용</label>
                <input
                  value={meta.effectiveFrom}
                  onChange={(e) => patch({ effectiveFrom: e.target.value })}
                  placeholder="2026.03.31 ~"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">양식번호</label>
                <input value={meta.formNumber} onChange={(e) => patch({ formNumber: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">개정(rev.)</label>
                <input value={meta.revision} onChange={(e) => patch({ revision: e.target.value })} className={inputCls} />
                <p className="mt-1 text-xs text-gray-400">
                  바닥글 표기: {meta.formNumber}(rev.{meta.revision})
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-700">회사명</label>
                <input value={meta.companyName} onChange={(e) => patch({ companyName: e.target.value })} className={inputCls} />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">개정 이력</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  문서에는 최신 개정만 인쇄됩니다. 이력은 추적용으로 보관됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => patch({ revisions: [...meta.revisions, { rev: '', date: '', note: '' }] })}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
              >
                + 행 추가
              </button>
            </div>

            {meta.revisions.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">등록된 개정 이력이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {meta.revisions.map((r, i) => (
                  <div key={i} className="grid grid-cols-12 items-center gap-2">
                    <input
                      value={r.rev}
                      onChange={(e) => patchRevision(i, { rev: e.target.value })}
                      placeholder="rev"
                      className={`col-span-2 ${inputCls}`}
                    />
                    <input
                      value={r.date}
                      onChange={(e) => patchRevision(i, { date: e.target.value })}
                      placeholder="2026.03.31"
                      className={`col-span-3 ${inputCls}`}
                    />
                    <input
                      value={r.note}
                      onChange={(e) => patchRevision(i, { note: e.target.value })}
                      placeholder="변경 사유"
                      className={`col-span-6 ${inputCls}`}
                    />
                    <button
                      type="button"
                      onClick={() => patch({ revisions: meta.revisions.filter((_, idx) => idx !== i) })}
                      className="col-span-1 rounded-md border border-red-200 px-2 py-2 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
