'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import RichTextEditor from '@/app/components/RichTextEditor'
import FieldEngineerSelectModal from '@/app/components/FieldEngineerSelectModal'
import MaintenanceVisitPicker, { type VisitInput } from './MaintenanceVisitPicker'

interface Hospital {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName: string
}

interface StatusCode {
  id: number
  name: string
  color: string | null
}

interface MaintenanceFileItem {
  id?: number
  fileCategory: string
  fileName: string
  s3Key: string
}

interface MaintenanceFormData {
  hospitalCode: string
  typeId: string
  statusId: string
  priority: string
  title: string
  reporterName: string
  isRemote: boolean
  reportedAt: string
  resolvedAt: string
  symptoms: string
  cause: string
  resolution: string
  notes: string
}

interface Props {
  initialData?: Partial<MaintenanceFormData> & {
    id?: number
    files?: MaintenanceFileItem[]
    assignees?: { user: { id: string; name: string; email: string } }[]
    visits?: VisitInput[]
  }
  mode: 'create' | 'edit'
}

// ─── MultiFileField 컴포넌트 ───────────────────────────────────────────────────

interface MultiFileFieldProps {
  label: string
  fileCategory: string
  maintenanceId?: number
  busy: boolean
  isAdmin: boolean
  savedFiles?: MaintenanceFileItem[]
  onSavedFilesChange?: (files: MaintenanceFileItem[]) => void
}

function MultiFileField({
  label,
  fileCategory,
  maintenanceId,
  busy,
  isAdmin,
  savedFiles,
  onSavedFilesChange,
}: MultiFileFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const displayFiles = savedFiles ?? []

  async function handleDownload(s3Key: string) {
    const res = await fetch(`/api/maintenances/file-url?key=${encodeURIComponent(s3Key)}`)
    if (!res.ok) return
    const { url } = await res.json()
    window.open(url, '_blank')
  }

  async function handleDelete(file: MaintenanceFileItem) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    setDeletingKey(file.s3Key)

    if (file.id && maintenanceId) {
      await fetch(`/api/maintenances/${maintenanceId}/files/${file.id}`, { method: 'DELETE' })
      onSavedFilesChange?.((savedFiles ?? []).filter((f) => f.id !== file.id))
    }

    setDeletingKey(null)
  }

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length === 0) return
    if (!maintenanceId) {
      setUploadError('저장 후 파일을 첨부할 수 있습니다.')
      return
    }

    setUploading(true)
    setUploadError(null)

    try {
      for (const file of selected) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('fileCategory', fileCategory)
        const res = await fetch(`/api/maintenances/${maintenanceId}/files`, {
          method: 'POST',
          body: formData,
        })
        if (res.ok) {
          const data = await res.json()
          onSavedFilesChange?.([...(savedFiles ?? []), data.file])
        } else {
          const data = await res.json()
          setUploadError(data.error ?? '업로드 실패')
        }
      }
    } catch {
      setUploadError('업로드 중 오류가 발생했습니다.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      {displayFiles.length === 0 ? (
        <p className="text-xs text-gray-400">등록된 파일이 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {displayFiles.map((f) => (
            <li
              key={f.s3Key}
              className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-400">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
                <button
                  type="button"
                  onClick={() => handleDownload(f.s3Key)}
                  className="truncate text-xs text-blue-600 hover:underline text-left"
                >
                  {f.fileName}
                </button>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => handleDelete(f)}
                  disabled={deletingKey === f.s3Key || busy}
                  className="ml-3 shrink-0 text-xs text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deletingKey === f.s3Key ? '삭제 중...' : '삭제'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {maintenanceId && (
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip"
            className="hidden"
            onChange={handleFilesSelected}
          />
          <button
            type="button"
            disabled={uploading || busy}
            onClick={() => { if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click() } }}
            className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? '업로드 중...' : `+ ${label} 추가`}
          </button>
        </div>
      )}
      {!maintenanceId && (
        <p className="text-xs text-gray-400">저장 후 파일을 첨부할 수 있습니다.</p>
      )}
      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
    </div>
  )
}

