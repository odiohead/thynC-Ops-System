'use client'

/**
 * VOC 접수 등록 (cs_ticket_workflow_design.md §5 — 2026-08-15 개정)
 * 등록하면 CS 마스터 티켓이 자동 생성된다. 생성자는 서버가 기록하고, 담당 배정은 티켓에서.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import VocForm, { emptyVocForm, nowLocalKst, type VocFormValue } from '../_components/VocForm'

export default function VocNewPage() {
  const router = useRouter()

  const [form, setForm] = useState<VocFormValue>({ ...emptyVocForm, receivedAt: nowLocalKst() })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/voc-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        hospitalCode: form.hospitalCode || null,
        hospitalNameRaw: form.hospitalCode ? null : form.hospitalNameRaw || null,
        customerName: form.customerName || null,
        customerPhone: form.customerPhone || null,
        channelId: form.channelId === '' ? undefined : form.channelId,
        vocTypeId: form.vocTypeId === '' ? undefined : form.vocTypeId,
        statusId: form.statusId === '' ? undefined : form.statusId,
        receivedAt: form.receivedAt ? `${form.receivedAt}:00+09:00` : undefined,
        content: form.content || null,
      }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? '등록에 실패했습니다.'); return }
    router.refresh()
    router.push(`/voc/${d.vocReceipt.id}`)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-bold text-gray-900">VOC 접수 등록</h1>
      <p className="mt-0.5 text-sm text-gray-500">
        등록하면 CS 마스터 티켓이 자동 생성됩니다. 담당 배정은 생성된 티켓에서 지정하세요.
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <VocForm value={form} onChange={setForm} onSubmit={submit} onCancel={() => router.back()} busy={busy} submitLabel="등록" />
      </div>
    </div>
  )
}
