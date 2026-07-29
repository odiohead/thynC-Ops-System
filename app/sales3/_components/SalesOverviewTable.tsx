'use client'

/**
 * 도입 현황 v3 — 병원당 1행 요약 테이블 (실험, /sales·/sales2 비교용)
 * 핵심 컬럼 = 도입 라이프사이클 상태(딜 상태에서 파생) + 누적 지표.
 * 상세(차수별)는 병원 상세 > 영업 정보에서.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/ui/PageHeader'

export interface OverviewRow {
  hospitalCode: string
  hospitalName: string
  hospitalType: string
  sido: string | null
  lifecycle: { key: 'none' | 'first' | 'adopted' | 'expanding' | 'dropped'; label: string; sub?: string }
  stage: { name: string; color: string | null } | null
  owner: string | null
  totalBeds: number | null
  introBeds: number | null
  penetration: number | null
  wardSum: number
  deviceCount: number
  completedCount: number
  activeCount: number
  saleSum: number
  actualSum: number
  lastContract: string | null
}

const fmtWon = (v: number) => (v === 0 ? '—' : v.toLocaleString('ko-KR'))
const thCls = 'whitespace-nowrap px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-gray-400'
const tdCls = 'whitespace-nowrap px-2.5 py-1.5 text-[13px] text-gray-800'
const selCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none'

/** 라이프사이클 상태 배지 색 — 파생 상태라 고정 팔레트 */
const LIFECYCLE_COLORS: Record<OverviewRow['lifecycle']['key'], string> = {
  none: '#94a3b8', // 미도입 — slate
  first: '#60a5fa', // 최초 도입 검토중 — blue
  adopted: '#34d399', // N차 도입완료 — green
  expanding: '#2dd4bf', // 추가도입 검토중 — teal
  dropped: '#f87171', // 중단·해지 — red
}

function LifecycleBadge({ v }: { v: OverviewRow['lifecycle'] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: LIFECYCLE_COLORS[v.key] }}>
        {v.label}
      </span>
      {v.sub && <span className="text-[11px] text-gray-500">{v.sub}</span>}
    </span>
  )
}

const uniq = (vals: Array<string | null>) => Array.from(new Set(vals.filter((v): v is string => !!v))).sort()

type SortKey = 'actualSum' | 'introBeds' | 'penetration' | 'totalBeds' | 'lastContract' | 'hospitalName'
const SORT_LABELS: Record<SortKey, string> = {
  actualSum: '누적 실판매액',
  introBeds: '도입 병상',
  penetration: '침투율',
  totalBeds: '전체 병상',
  lastContract: '최근 계약일',
  hospitalName: '병원명',
}