// ─── MaintenanceForm 본체 ────────────────────────────────────────────────────

export default function MaintenanceForm({ initialData, mode }: Props) {
  const router = useRouter()
  const [types, setTypes] = useState<StatusCode[]>([])
  const [statuses, setStatuses] = useState<StatusCode[]>([])
  const [userRole, setUserRole] = useState<string | null>(null)
  const [assignees, setAssignees] = useState<{ id: string; name: string; email: string }[]>(
    (initialData?.assignees ?? []).map((a) => a.user)
  )
  const [assigneeModalOpen, setAssigneeModalOpen] = useState(false)

  const [hospital, setHospital] = useState<Hospital | null>(null)
  const [hospitalModalOpen, setHospitalModalOpen] = useState(false)
  const [hospitalSearch, setHospitalSearch] = useState('')
  const [hospitalResults, setHospitalResults] = useState<Hospital[]>([])
  const [hospitalSearching, setHospitalSearching] = useState(false)

  const [form, setForm] = useState<MaintenanceFormData>({
    hospitalCode: initialData?.hospitalCode ?? '',
    typeId: initialData?.typeId ?? '',
    statusId: initialData?.statusId ?? '',
    priority: initialData?.priority ?? '보통',
    title: initialData?.title ?? '',
    reporterName: initialData?.reporterName ?? '',
    isRemote: initialData?.isRemote ?? false,
    reportedAt: initialData?.reportedAt ?? '',
    resolvedAt: initialData?.resolvedAt ?? '',
    symptoms: initialData?.symptoms ?? '',
    cause: initialData?.cause ?? '',
    resolution: initialData?.resolution ?? '',
    notes: initialData?.notes ?? '',
  })

  const [maintenanceFiles, setMaintenanceFiles] = useState<MaintenanceFileItem[]>(
    initialData?.files ?? []
  )

  const [visits, setVisits] = useState<VisitInput[]>(initialData?.visits ?? [])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = !!userRole && userRole !== 'VIEWER'
  const isEditMode = mode === 'edit'

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/maintenance-type').then((r) => r.json()),
      fetch('/api/settings/maintenance-status').then((r) => r.json()),
      fetch('/api/auth/me').then((r) => r.json()),
    ]).then(([tData, sData, meData]) => {
      setTypes(tData.statusCodes ?? [])
      const statusCodes = sData.statusCodes ?? []
      setStatuses(statusCodes)
      setUserRole(meData?.role ?? null)
      // create 모드: 상태 기본값 '접수'
      if (mode === 'create' && !initialData?.statusId) {
        const defaultStatus = statusCodes.find((s: StatusCode) => s.name === '접수')
        if (defaultStatus) setForm((prev) => ({ ...prev, statusId: String(defaultStatus.id) }))
      }
    })

    if (initialData?.hospitalCode) {
      fetch(`/api/hospitals/${initialData.hospitalCode}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.hospital) {
            setHospital({
              hospitalCode: data.hospital.hospitalCode,
              hospitalName: data.hospital.hospitalName,
              hiraHospitalName: data.hospital.hiraHospitalName,
            })
          }
        })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function searchHospitals() {
    if (!hospitalSearch.trim()) return
    setHospitalSearching(true)
    try {
      const res = await fetch(`/api/hospitals?search=${encodeURIComponent(hospitalSearch)}&limit=20`)
      const data = await res.json()
      setHospitalResults(data.hospitals ?? [])
    } finally {
      setHospitalSearching(false)
    }
  }

  function selectHospital(h: Hospital) {
    setHospital(h)
    setForm((prev) => ({ ...prev, hospitalCode: h.hospitalCode }))
    setHospitalModalOpen(false)
    setHospitalSearch('')
    setHospitalResults([])
  }

  function clearHospital() {
    setHospital(null)
    setForm((prev) => ({ ...prev, hospitalCode: '' }))
  }

  function set(field: keyof MaintenanceFormData, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.hospitalCode) { setError('병원을 선택해주세요.'); return }
    if (!form.title.trim()) { setError('제목을 입력해주세요.'); return }
    setBusy(true)
    setError(null)

    const payload = {
      hospitalCode: form.hospitalCode,
      typeId: form.typeId ? Number(form.typeId) : null,
      statusId: form.statusId ? Number(form.statusId) : null,
      priority: form.priority || '보통',
      title: form.title,
      reporterName: form.reporterName || null,
      isRemote: form.isRemote,
      reportedAt: form.reportedAt || null,
      visits: visits
        .filter((v) => v.startDate)
        .map((v) => ({ startDate: v.startDate, endDate: v.endDate || v.startDate })),
      resolvedAt: form.resolvedAt || null,
      symptoms: form.symptoms || null,
      cause: form.cause || null,
      resolution: form.resolution || null,
      notes: form.notes || null,
      assigneeIds: assignees.map((a) => a.id),
    }

    const url = mode === 'create' ? '/api/maintenances' : `/api/maintenances/${initialData?.id}`
    const method = mode === 'create' ? 'POST' : 'PUT'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      router.refresh()
      router.push('/maintenances')
    } else {
      const data = await res.json()
      setError(data.error ?? '저장 실패')
    }
    setBusy(false)
  }

  async function handleDelete() {
    if (!confirm('이 유지보수를 삭제하시겠습니까?')) return
    setBusy(true)
    const res = await fetch(`/api/maintenances/${initialData?.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      router.push('/maintenances')
    } else {
      const data = await res.json()
      setError(data.error ?? '삭제 실패')
      setBusy(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const selectClass = inputClass

  return (
    <>
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
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 bg-gray-50 min-h-[38px]">
                    {hospital ? (
                      <span>
                        {hospital.hospitalName || hospital.hiraHospitalName}
                        <span className="ml-2 font-mono text-xs text-gray-400">({hospital.hospitalCode})</span>
                      </span>
                    ) : (
                      <span className="text-gray-400">병원을 선택해주세요</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setHospitalModalOpen(true)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {hospital ? '변경' : '병원 선택'}
                  </button>
                  {hospital && (
                    <button
                      type="button"
                      onClick={clearHospital}
                      className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      해제
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 제목 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-center text-sm font-medium text-gray-700">
                제목 <span className="ml-1 text-red-500">*</span>
              </label>
              <div className="col-span-2">
                <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} className={inputClass} placeholder="장애/유지보수 제목" />
              </div>
            </div>

            {/* 장애유형 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-center text-sm font-medium text-gray-700">장애유형</label>
              <div className="col-span-2">
                <select value={form.typeId} onChange={(e) => set('typeId', e.target.value)} className={selectClass}>
                  <option value="">선택 없음</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
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

            {/* 우선순위 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-center text-sm font-medium text-gray-700">우선순위</label>
              <div className="col-span-2">
                <select value={form.priority} onChange={(e) => set('priority', e.target.value)} className={selectClass}>
                  {['긴급', '높음', '보통', '낮음'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 신고자 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-center text-sm font-medium text-gray-700">신고자 (병원 측)</label>
              <div className="col-span-2">
                <input type="text" value={form.reporterName} onChange={(e) => set('reporterName', e.target.value)} className={inputClass} placeholder="병원 측 담당자명" />
              </div>
            </div>

            {/* 원격처리 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-center text-sm font-medium text-gray-700">원격처리</label>
              <div className="col-span-2 flex items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isRemote}
                    onChange={(e) => set('isRemote', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">원격으로 처리</span>
                </label>
              </div>
            </div>

            {/* 담당자 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-center text-sm font-medium text-gray-700">담당자</label>
              <div className="col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  {assignees.length === 0 ? (
                    <span className="text-sm text-gray-400">-</span>
                  ) : (
                    assignees.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                        {a.name}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setAssignees((prev) => prev.filter((x) => x.id !== a.id))}
                            className="ml-0.5 text-blue-400 hover:text-blue-600"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => setAssigneeModalOpen(true)}
                    className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    담당자 추가
                  </button>
                </div>
              </div>
            </div>

            {/* 접수일 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-center text-sm font-medium text-gray-700">접수일</label>
              <div className="col-span-2">
                <input type="date" value={form.reportedAt} onChange={(e) => set('reportedAt', e.target.value)} className={inputClass} />
              </div>
            </div>

            {/* 방문일정 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-start pt-2 text-sm font-medium text-gray-700">방문일정</label>
              <div className="col-span-2">
                <MaintenanceVisitPicker visits={visits} onChange={setVisits} />
              </div>
            </div>

            {/* 완료일 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-center text-sm font-medium text-gray-700">완료일</label>
              <div className="col-span-2">
                <input type="date" value={form.resolvedAt} onChange={(e) => set('resolvedAt', e.target.value)} className={inputClass} />
              </div>
            </div>

            {/* 증상 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-start pt-2 text-sm font-medium text-gray-700">증상</label>
              <div className="col-span-2">
                <textarea
                  rows={4}
                  value={form.symptoms}
                  onChange={(e) => set('symptoms', e.target.value)}
                  className={inputClass}
                  placeholder="장애 증상을 입력하세요."
                />
              </div>
            </div>

            {/* 원인 */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <label className="flex items-start pt-2 text-sm font-medium text-gray-700">원인</label>
              <div className="col-span-2">
                <textarea
                  rows={4}
                  value={form.cause}
                  onChange={(e) => set('cause', e.target.value)}
                  className={inputClass}
                  placeholder="장애 원인을 입력하세요."
                />
              </div>
            </div>

            {/* 조치 내용 */}
            <div className="px-6 py-4">
              <label className="mb-2 block text-sm font-medium text-gray-700">조치 내용</label>
              <RichTextEditor
                value={form.resolution}
                onChange={(v) => set('resolution', v)}
                placeholder="조치 내용을 입력하세요."
              />
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

            {/* 첨부파일 — edit 모드에서만 */}
            {isEditMode && (
              <div className="grid grid-cols-3 gap-4 px-6 py-4">
                <label className="flex items-start pt-1 text-sm font-medium text-gray-700">첨부파일</label>
                <div className="col-span-2">
                  <MultiFileField
                    label="파일"
                    fileCategory="MAINTENANCE_FILE"
                    maintenanceId={initialData?.id}
                    busy={busy}
                    isAdmin={isAdmin}
                    savedFiles={maintenanceFiles}
                    onSavedFilesChange={setMaintenanceFiles}
                  />
                </div>
              </div>
            )}

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
              onClick={() => router.push('/maintenances')}
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

      {/* 담당자 선택 모달 */}
      <FieldEngineerSelectModal
        isOpen={assigneeModalOpen}
        onClose={() => setAssigneeModalOpen(false)}
        onSelect={(selected) => setAssignees(selected)}
        currentAssigneeIds={assignees.map((a) => a.id)}
        workType="MAINTENANCE"
      />

      {/* 병원 검색 모달 */}
      {hospitalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">병원 검색</h2>
              <button
                type="button"
                onClick={() => { setHospitalModalOpen(false); setHospitalSearch(''); setHospitalResults([]) }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>
            <div className="p-5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={hospitalSearch}
                  onChange={(e) => setHospitalSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchHospitals())}
                  placeholder="병원명 검색..."
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={searchHospitals}
                  disabled={hospitalSearching}
                  className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
                >
                  검색
                </button>
              </div>
              <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-gray-100">
                {hospitalResults.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">
                    {hospitalSearching ? '검색 중...' : '검색어를 입력하고 검색 버튼을 눌러주세요.'}
                  </p>
                ) : (
                  hospitalResults.map((h) => (
                    <button
                      key={h.hospitalCode}
                      type="button"
                      onClick={() => selectHospital(h)}
                      className="flex w-full flex-col px-2 py-2.5 text-left hover:bg-blue-50"
                    >
                      <span className="text-sm font-medium text-gray-900">{h.hospitalName || h.hiraHospitalName}</span>
                      <span className="text-xs text-gray-400">{h.hospitalCode}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
