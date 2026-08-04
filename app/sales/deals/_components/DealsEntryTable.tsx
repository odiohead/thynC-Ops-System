'use client'

/**
 * 도입현황 입력 테이블 — 대웅 원장(thynC_status_DW.xlsx '1. 거래처별 종합현황') 컬럼 순서 재현 + 구파일 보강 금액.
 * 1행 = 1차수(딜, flat). 행 클릭 → /sales/deals/[id] 상세 편집. 금액은 대웅 축(씨어스 금액은 상세에서 별도 관리).
 * '등록' → 병원 검색·매핑 후 딜 생성 → 상세 페이지에서 부가 정보 입력.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/ui/PageHeader'

export interface DealEntryRow {
  id: number
  dealCode: string
  roundNo: number
  hospitalCode: string
  hospitalName: string
  hospitalType: string
  sido: string | null
  dealStatus: { name: string; color: string | null } | null
  buildStatus: { name: string; color: string | null } | null
  dwCountType: string | null
  dwOrderStatus: string | null
  dwDivision: string | null
  dwOffice: string | null
  dwManager: string | null
  dwClientCode: string | null
  dwModelKind: string | null
  dwModel: string | null
  wardsText: string | null
  dwDeviceCount: number | null
  bedCount: number | null
  dwAmountTotal: number | null
  contractDate: string | null
  dwBuildDate: string | null
  dwAmountProduct: number | null
  dwAmountConstruction: number | null
  dwAmountActual: number | null
  dwAmountService: number | null
  dwTaxInvoice: string | null
  dwSettlement: string | null
  dwPriceType: string | null
  remark: string | null
}

const fmtWon = (v: number | null) => (v === null ? '—' : v.toLocaleString('ko-KR'))
const thCls = 'whitespace-nowrap px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-gray-400'
const tdCls = 'whitespace-nowrap px-2.5 py-1.5 text-[13px] text-gray-800'
const selCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none'
const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none'
const btnPrimary = 'rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50'
const btnGhost = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100'

function Badge({ v }: { v: { name: string; color: string | null } | null }) {
  if (!v) return <span className="text-gray-300">—</span>
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: v.color || '#94a3b8' }}>
      {v.name}
    </span>
  )
}

const uniq = (vals: Array<string | null>) => Array.from(new Set(vals.filter((v): v is string => !!v))).sort()

interface HospitalPick { hospitalCode: string; hospitalName: string }

/** 병원 검색 — 2글자 이상 입력 시 검색 */
function HospitalSearch({ target, setTarget }: { target: HospitalPick | null; setTarget: (h: HospitalPick | null) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HospitalPick[]>([])

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/hospitals?search=${encodeURIComponent(query.trim())}`)
      if (res.ok) {
        const json = await res.json()
        setResults((json.hospitals ?? []).slice(0, 8).map((h: HospitalPick) => ({ hospitalCode: h.hospitalCode, hospitalName: h.hospitalName })))
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  if (target) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
        <span className="font-medium text-blue-700">{target.hospitalName}</span>
        <button onClick={() => setTarget(null)} className="text-xs text-gray-500 hover:underline">변경</button>
      </div>
    )
  }
  return (
    <>
      <input className={inputCls} placeholder="병원명 2글자 이상 입력" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      {results.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 text-sm">
          {results.map((h) => (
            <li key={h.hospitalCode}>
              <button className="w-full px-3 py-1.5 text-left hover:bg-blue-50" onClick={() => setTarget(h)}>{h.hospitalName}</button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** 등록 모달 — 병원 매핑 + 딜 생성 → 상세 페이지에서 부가 정보 입력 */
function CreateModal({ existingRounds, onClose }: { existingRounds: Map<string, number>; onClose: () => void }) {
  const router = useRouter()
  const [target, setTarget] = useState<HospitalPick | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextRound = target ? (existingRounds.get(target.hospitalCode) ?? 0) + 1 : null

  const submit = async () => {
    if (!target) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/hospitals/${target.hospitalCode}/sales/deals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '등록에 실패했습니다.'); return }
    const json = await res.json()
    router.refresh()
    router.push(`/sales/deals/${json.deal.id}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-800">도입현황 등록</h3>
        <p className="mt-1 text-xs text-gray-500">병원을 매핑해 계약 이력(차수)을 만듭니다. 등록 후 상세 페이지에서 나머지 정보를 입력하세요. 기본 상태는 &lsquo;영업중&rsquo;입니다.</p>
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-500">병원 *</label>
          <HospitalSearch target={target} setTarget={setTarget} />
          {nextRound !== null && <p className="mt-1 text-xs text-blue-600">{nextRound}차로 등록됩니다</p>}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>취소</button>
          <button onClick={submit} disabled={busy || !target} className={btnPrimary}>등록</button>
        </div>
      </div>
    </div>
  )
}

