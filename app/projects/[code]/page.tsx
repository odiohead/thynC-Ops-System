'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import IssueNoteEditor from '@/app/components/IssueNoteEditor'

interface DeviceInfo {
  id: number
  deviceModel: string
  deviceName: string
  isActive: boolean
  sortOrder: number
}

interface ProjectDevice {
  id: number
  deviceInfoId: number
  quantity: number
  deviceInfo: DeviceInfo
}

interface ProjectFile {
  id: number
  fileCategory: string
  fileName: string
  driveUrl: string | null
  s3Key: string | null
  uploadedAt: string
}

interface ConstructorInfo {
  id: number
  code: string
  name: string
}

interface BuildStatusOption {
  id: number
  label: string
  color: string | null
}

interface Project {
  id: number
  projectCode: string
  projectName: string
  hospitalCode: string
  orderNumber: number
  contractDate: string | null
  contractType: string | null
  wardCount: number | null
  bedCount: number | null
  gatewayCount: number | null
  hasSurvey: boolean
  hasOrder: boolean
  builderUserId: string | null
  builderNameManual: string | null
  constructorId: number | null
  startDate: string | null
  endDateExpected: string | null
  buildStatusId: number | null
  issueNote: string | null
  remark: string | null
  driveFolderId: string | null
  hospital: { hospitalCode: string; hospitalName: string; meta: { driveProjectFolderId: string | null } | null }
  builder: { id: string; name: string } | null
  contractor: ConstructorInfo | null
  devices: ProjectDevice[]
  files: ProjectFile[]
}

interface UserOption {
  id: string
  name: string
}

interface ConstructorOption {
  id: number
  code: string
  name: string
}

const FILE_CATEGORIES: { key: string; label: string }[] = [
  { key: 'INSTALL_PLAN', label: '설치계획문서' },
  { key: 'CONTRACTOR_CONFIRM', label: '시공업체 설치확인서' },
  { key: 'INSTALL_CONFIRM', label: '설치확인서' },
  { key: 'INSPECTION_CHECKLIST', label: '검수체크리스트' },
]

function toDateInput(val: string | null): string {
  if (!val) return ''
  return val.slice(0, 10)
}

