'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import RichTextEditor from '@/app/components/RichTextEditor'
import FieldEngineerSelectModal from '@/app/components/FieldEngineerSelectModal'

interface Hospital {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName: string
}

interface InstallPlanFileItem {
  id?: number
  fileCategory: string
  fileName: string
  s3Key: string
}

interface InstallPlanData {
  id: number
  planCode?: string | null
  hospitalCode: string | null
  hospital: Hospital | null
  requestDate: string | null
  writeStatus: string
  replyStatus: string
  assignees: { user: { id: string; name: string; email: string } }[]
  replyDate: string | null
  note: string | null
  files?: InstallPlanFileItem[]
}

interface Props {
  initialData?: InstallPlanData
  mode: 'new' | 'edit'
  initialHospitalCode?: string
  initialHospital?: Hospital | null
  canEdit?: boolean
}

const STATUS_OPTIONS = ['-', '미완료', '완료']

// ─── FileField 컴포넌트 ───────────────────────────────────────────────────────

interface FileFieldProps {
  label: string
  fileCategory: string
  installPlanId: number
  savedFiles: InstallPlanFileItem[]
  onSavedFilesChange: (files: InstallPlanFileItem[]) => void
  canEdit: boolean
}

function FileField({ label, fileCategory, installPlanId, savedFiles, onSavedFilesChange, canEdit }: FileFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const displayFiles = savedFiles.filter((f) => f.fileCategory === fileCategory)

  async function handleDownload(s3Key: string) {
    const res = await fetch(`/api/install-plans/file-url?key=${encodeURIComponent(s3Key)}`)
    if (!res.ok) return
    const { url } = await res.json()
    window.open(url, '_blank')
  }

  async function handleDelete(file: InstallPlanFileItem) {
    if (!file.id || !confirm('정말 삭제하시겠습니까?')) return
    setDeletingId(file.id)
    const res = await fetch(`/api/install-plans/${installPlanId}/files/${file.id}`, { method: 'DELETE' })
    if (res.ok) {
      onSavedFilesChange(savedFiles.filter((f) => f.id !== file.id))
    }
    setDeletingId(null)
  }

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      for (const file of selected) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('fileCategory', fileCategory)
        const res = await fetch(`/api/install-plans/${installPlanId}/files`, { method: 'POST', body: formData })
        if (res.ok) {
          const data = await res.json()
          onSavedFilesChange([...savedFiles, data.file])
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
            <li key={f.s3Key} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
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
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleDelete(f)}
                  disabled={deletingId === f.id}
                  className="ml-3 shrink-0 text-xs text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deletingId === f.id ? '삭제 중...' : '삭제'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
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
            disabled={uploading}
            onClick={() => { if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click() } }}
            className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? '업로드 중...' : `+ ${label} 추가`}
          </button>
        </div>
      )}
      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
    </div>
  )
}

// ─── 메인 폼 ─────────────────────────────────────────────────────────────────

