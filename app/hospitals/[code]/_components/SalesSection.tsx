'use client'

/**
 * 병원 영업 정보 섹션 (영업/CRM Phase 1+2 — projects/sales_crm_design.md)
 * 열람·편집: ADMIN 이상 + SEERS 소속 (서버 페이지에서 렌더 게이트 + API 재검증)
 * 프로필 · 키맨 · 대웅 채널 · 차수별 딜(+디바이스 수량) · 영업일지
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import RichTextEditor from '@/app/components/RichTextEditor'

// ─── 타입 ───

interface CodeItem { id: number; name: string }
interface Profile { totalBeds: number | null; totalWards: number | null; grade: string | null; salesMemo: string | null }
interface Contact {
  id: number; name: string; title: string | null; department: string | null; phone: string | null
  email: string | null; roleNote: string | null; isPrimary: boolean; isActive: boolean
}
interface Channel {
  id: number; isCurrent: boolean; note: string | null
  office: { id: number; division: string | null; name: string } | null
  rep: { id: number; name: string; phone: string | null } | null
}
interface DealDevice { id: number; quantity: number; unitPrice: number | null; deviceInfo: { id: number; deviceModel: string; deviceName: string } }
interface Deal {
  id: number; dealCode: string; roundNo: number; projectCode: string | null
  hospitalSaleModel: CodeItem | null; seersSaleModel: CodeItem | null
  wardCount: number | null; bedCount: number | null; wardsText: string | null; deptsText: string | null
  amountProduct: number | null; amountConstruction: number | null; amountTotal: number | null
  amountService: number | null; amountActual: number | null
  priceType: CodeItem | null
  firstContactDate: string | null; contractDate: string | null; deliveryDate: string | null; warrantyMonths: number | null
  settlementStatus: CodeItem | null; taxInvoiceStatus: CodeItem | null; revenueRecognition: CodeItem | null
  remark: string | null
  devices: DealDevice[]
}
interface Activity {
  id: number; activityDate: string; content: string
  activityType: CodeItem | null
  author: { id: string; name: string } | null
  deal: { id: number; dealCode: string; roundNo: number } | null
}
interface Masters {
  offices: Array<{ id: number; division: string | null; name: string; reps: Array<{ id: number; name: string; phone: string | null }> }>
  codes: Record<string, CodeItem[]>
  devices: Array<{ id: number; deviceModel: string; deviceName: string }>
  projects: Array<{ projectCode: string; orderNumber: number }>
}
interface SalesData {
  introBeds: number | null
  profile: Profile | null
  contacts: Contact[]
  channels: Channel[]
  deals: Deal[]
  activities: Activity[]
  masters: Masters
}

// ─── 공용 소품 ───

const fmtWon = (v: number | null) => (v === null ? '-' : `${v.toLocaleString('ko-KR')}원`)
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('ko-KR') : '-')
const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'
const labelCls = 'mb-1 block text-xs font-medium text-gray-500'
const btnPrimary = 'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50'
const btnGhost = 'rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100'

function Card({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm text-gray-900">{value ?? <span className="text-gray-400">-</span>}</dd>
    </div>
  )
}

// ─── 프로필 카드 ───

function ProfileCard({ code, profile, introBeds, onSaved }: { code: string; profile: Profile | null; introBeds: number | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ totalBeds: '', totalWards: '', grade: '', salesMemo: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = () => {
    setForm({
      totalBeds: profile?.totalBeds?.toString() ?? '',
      totalWards: profile?.totalWards?.toString() ?? '',
      grade: profile?.grade ?? '',
      salesMemo: profile?.salesMemo ?? '',
    })
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/hospitals/${code}/sales/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalBeds: form.totalBeds === '' ? null : form.totalBeds,
        totalWards: form.totalWards === '' ? null : form.totalWards,
        grade: form.grade,
        salesMemo: form.salesMemo,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      setError((await res.json()).error ?? '저장에 실패했습니다.')
      return
    }
    setEditing(false)
    onSaved()
  }

  const penetration = profile?.totalBeds && introBeds ? Math.round((introBeds / profile.totalBeds) * 1000) / 10 : null

  return (
    <Card
      title="영업 프로필"
      action={!editing && <button onClick={startEdit} className={btnGhost}>편집</button>}
    >
      {editing ? (
        <div className="px-6 py-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label className={labelCls}>전체(허가) 병상수</label>
              <input type="number" min={0} value={form.totalBeds} onChange={(e) => setForm({ ...form, totalBeds: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>전체 병동수</label>
              <input type="number" min={0} value={form.totalWards} onChange={(e) => setForm({ ...form, totalWards: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>영업 등급</label>
              <input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="A / B / C" className={inputCls} />
            </div>
          </div>
          <div className="mt-4">
            <label className={labelCls}>영업 메모</label>
            <textarea value={form.salesMemo} onChange={(e) => setForm({ ...form, salesMemo: e.target.value })} rows={3} className={inputCls} />
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={busy} className={btnPrimary}>저장</button>
            <button onClick={() => setEditing(false)} className={btnGhost}>취소</button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-6 px-6 py-5 sm:grid-cols-4">
          <Field label="전체(허가) 병상수" value={profile?.totalBeds != null ? `${profile.totalBeds.toLocaleString()}병상` : null} />
          <Field label="도입 병상 / 침투율" value={
            introBeds != null
              ? <span>{introBeds.toLocaleString()}병상{penetration != null && <span className="ml-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{penetration}%</span>}</span>
              : null
          } />
          <Field label="전체 병동수" value={profile?.totalWards != null ? `${profile.totalWards}병동` : null} />
          <Field label="영업 등급" value={profile?.grade} />
          {profile?.salesMemo && (
            <div className="col-span-2 sm:col-span-4">
              <Field label="영업 메모" value={<span className="whitespace-pre-wrap">{profile.salesMemo}</span>} />
            </div>
          )}
        </dl>
      )}
    </Card>
  )
}

// ─── 키맨 카드 ───

const emptyContact = { name: '', title: '', department: '', phone: '', email: '', roleNote: '', isPrimary: false }

function ContactsCard({ code, contacts, onSaved }: { code: string; contacts: Contact[]; onSaved: () => void }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyContact })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openNew = () => { setEditId(null); setForm({ ...emptyContact }); setError(null); setFormOpen(true) }
  const openEdit = (c: Contact) => {
    setEditId(c.id)
    setForm({ name: c.name, title: c.title ?? '', department: c.department ?? '', phone: c.phone ?? '', email: c.email ?? '', roleNote: c.roleNote ?? '', isPrimary: c.isPrimary })
    setError(null)
    setFormOpen(true)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    const url = editId === null ? `/api/hospitals/${code}/sales/contacts` : `/api/hospitals/${code}/sales/contacts/${editId}`
    const res = await fetch(url, {
      method: editId === null ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json()).error ?? '저장에 실패했습니다.'); return }
    setFormOpen(false)
    onSaved()
  }

  const toggleActive = async (c: Contact) => {
    await fetch(`/api/hospitals/${code}/sales/contacts/${c.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...c, isActive: !c.isActive }),
    })
    onSaved()
  }

  const remove = async (c: Contact) => {
    if (!confirm(`'${c.name}' 담당자를 삭제할까요? (이력 보존이 필요하면 비활성을 사용하세요)`)) return
    await fetch(`/api/hospitals/${code}/sales/contacts/${c.id}`, { method: 'DELETE' })
    onSaved()
  }

  return (
    <Card title="병원 키맨" action={<button onClick={openNew} className={btnPrimary}>담당자 추가</button>}>
      {contacts.length === 0 && !formOpen ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">등록된 담당자가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['이름', '직책/부서', '연락처', '역할 메모', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {contacts.map((c) => (
                <tr key={c.id} className={c.isActive ? '' : 'opacity-45'}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                    {c.name}
                    {c.isPrimary && <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">대표</span>}
                    {!c.isActive && <span className="ml-1.5 text-xs text-gray-400">(비활성)</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{[c.title, c.department].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{[c.phone, c.email].filter(Boolean).join(' · ') || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.roleNote ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs">
                    <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline">수정</button>
                    <button onClick={() => toggleActive(c)} className="ml-2 text-gray-500 hover:underline">{c.isActive ? '비활성' : '활성'}</button>
                    <button onClick={() => remove(c)} className="ml-2 text-red-500 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {formOpen && (
        <div className="border-t border-gray-100 bg-gray-50 px-6 py-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><label className={labelCls}>이름 *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>직책</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>부서</label><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>전화</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>이메일</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>역할 메모</label><input value={form.roleNote} onChange={(e) => setForm({ ...form, roleNote: e.target.value })} placeholder="구매결정권자, 실무 창구 …" className={inputCls} /></div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} className="h-4 w-4" />
            대표 키맨
          </label>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={busy} className={btnPrimary}>{editId === null ? '추가' : '저장'}</button>
            <button onClick={() => setFormOpen(false)} className={btnGhost}>취소</button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── 대웅 채널 카드 ───

function ChannelsCard({ code, channels, masters, onSaved }: { code: string; channels: Channel[]; masters: Masters; onSaved: () => void }) {
  const [formOpen, setFormOpen] = useState(false)
  const [officeId, setOfficeId] = useState('')
  const [repId, setRepId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const current = channels.filter((c) => c.isCurrent)
  const history = channels.filter((c) => !c.isCurrent)
  const repOptions = useMemo(() => {
    if (officeId === '') return masters.offices.flatMap((o) => o.reps.map((r) => ({ ...r, officeName: o.name })))
    const office = masters.offices.find((o) => o.id === parseInt(officeId))
    return (office?.reps ?? []).map((r) => ({ ...r, officeName: office?.name ?? '' }))
  }, [officeId, masters.offices])

  const save = async () => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/hospitals/${code}/sales/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        officeId: officeId === '' ? null : parseInt(officeId),
        repId: repId === '' ? null : parseInt(repId),
        note,
      }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json()).error ?? '저장에 실패했습니다.'); return }
    setFormOpen(false)
    setOfficeId(''); setRepId(''); setNote('')
    onSaved()
  }

  const remove = async (ch: Channel) => {
    if (!confirm('이 채널 기록을 삭제할까요?')) return
    await fetch(`/api/hospitals/${code}/sales/channels/${ch.id}`, { method: 'DELETE' })
    onSaved()
  }

  const renderRow = (ch: Channel) => (
    <div key={ch.id} className="flex items-center justify-between px-6 py-3">
      <div className="text-sm text-gray-700">
        {ch.office ? <span>{ch.office.division && <span className="text-gray-400">{ch.office.division} · </span>}{ch.office.name}</span> : <span className="text-gray-400">사무소 미지정</span>}
        {ch.rep && <span className="ml-2 font-medium">{ch.rep.name}</span>}
        {ch.rep?.phone && <span className="ml-1.5 text-xs text-gray-400">{ch.rep.phone}</span>}
        {ch.note && <span className="ml-2 text-xs text-gray-400">— {ch.note}</span>}
        {!ch.isCurrent && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">이전</span>}
      </div>
      <button onClick={() => remove(ch)} className="text-xs text-red-500 hover:underline">삭제</button>
    </div>
  )

  return (
    <Card
      title="대웅 관리 채널 (사업부·사무소·담당자)"
      action={<button onClick={() => setFormOpen(true)} className={btnPrimary}>채널 지정</button>}
    >
      {current.length === 0 ? (
        <p className="px-6 py-6 text-center text-sm text-gray-400">지정된 대웅 채널이 없습니다. (선택 입력 — 없어도 무방)</p>
      ) : (
        <div className="divide-y divide-gray-100">{current.map(renderRow)}</div>
      )}
      {history.length > 0 && (
        <div className="border-t border-gray-100">
          <button onClick={() => setShowHistory(!showHistory)} className="w-full px-6 py-2 text-left text-xs text-gray-400 hover:text-gray-600">
            {showHistory ? '▾' : '▸'} 이전 채널 이력 {history.length}건
          </button>
          {showHistory && <div className="divide-y divide-gray-100 opacity-60">{history.map(renderRow)}</div>}
        </div>
      )}
      {formOpen && (
        <div className="border-t border-gray-100 bg-gray-50 px-6 py-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>사무소</label>
              <select value={officeId} onChange={(e) => { setOfficeId(e.target.value); setRepId('') }} className={inputCls}>
                <option value="">선택 안 함</option>
                {masters.offices.map((o) => (
                  <option key={o.id} value={o.id}>{o.division ? `[${o.division}] ` : ''}{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>담당자</label>
              <select value={repId} onChange={(e) => setRepId(e.target.value)} className={inputCls}>
                <option value="">선택 안 함</option>
                {repOptions.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{officeId === '' && r.officeName ? ` (${r.officeName})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>메모</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">새 채널을 지정하면 기존 현재 채널은 이력으로 전환됩니다. 사무소·담당자 마스터는 설정 → 영업 조직 관리에서 등록합니다.</p>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={busy} className={btnPrimary}>지정</button>
            <button onClick={() => setFormOpen(false)} className={btnGhost}>취소</button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── 딜 카드 + 모달 ───

const emptyDeal = {
  roundNo: '', projectCode: '', hospitalSaleModelId: '', seersSaleModelId: '',
  wardCount: '', bedCount: '', wardsText: '', deptsText: '',
  amountProduct: '', amountConstruction: '', amountTotal: '', amountService: '', amountActual: '',
  priceTypeId: '', firstContactDate: '', contractDate: '', deliveryDate: '', warrantyMonths: '',
  settlementStatusId: '', taxInvoiceStatusId: '', revenueRecognitionId: '', remark: '',
}
type DealForm = typeof emptyDeal
type DeviceRow = { deviceInfoId: string; quantity: string; unitPrice: string }

function toDateInput(v: string | null): string {
  return v ? new Date(v).toISOString().slice(0, 10) : ''
}

function DealModal({ code, deal, nextRound, masters, onClose, onSaved }: {
  code: string; deal: Deal | null; nextRound: number; masters: Masters; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<DealForm>(() => deal ? {
    roundNo: String(deal.roundNo), projectCode: deal.projectCode ?? '',
    hospitalSaleModelId: deal.hospitalSaleModel?.id.toString() ?? '', seersSaleModelId: deal.seersSaleModel?.id.toString() ?? '',
    wardCount: deal.wardCount?.toString() ?? '', bedCount: deal.bedCount?.toString() ?? '',
    wardsText: deal.wardsText ?? '', deptsText: deal.deptsText ?? '',
    amountProduct: deal.amountProduct?.toString() ?? '', amountConstruction: deal.amountConstruction?.toString() ?? '',
    amountTotal: deal.amountTotal?.toString() ?? '', amountService: deal.amountService?.toString() ?? '',
    amountActual: deal.amountActual?.toString() ?? '',
    priceTypeId: deal.priceType?.id.toString() ?? '',
    firstContactDate: toDateInput(deal.firstContactDate), contractDate: toDateInput(deal.contractDate),
    deliveryDate: toDateInput(deal.deliveryDate), warrantyMonths: deal.warrantyMonths?.toString() ?? '',
    settlementStatusId: deal.settlementStatus?.id.toString() ?? '', taxInvoiceStatusId: deal.taxInvoiceStatus?.id.toString() ?? '',
    revenueRecognitionId: deal.revenueRecognition?.id.toString() ?? '', remark: deal.remark ?? '',
  } : { ...emptyDeal, roundNo: String(nextRound) })
  const [devices, setDevices] = useState<DeviceRow[]>(
    deal?.devices.map((d) => ({ deviceInfoId: String(d.deviceInfo.id), quantity: String(d.quantity), unitPrice: d.unitPrice?.toString() ?? '' })) ?? []
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof DealForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const codeSelect = (label: string, key: keyof DealForm, category: string) => (
    <div>
      <label className={labelCls}>{label}</label>
      <select value={form[key]} onChange={set(key)} className={inputCls}>
        <option value="">선택 안 함</option>
        {(masters.codes[category] ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  )

  const save = async () => {
    setBusy(true)
    setError(null)
    const num = (v: string) => (v === '' ? null : parseInt(v))
    const body = {
      roundNo: num(form.roundNo),
      projectCode: form.projectCode || null,
      hospitalSaleModelId: num(form.hospitalSaleModelId), seersSaleModelId: num(form.seersSaleModelId),
      wardCount: num(form.wardCount), bedCount: num(form.bedCount),
      wardsText: form.wardsText, deptsText: form.deptsText,
      amountProduct: form.amountProduct, amountConstruction: form.amountConstruction,
      amountTotal: form.amountTotal, amountService: form.amountService, amountActual: form.amountActual,
      priceTypeId: num(form.priceTypeId),
      firstContactDate: form.firstContactDate || null, contractDate: form.contractDate || null,
      deliveryDate: form.deliveryDate || null, warrantyMonths: num(form.warrantyMonths),
      settlementStatusId: num(form.settlementStatusId), taxInvoiceStatusId: num(form.taxInvoiceStatusId),
      revenueRecognitionId: num(form.revenueRecognitionId), remark: form.remark,
      devices: devices
        .filter((d) => d.deviceInfoId !== '' && d.quantity !== '')
        .map((d) => ({ deviceInfoId: parseInt(d.deviceInfoId), quantity: parseInt(d.quantity), unitPrice: d.unitPrice === '' ? null : d.unitPrice })),
    }
    const url = deal ? `/api/hospitals/${code}/sales/deals/${deal.id}` : `/api/hospitals/${code}/sales/deals`
    const res = await fetch(url, { method: deal ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setBusy(false)
    if (!res.ok) { setError((await res.json()).error ?? '저장에 실패했습니다.'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-800">{deal ? `${deal.dealCode} 수정` : '도입 차수(딜) 등록'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {/* 기본 */}
          <p className="mb-2 text-xs font-semibold text-gray-400">기본</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className={labelCls}>차수 *</label><input type="number" min={1} value={form.roundNo} onChange={set('roundNo')} className={inputCls} /></div>
            <div>
              <label className={labelCls}>연결 프로젝트</label>
              <select value={form.projectCode} onChange={set('projectCode')} className={inputCls}>
                <option value="">연결 안 함</option>
                {masters.projects.map((p) => <option key={p.projectCode} value={p.projectCode}>{p.orderNumber}차 · {p.projectCode}</option>)}
              </select>
            </div>
            {codeSelect('병원 판매모델', 'hospitalSaleModelId', 'SALES_MODEL_HOSPITAL')}
            {codeSelect('씨어스 판매방식', 'seersSaleModelId', 'SALES_MODEL_SEERS')}
          </div>
          {/* 규모 */}
          <p className="mb-2 mt-5 text-xs font-semibold text-gray-400">규모 (계약 시점 스냅샷)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className={labelCls}>병동수</label><input type="number" min={0} value={form.wardCount} onChange={set('wardCount')} className={inputCls} /></div>
            <div><label className={labelCls}>병상수</label><input type="number" min={0} value={form.bedCount} onChange={set('bedCount')} className={inputCls} /></div>
            <div><label className={labelCls}>도입 병동</label><input value={form.wardsText} onChange={set('wardsText')} placeholder="IM, ICU" className={inputCls} /></div>
            <div><label className={labelCls}>도입 진료과</label><input value={form.deptsText} onChange={set('deptsText')} placeholder="내과계, 중환자실" className={inputCls} /></div>
          </div>
          {/* 금액 */}
          <p className="mb-2 mt-5 text-xs font-semibold text-gray-400">금액 (원)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><label className={labelCls}>제품(구성품)</label><input inputMode="numeric" value={form.amountProduct} onChange={set('amountProduct')} className={inputCls} /></div>
            <div><label className={labelCls}>공사비</label><input inputMode="numeric" value={form.amountConstruction} onChange={set('amountConstruction')} className={inputCls} /></div>
            <div><label className={labelCls}>판매 합계</label><input inputMode="numeric" value={form.amountTotal} onChange={set('amountTotal')} className={inputCls} /></div>
            <div><label className={labelCls}>용역 매출</label><input inputMode="numeric" value={form.amountService} onChange={set('amountService')} className={inputCls} /></div>
            <div><label className={labelCls}>실판매액 ★집계 기준</label><input inputMode="numeric" value={form.amountActual} onChange={set('amountActual')} className={inputCls} /></div>
            {codeSelect('판매가 유형', 'priceTypeId', 'SALES_PRICE_TYPE')}
          </div>
          {/* 일정·정산 */}
          <p className="mb-2 mt-5 text-xs font-semibold text-gray-400">일정 · 정산</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className={labelCls}>최초 인입일</label><input type="date" value={form.firstContactDate} onChange={set('firstContactDate')} className={inputCls} /></div>
            <div><label className={labelCls}>계약일</label><input type="date" value={form.contractDate} onChange={set('contractDate')} className={inputCls} /></div>
            <div><label className={labelCls}>납품일</label><input type="date" value={form.deliveryDate} onChange={set('deliveryDate')} className={inputCls} /></div>
            <div><label className={labelCls}>보증기간(개월)</label><input type="number" min={0} value={form.warrantyMonths} onChange={set('warrantyMonths')} className={inputCls} /></div>
            {codeSelect('정산 상태', 'settlementStatusId', 'SALES_SETTLEMENT')}
            {codeSelect('세금계산서', 'taxInvoiceStatusId', 'SALES_TAX_INVOICE')}
            {codeSelect('매출 인식', 'revenueRecognitionId', 'SALES_REVENUE_RECOG')}
          </div>
          {/* 디바이스 */}
          <p className="mb-2 mt-5 text-xs font-semibold text-gray-400">디바이스 수량 (계약/판매 기준)</p>
          {devices.map((d, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <select value={d.deviceInfoId} onChange={(e) => setDevices(devices.map((x, j) => j === i ? { ...x, deviceInfoId: e.target.value } : x))} className={`${inputCls} flex-1`}>
                <option value="">장비 선택</option>
                {masters.devices.map((dv) => <option key={dv.id} value={dv.id}>{dv.deviceName} ({dv.deviceModel})</option>)}
              </select>
              <input type="number" min={1} placeholder="수량" value={d.quantity} onChange={(e) => setDevices(devices.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} className={`${inputCls} w-24`} />
              <input inputMode="numeric" placeholder="단가(선택)" value={d.unitPrice} onChange={(e) => setDevices(devices.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} className={`${inputCls} w-32`} />
              <button onClick={() => setDevices(devices.filter((_, j) => j !== i))} className="shrink-0 text-red-500 hover:text-red-600">✕</button>
            </div>
          ))}
          <button onClick={() => setDevices([...devices, { deviceInfoId: '', quantity: '', unitPrice: '' }])} className={btnGhost}>+ 디바이스 추가</button>
          {/* 비고 */}
          <div className="mt-5">
            <label className={labelCls}>비고</label>
            <textarea value={form.remark} onChange={set('remark')} rows={2} className={inputCls} />
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button onClick={onClose} className={btnGhost}>취소</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>{deal ? '저장' : '등록'}</button>
        </div>
      </div>
    </div>
  )
}

