'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import HospitalSelectModal, { SelectedHospital } from '@/app/projects/_components/HospitalSelectModal'

interface QueueItem {
  id: number
  gmailMessageId: string
  receivedAt: string
  hospitalNameRaw: string
  requestDate: string | null
  managerName: string
  managerPhone: string
  managerEmail: string
  totalBeds: string
  model: string
  address: string
  fileUrl: string
  status: string
  siteVisitId: number | null
  siteVisit: { id: number; siteVisitCode: string | null } | null
  createdAt: string
}

type TabKey = 'pending' | 'registered' | 'ignored' | 'all'

function fmt(d: string | null | undefined) {
  if (!d) return '-'
  return d.slice(0, 16).replace('T', ' ')
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '-'
  return d.slice(0, 10)
}

export default function SiteVisitQueuePage() {
  const router = useRouter()
  const [items, setItems] = useState<QueueItem[]>([])
  const [canAccess, setCanAccess] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('pending')

  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncInterval, setSyncInterval] = useState('off')
  const [syncLast, setSyncLast] = useState<string | null>(null)

  const [registerTarget, setRegisterTarget] = useState<QueueItem | null>(null)
  const [hospitalModalOpen, setHospitalModalOpen] = useState(false)
  const [selectedHospital, setSelectedHospital] = useState<SelectedHospital | null>(null)
  const [registering, setRegistering] = useState(false)

  const fetchItems = useCallback(async () => {
    const res = await fetch('/api/site-visit-queue')
    if (res.ok) {
      const data = await res.json()
      setItems(data.items)
      setSyncInterval(data.syncInterval)
      setSyncLast(data.syncLast)
    }
  }, [])

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((me) => {
        const allowed = !!me?.role && me.role !== 'VIEWER'
        setCanAccess(allowed)
        setAuthChecked(true)
        if (!allowed) router.push('/')
      })
  }, [router])

  useEffect(() => {
    if (canAccess) fetchItems()
  }, [canAccess, fetchItems])

  async function handleSync() {
    setSyncing(true)
    setSyncMessage('')
    try {
      const res = await fetch('/api/site-visit-queue/sync', { method: 'POST' })
      const data = await res.json()
      if (data.newCount > 0) {
        setSyncMessage(`${data.newCount}건의 새 요청을 가져왔습니다.`)
      } else {
        setSyncMessage('새 요청이 없습니다.')
      }
      router.refresh()
      fetchItems()
    } catch {
      setSyncMessage('메일 가져오기에 실패했습니다.')
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMessage(''), 5000)
    }
  }

  async function handleRegister() {
    if (!registerTarget || !selectedHospital) return
    setRegistering(true)
    try {
      const res = await fetch(`/api/site-visit-queue/${registerTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospitalCode: selectedHospital.hospitalCode }),
      })
      if (res.ok) {
        setRegisterTarget(null)
        setSelectedHospital(null)
        router.refresh()
        fetchItems()
      }
    } finally {
      setRegistering(false)
    }
  }

  async function handleIgnore(id: number) {
    if (!confirm('이 요청을 무시하시겠습니까?')) return
    await fetch(`/api/site-visit-queue/${id}`, { method: 'DELETE' })
    router.refresh()
    fetchItems()
  }

  async function handleBulkDelete() {
    const tabLabel = activeTab === 'all' ? '전체' : activeTab === 'pending' ? '대기' : activeTab === 'registered' ? '등록완료' : '무시'
    if (!confirm(`"${tabLabel}" 탭의 ${filtered.length}건을 모두 삭제하시겠습니까?`)) return
    await fetch(`/api/site-visit-queue?status=${activeTab}`, { method: 'DELETE' })
    router.refresh()
    fetchItems()
  }

  if (!authChecked) return null

  const filtered = activeTab === 'all' ? items : items.filter((i) => i.status === activeTab)

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'pending', label: `대기 (${items.filter((i) => i.status === 'pending').length})` },
    { key: 'registered', label: `등록완료 (${items.filter((i) => i.status === 'registered').length})` },
    { key: 'ignored', label: `무시 (${items.filter((i) => i.status === 'ignored').length})` },
    { key: 'all', label: `전체 (${items.length})` },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-full px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6">
          <Link
            href="/site-visits"
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            ← 답사 관리로 돌아가기
          </Link>
          <div className="mt-2 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">실측 요청 메일 확인</h1>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs text-gray-400 leading-relaxed">
                <div>
                  자동 동기화:{' '}
                  {syncInterval === 'off' ? (
                    <span className="text-gray-500">OFF</span>
                  ) : (
                    <span className="text-green-600 font-medium">
                      {{ '30m': '30분', '1h': '1시간', '2h': '2시간', '6h': '6시간' }[syncInterval] || syncInterval}
                    </span>
                  )}
                </div>
                <div>
                  마지막 동기화:{' '}
                  <span className="text-gray-500">
                    {syncLast
                      ? new Date(syncLast).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                      : '-'}
                  </span>
                </div>
              </div>
              {syncMessage && (
                <span className="text-sm text-green-600">{syncMessage}</span>
              )}
              <button
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {syncing && (
                  <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                메일 가져오기
              </button>
            </div>
          </div>
        </div>

        {/* 탭 */}
        <div className="mb-4 flex items-center justify-between border-b border-gray-200">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'border-b-2 border-blue-600 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {filtered.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className="mb-1 rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              일괄삭제 ({filtered.length}건)
            </button>
          )}
        </div>

        {/* 테이블 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['수신일시', '병원명(파싱)', '주소', '요청일', '담당자', '연락처', '판매모델', '병상수', '도면', '상태', '액션'].map((col) => (
                    <th key={col} className="whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-16 text-center text-sm text-gray-400">
                      항목이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={item.status === 'ignored' ? 'opacity-50' : ''}
                    >
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{fmt(item.receivedAt)}</td>
                      <td className="px-3 py-3 font-medium text-gray-900" style={{ minWidth: '140px' }}>
                        {item.hospitalNameRaw || '-'}
                      </td>
                      <td className="px-3 py-3 text-gray-600 text-xs" style={{ maxWidth: '200px' }}>
                        {item.address || '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{fmtDate(item.requestDate)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{item.managerName || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{item.managerPhone || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{item.model || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{item.totalBeds || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {item.fileUrl ? (
                          <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 text-xs">파일 링크</a>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {item.status === 'pending' && (
                          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">대기</span>
                        )}
                        {item.status === 'registered' && (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">등록완료</span>
                        )}
                        {item.status === 'ignored' && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">무시</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {item.status === 'pending' && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => { setRegisterTarget(item); setSelectedHospital(null) }}
                              className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                            >
                              등록
                            </button>
                            <button
                              onClick={() => handleIgnore(item.id)}
                              className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                            >
                              무시
                            </button>
                          </div>
                        )}
                        {item.status === 'registered' && item.siteVisit && (
                          <Link
                            href={`/site-visits/${item.siteVisit.id}`}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800"
                          >
                            → {item.siteVisit.siteVisitCode}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 등록 모달 */}
      {registerTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-semibold text-gray-900">답사 등록</h2>
              <button
                onClick={() => setRegisterTarget(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-700">메일 파싱 데이터</h3>
              <div className="rounded-lg bg-gray-50 p-4 text-sm space-y-1.5">
                <div className="flex"><span className="w-24 flex-shrink-0 text-gray-500">수신일시</span><span className="text-gray-900">{fmt(registerTarget.receivedAt)}</span></div>
                <div className="flex"><span className="w-24 flex-shrink-0 text-gray-500">병원명</span><span className="text-gray-900">{registerTarget.hospitalNameRaw || '-'}</span></div>
                <div className="flex"><span className="w-24 flex-shrink-0 text-gray-500">주소</span><span className="text-gray-900">{registerTarget.address || '-'}</span></div>
                <div className="flex"><span className="w-24 flex-shrink-0 text-gray-500">요청일</span><span className="text-gray-900">{fmtDate(registerTarget.requestDate)}</span></div>
                <div className="flex"><span className="w-24 flex-shrink-0 text-gray-500">담당자</span><span className="text-gray-900">{registerTarget.managerName || '-'}</span></div>
                <div className="flex"><span className="w-24 flex-shrink-0 text-gray-500">연락처</span><span className="text-gray-900">{registerTarget.managerPhone || '-'}</span></div>
                <div className="flex"><span className="w-24 flex-shrink-0 text-gray-500">이메일</span><span className="text-gray-900">{registerTarget.managerEmail || '-'}</span></div>
                <div className="flex"><span className="w-24 flex-shrink-0 text-gray-500">판매모델</span><span className="text-gray-900">{registerTarget.model || '-'}</span></div>
                <div className="flex"><span className="w-24 flex-shrink-0 text-gray-500">병상수</span><span className="text-gray-900">{registerTarget.totalBeds || '-'}</span></div>
              </div>

              <div className="pt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  병원 연결 <span className="text-red-500">*</span>
                </label>
                {selectedHospital ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800">
                      {selectedHospital.hospitalName}
                      <button
                        onClick={() => setSelectedHospital(null)}
                        className="ml-1.5 text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={() => setHospitalModalOpen(true)}
                    className="rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700"
                  >
                    병원 선택...
                  </button>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
              <button
                onClick={() => setRegisterTarget(null)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleRegister}
                disabled={!selectedHospital || registering}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {registering ? '등록 중...' : '확인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 병원 선택 모달 */}
      <HospitalSelectModal
        isOpen={hospitalModalOpen}
        onClose={() => setHospitalModalOpen(false)}
        onSelect={(h) => {
          setSelectedHospital(h)
          setHospitalModalOpen(false)
        }}
      />
    </div>
  )
}