export default function InstallPlanForm({ initialData, mode, initialHospitalCode, initialHospital, canEdit = true }: Props) {
  const router = useRouter()

  const [hospitalCode, setHospitalCode] = useState(initialData?.hospitalCode ?? initialHospitalCode ?? '')
  const [hospital, setHospital] = useState<Hospital | null>(initialData?.hospital ?? initialHospital ?? null)
  const [requestDate, setRequestDate] = useState(initialData?.requestDate?.slice(0, 10) ?? '')
  const [writeStatus, setWriteStatus] = useState(initialData?.writeStatus ?? (mode === 'new' ? '미완료' : '-'))
  const [replyStatus, setReplyStatus] = useState(initialData?.replyStatus ?? (mode === 'new' ? '미완료' : '-'))
  const [assignees, setAssignees] = useState<{ id: string; name: string; email: string }[]>(
    (initialData?.assignees ?? []).map((a) => a.user)
  )
  const [assigneeModalOpen, setAssigneeModalOpen] = useState(false)
  const [replyDate, setReplyDate] = useState(initialData?.replyDate?.slice(0, 10) ?? '')
  const [note, setNote] = useState(initialData?.note ?? '')
  const [files, setFiles] = useState<InstallPlanFileItem[]>(initialData?.files ?? [])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 병원 검색 모달
  const [hospitalModalOpen, setHospitalModalOpen] = useState(false)
  const [hospitalSearch, setHospitalSearch] = useState('')
  const [hospitalResults, setHospitalResults] = useState<Hospital[]>([])
  const [hospitalSearching, setHospitalSearching] = useState(false)


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
    setHospitalCode(h.hospitalCode)
    setHospitalModalOpen(false)
    setHospitalSearch('')
    setHospitalResults([])
  }

  function clearHospital() {
    setHospital(null)
    setHospitalCode('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const body = {
      hospitalCode: hospitalCode || null,
      requestDate: requestDate || null,
      writeStatus,
      replyStatus,
      assigneeIds: assignees.map((a) => a.id),
      replyDate: replyDate || null,
      note: note || null,
    }

    const url = mode === 'new' ? '/api/install-plans' : `/api/install-plans/${initialData!.id}`
    const method = mode === 'new' ? 'POST' : 'PUT'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? '저장에 실패했습니다.')
      setSaving(false)
      return
    }

    router.refresh()
    router.push('/install-plans')
  }

  const labelClass = 'block text-sm font-medium text-gray-700'
  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const selectClass = inputClass

  const isEditMode = mode === 'edit' && !!initialData?.id
  const hasHospital = !!hospitalCode

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* 병원 매핑 */}
        <div>
          <label className={labelClass}>병원 (선택사항)</label>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 bg-gray-50 min-h-[38px]">
              {hospital
                ? (hospital.hospitalName || hospital.hiraHospitalName)
                : <span className="text-gray-400">병원 미매핑</span>}
            </div>
            <button
              type="button"
              onClick={() => setHospitalModalOpen(true)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {hospital ? '변경' : '병원 선택'}
            </button>
            {hospital && (
              <button
                type="button"
                onClick={clearHospital}
                className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                해제
              </button>
            )}
          </div>
        </div>

        {/* 요청일 */}
        <div>
          <label className={labelClass}>요청일</label>
          <input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} className={inputClass} />
        </div>

        {/* 작성완료여부 + 회신여부 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>작성완료여부</label>
            <select value={writeStatus} onChange={(e) => setWriteStatus(e.target.value)} className={selectClass}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>회신여부</label>
            <select value={replyStatus} onChange={(e) => setReplyStatus(e.target.value)} className={selectClass}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* 담당자 */}
        <div>
          <label className={labelClass}>담당자 (씨어스)</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {assignees.length === 0 ? (
              <span className="text-sm text-gray-400">-</span>
            ) : (
              assignees.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                  {a.name}
                  <button
                    type="button"
                    onClick={() => setAssignees((prev) => prev.filter((x) => x.id !== a.id))}
                    className="ml-0.5 text-blue-400 hover:text-blue-600"
                  >
                    ×
                  </button>
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

        {/* 회신일 */}
        <div>
          <label className={labelClass}>회신일</label>
          <input type="date" value={replyDate} onChange={(e) => setReplyDate(e.target.value)} className={inputClass} />
        </div>

        {/* 비고 */}
        <div>
          <label className={labelClass}>비고</label>
          <div className="mt-1">
            <RichTextEditor value={note} onChange={setNote} placeholder="비고를 입력하세요..." />
          </div>
        </div>

        {/* 버튼 */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push('/install-plans')}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? '저장 중...' : mode === 'new' ? '등록' : '수정'}
          </button>
        </div>
      </form>

      {/* 파일 첨부 (edit 모드 + 병원 매핑된 경우에만 표시) */}
      {isEditMode && (
        <div className="mt-8 space-y-6 border-t border-gray-200 pt-6">
          {!hasHospital && (
            <p className="text-sm text-amber-600">병원을 매핑하면 파일을 첨부할 수 있습니다.</p>
          )}
          {hasHospital && (
            <>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">도면</p>
                <FileField
                  label="도면"
                  fileCategory="FLOOR_PLAN"
                  installPlanId={initialData!.id}
                  savedFiles={files}
                  onSavedFilesChange={setFiles}
                  canEdit={canEdit}
                />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">설치계획서</p>
                <FileField
                  label="설치계획서"
                  fileCategory="INSTALL_PLAN"
                  installPlanId={initialData!.id}
                  savedFiles={files}
                  onSavedFilesChange={setFiles}
                  canEdit={canEdit}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* 담당자 선택 모달 */}
      <FieldEngineerSelectModal
        isOpen={assigneeModalOpen}
        onClose={() => setAssigneeModalOpen(false)}
        onSelect={(selected) => setAssignees(selected)}
        currentAssigneeIds={assignees.map((a) => a.id)}
        workType="INSTALL_PLAN"
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
                    {hospitalSearching ? '검색 중...' : '검색 결과가 없습니다.'}
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