function DealsCard({ code, deals, masters, onSaved }: { code: string; deals: Deal[]; masters: Masters; onSaved: () => void }) {
  const [modal, setModal] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null })

  const totals = useMemo(() => ({
    beds: deals.reduce((s, d) => s + (d.bedCount ?? 0), 0),
    actual: deals.reduce((s, d) => s + (d.amountActual ?? 0), 0),
  }), [deals])

  // 디바이스 종별 누적 (딜 합산 파생)
  const deviceTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of deals) for (const dd of d.devices) {
      map.set(dd.deviceInfo.deviceName, (map.get(dd.deviceInfo.deviceName) ?? 0) + dd.quantity)
    }
    return Array.from(map.entries())
  }, [deals])

  const remove = async (d: Deal) => {
    if (!confirm(`${d.roundNo}차 딜(${d.dealCode})을 삭제할까요? 디바이스 수량도 함께 삭제됩니다.`)) return
    await fetch(`/api/hospitals/${code}/sales/deals/${d.id}`, { method: 'DELETE' })
    onSaved()
  }

  const nextRound = deals.length > 0 ? Math.max(...deals.map((d) => d.roundNo)) + 1 : 1

  return (
    <Card title="도입 차수(딜) · 매출" action={<button onClick={() => setModal({ open: true, deal: null })} className={btnPrimary}>딜 등록</button>}>
      {deals.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">등록된 딜이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['차수', '판매모델(병원/씨어스)', '병동·병상', '계약일', '납품일', '실판매액', '정산', '매출인식', '프로젝트', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {deals.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {d.roundNo}차
                    {d.roundNo >= 2 && <span className="ml-1.5 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">확장</span>}
                    <div className="font-mono text-[11px] font-normal text-gray-400">{d.dealCode}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {d.hospitalSaleModel?.name ?? '-'} / {d.seersSaleModel?.name ?? '-'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {d.wardCount != null ? `${d.wardCount}병동` : '-'} · {d.bedCount != null ? `${d.bedCount}병상` : '-'}
                    {d.wardsText && <div className="text-[11px] text-gray-400">{d.wardsText}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{fmtDate(d.contractDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{fmtDate(d.deliveryDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">{fmtWon(d.amountActual)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{d.settlementStatus?.name ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{d.revenueRecognition?.name ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {d.projectCode
                      ? <Link href={`/projects/${d.projectCode}`} className="font-mono text-xs text-blue-600 hover:underline">{d.projectCode}</Link>
                      : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs">
                    <button onClick={() => setModal({ open: true, deal: d })} className="text-blue-600 hover:underline">수정</button>
                    <button onClick={() => remove(d)} className="ml-2 text-red-500 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-gray-700">합계 ({deals.length}건)</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-gray-700">{totals.beds.toLocaleString()}병상</td>
                <td colSpan={2} />
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-gray-900">{fmtWon(totals.actual)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {deviceTotals.length > 0 && (
        <div className="border-t border-gray-100 px-6 py-3">
          <span className="text-xs font-medium text-gray-400">디바이스 누적: </span>
          {deviceTotals.map(([name, qty]) => (
            <span key={name} className="mr-2 inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">{name} {qty.toLocaleString()}개</span>
          ))}
        </div>
      )}
      {modal.open && (
        <DealModal
          code={code}
          deal={modal.deal}
          nextRound={nextRound}
          masters={masters}
          onClose={() => setModal({ open: false, deal: null })}
          onSaved={() => { setModal({ open: false, deal: null }); onSaved() }}
        />
      )}
    </Card>
  )
}

// ─── 영업일지 카드 ───

function ActivitiesCard({ code, activities, deals, masters, currentUserId, onSaved }: {
  code: string; activities: Activity[]; deals: Deal[]; masters: Masters; currentUserId: string | null; onSaved: () => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const [typeId, setTypeId] = useState('')
  const [dealId, setDealId] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openNew = () => {
    setEditId(null)
    setDate(new Date().toISOString().slice(0, 10))
    setTypeId(''); setDealId(''); setContent('')
    setError(null)
    setFormOpen(true)
  }
  const openEdit = (a: Activity) => {
    setEditId(a.id)
    setDate(new Date(a.activityDate).toISOString().slice(0, 10))
    setTypeId(a.activityType?.id.toString() ?? '')
    setDealId(a.deal?.id.toString() ?? '')
    setContent(a.content)
    setError(null)
    setFormOpen(true)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    const body = {
      activityDate: date,
      activityTypeId: typeId === '' ? null : parseInt(typeId),
      dealId: dealId === '' ? null : parseInt(dealId),
      content,
    }
    const url = editId === null ? `/api/hospitals/${code}/sales/activities` : `/api/hospitals/${code}/sales/activities/${editId}`
    const res = await fetch(url, { method: editId === null ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setBusy(false)
    if (!res.ok) { setError((await res.json()).error ?? '저장에 실패했습니다.'); return }
    setFormOpen(false)
    onSaved()
  }

  const remove = async (a: Activity) => {
    if (!confirm('이 영업일지를 삭제할까요?')) return
    const res = await fetch(`/api/hospitals/${code}/sales/activities/${a.id}`, { method: 'DELETE' })
    if (!res.ok) { alert((await res.json()).error ?? '삭제에 실패했습니다.'); return }
    onSaved()
  }

  return (
    <Card title="영업일지" action={<button onClick={openNew} className={btnPrimary}>일지 작성</button>}>
      {formOpen && (
        <div className="border-b border-gray-100 bg-gray-50 px-6 py-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><label className={labelCls}>활동일 *</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></div>
            <div>
              <label className={labelCls}>활동 유형</label>
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={inputCls}>
                <option value="">선택 안 함</option>
                {(masters.codes['SALES_ACTIVITY_TYPE'] ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>관련 딜</label>
              <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={inputCls} disabled={editId !== null}>
                <option value="">연결 안 함</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.roundNo}차 · {d.dealCode}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className={labelCls}>내용 *</label>
            <RichTextEditor value={content} onChange={setContent} />
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={busy} className={btnPrimary}>{editId === null ? '등록' : '저장'}</button>
            <button onClick={() => setFormOpen(false)} className={btnGhost}>취소</button>
          </div>
        </div>
      )}
      {activities.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">작성된 영업일지가 없습니다.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {activities.map((a) => (
            <div key={a.id} className="px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-800">{fmtDate(a.activityDate)}</span>
                  {a.activityType && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700">{a.activityType.name}</span>}
                  {a.deal && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700">{a.deal.roundNo}차 딜</span>}
                  {a.author && <span>{a.author.name}</span>}
                </div>
                {(currentUserId !== null && a.author?.id === currentUserId) && (
                  <div className="text-xs">
                    <button onClick={() => openEdit(a)} className="text-blue-600 hover:underline">수정</button>
                    <button onClick={() => remove(a)} className="ml-2 text-red-500 hover:underline">삭제</button>
                  </div>
                )}
              </div>
              <div className="prose prose-sm mt-2 max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: a.content }} />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── 메인 ───

export default function SalesSection({ hospitalCode, currentUserId }: { hospitalCode: string; currentUserId: string | null }) {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/hospitals/${hospitalCode}/sales`)
    if (!res.ok) {
      setError(res.status === 403 ? null : '영업 정보를 불러오지 못했습니다.')
      setLoading(false)
      return
    }
    setData(await res.json())
    setLoading(false)
  }, [hospitalCode])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-white px-6 py-8 text-center text-sm text-gray-400 shadow-sm">
        영업 정보 로딩 중…
      </div>
    )
  }
  if (!data) {
    return error ? (
      <div className="mt-4 rounded-lg border border-gray-200 bg-white px-6 py-8 text-center text-sm text-red-500 shadow-sm">{error}</div>
    ) : null
  }

  return (
    <div>
      <div className="mt-6 flex items-center gap-2">
        <h2 className="text-base font-bold text-gray-800">영업 정보</h2>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">ADMIN 전용</span>
      </div>
      <ProfileCard code={hospitalCode} profile={data.profile} introBeds={data.introBeds} onSaved={load} />
      <ContactsCard code={hospitalCode} contacts={data.contacts} onSaved={load} />
      <ChannelsCard code={hospitalCode} channels={data.channels} masters={data.masters} onSaved={load} />
      <DealsCard code={hospitalCode} deals={data.deals} masters={data.masters} onSaved={load} />
      <ActivitiesCard code={hospitalCode} activities={data.activities} deals={data.deals} masters={data.masters} currentUserId={currentUserId} onSaved={load} />
    </div>
  )
}