const dwSale = (r: DealEntryRow): number | null =>
  r.dwAmountProduct === null && r.dwAmountConstruction === null ? null : (r.dwAmountProduct ?? 0) + (r.dwAmountConstruction ?? 0)

/** 정렬 가능 컬럼 정의 (표 순서) — accessor 값으로 정렬, null은 항상 마지막 */
const COLS: Array<{ key: string; label: string; right?: boolean; acc: (r: DealEntryRow) => string | number | null }> = [
  { key: 'hospitalName', label: '병원명', acc: (r) => r.hospitalName },
  { key: 'roundNo', label: '확장', acc: (r) => r.roundNo },
  { key: 'dealStatus', label: '딜 상태', acc: (r) => r.dealStatus?.name ?? null },
  { key: 'buildStatus', label: '공사 단계', acc: (r) => r.buildStatus?.name ?? null },
  { key: 'dwCountType', label: '카운팅', acc: (r) => r.dwCountType },
  { key: 'dwOrderStatus', label: '오더', acc: (r) => r.dwOrderStatus },
  { key: 'hospitalType', label: '종별', acc: (r) => r.hospitalType },
  { key: 'dwDivision', label: '사업부', acc: (r) => r.dwDivision },
  { key: 'dwOffice', label: '사무소', acc: (r) => r.dwOffice },
  { key: 'dwManager', label: '담당자', acc: (r) => r.dwManager },
  { key: 'dwClientCode', label: '거래처코드', acc: (r) => r.dwClientCode },
  { key: 'dwModelKind', label: '모델구분', acc: (r) => r.dwModelKind },
  { key: 'dwModel', label: '판매모델', acc: (r) => r.dwModel },
  { key: 'wardsText', label: '도입병동', acc: (r) => r.wardsText },
  { key: 'dwDeviceCount', label: '디바이스', right: true, acc: (r) => r.dwDeviceCount },
  { key: 'bedCount', label: '병상수', right: true, acc: (r) => r.bedCount },
  { key: 'dwAmountTotal', label: '계약금액(총견적가)', right: true, acc: (r) => r.dwAmountTotal },
  { key: 'contractDate', label: '계약일', acc: (r) => r.contractDate },
  { key: 'dwBuildDate', label: '공사일', acc: (r) => r.dwBuildDate },
  { key: 'dwAmountProduct', label: '제품가', right: true, acc: (r) => r.dwAmountProduct },
  { key: 'dwAmountConstruction', label: '공사비', right: true, acc: (r) => r.dwAmountConstruction },
  { key: 'dwSale', label: '판매', right: true, acc: (r) => dwSale(r) },
  { key: 'dwAmountActual', label: '실판매액', right: true, acc: (r) => r.dwAmountActual },
  { key: 'dwAmountService', label: '용역매출', right: true, acc: (r) => r.dwAmountService },
  { key: 'dwTaxInvoice', label: '세금계산서', acc: (r) => r.dwTaxInvoice },
  { key: 'dwSettlement', label: '정산', acc: (r) => r.dwSettlement },
  { key: 'dwPriceType', label: '판매가', acc: (r) => r.dwPriceType },
  { key: 'remark', label: '비고', acc: (r) => r.remark },
  { key: 'sido', label: '지역', acc: (r) => r.sido },
]

