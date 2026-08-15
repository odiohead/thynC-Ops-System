'use client'

/**
 * VOC 접수 등록/수정 공용 폼 (cs_ticket_workflow_design.md §5 — 2026-08-15 개정)
 * 담당 배정은 티켓이 단독 소유 — 폼에는 담당자 지정 없음 (생성자는 서버가 기록)
 */
import { useState, useEffect } from 'react'

export interface VocFormValue {
  title: string
  hospitalCode: string
  hospitalName: string
  hospitalNameRaw: string
  customerName: string
  customerPhone: string
  channelId: number | ''
  vocTypeId: number | ''
  statusId: number | ''
  receivedAt: string // datetime-local
  content: string
}

interface CodeRef { id: number; name: string; color: string | null }
interface HospitalOpt { hospitalCode: string; hospitalName: string; hiraHospitalName: string | null }

export function nowLocalKst(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16).replace(' ', 'T')
}

export const emptyVocForm: VocFormValue = {
  title: '',
  hospitalCode: '',
  hospitalName: '',
  hospitalNameRaw: '',
  customerName: '',
  customerPhone: '',
  channelId: '',
  vocTypeId: '',
  statusId: '',
  receivedAt: '',
  content: '',
}

export default function VocForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  submitLabel,
  statusEmptyLabel = '접수 (기본)',
}: {
  value: VocFormValue
  onChange: (v: VocFormValue) => void
  onSubmit: () => void
  onCancel?: () => void
  busy: boolean
  submitLabel: string
  /** 상태 빈 선택의 의미 표기 — 등록: '접수 (기본)' / 수정: '현재 상태 유지' */
  statusEmptyLabel?: string
}) {
  const [channels, setChannels] = useState<CodeRef[]>([])
  const [types, setTypes] = useState<CodeRef[]>([])
  const [statuses, setStatuses] = useState<CodeRef[]>([])

  const [hospitalQ, setHospitalQ] = useState('')
  const [hospitalOpts, setHospitalOpts] = useState<HospitalOpt[]>([])
  const [hospitalSearching, setHospitalSearching] = useState(false)

  useEffect(() => {
    fetch('/api/settings/voc-type').then((r) => (r.ok ? r.json() : null)).then((d) => setTypes(d?.statusCodes ?? []))
    fetch('/api/settings/voc-status').then((r) => (r.ok ? r.json() : null)).then((d) => setStatuses(d?.statusCodes ?? []))
    fetch('/api/voc-masters/channels').then((r) => (r.ok ? r.json() : null)).then((d) => setChannels(d?.statusCodes ?? []))
  }, [])

  async function searchHospitals() {
    if (!hospitalQ.trim()) return
    setHospitalSearching(true)
    const res = await fetch(`/api/hospitals?search=${encodeURIComponent(hospitalQ)}&limit=20`)
    if (res.ok) {
      const d = await res.json()
      setHospitalOpts(d.hospitals ?? [])
    }
    setHospitalSearching(false)
  }

  const set = (patch: Partial<VocFormValue>) => onChange({ ...value, ...patch })

  const label = 'text-xs font-medium text-gray-500'
  const input = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'

  return (
    <div className="space-y-4">
      <div>
        <label className={label}>제목 *</label>
        <input type="text" value={value.title} onChange={(e) => set({ title: e.target.value })} placeholder="VOC 사건을 한 줄로" className={input} />
      </div>

      <div>
        <label className={label}>병원</label>
        {value.hospitalCode ? (
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-md bg-blue-50 px-2.5 py-1.5 text-sm text-blue-800">{value.hospitalName}</span>
            <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => set({ hospitalCode: '', hospitalName: '' })}>변경</button>
          </div>
        ) : (
          <>
            <div className="mt-1 flex gap-1.5">
              <input
                type="text"
                value={hospitalQ}
                onChange={(e) => setHospitalQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchHospitals())}
                placeholder="병원명 검색 (비고객이면 아래 직접 입력)"
                className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
              />
              <button type="button" onClick={searchHospitals} disabled={hospitalSearching || !hospitalQ.trim()} className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">검색</button>
            </div>
            {hospitalOpts.length > 0 && (
              <div className="mt-1 max-h-36 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                {hospitalOpts.map((h) => (
                  <button
                    key={h.hospitalCode}
                    type="button"
                    className="block w-full px-2.5 py-1.5 text-left text-sm hover:bg-blue-50"
                    onClick={() => { set({ hospitalCode: h.hospitalCode, hospitalName: h.hospitalName || h.hiraHospitalName || h.hospitalCode }); setHospitalOpts([]) }}
                  >
                    {h.hospitalName || h.hiraHospitalName}
                    <span className="ml-1.5 font-mono text-xs text-gray-400">{h.hospitalCode}</span>
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              value={value.hospitalNameRaw}
              onChange={(e) => set({ hospitalNameRaw: e.target.value })}
              placeholder="병원명 직접 입력 (비고객 VOC)"
              className="mt-1.5 w-full rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 text-sm"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>고객명</label>
          <input type="text" value={value.customerName} onChange={(e) => set({ customerName: e.target.value })} className={input} />
        </div>
        <div>
          <label className={label}>고객 연락처</label>
          <input type="text" value={value.customerPhone} onChange={(e) => set({ customerPhone: e.target.value })} className={input} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className={label}>접수 채널</label>
          <select value={value.channelId} onChange={(e) => set({ channelId: e.target.value ? parseInt(e.target.value) : '' })} className={input}>
            <option value="">선택</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>VOC 분류</label>
          <select value={value.vocTypeId} onChange={(e) => set({ vocTypeId: e.target.value ? parseInt(e.target.value) : '' })} className={input}>
            <option value="">선택</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>상태</label>
          <select value={value.statusId} onChange={(e) => set({ statusId: e.target.value ? parseInt(e.target.value) : '' })} className={input}>
            <option value="">{statusEmptyLabel}</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>접수 일시</label>
          <input type="datetime-local" value={value.receivedAt} onChange={(e) => set({ receivedAt: e.target.value })} className={input} />
        </div>
      </div>

      <div>
        <label className={label}>내용</label>
        <textarea value={value.content} onChange={(e) => set({ content: e.target.value })} rows={5} placeholder="고객이 제기한 내용" className={input} />
      </div>

      <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !value.title.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '저장 중...' : submitLabel}
        </button>
      </div>
    </div>
  )
}
