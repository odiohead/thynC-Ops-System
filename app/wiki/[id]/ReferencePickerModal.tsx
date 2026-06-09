'use client'

import { useEffect, useRef, useState } from 'react'

type Hospital = { hospitalCode: string; hospitalName: string; hiraHospitalName: string }
type Project = { projectCode: string; projectName: string; hospital?: { hospitalName: string } | null }

type Props = {
  pageId: string
  onClose: () => void
  onAdded: () => void
}

export default function ReferencePickerModal({ pageId, onClose, onAdded }: Props) {
  const [tab, setTab] = useState<'hospital' | 'project'>('hospital')
  const [search, setSearch] = useState('')
  const [hospitals, setHospitals] = useState<Hospital[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        if (tab === 'hospital') {
          const url = `/api/hospitals?search=${encodeURIComponent(search)}&limit=20`
          const res = await fetch(url)
          if (!res.ok) throw new Error(`병원 조회 실패 (${res.status})`)
          const data = await res.json()
          setHospitals(data.hospitals ?? data.data ?? [])
        } else {
          const url = `/api/projects?all=true&search=${encodeURIComponent(search)}`
          const res = await fetch(url)
          if (!res.ok) throw new Error(`프로젝트 조회 실패 (${res.status})`)
          const data = await res.json()
          const list: Project[] = data.projects ?? data.data ?? []
          // search filter on client side as fallback
          const filtered = search
            ? list.filter(
                (p) =>
                  p.projectName?.toLowerCase().includes(search.toLowerCase()) ||
                  p.projectCode?.toLowerCase().includes(search.toLowerCase()),
              )
            : list
          setProjects(filtered.slice(0, 50))
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '조회 실패')
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [tab, search])

  const pick = async (refType: 'hospital' | 'project', refCode: string) => {
    setError(null)
    const res = await fetch(`/api/wiki/pages/${pageId}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refType, refCode }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setError(err.error || `추가 실패 (${res.status})`)
      return
    }
    onAdded()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b">
          <h2 className="text-lg font-bold">관련 항목 연결</h2>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                setTab('hospital')
                setSearch('')
              }}
              className={`px-3 py-1 text-sm rounded ${
                tab === 'hospital' ? 'bg-blue-600 text-white' : 'bg-gray-100'
              }`}
            >
              병원
            </button>
            <button
              onClick={() => {
                setTab('project')
                setSearch('')
              }}
              className={`px-3 py-1 text-sm rounded ${
                tab === 'project' ? 'bg-blue-600 text-white' : 'bg-gray-100'
              }`}
            >
              프로젝트
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'hospital' ? '병원명 검색' : '프로젝트명/코드 검색'}
            className="mt-3 w-full px-3 py-2 border rounded text-sm"
            autoFocus
          />
        </div>

        {error && (
          <div className="m-4 p-2 bg-red-50 text-red-700 text-sm rounded border border-red-200">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">조회 중...</div>
          ) : tab === 'hospital' ? (
            hospitals.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">결과 없음</div>
            ) : (
              <ul className="divide-y">
                {hospitals.map((h) => (
                  <li key={h.hospitalCode}>
                    <button
                      onClick={() => pick('hospital', h.hospitalCode)}
                      className="w-full text-left px-4 py-2 hover:bg-blue-50"
                    >
                      <div className="text-sm font-medium">
                        {h.hospitalName || h.hiraHospitalName}
                      </div>
                      <div className="text-xs text-gray-500">{h.hospitalCode}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : projects.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">결과 없음</div>
          ) : (
            <ul className="divide-y">
              {projects.map((p) => (
                <li key={p.projectCode}>
                  <button
                    onClick={() => pick('project', p.projectCode)}
                    className="w-full text-left px-4 py-2 hover:bg-blue-50"
                  >
                    <div className="text-sm font-medium">{p.projectName}</div>
                    <div className="text-xs text-gray-500">
                      {p.projectCode}
                      {p.hospital?.hospitalName ? ` · ${p.hospital.hospitalName}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-3 border-t text-right">
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
