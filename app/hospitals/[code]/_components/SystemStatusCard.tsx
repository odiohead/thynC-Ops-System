'use client'

/**
 * thynC 시스템 현황 카드 (2026-08-16) — 서버 현황 + EMR 연동 정보
 * - 서버: 1줄 레코드(서버이름·병동정보·모니터링·원격접속) 추가/인라인 수정/삭제
 * - EMR: 연동상태(단일)·업체(설정 마스터 선택)·데이터 범위(복수)·연동방식(복수)·메모
 * 편집: USER 이상 (VIEWER 조회만) — 선택지 단일 소스는 lib/hospitalSystem.ts
 */
import { Fragment, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { EMR_LINK_STATUSES, EMR_DATA_SCOPES, EMR_LINK_METHODS, type EmrLinkStatus } from '@/lib/hospitalSystem'

interface ServerRow {
  id: number
  name: string
  wardInfo: string | null
  monitoringUrl: string | null
  remoteUrl: string | null
}
interface VendorOpt { id: number; name: string }
interface EmrInfo {
  linkStatus: EmrLinkStatus
  emrVendorId: number | null
  dataScopes: string[]
  linkMethods: string[]
  memo: string | null
  emrVendor: VendorOpt | null
}

interface ServerForm { name: string; wardInfo: string; monitoringUrl: string; remoteUrl: string }
const emptyServerForm: ServerForm = { name: '', wardInfo: '', monitoringUrl: '', remoteUrl: '' }

const STATUS_TONES: Record<EmrLinkStatus, string> = {
  'ACK연동': 'bg-emerald-100 text-emerald-700',
  'EMR직접연동': 'bg-blue-100 text-blue-700',
  '개발중': 'bg-amber-100 text-amber-700',
  '미연동': 'bg-gray-100 text-gray-500',
}

function LinkBtn({ url, label }: { url: string | null; label: string }) {
  if (!url) return <span className="text-xs text-gray-300">-</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
      title={url}
    >
      {label} ↗
    </a>
  )
}

function chip(on: boolean) {
  return `rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`
}

