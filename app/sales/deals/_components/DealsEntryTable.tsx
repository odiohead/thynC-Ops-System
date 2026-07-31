'use client'

/**
 * 도입현황 입력 테이블 — 대웅 원장(thynC_status_DW.xlsx '1. 거래처별 종합현황') 컬럼 순서 재현 + 구파일 보강 금액.
 * 1행 = 1차수(딜, flat). 행 클릭 → /sales/deals/[id] 상세 편집. 금액은 대웅 축(씨어스 금액은 상세에서 별도 관리).
 * '등록' → 병원 검색·매핑 후 딜 생성 → 상세 페이지에서 부가 정보 입력.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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

export default function DealsEntryTable({ rows }: { rows: DealEntryRow[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [dealStatus, setDealStatus] = useState('')
  const [countType, setCountType] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const options = useMemo(() => ({
    dealStatuses: uniq(rows.map((r) => r.dealStatus?.name ?? null)),
    countTypes: uniq(rows.map((r) => r.dwCountType)),
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
    return true
  }), [rows, q, dealStatus, countType])

  const sum = (f: (r: DealEntryRow) => number | null) => filtered.reduce((a, r) => a + (f(r) ?? 0), 0)
  const dwSale = (r: DealEntryRow): number | null =>
    r.dwAmountProduct === null && r.dwAmountConstruction === null ? null : (r.dwAmountProduct ?? 0) + (r.dwAmountConstruction ?? 0)

  const go = (id: number) => router.push(`/sales/deals/${id}`)
  const sumTd = 'px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900'

  return (
    <div className="p-6">
      <PageHeader
        title="도입현황 입력"
        description="대웅 원장(거래처별 종합현황) 컬럼 순서의 계약 이력(차수) 원장입니다. 금액은 대웅 축 값이며 씨어스 금액은 행 클릭 → 상세에서 별도 관리합니다. 단계·종별·지역은 병원·프로젝트에서 자동 표시됩니다."
        actions={
          <>
            <Link href="/sales" className={btnGhost}>도입 현황으로</Link>
            <button onClick={() => setModalOpen(true)} className={btnPrimary}>+ 등록</button>
          </>
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
        <span className="ml-auto text-sm text-gray-500">계약 {filtered.length}건 / 전체 {rows.length}건</span>
      </div>

      <div className="mt-3 overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm" style={{ maxHeight: 'calc(100vh - 15rem)' }}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="sticky top-0 z-20 bg-gray-50">
            <tr>
              <th className={`${thCls} text-right`}>순번</th>
              <th className={`${thCls} sticky left-0 z-30 bg-gray-50`}>병원명</th>
              <th className={thCls}>확장</th>
              <th className={thCls}>딜 상태</th>
              <th className={thCls}>공사 단계</th>
              <th className={thCls}>카운팅</th>
              <th className={thCls}>오더</th>
              <th className={thCls}>종별</th>
              <th className={thCls}>사업부</th>
              <th className={thCls}>사무소</th>
              <th className={thCls}>담당자</th>
              <th className={thCls}>거래처코드</th>
              <th className={thCls}>모델구분</th>
              <th className={thCls}>판매모델</th>
              <th className={thCls}>도입병동</th>
              <th className={`${thCls} text-right`}>디바이스</th>
              <th className={`${thCls} text-right`}>병상수</th>
              <th className={`${thCls} text-right`}>계약금액(총견적가)</th>
              <th className={thCls}>계약일</th>
              <th className={thCls}>공사일</th>
              <th className={`${thCls} text-right`}>제품가</th>
              <th className={`${thCls} text-right`}>공사비</th>
              <th className={`${thCls} text-right`}>판매</th>
              <th className={`${thCls} text-right`}>실판매액</th>
              <th className={`${thCls} text-right`}>용역매출</th>
              <th className={thCls}>세금계산서</th>
              <th className={thCls}>정산</th>
              <th className={thCls}>판매가</th>
              <th className={thCls}>비고</th>
              <th className={thCls}>지역</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan={30} className="px-3 py-8 text-center text-sm text-gray-400">표시할 도입 건이 없습니다. 우측 상단 &lsquo;+ 등록&rsquo;으로 계약 이력을 만드세요.</td></tr>
            )}
            {filtered.map((r, i) => (
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