export default function SalesOverviewTable({ rows }: { rows: OverviewRow[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [lifecycle, setLifecycle] = useState('')
  const [type, setType] = useState('')
  const [sido, setSido] = useState('')
  const [owner, setOwner] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('actualSum')

  const options = useMemo(() => ({
    lifecycles: uniq(rows.map((r) => r.lifecycle.label)),
    types: uniq(rows.map((r) => r.hospitalType)),
    sidos: uniq(rows.map((r) => r.sido)),
    owners: uniq(rows.map((r) => r.owner)),
  }), [rows])

  const filtered = useMemo(() => {
    const list = rows.filter((r) => {
      if (q && !r.hospitalName.toLowerCase().includes(q.trim().toLowerCase())) return false
      if (lifecycle && r.lifecycle.label !== lifecycle) return false
      if (type && r.hospitalType !== type) return false
      if (sido && r.sido !== sido) return false
      if (owner && r.owner !== owner) return false
      return true
    })
    const num = (v: number | null) => v ?? -1
    return list.sort((a, b) => {
      switch (sortKey) {
        case 'hospitalName': return a.hospitalName.localeCompare(b.hospitalName, 'ko')
        case 'lastContract': return (b.lastContract ?? '').localeCompare(a.lastContract ?? '')
        case 'actualSum': return b.actualSum - a.actualSum
        case 'introBeds': return num(b.introBeds) - num(a.introBeds)
        case 'penetration': return num(b.penetration) - num(a.penetration)
        case 'totalBeds': return num(b.totalBeds) - num(a.totalBeds)
      }
    })
  }, [rows, q, lifecycle, type, sido, owner, sortKey])

  const sum = (f: (r: OverviewRow) => number | null) => filtered.reduce((a, r) => a + (f(r) ?? 0), 0)

  return (
    <div className="p-6">
      <PageHeader
        title="도입 현황 v3 (병원 요약)"
        description="병원당 1행 — 도입 라이프사이클 상태와 누적 지표(병상·기기·매출)를 스캔합니다. 차수별 상세는 병원 상세 > 영업 정보에서. 범위: 영업 프로필 또는 딜이 있는 병원."
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="병원명 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={selCls} value={lifecycle} onChange={(e) => setLifecycle(e.target.value)}>
          <option value="">상태 전체</option>
          {options.lifecycles.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={selCls} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">종별 전체</option>
          {options.types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={selCls} value={sido} onChange={(e) => setSido(e.target.value)}>
          <option value="">지역 전체</option>
          {options.sidos.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={selCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">담당 전체</option>
          {options.owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className={selCls} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          {Object.entries(SORT_LABELS).map(([k, label]) => <option key={k} value={k}>정렬: {label}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500">{filtered.length}곳 / 전체 {rows.length}곳</span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className={thCls}>병원명</th>
              <th className={thCls}>상태</th>
              <th className={thCls}>영업 단계</th>
              <th className={thCls}>종별</th>
              <th className={thCls}>지역</th>
              <th className={thCls}>담당</th>
              <th className={`${thCls} text-right`}>전체 병상</th>
              <th className={`${thCls} text-right`}>도입 병상</th>
              <th className={`${thCls} text-right`}>침투율</th>
              <th className={`${thCls} text-right`}>누적 병동</th>
              <th className={`${thCls} text-right`}>누적 기기</th>
              <th className={`${thCls} text-right`}>계약 (완료/진행)</th>
              <th className={`${thCls} text-right`}>누적 판매</th>
              <th className={`${thCls} text-right`}>누적 실판매액</th>
              <th className={thCls}>최근 계약일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan={15} className="px-3 py-8 text-center text-sm text-gray-400">표시할 병원이 없습니다.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.hospitalCode} className="cursor-pointer hover:bg-blue-50/40" onClick={() => router.push(`/hospitals/${r.hospitalCode}`)}>
                <td className={`${tdCls} font-medium text-gray-900`}>{r.hospitalName}</td>
                <td className={tdCls}><LifecycleBadge v={r.lifecycle} /></td>
                <td className={tdCls}>
                  {r.stage ? (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: r.stage.color || '#94a3b8' }}>{r.stage.name}</span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className={tdCls}>{r.hospitalType}</td>
                <td className={tdCls}>{r.sido ?? '—'}</td>
                <td className={tdCls}>{r.owner ?? '—'}</td>
                <td className={`${tdCls} text-right`}>{r.totalBeds?.toLocaleString() ?? '—'}</td>
                <td className={`${tdCls} text-right`}>{r.introBeds?.toLocaleString() ?? '—'}</td>
                <td className={`${tdCls} text-right`}>{r.penetration != null ? `${r.penetration}%` : '—'}</td>
                <td className={`${tdCls} text-right`}>{r.wardSum || '—'}</td>
                <td className={`${tdCls} text-right`}>{r.deviceCount || '—'}</td>
                <td className={`${tdCls} text-right`}>{r.completedCount} / {r.activeCount}</td>
                <td className={`${tdCls} text-right`}>{fmtWon(r.saleSum)}</td>
                <td className={`${tdCls} text-right font-medium`}>{fmtWon(r.actualSum)}</td>
                <td className={tdCls}>{r.lastContract ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="sticky bottom-0 border-t border-gray-300 bg-gray-50">
              <tr>
                <td colSpan={6} className="px-2.5 py-2 text-xs font-medium text-gray-500">합계 ({filtered.length}곳)</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{sum((r) => r.totalBeds).toLocaleString()}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{sum((r) => r.introBeds).toLocaleString()}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900" />
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{sum((r) => r.wardSum).toLocaleString()}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{sum((r) => r.deviceCount).toLocaleString()}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{sum((r) => r.completedCount)} / {sum((r) => r.activeCount)}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{fmtWon(sum((r) => r.saleSum))}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{fmtWon(sum((r) => r.actualSum))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
