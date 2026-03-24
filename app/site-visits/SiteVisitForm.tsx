'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface Hospital {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName: string
}

interface DaewoongStaff {
  id: string
  name: string
}

interface UserItem {
  id: string
  name: string
  role: string
}

interface StatusCode {
  id: number
  name: string
  color: string | null
}

interface SiteVisitFormData {
  hospitalCode: string
  daewoongStaffId: string
  assigneeId: string
  requestDate: string
  visitDate: string
  replyDate: string
  statusId: string
  installPlanUrl: string
  installPlanFileId: string
  floorPlanUrl: string
  floorPlanFileId: string
  notes: string
}

interface Props {
  initialData?: Partial<SiteVisitFormData> & { id?: number }
  mode: 'create' | 'edit'
}

function NoteEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      placeholder="비고를 입력하세요."
    />
  )
}

interface FileFieldProps {
  label: string
  currentUrl: string
  currentFileId: string
  onUpload: (url: string, fileId: string) => void
  onDelete: () => void
  hospitalCode: string
  busy: boolean
}

function FileField({ label, currentUrl, currentFileId, onUpload, onDelete, hospitalCode, busy }: FileFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!hospitalCode) {
      setUploadError('병원을 먼저 선택해주세요.')
      return
    }

    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('hospitalCode', hospitalCode)

    const res = await fetch('/api/site-visits/upload', { method: 'POST', body: formData })
    if (res.ok) {
      const data = await res.json()
      onUpload(data.webViewLink, data.fileId)
    } else {
      const data = await res.json()
      setUploadError(data.error ?? '업로드 실패')
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleDelete() {
    if (!confirm(`${label} 파일을 삭제하시겠습니까?`)) return
    if (currentFileId) {
      await fetch(`/api/drive/delete?fileId=${currentFileId}`, { method: 'DELETE' })
    }
    onDelete()
  }

  return (
    <div>
      {currentUrl ? (
        <div className="flex items-center gap-3">
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            현재 파일 보기
          </a>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy || uploading}
            className="text-xs text-red-500 hover:underline disabled:opacity-50"
          >
            파일 삭제
          </button>
          <span className="text-xs text-gray-400">또는 새 파일 업로드:</span>
          <input
            ref={inputRef}
            type="file"
            onChange={handleFileChange}
            disabled={busy || uploading}
            className="text-sm text-gray-600"
          />
        </div>
      ) : (
        <input
          ref={inputRef}
          type="file"
          onChange={handleFileChange}
          disabled={busy || uploading}
          className="text-sm text-gray-600"
        />
      )}
      {uploading && <p className="mt-1 text-xs text-gray-400">업로드 중...</p>}
      {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
    </div>
  )
}