export default function ProjectDetailPage() {
  const { code } = useParams() as { code: string }
  const router = useRouter()

  const [project, setProject] = useState<Project | null>(null)
  const [allDevices, setAllDevices] = useState<DeviceInfo[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [constructors, setConstructors] = useState<ConstructorOption[]>([])
  const [buildStatuses, setBuildStatuses] = useState<BuildStatusOption[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // 편집 상태
  const [contractDate, setContractDate] = useState('')
  const [contractType, setContractType] = useState('')
  const [wardCount, setWardCount] = useState('')
  const [bedCount, setBedCount] = useState('')
  const [gatewayCount, setGatewayCount] = useState('')
  const [hasSurvey, setHasSurvey] = useState(false)
  const [hasOrder, setHasOrder] = useState(false)
  const [builderMode, setBuilderMode] = useState<'user' | 'manual'>('user')
  const [builderUserId, setBuilderUserId] = useState('')
  const [builderNameManual, setBuilderNameManual] = useState('')
  const [constructorId, setConstructorId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDateExpected, setEndDateExpected] = useState('')
  const [buildStatusId, setBuildStatusId] = useState('')
  const [remark, setRemark] = useState('')
  const [deviceQty, setDeviceQty] = useState<Record<number, number>>({})

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null)
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingCategoryRef = useRef<string | null>(null)

  const loadProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${code}`)
    if (!res.ok) { router.push('/projects'); return }
    const { project: p } = await res.json()

    setProject(p)

    setContractDate(toDateInput(p.contractDate))
    setContractType(p.contractType ?? '')
    setWardCount(p.wardCount != null ? String(p.wardCount) : '')
    setBedCount(p.bedCount != null ? String(p.bedCount) : '')
    setGatewayCount(p.gatewayCount != null ? String(p.gatewayCount) : '')
    setHasSurvey(p.hasSurvey)
    setHasOrder(p.hasOrder)
    if (p.builderUserId) { setBuilderMode('user'); setBuilderUserId(p.builderUserId) }
    else if (p.builderNameManual) { setBuilderMode('manual'); setBuilderNameManual(p.builderNameManual) }
    setConstructorId(p.constructorId ? String(p.constructorId) : '')
    setStartDate(toDateInput(p.startDate))
    setEndDateExpected(toDateInput(p.endDateExpected))
    setBuildStatusId(p.buildStatusId ? String(p.buildStatusId) : '')
    setRemark(p.remark ?? '')

    const qtyMap: Record<number, number> = {}
    p.devices.forEach((d: ProjectDevice) => { qtyMap[d.deviceInfoId] = d.quantity })
    setDeviceQty(qtyMap)
  }, [code, router])

  useEffect(() => {
    Promise.all([
      loadProject(),
      fetch('/api/settings/devices').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/constructors').then((r) => r.json()),
      fetch('/api/settings/build-status').then((r) => r.json()),
      fetch('/api/auth/me').then((r) => r.json()),
    ]).then(([, devData, userData, conData, bsData, meData]) => {
      setAllDevices((devData.devices ?? []).filter((d: DeviceInfo) => d.isActive))
      setUsers(Array.isArray(userData) ? userData : [])
      setConstructors(conData.constructors ?? [])
      setBuildStatuses(bsData.buildStatuses ?? [])
      setIsAdmin(meData?.role === 'ADMIN')
      setLoading(false)
    })
  }, [loadProject])

  async function handleSave() {
    setSaving(true)
    setError(null)

    const res = await fetch(`/api/projects/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contractDate: contractDate || null,
        contractType: contractType || null,
        wardCount: wardCount !== '' ? Number(wardCount) : null,
        bedCount: bedCount !== '' ? Number(bedCount) : null,
        gatewayCount: gatewayCount !== '' ? Number(gatewayCount) : null,
        hasSurvey,
        hasOrder,
        builderUserId: builderMode === 'user' && builderUserId ? builderUserId : null,
        builderNameManual: builderMode === 'manual' && builderNameManual ? builderNameManual : null,
        constructorId: constructorId ? Number(constructorId) : null,
        startDate: startDate || null,
        endDateExpected: endDateExpected || null,
        buildStatusId: buildStatusId ? Number(buildStatusId) : null,
        remark: remark || null,
      }),
    })

    if (!res.ok) {
      setError((await res.json()).error ?? '저장에 실패했습니다.')
      setSaving(false)
      return
    }

    // 기기 수량 저장
    const entries = Object.entries(deviceQty)
    await Promise.all(
      entries.map(([deviceInfoId, quantity]) =>
        fetch(`/api/projects/${code}/devices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceInfoId: Number(deviceInfoId), quantity }),
        })
      )
    )

    router.refresh()
    await loadProject()
    setSaving(false)
    setSaveMsg('저장되었습니다.')
    setTimeout(() => setSaveMsg(null), 3000)
  }

  async function handleDelete() {
    if (!confirm(`'${project?.projectName}' 프로젝트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return
    setDeleting(true)
    await fetch(`/api/projects/${code}`, { method: 'DELETE' })
    router.refresh()
    router.push('/projects')
  }

  async function handleDeleteFile(fileId: number) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    setDeletingFileId(fileId)
    await fetch(`/api/projects/${code}/files/${fileId}`, { method: 'DELETE' })
    setDeletingFileId(null)
    router.refresh()
    await loadProject()
  }

  async function handleDownloadFile(file: ProjectFile) {
    if (file.s3Key) {
      const res = await fetch(`/api/projects/${code}/files/${file.id}/download`)
      if (!res.ok) return
      const { url } = await res.json()
      window.open(url, '_blank')
    } else if (file.driveUrl) {
      window.open(file.driveUrl, '_blank')
    }
  }

  function handleAddFileClick(category: string) {
    pendingCategoryRef.current = category
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const category = pendingCategoryRef.current
    if (!file || !category) return

    setUploadingCategory(category)
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('fileCategory', category)

    try {
      const res = await fetch(`/api/projects/${code}/files`, { method: 'POST', body: formData })
      if (!res.ok) {
        const json = await res.json()
        setUploadError(json.error ?? '업로드에 실패했습니다.')
      } else {
        await loadProject()
      }
    } catch {
      setUploadError('업로드 중 오류가 발생했습니다.')
    } finally {
      setUploadingCategory(null)
      pendingCategoryRef.current = null
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">불러오는 중...</p>
      </div>
    )
  }

  if (!project) return null

  const labelClass = 'block text-xs font-medium uppercase tracking-wider text-gray-400'
  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/projects" className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100">
              ← 목록으로
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{project.projectName}</h1>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="font-mono text-sm text-gray-400">{project.projectCode}</span>
                <span className="text-gray-300">·</span>
                <Link href={`/hospitals/${project.hospital.hospitalCode}`} className="text-sm text-blue-600 hover:underline">
                  {project.hospital.hospitalName}
                </Link>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && <span className="text-sm text-green-600">{saveMsg}</span>}
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            {isAdmin && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                삭제
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="space-y-4">

          {/* 계약 정보 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">계약 정보</h2>
            </div>
            <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-3">
              <div>
                <label className={labelClass}>계약일</label>
                <input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>도입형태</label>
                <input type="text" value={contractType} onChange={(e) => setContractType(e.target.value)} className={inputClass} placeholder="예: 구축형, 씨어스, 사용량" />
              </div>
              <div>
                <label className={labelClass}>도입 병동 수</label>
                <input type="number" min="0" value={wardCount} onChange={(e) => setWardCount(e.target.value)} className={inputClass} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>도입 병상 수</label>
                <input type="number" min="0" value={bedCount} onChange={(e) => setBedCount(e.target.value)} className={inputClass} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>게이트웨이 수량</label>
                <input type="number" min="0" value={gatewayCount} onChange={(e) => setGatewayCount(e.target.value)} className={inputClass} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>답사 / 오더 여부</label>
                <div className="mt-2 flex gap-6">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={hasSurvey} onChange={(e) => setHasSurvey(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    답사 완료
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={hasOrder} onChange={(e) => setHasOrder(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    오더 완료
                  </label>
                </div>
              </div>
            </div>

            {/* 기기별 도입 수량 (계약 정보 카드 안으로 통합) */}
            {allDevices.length > 0 && (
              <div className="border-t border-gray-100 px-6 py-5">
                <p className={`mb-3 ${labelClass}`}>기기별 도입 수량</p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {allDevices.map((d) => (
                    <div key={d.id}>
                      <label className={labelClass}>
                        {d.deviceName}
                        <span className="ml-1 font-mono normal-case text-gray-300">{d.deviceModel}</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={deviceQty[d.id] ?? ''}
                        onChange={(e) => setDeviceQty((prev) => ({ ...prev, [d.id]: parseInt(e.target.value) || 0 }))}
                        className={inputClass}
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 구축 정보 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">구축 정보</h2>
            </div>
            <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass}>구축 담당자</label>
                <div className="mt-2 flex gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input type="radio" checked={builderMode === 'user'} onChange={() => setBuilderMode('user')} className="text-blue-600" />
                    시스템 사용자 선택
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input type="radio" checked={builderMode === 'manual'} onChange={() => setBuilderMode('manual')} className="text-blue-600" />
                    직접 입력
                  </label>
                </div>
                {builderMode === 'user' ? (
                  <select value={builderUserId} onChange={(e) => setBuilderUserId(e.target.value)} className={`${inputClass} mt-2`}>
                    <option value="">담당자 선택</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={builderNameManual}
                    onChange={(e) => setBuilderNameManual(e.target.value)}
                    placeholder="담당자명 직접 입력"
                    className={`${inputClass} mt-2`}
                  />
                )}
              </div>

              {/* 공사업체 */}
              <div>
                <label className={labelClass}>공사업체</label>
                <select value={constructorId} onChange={(e) => setConstructorId(e.target.value)} className={inputClass}>
                  <option value="">업체 선택 (선택사항)</option>
                  {constructors.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>구축 시작일</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>구축 종료 예상일</label>
                <input type="date" value={endDateExpected} onChange={(e) => setEndDateExpected(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>구축 진행상태</label>
                <select value={buildStatusId} onChange={(e) => setBuildStatusId(e.target.value)} className={inputClass}>
                  <option value="">상태 없음</option>
                  {buildStatuses.map((bs) => (
                    <option key={bs.id} value={bs.id}>{bs.label}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>비고</label>
                <input
                  type="text"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  maxLength={200}
                  placeholder="비고 사항 입력"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* 첨부파일 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">첨부파일</h2>
            </div>

            {uploadError && (
              <div className="px-6 py-3 text-sm text-red-600 bg-red-50 border-b border-red-100">{uploadError}</div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              className="hidden"
              onChange={handleFileSelected}
            />

            <div className="divide-y divide-gray-100">
              {FILE_CATEGORIES.map((cat) => {
                const catFiles = project.files.filter((f) => f.fileCategory === cat.key)
                const isUploading = uploadingCategory === cat.key
                return (
                  <div key={cat.key} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-700">{cat.label}</h3>
                      <button
                        type="button"
                        disabled={!!uploadingCategory}
                        onClick={() => handleAddFileClick(cat.key)}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isUploading ? '업로드 중...' : '+ 파일 추가'}
                      </button>
                    </div>
                    {catFiles.length === 0 ? (
                      <p className="mt-2 text-xs text-gray-400">등록된 파일이 없습니다.</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {catFiles.map((f) => (
                          <li key={f.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-400">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                              </svg>
                              {(f.s3Key || f.driveUrl) ? (
                                <button
                                  type="button"
                                  onClick={() => handleDownloadFile(f)}
                                  className="truncate text-xs text-blue-600 hover:underline text-left"
                                >
                                  {f.fileName}
                                </button>
                              ) : (
                                <span className="truncate text-xs text-gray-700">{f.fileName}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteFile(f.id)}
                              disabled={deletingFileId === f.id}
                              className="ml-3 shrink-0 text-xs text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {deletingFileId === f.id ? '삭제 중...' : '삭제'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 이슈 노트 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">이슈 노트</h2>
            </div>
            <div className="px-6 py-5">
              <IssueNoteEditor
                projectCode={code}
                initialContent={project.issueNote ?? ''}
              />
            </div>
          </div>

          {/* 하단 저장 버튼 */}
          <div className="flex justify-end gap-3 pb-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
