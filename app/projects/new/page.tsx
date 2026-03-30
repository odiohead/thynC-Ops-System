'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import HospitalSelectModal, { SelectedHospital } from '../_components/HospitalSelectModal'



interface DeviceInfo {
  id: number
  deviceModel: string
  deviceName: string
  isActive: boolean
  sortOrder: number
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

interface BuildStatusOption {
  id: number
  label: string
  color: string | null
}

function NewProjectForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [hospital, setHospital] = useState<SelectedHospital | null>(null)
  const [showHospitalModal, setShowHospitalModal] = useState(false)

  const [contractDate, setContractDate] = useState('')
  const [wardCount, setWardCount] = useState('')
  const [bedCount, setBedCount] = useState('')
  const [gatewayCount, setGatewayCount] = useState('')
  const [hasSurvey, setHasSurvey] = useState(false)
  const [hasOrder, setHasOrder] = useState(false)

  const [builderMode, setBuilderMode] = useState<'user' | 'manual'>('user')
  const [builderUserId, setBuilderUserId] = useState('')
  const [builderNameManual, setBuilderNameManual] = useState('')
  const [users, setUsers] = useState<UserOption[]>([])
  const [constructorId, setConstructorId] = useState('')
  const [constructors, setConstructors] = useState<ConstructorOption[]>([])

  const [startDate, setStartDate] = useState('')
  const [endDateExpected, setEndDateExpected] = useState('')
  const [buildStatusId, setBuildStatusId] = useState('')
  const [buildStatuses, setBuildStatuses] = useState<BuildStatusOption[]>([])
  const [issueNote, setIssueNote] = useState('')

  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [deviceQty, setDeviceQty] = useState<Record<number, number>>({})

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const presetCode = searchParams.get('hospitalCode')

    Promise.all([
      fetch('/api/settings/devices').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/constructors').then((r) => r.json()),
      fetch('/api/settings/build-status').then((r) => r.json()),
      presetCode ? fetch(`/api/hospitals/${presetCode}`).then((r) => r.json()) : Promise.resolve(null),
    ]).then(([devData, userData, conData, bsData, hospData]) => {
      setDevices((devData.devices ?? []).filter((d: DeviceInfo) => d.isActive))
      setUsers(Array.isArray(userData) ? userData : [])
      setConstructors(conData.constructors ?? [])
      setBuildStatuses(bsData.buildStatuses ?? [])
      if (hospData?.hospital) {
        setHospital({
          hospitalCode: hospData.hospital.hospitalCode,
          hospitalName: hospData.hospital.hospitalName,
        })
      }
    })
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hospital) { setError('병원을 선택해주세요.'); return }

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalCode: hospital.hospitalCode,
          contractDate: contractDate || null,
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
          issueNote: issueNote || null,
        }),
      })

      if (!res.ok) {
        const json = await res.json()
        setError(json.error ?? '등록에 실패했습니다.')
        setSubmitting(false)
        return
      }

      const { project } = await res.json()

      // 기기 수량 등록
      const deviceEntries = Object.entries(deviceQty).filter(([, qty]) => qty > 0)
      await Promise.all(
        deviceEntries.map(([deviceInfoId, quantity]) =>
          fetch(`/api/projects/${project.projectCode}/devices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceInfoId: Number(deviceInfoId), quantity }),
          })
        )
      )

      router.refresh()
      router.push(`/projects/${project.projectCode}`)
    } catch {
      setError('등록 중 오류가 발생했습니다.')
      setSubmitting(false)
    }
  }

  const labelClass = 'block text-xs font-medium uppercase tracking-wider text-gray-400'
  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center gap-4">
          <Link href="/projects" className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100">
            ← 목록으로
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">프로젝트 등록</h1>
            <p className="mt-0.5 text-sm text-gray-500">프로젝트 코드와 차수는 자동으로 생성됩니다.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* 병원 선택 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">병원 선택 *</h2>
              <button
                type="button"
                onClick={() => setShowHospitalModal(true)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                {hospital ? '병원 변경' : '병원 검색'}
              </button>
            </div>
            <div className="px-6 py-4">
              {hospital ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{hospital.hospitalName}</p>
                    <p className="mt-0.5 font-mono text-xs text-gray-400">{hospital.hospitalCode}</p>
                  </div>
                  <button type="button" onClick={() => setHospital(null)} className="text-xs text-gray-400 hover:text-gray-600">해제</button>
                </div>
              ) : (
                <p className="text-sm text-gray-400">병원을 선택해주세요.</p>
              )}
            </div>
          </div>

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

            {/* 기기별 도입 수량 */}
            {devices.length > 0 && (
              <div className="border-t border-gray-100 px-6 py-5">
                <p className={`mb-3 ${labelClass}`}>기기별 도입 수량</p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {devices.map((d) => (
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

              {/* 구축 담당자 */}
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
            </div>
          </div>

          {/* 이슈 노트 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">이슈 노트</h2>
            </div>
            <div className="px-6 py-5">
              <textarea
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
                rows={4}
                placeholder="특이사항, 이슈 내용 등을 자유롭게 입력하세요."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 버튼 */}
          <div className="flex justify-end gap-3 pb-4">
            <Link href="/projects" className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100">
              취소
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '등록 중...' : '등록'}
            </button>
          </div>

        </form>
      </div>

      <HospitalSelectModal
        isOpen={showHospitalModal}
        onClose={() => setShowHospitalModal(false)}
        onSelect={setHospital}
      />
    </div>
  )
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-sm text-gray-400">불러오는 중...</p></div>}>
      <NewProjectForm />
    </Suspense>
  )
}