export default function SiteVisitForm({ initialData, mode }: Props) {
  const router = useRouter()
  const [hospitals, setHospitals] = useState<Hospital[]>([])
  const [staff, setStaff] = useState<DaewoongStaff[]>([])
  const [users, setUsers] = useState<UserItem[]>([])
  const [statuses, setStatuses] = useState<StatusCode[]>([])
  const [userRole, setUserRole] = useState<string | null>(null)

  const [form, setForm] = useState<SiteVisitFormData>({
    hospitalCode: initialData?.hospitalCode ?? '',
    daewoongStaffId: initialData?.daewoongStaffId ?? '',
    assigneeId: initialData?.assigneeId ?? '',
    requestDate: initialData?.requestDate ?? '',
    visitDate: initialData?.visitDate ?? '',
    replyDate: initialData?.replyDate ?? '',
    statusId: initialData?.statusId ?? '',
    installPlanUrl: initialData?.installPlanUrl ?? '',
    installPlanFileId: initialData?.installPlanFileId ?? '',
    floorPlanUrl: initialData?.floorPlanUrl ?? '',
    floorPlanFileId: initialData?.floorPlanFileId ?? '',
    notes: initialData?.notes ?? '',
  })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/hospitals?limit=999').then((r) => r.json()),
      fetch('/api/daewoong-staff').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/settings/site-visit-status').then((r) => r.json()),
      fetch('/api/auth/me').then((r) => r.json()),
    ]).then(([hData, sData, uData, stData, meData]) => {
      setHospitals(hData.hospitals ?? [])
      setStaff(sData.staff ?? [])
      setUsers((uData ?? []).filter((u: UserItem) => u.role === 'USER'))
      setStatuses(stData.statusCodes ?? [])
      setUserRole(meData?.role ?? null)
    })
  }, [])

  function set(field: keyof SiteVisitFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.hospitalCode) { setError('병원을 선택해주세요.'); return }
    setBusy(true)
    setError(null)

    const payload = {
      hospitalCode: form.hospitalCode,
      daewoongStaffId: form.daewoongStaffId || null,
      assigneeId: form.assigneeId || null,
      requestDate: form.requestDate || null,
      visitDate: form.visitDate || null,
      replyDate: form.replyDate || null,
      statusId: form.statusId ? Number(form.statusId) : null,
      installPlanUrl: form.installPlanUrl || null,
      installPlanFileId: form.installPlanFileId || null,
      floorPlanUrl: form.floorPlanUrl || null,
      floorPlanFileId: form.floorPlanFileId || null,
      notes: form.notes || null,
    }

    const url = mode === 'create' ? '/api/site-visits' : `/api/site-visits/${initialData?.id}`
    const method = mode === 'create' ? 'POST' : 'PUT'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      router.refresh()
      router.push('/site-visits')
    } else {
      const data = await res.json()
      setError(data.error ?? '저장 실패')
    }
    setBusy(false)
  }

  async function handleDelete() {
    if (!confirm('이 답사를 삭제하시겠습니까?')) return
    setBusy(true)
    const res = await fetch(`/api/site-visits/${initialData?.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      router.push('/site-visits')
    } else {
      const data = await res.json()
      setError(data.error ?? '삭제 실패')
      setBusy(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const selectClass = inputClass

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="divide-y divide-gray-100">

          {/* 병원명 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-center text-sm font-medium text-gray-700">
              병원명 <span className="ml-1 text-red-500">*</span>
            </label>
            <div className="col-span-2">
              <select
                value={form.hospitalCode}
                onChange={(e) => set('hospitalCode', e.target.value)}
                required
                className={selectClass}
              >
                <option value="">병원 선택</option>
                {hospitals.map((h) => (
                  <option key={h.hospitalCode} value={h.hospitalCode}>
                    {h.hospitalName || h.hiraHospitalName} ({h.hospitalCode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 대웅 담당자 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-center text-sm font-medium text-gray-700">대웅 담당자</label>
            <div className="col-span-2">
              <select value={form.daewoongStaffId} onChange={(e) => set('daewoongStaffId', e.target.value)} className={selectClass}>
                <option value="">선택 없음</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 담당자 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-center text-sm font-medium text-gray-700">담당자</label>
            <div className="col-span-2">
              <select value={form.assigneeId} onChange={(e) => set('assigneeId', e.target.value)} className={selectClass}>
                <option value="">선택 없음</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 상태 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-center text-sm font-medium text-gray-700">상태</label>
            <div className="col-span-2">
              <select value={form.statusId} onChange={(e) => set('statusId', e.target.value)} className={selectClass}>
                <option value="">선택 없음</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 요청일 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-center text-sm font-medium text-gray-700">요청일</label>
            <div className="col-span-2">
              <input type="date" value={form.requestDate} onChange={(e) => set('requestDate', e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* 답사 날짜 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-center text-sm font-medium text-gray-700">답사 날짜</label>
            <div className="col-span-2">
              <input type="date" value={form.visitDate} onChange={(e) => set('visitDate', e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* 회신 날짜 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-center text-sm font-medium text-gray-700">회신 날짜</label>
            <div className="col-span-2">
              <input type="date" value={form.replyDate} onChange={(e) => set('replyDate', e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* 설치계획서 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-center text-sm font-medium text-gray-700">설치계획서</label>
            <div className="col-span-2">
              <FileField
                label="설치계획서"
                currentUrl={form.installPlanUrl}
                currentFileId={form.installPlanFileId}
                onUpload={(url, fileId) => { set('installPlanUrl', url); set('installPlanFileId', fileId) }}
                onDelete={() => { set('installPlanUrl', ''); set('installPlanFileId', '') }}
                hospitalCode={form.hospitalCode}
                busy={busy}
              />
            </div>
          </div>

          {/* 도면 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-center text-sm font-medium text-gray-700">도면</label>
            <div className="col-span-2">
              <FileField
                label="도면"
                currentUrl={form.floorPlanUrl}
                currentFileId={form.floorPlanFileId}
                onUpload={(url, fileId) => { set('floorPlanUrl', url); set('floorPlanFileId', fileId) }}
                onDelete={() => { set('floorPlanUrl', ''); set('floorPlanFileId', '') }}
                hospitalCode={form.hospitalCode}
                busy={busy}
              />
            </div>
          </div>

          {/* 비고 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-start pt-1 text-sm font-medium text-gray-700">비고</label>
            <div className="col-span-2">
              <NoteEditor value={form.notes} onChange={(v) => set('notes', v)} />
            </div>
          </div>

        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          {mode === 'edit' && userRole === 'ADMIN' && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              삭제
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push('/site-visits')}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '저장 중...' : mode === 'create' ? '등록' : '저장'}
          </button>
        </div>
      </div>
    </form>
  )
}