export default function SystemStatusCard({ hospitalCode, canWrite }: { hospitalCode: string; canWrite: boolean }) {
  const router = useRouter()
  const [servers, setServers] = useState<ServerRow[]>([])
  const [emr, setEmr] = useState<EmrInfo | null>(null)
  const [vendors, setVendors] = useState<VendorOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 서버 추가/수정 폼
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState<ServerForm>(emptyServerForm)
  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<ServerForm>(emptyServerForm)

  // EMR 편집
  const [emrEdit, setEmrEdit] = useState(false)
  const [emrForm, setEmrForm] = useState<{ linkStatus: EmrLinkStatus; emrVendorId: number | ''; dataScopes: string[]; linkMethods: string[]; memo: string }>({
    linkStatus: '미연동', emrVendorId: '', dataScopes: [], linkMethods: [], memo: '',
  })

  const load = useCallback(async () => {
    const res = await fetch(`/api/hospitals/${hospitalCode}/system-info`)
    if (res.ok) {
      const d = await res.json()
      setServers(d.servers ?? [])
      setEmr(d.emr ?? null)
      setVendors(d.vendors ?? [])
    }
    setLoading(false)
  }, [hospitalCode])

  useEffect(() => { void load() }, [load])

  function flash(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  const serverPayload = (f: ServerForm) => ({
    name: f.name,
    wardInfo: f.wardInfo || null,
    monitoringUrl: f.monitoringUrl || null,
    remoteUrl: f.remoteUrl || null,
  })

  async function submitAdd() {
    if (!addForm.name.trim()) { flash('서버 이름을 입력하세요.'); return }
    setBusy(true)
    const res = await fetch(`/api/hospitals/${hospitalCode}/servers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(serverPayload(addForm)),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '서버 등록에 실패했습니다.'); return }
    setAdding(false)
    setAddForm(emptyServerForm)
    router.refresh()
    await load()
  }

  function startEdit(s: ServerRow) {
    setEditId(s.id)
    setEditForm({ name: s.name, wardInfo: s.wardInfo ?? '', monitoringUrl: s.monitoringUrl ?? '', remoteUrl: s.remoteUrl ?? '' })
  }

  async function submitEdit() {
    if (editId === null) return
    if (!editForm.name.trim()) { flash('서버 이름을 입력하세요.'); return }
    setBusy(true)
    const res = await fetch(`/api/hospitals/${hospitalCode}/servers/${editId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(serverPayload(editForm)),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '서버 수정에 실패했습니다.'); return }
    setEditId(null)
    router.refresh()
    await load()
  }

  async function removeServer(s: ServerRow) {
    if (!confirm(`서버 '${s.name}'을(를) 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/hospitals/${hospitalCode}/servers/${s.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { flash('서버 삭제에 실패했습니다.'); return }
    router.refresh()
    await load()
  }

  function startEmrEdit() {
    setEmrForm({
      linkStatus: emr?.linkStatus ?? '미연동',
      emrVendorId: emr?.emrVendorId ?? '',
      dataScopes: emr?.dataScopes ?? [],
      linkMethods: emr?.linkMethods ?? [],
      memo: emr?.memo ?? '',
    })
    setEmrEdit(true)
  }

  async function submitEmr() {
    setBusy(true)
    const res = await fetch(`/api/hospitals/${hospitalCode}/emr`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkStatus: emrForm.linkStatus,
        emrVendorId: emrForm.emrVendorId === '' ? null : emrForm.emrVendorId,
        dataScopes: emrForm.dataScopes,
        linkMethods: emrForm.linkMethods,
        memo: emrForm.memo || null,
      }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? 'EMR 정보 저장에 실패했습니다.'); return }
    setEmrEdit(false)
    router.refresh()
    await load()
  }

  const toggleMulti = (key: 'dataScopes' | 'linkMethods', v: string) =>
    setEmrForm((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }))

  const inputCls = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none'
  const thCls = 'whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500'
  const label = 'text-xs font-medium uppercase tracking-wider text-gray-400'

  function serverFormRow(form: ServerForm, setForm: (f: ServerForm) => void, onSave: () => void, onCancel: () => void) {
    return (
      <tr className="bg-blue-50/40">
        <td className="px-4 py-2"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="서버이름 *" className={inputCls} autoFocus /></td>
        <td className="px-4 py-2"><input type="text" value={form.wardInfo} onChange={(e) => setForm({ ...form, wardInfo: e.target.value })} placeholder="병동정보 (예: 51·52병동)" className={inputCls} /></td>
        <td className="px-4 py-2"><input type="text" value={form.monitoringUrl} onChange={(e) => setForm({ ...form, monitoringUrl: e.target.value })} placeholder="https:// 모니터링 URL" className={inputCls} /></td>
        <td className="px-4 py-2"><input type="text" value={form.remoteUrl} onChange={(e) => setForm({ ...form, remoteUrl: e.target.value })} placeholder="https:// 원격접속 URL" className={inputCls} /></td>
        <td className="whitespace-nowrap px-4 py-2">
          <div className="flex gap-1.5">
            <button type="button" onClick={onSave} disabled={busy} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">저장</button>
            <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">취소</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-700">thynC 시스템 현황</h2>
      </div>

      {error && <div className="mx-6 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">불러오는 중...</p>
      ) : (
        <>
          {/* 서버 현황 */}
          <div className="flex items-center justify-between px-6 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">서버 현황</h3>
            {canWrite && !adding && (
              <button
                type="button"
                onClick={() => { setAdding(true); setAddForm(emptyServerForm) }}
                className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                + 서버 추가
              </button>
            )}
          </div>
          <div className="overflow-x-auto px-2 pb-2 pt-2">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr>
                  <th className={thCls}>서버이름</th>
                  <th className={thCls}>병동정보</th>
                  <th className={thCls}>모니터링시스템</th>
                  <th className={thCls}>원격접속시스템</th>
                  <th className={`${thCls} w-24`}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {servers.length === 0 && !adding && (
                  <tr><td colSpan={5} className="px-4 py-5 text-center text-sm text-gray-400">등록된 서버가 없습니다.</td></tr>
                )}
                {servers.map((s) =>
                  editId === s.id ? (
                    <Fragment key={s.id}>{serverFormRow(editForm, setEditForm, submitEdit, () => setEditId(null))}</Fragment>
                  ) : (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-gray-900">{s.name}</td>
                      <td className="px-4 py-2.5 text-gray-700">{s.wardInfo ?? <span className="text-gray-300">-</span>}</td>
                      <td className="whitespace-nowrap px-4 py-2.5"><LinkBtn url={s.monitoringUrl} label="모니터링" /></td>
                      <td className="whitespace-nowrap px-4 py-2.5"><LinkBtn url={s.remoteUrl} label="원격접속" /></td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {canWrite && (
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => startEdit(s)} disabled={busy} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">수정</button>
                            <button type="button" onClick={() => removeServer(s)} disabled={busy} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50">삭제</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                )}
                {adding && serverFormRow(addForm, setAddForm, submitAdd, () => setAdding(false))}
              </tbody>
            </table>
          </div>

          {/* EMR 연동 정보 */}
          <div className="border-t border-gray-100">
            <div className="flex items-center justify-between px-6 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">EMR 연동 정보</h3>
              {canWrite && !emrEdit && (
                <button type="button" onClick={startEmrEdit} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
                  {emr ? '편집' : '등록'}
                </button>
              )}
            </div>

            {emrEdit ? (
              <div className="space-y-4 px-6 py-4">
                <div>
                  <p className={label}>연동상태 (1개 선택)</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {EMR_LINK_STATUSES.map((s) => (
                      <label key={s} className={`${chip(emrForm.linkStatus === s)} inline-flex cursor-pointer items-center gap-1.5`}>
                        <input
                          type="checkbox"
                          checked={emrForm.linkStatus === s}
                          onChange={() => setEmrForm((f) => ({ ...f, linkStatus: s }))}
                          className="h-3.5 w-3.5 rounded border-gray-300"
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="max-w-xs">
                  <p className={label}>EMR 업체 <span className="normal-case">(설정 &gt; EMR 업체 관리에서 리스트 관리)</span></p>
                  <select
                    value={emrForm.emrVendorId}
                    onChange={(e) => setEmrForm((f) => ({ ...f, emrVendorId: e.target.value ? parseInt(e.target.value) : '' }))}
                    className="mt-1.5 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                  >
                    <option value="">선택 안 함</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <p className={label}>데이터 연동 범위 (복수 선택)</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {EMR_DATA_SCOPES.map((s) => (
                      <label key={s} className={`${chip(emrForm.dataScopes.includes(s))} inline-flex cursor-pointer items-center gap-1.5`}>
                        <input type="checkbox" checked={emrForm.dataScopes.includes(s)} onChange={() => toggleMulti('dataScopes', s)} className="h-3.5 w-3.5 rounded border-gray-300" />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className={label}>연동방식 (복수 선택)</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {EMR_LINK_METHODS.map((m) => (
                      <label key={m} className={`${chip(emrForm.linkMethods.includes(m))} inline-flex cursor-pointer items-center gap-1.5`}>
                        <input type="checkbox" checked={emrForm.linkMethods.includes(m)} onChange={() => toggleMulti('linkMethods', m)} className="h-3.5 w-3.5 rounded border-gray-300" />
                        {m}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className={label}>메모</p>
                  <textarea
                    value={emrForm.memo}
                    onChange={(e) => setEmrForm((f) => ({ ...f, memo: e.target.value }))}
                    rows={3}
                    placeholder="연동 관련 특이사항"
                    className="mt-1.5 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
                  <button type="button" onClick={() => setEmrEdit(false)} disabled={busy} className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
                  <button type="button" onClick={submitEmr} disabled={busy} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                    {busy ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-6 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className={label}>연동상태</dt>
                  <dd className="mt-1">
                    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONES[emr?.linkStatus ?? '미연동']}`}>
                      {emr?.linkStatus ?? '미연동'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className={label}>EMR 업체</dt>
                  <dd className="mt-1 text-sm text-gray-900">{emr?.emrVendor?.name ?? <span className="text-gray-400">-</span>}</dd>
                </div>
                <div>
                  <dt className={label}>데이터 연동 범위</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {emr?.dataScopes.length ? emr.dataScopes.join(' · ') : <span className="text-gray-400">-</span>}
                  </dd>
                </div>
                <div>
                  <dt className={label}>연동방식</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {emr?.linkMethods.length ? emr.linkMethods.join(' · ') : <span className="text-gray-400">-</span>}
                  </dd>
                </div>
                {emr?.memo && (
                  <div className="sm:col-span-2 lg:col-span-4">
                    <dt className={label}>메모</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{emr.memo}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </>
      )}
    </div>
  )
}
