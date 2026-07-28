'use client'

/**
 * 영업 조직 관리 (ADMIN 이상) — 대웅 사업부·사무소·담당자 마스터.
 * 담당자는 시스템 계정이 아니다 (대웅 영업사원 전원 계정화 불가 전제 — projects/sales_crm_design.md §4.3).
 * 병원 채널에서 사용 중인 사무소·담당자는 삭제 불가(409) → 비활성화 사용.
 */

import { useCallback, useEffect, useState } from 'react'

interface Rep { id: number; officeId: number | null; name: string; phone: string | null; isActive: boolean }
interface Office { id: number; division: string | null; name: string; sortOrder: number; isActive: boolean; reps: Rep[]; _count: { channels: number } }

const inputCls = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none'
const btnPrimary = 'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50'
const btnGhost = 'rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100'

export default function SalesOfficesSettingsPage() {
  const [offices, setOffices] = useState<Office[]>([])
  const [orphanReps, setOrphanReps] = useState<Rep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 사무소 추가·수정
  const [officeForm, setOfficeForm] = useState<{ id: number | null; division: string; name: string } | null>(null)
  // 담당자 추가·수정 (officeId 대상)
  const [repForm, setRepForm] = useState<{ id: number | null; officeId: number | null; name: string; phone: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/sales-offices')
    if (res.ok) {
      const data = await res.json()
      setOffices(data.offices)
      setOrphanReps(data.orphanReps)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true)
    setError(null)
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    setBusy(false)
    if (!res.ok) {
      setError((await res.json()).error ?? '요청에 실패했습니다.')
      return false
    }
    await load()
    return true
  }

  const saveOffice = async () => {
    if (!officeForm) return
    const ok = officeForm.id === null
      ? await call('/api/settings/sales-offices', 'POST', { division: officeForm.division, name: officeForm.name })
      : await call(`/api/settings/sales-offices/${officeForm.id}`, 'PUT', { division: officeForm.division, name: officeForm.name })
    if (ok) setOfficeForm(null)
  }

  const toggleOffice = (o: Office) =>
    call(`/api/settings/sales-offices/${o.id}`, 'PUT', { division: o.division, name: o.name, sortOrder: o.sortOrder, isActive: !o.isActive })

  const removeOffice = (o: Office) => {
    if (!confirm(`'${o.name}' 사무소를 삭제할까요?`)) return
    call(`/api/settings/sales-offices/${o.id}`, 'DELETE')
  }

  const saveRep = async () => {
    if (!repForm) return
    const ok = repForm.id === null
      ? await call('/api/settings/sales-reps', 'POST', { officeId: repForm.officeId, name: repForm.name, phone: repForm.phone })
      : await call(`/api/settings/sales-reps/${repForm.id}`, 'PUT', { officeId: repForm.officeId, name: repForm.name, phone: repForm.phone })
    if (ok) setRepForm(null)
  }

  const toggleRep = (r: Rep) =>
    call(`/api/settings/sales-reps/${r.id}`, 'PUT', { officeId: r.officeId, name: r.name, phone: r.phone, isActive: !r.isActive })

  const removeRep = (r: Rep) => {
    if (!confirm(`'${r.name}' 담당자를 삭제할까요?`)) return
    call(`/api/settings/sales-reps/${r.id}`, 'DELETE')
  }

  const repRow = (r: Rep) => (
    <div key={r.id} className={`flex items-center justify-between py-1.5 ${r.isActive ? '' : 'opacity-45'}`}>
      {repForm?.id === r.id ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input value={repForm.name} onChange={(e) => setRepForm({ ...repForm, name: e.target.value })} placeholder="이름" className={`${inputCls} w-32`} />
          <input value={repForm.phone} onChange={(e) => setRepForm({ ...repForm, phone: e.target.value })} placeholder="연락처" className={`${inputCls} w-40`} />
          <button onClick={saveRep} disabled={busy} className={btnPrimary}>저장</button>
          <button onClick={() => setRepForm(null)} className={btnGhost}>취소</button>
        </div>
      ) : (
        <>
          <span className="text-sm text-gray-700">
            {r.name}
            {r.phone && <span className="ml-2 text-xs text-gray-400">{r.phone}</span>}
            {!r.isActive && <span className="ml-2 text-xs text-gray-400">(비활성)</span>}
          </span>
          <span className="text-xs">
            <button onClick={() => setRepForm({ id: r.id, officeId: r.officeId, name: r.name, phone: r.phone ?? '' })} className="text-blue-600 hover:underline">수정</button>
            <button onClick={() => toggleRep(r)} className="ml-2 text-gray-500 hover:underline">{r.isActive ? '비활성' : '활성'}</button>
            <button onClick={() => removeRep(r)} className="ml-2 text-red-500 hover:underline">삭제</button>
          </span>
        </>
      )}
    </div>
  )

  if (loading) return <div className="p-6 text-sm text-gray-400">로딩 중…</div>

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">영업 조직 관리</h1>
          <p className="mt-1 text-sm text-gray-500">
            대웅 사업부·사무소·담당자 마스터입니다. 담당자는 시스템 계정이 아니며, 병원 상세의 대웅 채널 지정에서 선택합니다.
            병원에서 사용 중이면 삭제 대신 비활성화하세요.
          </p>
        </div>
        <button onClick={() => setOfficeForm({ id: null, division: '', name: '' })} className={btnPrimary}>사무소 추가</button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {officeForm && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <input value={officeForm.division} onChange={(e) => setOfficeForm({ ...officeForm, division: e.target.value })} placeholder="사업부 (예: 서울1)" className={`${inputCls} w-36`} />
          <input value={officeForm.name} onChange={(e) => setOfficeForm({ ...officeForm, name: e.target.value })} placeholder="사무소명 (예: 병원강원)" className={`${inputCls} w-44`} />
          <button onClick={saveOffice} disabled={busy} className={btnPrimary}>{officeForm.id === null ? '추가' : '저장'}</button>
          <button onClick={() => setOfficeForm(null)} className={btnGhost}>취소</button>
        </div>
      )}

      {offices.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center text-sm text-gray-400">
          등록된 사무소가 없습니다. 사무소를 먼저 추가하세요.
        </p>
      ) : (
        <div className="space-y-4">
          {offices.map((o) => (
            <div key={o.id} className={`rounded-lg border border-gray-200 bg-white shadow-sm ${o.isActive ? '' : 'opacity-60'}`}>
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
                <div className="text-sm font-semibold text-gray-800">
                  {o.division && <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">{o.division}</span>}
                  {o.name}
                  {!o.isActive && <span className="ml-2 text-xs font-normal text-gray-400">(비활성)</span>}
                  {o._count.channels > 0 && <span className="ml-2 text-xs font-normal text-gray-400">병원 {o._count.channels}곳 사용</span>}
                </div>
                <div className="text-xs">
                  <button onClick={() => setRepForm({ id: null, officeId: o.id, name: '', phone: '' })} className="text-blue-600 hover:underline">담당자 추가</button>
                  <button onClick={() => setOfficeForm({ id: o.id, division: o.division ?? '', name: o.name })} className="ml-2 text-blue-600 hover:underline">수정</button>
                  <button onClick={() => toggleOffice(o)} className="ml-2 text-gray-500 hover:underline">{o.isActive ? '비활성' : '활성'}</button>
                  <button onClick={() => removeOffice(o)} className="ml-2 text-red-500 hover:underline">삭제</button>
                </div>
              </div>
              <div className="px-5 py-2">
                {repForm && repForm.id === null && repForm.officeId === o.id && (
                  <div className="flex flex-wrap items-center gap-2 py-2">
                    <input value={repForm.name} onChange={(e) => setRepForm({ ...repForm, name: e.target.value })} placeholder="이름" className={`${inputCls} w-32`} />
                    <input value={repForm.phone} onChange={(e) => setRepForm({ ...repForm, phone: e.target.value })} placeholder="연락처" className={`${inputCls} w-40`} />
                    <button onClick={saveRep} disabled={busy} className={btnPrimary}>추가</button>
                    <button onClick={() => setRepForm(null)} className={btnGhost}>취소</button>
                  </div>
                )}
                {o.reps.length === 0 ? (
                  <p className="py-2 text-xs text-gray-400">등록된 담당자가 없습니다.</p>
                ) : (
                  <div className="divide-y divide-gray-50">{o.reps.map(repRow)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {orphanReps.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-5 py-3">
          <p className="mb-1 text-xs font-medium text-amber-700">사무소 미지정 담당자 (사무소 삭제 등으로 소속이 풀린 담당자)</p>
          <div className="divide-y divide-amber-100">{orphanReps.map(repRow)}</div>
        </div>
      )}
    </div>
  )
}
