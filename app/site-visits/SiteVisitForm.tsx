'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import RichTextEditor from '@/app/components/RichTextEditor'

interface Hospital {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName: string
}

interface DaewoongUser {
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
  daewoongUserId: string
  assigneeId: string
  requestDate: string
  visitDate: string
  replyDate: string
  statusId: string
  installPlanS3Key: string
  floorPlanS3Key: string
  notes: string
}

interface Props {
  initialData?: Partial<SiteVisitFormData> & { id?: number }
  mode: 'create' | 'edit'
}


interface FileFieldProps {
  s3Key: string
  onUploadComplete: (s3Key: string) => void
  onDeleteComplete: () => void
  hospitalCode: string
  busy: boolean
  isAdmin: boolean
}

function FileField({ s3Key, onUploadComplete, onDeleteComplete, hospitalCode, busy, isAdmin }: FileFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const fileName = s3Key ? s3Key.split('/').pop() ?? s3Key : null

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

    try {
      const res = await fetch(`/api/site-visits/upload?hospitalCode=${encodeURIComponent(hospitalCode)}`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        onUploadComplete(data.s3Key)
      } else {
        const data = await res.json()
        setUploadError(data.error ?? '업로드 실패')
      }
    } catch {
      setUploadError('업로드 중 오류가 발생했습니다.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleDownload() {
    if (!s3Key) return
    const res = await fetch(`/api/site-visits/file-url?key=${encodeURIComponent(s3Key)}`)
    if (!res.ok) return
    const { url } = await res.json()
    window.open(url, '_blank')
  }

  async function handleDelete() {
    if (!confirm('정말 삭제하시겠습니까?')) return
    if (!s3Key) return
    setDeleting(true)
    await fetch('/api/site-visits/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ s3Key }),
    })
    setDeleting(false)
    onDeleteComplete()
  }

  return (
    <div className="space-y-2">
      {s3Key && fileName ? (
        <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-400">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
            <button
              type="button"
              onClick={handleDownload}
              className="truncate text-xs text-blue-600 hover:underline text-left"
            >
              {fileName}
            </button>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || busy}
              className="ml-3 shrink-0 text-xs text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting ? '삭제 중...' : '삭제'}
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400">등록된 파일이 없습니다.</p>
      )}
      <div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          disabled={uploading || busy}
          onClick={() => { if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click() } }}
          className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {uploading ? '업로드 중...' : '+ 파일 추가'}
        </button>
      </div>
      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
    </div>
  )
}

export default function SiteVisitForm({ initialData, mode }: Props) {
  const router = useRouter()
  const [hospitals, setHospitals] = useState<Hospital[]>([])
  const [daewoongUsers, setDaewoongUsers] = useState<DaewoongUser[]>([])
  const [users, setUsers] = useState<UserItem[]>([])
  const [statuses, setStatuses] = useState<StatusCode[]>([])
  const [userRole, setUserRole] = useState<string | null>(null)

  const [form, setForm] = useState<SiteVisitFormData>({
    hospitalCode: initialData?.hospitalCode ?? '',
    daewoongUserId: initialData?.daewoongUserId ?? '',
    assigneeId: initialData?.assigneeId ?? '',
    requestDate: initialData?.requestDate ?? '',
    visitDate: initialData?.visitDate ?? '',
    replyDate: initialData?.replyDate ?? '',
    statusId: initialData?.statusId ?? '',
    installPlanS3Key: initialData?.installPlanS3Key ?? '',
    floorPlanS3Key: initialData?.floorPlanS3Key ?? '',
    notes: initialData?.notes ?? '',
  })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN'

  useEffect(() => {
    Promise.all([
      fetch('/api/hospitals?limit=999').then((r) => r.json()),
      fetch('/api/users?organization=DAEWOONG').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/settings/site-visit-status').then((r) => r.json()),
      fetch('/api/auth/me').then((r) => r.json()),
    ]).then(([hData, dData, uData, stData, meData]) => {
      setHospitals(hData.hospitals ?? [])
      setDaewoongUsers(dData ?? [])
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
      daewoongUserId: form.daewoongUserId || null,
      assigneeId: form.assigneeId || null,
      requestDate: form.requestDate || null,
      visitDate: form.visitDate || null,
      replyDate: form.replyDate || null,
      statusId: form.statusId ? Number(form.statusId) : null,
      installPlanS3Key: form.installPlanS3Key || null,
      floorPlanS3Key: form.floorPlanS3Key || null,
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
              <select value={form.daewoongUserId} onChange={(e) => set('daewoongUserId', e.target.value)} className={selectClass}>
                <option value="">선택 없음</option>
                {daewoongUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
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
            <label className="flex items-start pt-1 text-sm font-medium text-gray-700">설치계획서</label>
            <div className="col-span-2">
              <FileField
                s3Key={form.installPlanS3Key}
                onUploadComplete={(s3Key) => set('installPlanS3Key', s3Key)}
                onDeleteComplete={() => set('installPlanS3Key', '')}
                hospitalCode={form.hospitalCode}
                busy={busy}
                isAdmin={isAdmin}
              />
            </div>
          </div>

          {/* 도면 */}
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <label className="flex items-start pt-1 text-sm font-medium text-gray-700">도면</label>
            <div className="col-span-2">
              <FileField
                s3Key={form.floorPlanS3Key}
                onUploadComplete={(s3Key) => set('floorPlanS3Key', s3Key)}
                onDeleteComplete={() => set('floorPlanS3Key', '')}
                hospitalCode={form.hospitalCode}
                busy={busy}
                isAdmin={isAdmin}
              />
            </div>
          </div>

          {/* 비고 */}
          <div className="px-6 py-4">
            <label className="mb-2 block text-sm font-medium text-gray-700">비고</label>
            <RichTextEditor
              value={form.notes}
              onChange={(v) => set('notes', v)}
              placeholder="비고를 입력하세요."
            />
          </div>

        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          {mode === 'edit' && isAdmin && (
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
