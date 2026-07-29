'use client'

/**
 * 병원 영업 정보 섹션 (영업/CRM v3 — projects/sales_crm_design.md)
 * 열람·편집: ADMIN 이상 + SEERS 소속 (서버 페이지에서 렌더 게이트 + API 재검증)
 *
 * 구조: 요약 스트립(항상 표시) + 탭 4개(개요·키맨·영업 활동·계약 이력).
 * 원칙: 빈 상태에도 전체 필드 구조가 보인다 — 개요는 필드 그리드 상시 노출(값 없으면 —),
 *       키맨·계약 이력은 컬럼 헤더 상시 노출.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import RichTextEditor from '@/app/components/RichTextEditor'

// ─── 타입 ───

interface CodeItem { id: number; name: string; color?: string | null }
interface Profile {
  stageId: number | null; ownerId: string | null
  totalBeds: number | null; totalWards: number | null; salesMemo: string | null
  stage: CodeItem | null; owner: { id: string; name: string } | null
}
interface AffiliationHistory {
  id: number; isCurrent: boolean; startedOn: string | null; endedOn: string | null
  title: string | null
  hospital: { hospitalCode: string; hospitalName: string }
}
interface PersonRow {
  id: number
  title: string | null; department: string | null; isPrimary: boolean; isCurrent: boolean
  startedOn: string | null; endedOn: string | null; note: string | null
  person: {
    id: number; name: string; specialty: string | null; phone: string | null; email: string | null
    memo: string | null; personGroupId: number | null
    personGroup: { id: number; name: string } | null
    affiliations: AffiliationHistory[]
  }
}
interface Deal {
  id: number; dealCode: string; roundNo: number; projectCode: string | null
  statusId: number | null; hospitalModelId: number | null; seersModelId: number | null
  wardsText: string | null; deptsText: string | null
  wardCount: number | null; bedCount: number | null
  amountProduct: number | null; amountConstruction: number | null; amountActual: number | null
  taxInvoiceId: number | null; settlementId: number | null
  contractDate: string | null; remark: string | null
  status: CodeItem | null; hospitalModel: CodeItem | null; seersModel: CodeItem | null
  taxInvoice: CodeItem | null; settlement: CodeItem | null
  project: { projectCode: string; projectName: string } | null
}
interface Activity {
  id: number; activityDate: string; content: string
  activityType: CodeItem | null
  author: { id: string; name: string } | null
  deal: { id: number; dealCode: string; roundNo: number } | null
}
interface SalesData {
  profile: Profile | null
  persons: { current: PersonRow[]; past: PersonRow[] }
  deals: Deal[]
  activities: Activity[]
  derived: { introBeds: number | null; penetration: number | null; contractedTotal: number }
  masters: {
    codes: Record<string, CodeItem[]>
    owners: Array<{ id: string; name: string }>
    projects: Array<{ projectCode: string; projectName: string }>
  }
}

// ─── 공용 소품 ───

const fmtWon = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('ko-KR')}원`)
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('ko-KR') : '—')
const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'
const labelCls = 'mb-1 block text-xs font-medium text-gray-500'
const btnPrimary = 'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50'
const btnGhost = 'rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100'
const thCls = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-400'
const tdCls = 'px-3 py-2 text-sm text-gray-800'

const Empty = () => <span className="text-gray-300">—</span>

function StageBadge({ stage }: { stage: CodeItem | null }) {
  if (!stage) return <span className="rounded-full border border-dashed border-gray-300 px-2.5 py-0.5 text-xs text-gray-400">단계 미지정</span>
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: stage.color || '#94a3b8' }}
    >
      {stage.name}
    </span>
  )
}


// ─── 개요 탭 — 필드 그리드 상시 노출, [수정] 토글로 같은 그리드가 폼 전환 ───

function OverviewTab({ code, data, onSaved }: { code: string; data: SalesData; onSaved: () => void }) {
  const p = data.profile
  const { introBeds, penetration } = data.derived
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ stageId: '', ownerId: '', totalBeds: '', totalWards: '', salesMemo: '' })

  const startEdit = () => {
    setForm({
      stageId: p?.stageId?.toString() ?? '',
      ownerId: p?.ownerId ?? '',
      totalBeds: p?.totalBeds?.toString() ?? '',
      totalWards: p?.totalWards?.toString() ?? '',
      salesMemo: p?.salesMemo ?? '',
    })
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    setBusy(true); setError(null)
    const res = await fetch(`/api/hospitals/${code}/sales/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stageId: form.stageId === '' ? null : parseInt(form.stageId),
        ownerId: form.ownerId === '' ? null : form.ownerId,
        totalBeds: form.totalBeds === '' ? null : form.totalBeds,
        totalWards: form.totalWards === '' ? null : form.totalWards,
        salesMemo: form.salesMemo,
      }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '저장에 실패했습니다.'); return }
    setEditing(false)
    onSaved()
  }

  const stages = data.masters.codes.SALES_STAGE ?? []

  if (editing) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <label className={labelCls}>영업 단계</label>
            <select className={inputCls} value={form.stageId} onChange={(e) => setForm({ ...form, stageId: e.target.value })}>
              <option value="">미지정</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>담당 영업</label>
            <select className={inputCls} value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
              <option value="">미지정</option>
              {data.masters.owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>전체 병상수</label>
            <input type="number" min={0} className={inputCls} placeholder="병원 전체(허가) 병상" value={form.totalBeds} onChange={(e) => setForm({ ...form, totalBeds: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>전체 병동수</label>
            <input type="number" min={0} className={inputCls} value={form.totalWards} onChange={(e) => setForm({ ...form, totalWards: e.target.value })} />
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className={labelCls}>영업 메모</label>
            <textarea rows={3} className={inputCls} placeholder="영업 관점 특이사항" value={form.salesMemo} onChange={(e) => setForm({ ...form, salesMemo: e.target.value })} />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={save} disabled={busy} className={btnPrimary}>저장</button>
          <button onClick={() => setEditing(false)} className={btnGhost}>취소</button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <div>
          <dt className={labelCls}>영업 단계</dt>
          <dd><StageBadge stage={p?.stage ?? null} /></dd>
        </div>
        <div>
          <dt className={labelCls}>담당 영업</dt>
          <dd className="text-sm text-gray-900">{p?.owner?.name ?? <Empty />}</dd>
        </div>
        <div>
          <dt className={labelCls}>전체 병상수 <span className="normal-case">(수기)</span></dt>
          <dd className="text-sm text-gray-900">{p?.totalBeds != null ? `${p.totalBeds.toLocaleString()}병상` : <Empty />}</dd>
        </div>
        <div>
          <dt className={labelCls}>전체 병동수</dt>
          <dd className="text-sm text-gray-900">{p?.totalWards != null ? `${p.totalWards}병동` : <Empty />}</dd>
        </div>
        <div>
          <dt className={labelCls}>도입 병상 <span className="normal-case">(자동)</span></dt>
          <dd className="text-sm text-gray-900">{introBeds != null ? `${introBeds.toLocaleString()}병상` : <Empty />}</dd>
        </div>
        <div>
          <dt className={labelCls}>침투율 <span className="normal-case">(자동)</span></dt>
          <dd className="text-sm text-gray-900">{penetration != null ? `${penetration}%` : <Empty />}</dd>
        </div>
        <div className="col-span-2 md:col-span-4">
          <dt className={labelCls}>영업 메모</dt>
          <dd className="whitespace-pre-wrap text-sm text-gray-900">{p?.salesMemo ?? <Empty />}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <button onClick={startEdit} className={btnGhost}>수정</button>
      </div>
    </div>
  )
}

// ─── 인적정보 탭 — 인물/소속 (전원 이력) · 컬럼 헤더 상시 노출 ───

const PERSON_EMPTY = { name: '', personGroupId: '', specialty: '', title: '', department: '', phone: '', email: '', memo: '', isPrimary: false }

/** 전원 모달 — 병원 검색 후 새 소속 정보 입력 */
function TransferModal({ code, row, onClose, onDone }: { code: string; row: PersonRow; onClose: () => void; onDone: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ hospitalCode: string; hospitalName: string }>>([])
  const [target, setTarget] = useState<{ hospitalCode: string; hospitalName: string } | null>(null)
  const [form, setForm] = useState({ title: row.title ?? '', department: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/hospitals?search=${encodeURIComponent(query.trim())}`)
      if (res.ok) {
        const json = await res.json()
        setResults((json.hospitals ?? []).slice(0, 8).map((h: { hospitalCode: string; hospitalName: string }) => ({ hospitalCode: h.hospitalCode, hospitalName: h.hospitalName })))
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const submit = async () => {
    if (!target) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/hospitals/${code}/sales/persons/${row.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toHospitalCode: target.hospitalCode, title: form.title, department: form.department }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '전원 처리에 실패했습니다.'); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-800">{row.person.name} 전원 처리</h3>
        <p className="mt-1 text-xs text-gray-500">현재 병원 소속을 종료하고 새 병원으로 소속을 옮깁니다. 이력은 보존됩니다.</p>
        <div className="mt-4">
          <label className={labelCls}>전원할 병원 검색 *</label>
          {target ? (
            <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <span className="font-medium text-blue-700">{target.hospitalName}</span>
              <button onClick={() => setTarget(null)} className="text-xs text-gray-500 hover:underline">변경</button>
            </div>
          ) : (
            <>
              <input className={inputCls} placeholder="병원명 2글자 이상 입력" value={query} onChange={(e) => setQuery(e.target.value)} />
              {results.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 text-sm">
                  {results.map((h) => (
                    <li key={h.hospitalCode}>
                      <button className="w-full px-3 py-1.5 text-left hover:bg-blue-50" onClick={() => setTarget(h)}>{h.hospitalName}</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><label className={labelCls}>새 직책</label><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><label className={labelCls}>새 부서</label><input className={inputCls} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>취소</button>
          <button onClick={submit} disabled={busy || !target} className={btnPrimary}>전원 처리</button>
        </div>
      </div>
    </div>
  )
}

function PersonsTab({ code, data, onSaved }: { code: string; data: SalesData; onSaved: () => void }) {
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState({ ...PERSON_EMPTY })
  const [transfer, setTransfer] = useState<PersonRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = data.masters.codes.PERSON_GROUP ?? []
  const { current, past } = data.persons

  const open = (r: PersonRow | null) => {
    setForm(r ? {
      name: r.person.name,
      personGroupId: r.person.personGroup?.id?.toString() ?? '',
      specialty: r.person.specialty ?? '',
      title: r.title ?? '',
      department: r.department ?? '',
      phone: r.person.phone ?? '',
      email: r.person.email ?? '',
      memo: r.person.memo ?? '',
      isPrimary: r.isPrimary,
    } : { ...PERSON_EMPTY })
    setError(null)
    setEditingId(r ? r.id : 'new')
  }

  const save = async () => {
    setBusy(true); setError(null)
    const url = editingId === 'new' ? `/api/hospitals/${code}/sales/persons` : `/api/hospitals/${code}/sales/persons/${editingId}`
    const res = await fetch(url, {
      method: editingId === 'new' ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, personGroupId: form.personGroupId === '' ? null : parseInt(form.personGroupId) }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '저장에 실패했습니다.'); return }
    setEditingId(null)
    onSaved()
  }

  const endAffiliation = async (r: PersonRow) => {
    if (!confirm(`${r.person.name}의 이 병원 소속을 종료할까요? (이력은 보존됩니다)`)) return
    const res = await fetch(`/api/hospitals/${code}/sales/persons/${r.id}/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (res.ok) onSaved()
  }

  const removeAffiliation = async (r: PersonRow) => {
    if (!confirm(`${r.person.name}의 소속 행을 삭제할까요? (오입력 정정용 — 이력이 남지 않습니다)`)) return
    const res = await fetch(`/api/hospitals/${code}/sales/persons/${r.id}`, { method: 'DELETE' })
    if (res.ok) onSaved()
  }

  /** 이 병원 외 이력이 있으면 뱃지 표시용 텍스트 */
  const historyHint = (r: PersonRow) => {
    const others = r.person.affiliations.filter((a) => a.hospital.hospitalCode !== code)
    if (others.length === 0) return null
    return others.map((a) => `${a.hospital.hospitalName}${a.isCurrent ? ' (현재)' : ''}`).join(', ')
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className={thCls}>이름</th>
              <th className={thCls}>직군</th>
              <th className={thCls}>직책</th>
              <th className={thCls}>부서</th>
              <th className={thCls}>진료과</th>
              <th className={thCls}>전화</th>
              <th className={thCls}>이메일</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {current.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">등록된 인물이 없습니다. 교수·의공·전산·구매 등 병원 측 인물을 등록하세요.</td></tr>
            )}
            {current.map((r) => (
              <tr key={r.id}>
                <td className={`${tdCls} whitespace-nowrap`}>
                  <span className="font-medium">{r.person.name}</span>
                  {r.isPrimary && <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">주요</span>}
                  {historyHint(r) && (
                    <span className="ml-1.5 cursor-help rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600" title={`이전 소속: ${historyHint(r)}`}>이력</span>
                  )}
                </td>
                <td className={tdCls}>{r.person.personGroup?.name ?? <Empty />}</td>
                <td className={tdCls}>{r.title ?? <Empty />}</td>
                <td className={tdCls}>{r.department ?? <Empty />}</td>
                <td className={tdCls}>{r.person.specialty ?? <Empty />}</td>
                <td className={tdCls}>{r.person.phone ?? <Empty />}</td>
                <td className={tdCls}>{r.person.email ?? <Empty />}</td>
                <td className={`${tdCls} whitespace-nowrap text-right`}>
                  <button onClick={() => open(r)} className="text-xs text-blue-600 hover:underline">수정</button>
                  <button onClick={() => setTransfer(r)} className="ml-2 text-xs text-amber-600 hover:underline">전원</button>
                  <button onClick={() => endAffiliation(r)} className="ml-2 text-xs text-gray-500 hover:underline">소속종료</button>
                  <button onClick={() => removeAffiliation(r)} className="ml-2 text-xs text-red-500 hover:underline">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-100 p-4">
        {editingId === null ? (
          <button onClick={() => open(null)} className={btnGhost}>인물 등록</button>
        ) : (
          <div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><label className={labelCls}>이름 *</label><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div>
                <label className={labelCls}>직군</label>
                <select className={inputCls} value={form.personGroupId} onChange={(e) => setForm({ ...form, personGroupId: e.target.value })}>
                  <option value="">미지정</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>진료과 (의사)</label><input className={inputCls} placeholder="예: 순환기내과" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} /></div>
              <div><label className={labelCls}>직책</label><input className={inputCls} placeholder="예: 과장, 교수" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div><label className={labelCls}>부서</label><input className={inputCls} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
              <div><label className={labelCls}>전화</label><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><label className={labelCls}>이메일</label><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className={labelCls}>메모</label><input className={inputCls} placeholder="성향·관계 메모" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
              주요 인물 (이 병원의 핵심 키맨)
            </label>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={save} disabled={busy || !form.name.trim()} className={btnPrimary}>저장</button>
              <button onClick={() => setEditingId(null)} className={btnGhost}>취소</button>
            </div>
          </div>
        )}
      </div>

      {past.length > 0 && (
        <details className="border-t border-gray-100 px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-500">과거 인물 ({past.length})</summary>
          <ul className="mt-2 space-y-1">
            {past.map((r) => {
              const now = r.person.affiliations.find((a) => a.isCurrent)
              return (
                <li key={r.id} className="text-sm text-gray-600">
                  <span className="font-medium text-gray-800">{r.person.name}</span>
                  {r.person.personGroup && <span className="ml-1.5 text-xs text-gray-400">{r.person.personGroup.name}</span>}
                  {r.title && <span className="ml-1.5 text-xs text-gray-400">{r.title}</span>}
                  <span className="ml-2 text-xs text-gray-400">
                    {fmtDate(r.startedOn)} ~ {fmtDate(r.endedOn)}
                  </span>
                  {now && <span className="ml-2 text-xs text-amber-600">현재: {now.hospital.hospitalName}</span>}
                </li>
              )
            })}
          </ul>
        </details>
      )}

      {transfer && (
        <TransferModal code={code} row={transfer} onClose={() => setTransfer(null)} onDone={() => { setTransfer(null); onSaved() }} />
      )}
    </div>
  )
}

// ─── 영업 활동 탭 — 타임라인 + 작성 폼 ───

function ActivitiesTab({ code, data, onSaved }: { code: string; data: SalesData; onSaved: () => void }) {
  const [writing, setWriting] = useState(false)
  const [form, setForm] = useState({ activityDate: new Date().toISOString().slice(0, 10), activityTypeId: '', dealId: '', content: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const types = data.masters.codes.SALES_ACTIVITY_TYPE ?? []

  const save = async () => {
    setBusy(true); setError(null)
    const res = await fetch(`/api/hospitals/${code}/sales/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activityDate: form.activityDate,
        activityTypeId: form.activityTypeId === '' ? null : parseInt(form.activityTypeId),
        dealId: form.dealId === '' ? null : parseInt(form.dealId),
        content: form.content,
      }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '저장에 실패했습니다.'); return }
    setWriting(false)
    setForm({ activityDate: new Date().toISOString().slice(0, 10), activityTypeId: '', dealId: '', content: '' })
    onSaved()
  }

  const remove = async (id: number) => {
    if (!confirm('이 활동 기록을 삭제할까요?')) return
    const res = await fetch(`/api/hospitals/${code}/sales/activities/${id}`, { method: 'DELETE' })
    if (res.ok) onSaved()
  }

  return (
    <div className="p-4">
      {!writing ? (
        <button onClick={() => setWriting(true)} className={btnGhost}>활동 기록 작성</button>
      ) : (
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div><label className={labelCls}>활동일 *</label><input type="date" className={inputCls} value={form.activityDate} onChange={(e) => setForm({ ...form, activityDate: e.target.value })} /></div>
            <div>
              <label className={labelCls}>활동 유형</label>
              <select className={inputCls} value={form.activityTypeId} onChange={(e) => setForm({ ...form, activityTypeId: e.target.value })}>
                <option value="">미지정</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>관련 딜 (선택)</label>
              <select className={inputCls} value={form.dealId} onChange={(e) => setForm({ ...form, dealId: e.target.value })}>
                <option value="">없음</option>
                {data.deals.map((d) => <option key={d.id} value={d.id}>{d.roundNo}차 ({d.dealCode})</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className={labelCls}>내용 *</label>
            <RichTextEditor value={form.content} onChange={(html) => setForm({ ...form, content: html })} />
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={busy} className={btnPrimary}>저장</button>
            <button onClick={() => setWriting(false)} className={btnGhost}>취소</button>
          </div>
        </div>
      )}

      <ul className="mt-4 divide-y divide-gray-100">
        {data.activities.length === 0 && (
          <li className="py-6 text-center text-sm text-gray-400">활동 기록이 없습니다. 방문·전화·시연 등 접촉 내역을 남기세요.</li>
        )}
        {data.activities.map((a) => (
          <li key={a.id} className="py-3">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-medium text-gray-700">{fmtDate(a.activityDate)}</span>
              {a.activityType && <span className="rounded bg-gray-100 px-1.5 py-0.5">{a.activityType.name}</span>}
              {a.deal && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600">{a.deal.roundNo}차</span>}
              {a.author && <span>{a.author.name}</span>}
              <button onClick={() => remove(a.id)} className="ml-auto text-red-400 hover:underline">삭제</button>
            </div>
            <div className="prose prose-sm mt-1 max-w-none text-gray-800" dangerouslySetInnerHTML={{ __html: a.content }} />
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── 계약 이력 탭 — 컬럼 헤더 상시 노출 + 합계 행 + 등록/수정 모달 ───

const DEAL_EMPTY = {
  roundNo: '', statusId: '', hospitalModelId: '', seersModelId: '', contractDate: '',
  wardsText: '', deptsText: '', wardCount: '', bedCount: '',
  amountProduct: '', amountConstruction: '', amountActual: '',
  taxInvoiceId: '', settlementId: '', projectCode: '', remark: '',
}

function DealsTab({ code, data, onSaved }: { code: string; data: SalesData; onSaved: () => void }) {
  const [modal, setModal] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null })
  const [form, setForm] = useState({ ...DEAL_EMPTY })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const statuses = data.masters.codes.SALES_DEAL_STATUS ?? []
  const models = data.masters.codes.SALES_MODEL ?? []
  const taxInvoices = data.masters.codes.SALES_TAX_INVOICE ?? []
  const settlements = data.masters.codes.SALES_SETTLEMENT ?? []

  const open = (deal: Deal | null) => {
    setForm(deal ? {
      roundNo: deal.roundNo.toString(),
      statusId: deal.statusId?.toString() ?? '',
      hospitalModelId: deal.hospitalModelId?.toString() ?? '',
      seersModelId: deal.seersModelId?.toString() ?? '',
      contractDate: deal.contractDate ? deal.contractDate.slice(0, 10) : '',
      wardsText: deal.wardsText ?? '',
      deptsText: deal.deptsText ?? '',
      wardCount: deal.wardCount?.toString() ?? '',
      bedCount: deal.bedCount?.toString() ?? '',
      amountProduct: deal.amountProduct?.toString() ?? '',
      amountConstruction: deal.amountConstruction?.toString() ?? '',
      amountActual: deal.amountActual?.toString() ?? '',
      taxInvoiceId: deal.taxInvoiceId?.toString() ?? '',
      settlementId: deal.settlementId?.toString() ?? '',
      projectCode: deal.projectCode ?? '',
      remark: deal.remark ?? '',
    } : { ...DEAL_EMPTY })
    setError(null)
    setModal({ open: true, deal })
  }

  const save = async () => {
    setBusy(true); setError(null)
    const url = modal.deal ? `/api/hospitals/${code}/sales/deals/${modal.deal.id}` : `/api/hospitals/${code}/sales/deals`
    const res = await fetch(url, {
      method: modal.deal ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roundNo: form.roundNo === '' ? null : parseInt(form.roundNo),
        statusId: form.statusId === '' ? null : parseInt(form.statusId),
        hospitalModelId: form.hospitalModelId === '' ? null : parseInt(form.hospitalModelId),
        seersModelId: form.seersModelId === '' ? null : parseInt(form.seersModelId),
        contractDate: form.contractDate || null,
        wardsText: form.wardsText,
        deptsText: form.deptsText,
        wardCount: form.wardCount === '' ? null : form.wardCount,
        bedCount: form.bedCount === '' ? null : form.bedCount,
        amountProduct: form.amountProduct,
        amountConstruction: form.amountConstruction,
        amountActual: form.amountActual,
        taxInvoiceId: form.taxInvoiceId === '' ? null : parseInt(form.taxInvoiceId),
        settlementId: form.settlementId === '' ? null : parseInt(form.settlementId),
        projectCode: form.projectCode || null,
        remark: form.remark,
      }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '저장에 실패했습니다.'); return }
    setModal({ open: false, deal: null })
    onSaved()
  }

  const remove = async (deal: Deal) => {
    if (!confirm(`${deal.roundNo}차 딜(${deal.dealCode})을 삭제할까요?`)) return
    const res = await fetch(`/api/hospitals/${code}/sales/deals/${deal.id}`, { method: 'DELETE' })
    if (res.ok) onSaved()
  }

  const contracted = data.deals.filter((d) => d.status?.name === '계약완료')
  const sum = (f: (d: Deal) => number | null) => contracted.reduce((acc, d) => acc + (f(d) ?? 0), 0)
  // '판매' = 제품가 + 공사비 파생 (저장 안 함)
  const saleSum = (d: Deal): number | null =>
    d.amountProduct === null && d.amountConstruction === null ? null : (d.amountProduct ?? 0) + (d.amountConstruction ?? 0)

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className={thCls}>차수</th>
              <th className={thCls}>상태</th>
              <th className={thCls}>판매모델<br /><span className="normal-case">(병원/씨어스)</span></th>
              <th className={thCls}>계약일</th>
              <th className={thCls}>도입병동</th>
              <th className={`${thCls} text-right`}>병동</th>
              <th className={`${thCls} text-right`}>병상</th>
              <th className={`${thCls} text-right`}>제품가</th>
              <th className={`${thCls} text-right`}>공사비</th>
              <th className={`${thCls} text-right`}>판매</th>
              <th className={`${thCls} text-right`}>실판매액</th>
              <th className={thCls}>세금계산서</th>
              <th className={thCls}>정산</th>
              <th className={thCls}>프로젝트</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.deals.length === 0 && (
              <tr><td colSpan={15} className="px-3 py-6 text-center text-sm text-gray-400">계약 이력이 없습니다. 도입(계약) 건을 차수 단위로 등록하세요.</td></tr>
            )}
            {data.deals.map((d) => (
              <tr key={d.id}>
                <td className={`${tdCls} whitespace-nowrap font-medium`} title={d.remark ?? undefined}>{d.roundNo}차 <span className="ml-1 text-xs text-gray-400">{d.dealCode}</span></td>
                <td className={tdCls}>
                  {d.status ? (
                    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: d.status.color || '#94a3b8' }}>{d.status.name}</span>
                  ) : <Empty />}
                </td>
                <td className={`${tdCls} whitespace-nowrap`}>{d.hospitalModel?.name ?? '—'} / {d.seersModel?.name ?? '—'}</td>
                <td className={`${tdCls} whitespace-nowrap`}>{fmtDate(d.contractDate)}</td>
                <td className={`${tdCls} max-w-[120px] truncate`} title={[d.wardsText, d.deptsText].filter(Boolean).join(' | ') || undefined}>{d.wardsText ?? <Empty />}</td>
                <td className={`${tdCls} text-right`}>{d.wardCount ?? <Empty />}</td>
                <td className={`${tdCls} text-right`}>{d.bedCount ?? <Empty />}</td>
                <td className={`${tdCls} whitespace-nowrap text-right`}>{fmtWon(d.amountProduct)}</td>
                <td className={`${tdCls} whitespace-nowrap text-right`}>{fmtWon(d.amountConstruction)}</td>
                <td className={`${tdCls} whitespace-nowrap text-right`}>{fmtWon(saleSum(d))}</td>
                <td className={`${tdCls} whitespace-nowrap text-right`}>{fmtWon(d.amountActual)}</td>
                <td className={tdCls}>{d.taxInvoice?.name ?? <Empty />}</td>
                <td className={tdCls}>{d.settlement?.name ?? <Empty />}</td>
                <td className={`${tdCls} max-w-[140px] truncate`}>
                  {d.project ? (
                    <Link href={`/projects/${d.project.projectCode}`} className="text-blue-600 hover:underline">{d.project.projectName}</Link>
                  ) : <Empty />}
                </td>
                <td className={`${tdCls} whitespace-nowrap text-right`}>
                  <button onClick={() => open(d)} className="text-xs text-blue-600 hover:underline">수정</button>
                  <button onClick={() => remove(d)} className="ml-2 text-xs text-red-500 hover:underline">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
          {data.deals.length > 0 && (
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-xs font-medium text-gray-500">합계 (계약완료 {contracted.length}건)</td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-gray-900">{sum((d) => d.wardCount) || '—'}</td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-gray-900">{sum((d) => d.bedCount) || '—'}</td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-gray-900">{fmtWon(sum((d) => d.amountProduct))}</td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-gray-900">{fmtWon(sum((d) => d.amountConstruction))}</td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-gray-900">{fmtWon(sum(saleSum))}</td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-gray-900">{fmtWon(sum((d) => d.amountActual))}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="border-t border-gray-100 p-4">
        <button onClick={() => open(null)} className={btnGhost}>계약 건 등록</button>
      </div>

      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal({ open: false, deal: null })}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-800">{modal.deal ? `${modal.deal.dealCode} 수정` : '계약 건(딜) 등록'}</h3>

            <p className="mt-4 text-xs font-semibold text-gray-500">규모 · 계약</p>
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
              <div><label className={labelCls}>차수</label><input type="number" min={1} className={inputCls} placeholder="비우면 자동" value={form.roundNo} onChange={(e) => setForm({ ...form, roundNo: e.target.value })} /></div>
              <div>
                <label className={labelCls}>상태</label>
                <select className={inputCls} value={form.statusId} onChange={(e) => setForm({ ...form, statusId: e.target.value })}>
                  <option value="">미지정</option>
                  {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>계약일</label><input type="date" className={inputCls} value={form.contractDate} onChange={(e) => setForm({ ...form, contractDate: e.target.value })} /></div>
              <div>
                <label className={labelCls}>병원 판매모델</label>
                <select className={inputCls} value={form.hospitalModelId} onChange={(e) => setForm({ ...form, hospitalModelId: e.target.value })}>
                  <option value="">미지정</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>씨어스 판매방식</label>
                <select className={inputCls} value={form.seersModelId} onChange={(e) => setForm({ ...form, seersModelId: e.target.value })}>
                  <option value="">미지정</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>도입병동</label><input className={inputCls} placeholder="예: IM, ICU" value={form.wardsText} onChange={(e) => setForm({ ...form, wardsText: e.target.value })} /></div>
              <div><label className={labelCls}>도입진료과</label><input className={inputCls} placeholder="예: 내과계, 중환자실" value={form.deptsText} onChange={(e) => setForm({ ...form, deptsText: e.target.value })} /></div>
              <div><label className={labelCls}>병동수 (계약 스냅샷)</label><input type="number" min={0} className={inputCls} value={form.wardCount} onChange={(e) => setForm({ ...form, wardCount: e.target.value })} /></div>
              <div><label className={labelCls}>병상수 (계약 스냅샷)</label><input type="number" min={0} className={inputCls} value={form.bedCount} onChange={(e) => setForm({ ...form, bedCount: e.target.value })} /></div>
            </div>

            <p className="mt-4 text-xs font-semibold text-gray-500">금액 · 정산 <span className="font-normal">{"('판매' 합계 = 제품가+공사비 자동 계산)"}</span></p>
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
              <div><label className={labelCls}>제품(구성품) 금액 (원)</label><input className={inputCls} placeholder="예: 93,172,509" value={form.amountProduct} onChange={(e) => setForm({ ...form, amountProduct: e.target.value })} /></div>
              <div><label className={labelCls}>공사비 (원)</label><input className={inputCls} value={form.amountConstruction} onChange={(e) => setForm({ ...form, amountConstruction: e.target.value })} /></div>
              <div><label className={labelCls}>실판매액 (원)</label><input className={inputCls} value={form.amountActual} onChange={(e) => setForm({ ...form, amountActual: e.target.value })} /></div>
              <div>
                <label className={labelCls}>세금계산서 발행</label>
                <select className={inputCls} value={form.taxInvoiceId} onChange={(e) => setForm({ ...form, taxInvoiceId: e.target.value })}>
                  <option value="">미지정</option>
                  {taxInvoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>정산 상태</label>
                <select className={inputCls} value={form.settlementId} onChange={(e) => setForm({ ...form, settlementId: e.target.value })}>
                  <option value="">미지정</option>
                  {settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>연결 프로젝트 (계약 완료 후 매핑)</label>
                <select className={inputCls} value={form.projectCode} onChange={(e) => setForm({ ...form, projectCode: e.target.value })}>
                  <option value="">없음 — 영업 단계</option>
                  {data.masters.projects.map((pr) => <option key={pr.projectCode} value={pr.projectCode}>{pr.projectName}</option>)}
                </select>
              </div>
              <div className="col-span-2 md:col-span-3">
                <label className={labelCls}>비고</label>
                <textarea rows={2} className={inputCls} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setModal({ open: false, deal: null })} className={btnGhost}>취소</button>
              <button onClick={save} disabled={busy} className={btnPrimary}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 메인 ───

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'persons', label: '인적정보' },
  { key: 'activities', label: '영업 활동' },
  { key: 'deals', label: '계약 이력' },
] as const
type TabKey = (typeof TABS)[number]['key']

export default function SalesSection({ hospitalCode }: { hospitalCode: string; currentUserId?: string | null }) {
  const [data, setData] = useState<SalesData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')

  const load = useCallback(async () => {
    const res = await fetch(`/api/hospitals/${hospitalCode}/sales`, { cache: 'no-store' })
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '영업 정보를 불러오지 못했습니다.'); return }
    setData(await res.json())
  }, [hospitalCode])

  useEffect(() => { load() }, [load])

  if (error) return null
  if (!data) {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-400 shadow-sm">영업 정보 불러오는 중…</div>
    )
  }

  const p = data.profile
  const { introBeds, penetration, contractedTotal } = data.derived
  const counts: Record<TabKey, number | null> = {
    overview: null,
    persons: data.persons.current.length,
    activities: data.activities.length,
    deals: data.deals.length,
  }
  const lastActivity = data.activities[0]?.activityDate ?? null

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* 헤더 + 요약 스트립 */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-base font-bold text-gray-800">영업 정보</h2>
          <StageBadge stage={p?.stage ?? null} />
          <span className="text-xs text-gray-500">담당 {p?.owner?.name ?? '—'}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500">
          <span>전체 병상 <b className="text-sm text-gray-900">{p?.totalBeds?.toLocaleString() ?? '—'}</b></span>
          <span>도입 병상 <b className="text-sm text-gray-900">{introBeds?.toLocaleString() ?? '—'}</b></span>
          <span>침투율 <b className="text-sm text-gray-900">{penetration != null ? `${penetration}%` : '—'}</b></span>
          <span>누적 실판매액 <b className="text-sm text-gray-900">{contractedTotal > 0 ? `${contractedTotal.toLocaleString()}원` : '—'}</b></span>
          <span>최근 활동 <b className="text-sm text-gray-900">{lastActivity ? fmtDate(lastActivity) : '—'}</b></span>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-gray-200 px-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
            {counts[t.key] !== null && <span className="ml-1 text-xs text-gray-400">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab code={hospitalCode} data={data} onSaved={load} />}
      {tab === 'persons' && <PersonsTab code={hospitalCode} data={data} onSaved={load} />}
      {tab === 'activities' && <ActivitiesTab code={hospitalCode} data={data} onSaved={load} />}
      {tab === 'deals' && <DealsTab code={hospitalCode} data={data} onSaved={load} />}
    </div>
  )
}