export default function DealsEntryTable({ rows }: { rows: DealEntryRow[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [dealStatus, setDealStatus] = useState('')
  const [countType, setCountType] = useState('')
  const [orderStatus, setOrderStatus] = useState('')
  const [htype, setHtype] = useState('')
  const [division, setDivision] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'contractDate', dir: 'desc' })
  const [modalOpen, setModalOpen] = useState(false)

  const options = useMemo(() => ({
    dealStatuses: uniq(rows.map((r) => r.dealStatus?.name ?? null)),
    countTypes: uniq(rows.map((r) => r.dwCountType)),
    orderStatuses: uniq(rows.map((r) => r.dwOrderStatus)),
    types: uniq(rows.map((r) => r.hospitalType)),
    divisions: uniq(rows.map((r) => r.dwDivision)),
  }), [rows])

  const existingRounds = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.hospitalCode, Math.max(m.get(r.hospitalCode) ?? 0, r.roundNo))
    return m
  }, [rows])

  const filtered = useMemo(() => rows.filter((r) => {
    if (q && !r.hospitalName.toLowerCase().includes(q.trim().toLowerCase())) return false
    if (dealStatus && r.dealStatus?.name !== dealStatus) return false
    if (countType && r.dwCountType !== countType) return false
    if (orderStatus && r.dwOrderStatus !== orderStatus) return false
    if (htype && r.hospitalType !== htype) return false
    if (division && r.dwDivision !== division) return false
    return true
  }), [rows, q, dealStatus, countType, orderStatus, htype, division])

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key)
    if (!col) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = col.acc(a), vb = col.acc(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1 // null은 방향 무관 마지막
      if (vb === null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'ko') * dir
    })
  }, [filtered, sort])

  const toggleSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  // 엑셀 다운로드 — 화면에 보이는 그대로(필터·정렬 적용된 sorted)를 COLS 순서로 내보낸다.
  // xlsx는 용량이 커서 클릭 시점에 동적 로드(초기 번들 제외).
  const [exporting, setExporting] = useState(false)
  const exportExcel = async () => {
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      const data = sorted.map((r, i) => {
        const o: Record<string, string | number> = { 순번: i + 1 }
        for (const c of COLS) o[c.label] = c.acc(r) ?? ''
        return o
      })
      const ws = XLSX.utils.json_to_sheet(data)
      ws['!cols'] = [{ wch: 6 }, ...COLS.map((c) => ({ wch: c.right ? 14 : c.key === 'remark' ? 30 : 16 }))]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '도입현황')
      const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '')
      XLSX.writeFile(wb, `도입현황_${stamp}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  const sum = (f: (r: DealEntryRow) => number | null) => filtered.reduce((a, r) => a + (f(r) ?? 0), 0)

  const go = (id: number) => router.push(`/sales/deals/${id}`)
  const sumTd = 'px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900'

  return (
    <div className="p-6">
      <PageHeader
        title="도입현황 입력"
        description="대웅 원장(거래처별 종합현황) 컬럼 순서의 계약 이력(차수) 원장입니다. 금액은 대웅 축 값이며 씨어스 금액은 행 클릭 → 상세에서 별도 관리합니다. 단계·종별·지역은 병원·프로젝트에서 자동 표시됩니다."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportExcel} disabled={exporting || sorted.length === 0} className={btnGhost}>
              {exporting ? '생성 중…' : '엑셀 다운로드'}
            </button>
            <button onClick={() => setModalOpen(true)} className={btnPrimary}>+ 등록</button>
          </div>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="병원명 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={selCls} value={dealStatus} onChange={(e) => setDealStatus(e.target.value)}>
          <option value="">딜 상태 전체</option>
          {options.dealStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={selCls} value={countType} onChange={(e) => setCountType(e.target.value)}>
          <option value="">카운팅 전체</option>
          {options.countTypes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={selCls} value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)}>
          <option value="">오더 전체</option>
          {options.orderStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={selCls} value={htype} onChange={(e) => setHtype(e.target.value)}>
          <option value="">병원종 전체</option>
          {options.types.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={selCls} value={division} onChange={(e) => setDivision(e.target.value)}>
          <option value="">사업부 전체</option>
          {options.divisions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500">계약 {filtered.length}건 / 전체 {rows.length}건</span>
      </div>

      <div className="mt-3 overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm" style={{ maxHeight: 'calc(100vh - 15rem)' }}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="sticky top-0 z-20 bg-gray-50">
            <tr>
              <th className={`${thCls} text-right`}>순번</th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={`${thCls} cursor-pointer select-none hover:text-gray-600 ${c.right ? 'text-right' : ''} ${c.key === 'hospitalName' ? 'sticky left-0 z-30 bg-gray-50' : ''}`}
                  onClick={() => toggleSort(c.key)}
                  title="클릭 정렬 · 다시 클릭 시 역순"
                >
                  {c.label}
                  {sort.key === c.key && <span className="ml-0.5 text-blue-500">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan={30} className="px-3 py-8 text-center text-sm text-gray-400">표시할 도입 건이 없습니다. 우측 상단 &lsquo;+ 등록&rsquo;으로 계약 이력을 만드세요.</td></tr>
            )}
            {sorted.map((r, i) => (
              <tr key={r.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => go(r.id)}>
                <td className={`${tdCls} text-right text-gray-400`}>{i + 1}</td>
                <td className={`${tdCls} sticky left-0 z-10 bg-white font-medium text-blue-700`}>
                  {r.hospitalName} <span className="ml-0.5 text-[11px] font-normal text-gray-400">{r.roundNo}차</span>
                </td>
                <td className={tdCls}>{r.roundNo >= 2 ? `확장(${r.roundNo}차)` : '—'}</td>
                <td className={tdCls}><Badge v={r.dealStatus} /></td>
                <td className={tdCls}><Badge v={r.buildStatus} /></td>
                <td className={tdCls}>{r.dwCountType ?? '—'}</td>
                <td className={tdCls}>{r.dwOrderStatus ?? '—'}</td>
                <td className={tdCls}>{r.hospitalType}</td>
                <td className={tdCls}>{r.dwDivision ?? '—'}</td>
                <td className={tdCls}>{r.dwOffice ?? '—'}</td>
                <td className={tdCls}>{r.dwManager ?? '—'}</td>
                <td className={tdCls}>{r.dwClientCode ?? '—'}</td>
                <td className={tdCls}>{r.dwModelKind ?? '—'}</td>
                <td className={tdCls}>{r.dwModel ?? '—'}</td>
                <td className={`${tdCls} max-w-[110px] truncate`} title={r.wardsText ?? undefined}>{r.wardsText ?? '—'}</td>
                <td className={`${tdCls} text-right`}>{r.dwDeviceCount ?? '—'}</td>
                <td className={`${tdCls} text-right`}>{r.bedCount ?? '—'}</td>
                <td className={`${tdCls} text-right font-medium`}>{fmtWon(r.dwAmountTotal)}</td>
                <td className={tdCls}>{r.contractDate ?? '—'}</td>
                <td className={tdCls}>{r.dwBuildDate ?? '—'}</td>
                <td className={`${tdCls} text-right`}>{fmtWon(r.dwAmountProduct)}</td>
                <td className={`${tdCls} text-right`}>{fmtWon(r.dwAmountConstruction)}</td>
                <td className={`${tdCls} text-right`}>{fmtWon(dwSale(r))}</td>
                <td className={`${tdCls} text-right font-medium`}>{fmtWon(r.dwAmountActual)}</td>
                <td className={`${tdCls} text-right`}>{fmtWon(r.dwAmountService)}</td>
                <td className={tdCls}>{r.dwTaxInvoice ?? '—'}</td>
                <td className={tdCls}>{r.dwSettlement ?? '—'}</td>
                <td className={tdCls}>{r.dwPriceType ?? '—'}</td>
                <td className={`${tdCls} max-w-[140px] truncate`} title={r.remark ?? undefined}>{r.remark ?? '—'}</td>
                <td className={tdCls}>{r.sido ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="sticky bottom-0 border-t border-gray-300 bg-gray-50">
              <tr>
                <td colSpan={15} className="px-2.5 py-2 text-xs font-medium text-gray-500">합계 ({filtered.length}건)</td>
                <td className={sumTd}>{sum((r) => r.dwDeviceCount) || '—'}</td>
                <td className={sumTd}>{sum((r) => r.bedCount) || '—'}</td>
                <td className={sumTd}>{fmtWon(sum((r) => r.dwAmountTotal))}</td>
                <td colSpan={2} />
                <td className={sumTd}>{fmtWon(sum((r) => r.dwAmountProduct))}</td>
                <td className={sumTd}>{fmtWon(sum((r) => r.dwAmountConstruction))}</td>
                <td className={sumTd}>{fmtWon(sum(dwSale))}</td>
                <td className={sumTd}>{fmtWon(sum((r) => r.dwAmountActual))}</td>
                <td className={sumTd}>{fmtWon(sum((r) => r.dwAmountService))}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {modalOpen && <CreateModal existingRounds={existingRounds} onClose={() => setModalOpen(false)} />}
    </div>
  )
}
