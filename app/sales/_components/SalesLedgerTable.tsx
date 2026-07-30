'use client'

/**
 * 도입 현황 테이블 (영업/CRM v4 P3) — 병원 기준 그룹 뷰.
 * 기준점 = 병원: 병원명·종별·지역·담당·답사는 병원 단위 rowspan, 행 = 도입계약(차수).
 * 한 병원의 1·2·N차가 묶여 보이고, 2건 이상이면 소계 행 표시.
 * 필터·합계는 클라이언트 처리 (딜 수백 건 규모 전제).
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/ui/PageHeader'

export interface LedgerRow {
  id: number
  dealCode: string
  roundNo: number
  hospitalCode: string
  hospitalName: string
  hospitalType: string
  sido: string | null
  stage: { name: string; color: string | null } | null
  owner: string | null
  dealStatus: { name: string; color: string | null } | null
  buildStatus: { name: string; color: string | null } | null
  hospitalModel: string | null
  seersModel: string | null
  contractDate: string | null
  wardsText: string | null
  deptsText: string | null
  wardCount: number | null
  bedCount: number | null
  amountProduct: number | null
  amountConstruction: number | null
  amountActual: number | null
  taxInvoice: string | null
  settlement: string | null
  startDate: string | null
  endDateExpected: string | null
  educationDate: string | null
  projectCode: string | null
  remark: string | null
}

const fmtWon = (v: number | null) => (v === null ? '—' : v.toLocaleString('ko-KR'))
const thCls = 'whitespace-nowrap px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-gray-400'
const tdCls = 'whitespace-nowrap px-2.5 py-1.5 text-[13px] text-gray-800'
const selCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none'

function Badge({ v }: { v: { name: string; color: string | null } | null }) {
  if (!v) return <span className="text-gray-300">—</span>
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: v.color || '#94a3b8' }}>
      {v.name}
    </span>
  )
}

const uniq = (vals: Array<string | null>) => Array.from(new Set(vals.filter((v): v is string => !!v))).sort()

/** 병원 그룹 — 차수 오름차순, 그룹 정렬은 최신 계약일 내림차순 */
interface HospitalGroup { key: string; deals: LedgerRow[] }

export default function SalesLedgerTable({ rows }: { rows: LedgerRow[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [dealStatus, setDealStatus] = useState('')
  const [model, setModel] = useState('')
  const [sido, setSido] = useState('')
  const [owner, setOwner] = useState('')
  const [taxInvoice, setTaxInvoice] = useState('')

  const options = useMemo(() => ({
    dealStatuses: uniq(rows.map((r) => r.dealStatus?.name ?? null)),
    models: uniq([...rows.map((r) => r.hospitalModel), ...rows.map((r) => r.seersModel)]),
    sidos: uniq(rows.map((r) => r.sido)),
    owners: uniq(rows.map((r) => r.owner)),
    taxInvoices: uniq(rows.map((r) => r.taxInvoice)),
  }), [rows])

  const filtered = useMemo(() => rows.filter((r) => {
    if (q && !r.hospitalName.toLowerCase().includes(q.trim().toLowerCase())) return false
    if (dealStatus && r.dealStatus?.name !== dealStatus) return false
    if (model && r.hospitalModel !== model && r.seersModel !== model) return false
    if (sido && r.sido !== sido) return false
    if (owner && r.owner !== owner) return false
    if (taxInvoice && r.taxInvoice !== taxInvoice) return false
    return true
  }), [rows, q, dealStatus, model, sido, owner, taxInvoice])

  const groups = useMemo<HospitalGroup[]>(() => {
    const map = new Map<string, LedgerRow[]>()
    for (const r of filtered) {
      const list = map.get(r.hospitalCode)
      if (list) list.push(r)
      else map.set(r.hospitalCode, [r])
    }
    const latest = (deals: LedgerRow[]) => deals.reduce<string>((m, d) => (d.contractDate && d.contractDate > m ? d.contractDate : m), '')
    return Array.from(map.entries())
      .map(([key, deals]) => ({ key, deals: deals.sort((a, b) => a.roundNo - b.roundNo) }))
      .sort((g1, g2) => latest(g2.deals).localeCompare(latest(g1.deals)))
  }, [filtered])

  const sum = (list: LedgerRow[], f: (r: LedgerRow) => number | null) => list.reduce((a, r) => a + (f(r) ?? 0), 0)
  const sale = (r: LedgerRow): number | null =>
    r.amountProduct === null && r.amountConstruction === null ? null : (r.amountProduct ?? 0) + (r.amountConstruction ?? 0)

  const goHospital = (code: string) => router.push(`/hospitals/${code}`)

  const subtotalTd = 'whitespace-nowrap px-2.5 py-1 text-right text-[12px] font-semibold text-gray-700'

  return (
    <div className="p-6">
      <PageHeader title="도입 현황" description="병원 기준 그룹 뷰 — 행은 도입계약(차수, 영업 수기 입력이 원본). 계약 완료 후 프로젝트를 매핑하면 공사 단계·일정이 자동 표시됩니다. 등록·수정은 병원 상세 > 영업 정보 > 계약 이력에서." />

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
        <select className={selCls} value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">판매모델 전체</option>
          {options.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className={selCls} value={sido} onChange={(e) => setSido(e.target.value)}>
          <option value="">지역 전체</option>
          {options.sidos.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={selCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">담당 전체</option>
          {options.owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className={selCls} value={taxInvoice} onChange={(e) => setTaxInvoice(e.target.value)}>
          <option value="">세금계산서 전체</option>
          {options.taxInvoices.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500">병원 {groups.length}곳 · 계약 {filtered.length}건 / 전체 {rows.length}건</span>
      </div>

      <div className="mt-3 overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm" style={{ maxHeight: 'calc(100vh - 15rem)' }}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="sticky top-0 z-20 bg-gray-50">
            <tr>
              <th className={`${thCls} sticky left-0 z-30 bg-gray-50`}>병원명</th>
              <th className={thCls}>종별</th>
              <th className={thCls}>지역</th>
              <th className={thCls}>도입계약</th>
              <th className={thCls}>딜 상태</th>
              <th className={thCls}>공사 단계</th>
              <th className={thCls}>판매모델(병원/씨어스)</th>
              <th className={thCls}>계약일</th>
              <th className={thCls}>도입병동</th>
              <th className={`${thCls} text-right`}>병동</th>
              <th className={`${thCls} text-right`}>병상</th>
              <th className={`${thCls} text-right`}>제품가</th>
              <th className={`${thCls} text-right`}>공사비</th>
              <th className={`${thCls} text-right`}>판매</th>
              <th className={`${thCls} text-right`}>실판매액</th>
              <th className={thCls}>세금계산서</th>
              <th className={thCls}>정산</th>
              <th className={thCls}>공사시작</th>
              <th className={thCls}>공사완료(예정)</th>
              <th className={thCls}>교육일</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={20} className="px-3 py-8 text-center text-sm text-gray-400">표시할 도입 건이 없습니다. 병원 상세의 영업 정보 &gt; 계약 이력에서 차수를 등록하세요.</td></tr>
            )}
            {groups.map((g, gi) => {
              const h = g.deals[0]
              const many = g.deals.length > 1
              const span = g.deals.length + (many ? 1 : 0) // 소계 행 포함
              const groupBg = gi % 2 === 1 ? 'bg-gray-50/50' : ''
              return (
                <FragmentGroup key={g.key}>
                  {g.deals.map((r, i) => (
                    <tr key={r.id} className={`border-t ${i === 0 ? 'border-gray-300' : 'border-gray-100'} ${groupBg} hover:bg-blue-50/40`} title={r.remark ?? undefined}>
                      {i === 0 && (
                        <>
                          <td rowSpan={span} className={`${tdCls} sticky left-0 z-10 cursor-pointer align-top ${gi % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`} onClick={() => goHospital(g.key)}>
                            <div className="font-medium text-blue-700 hover:underline">{h.hospitalName}</div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <Badge v={h.stage} />
                              {h.owner && <span className="text-[11px] text-gray-500">담당 {h.owner}</span>}
                            </div>
                          </td>
                          <td rowSpan={span} className={`${tdCls} align-top`}>{h.hospitalType}</td>
                          <td rowSpan={span} className={`${tdCls} align-top`}>{h.sido ?? '—'}</td>
                        </>
                      )}
                      <td className={`${tdCls} cursor-pointer`} onClick={() => goHospital(g.key)}>
                        <span className="font-medium">{r.roundNo}차</span>
                        {r.projectCode && (
                          <Link href={`/projects/${r.projectCode}`} className="ml-1.5 text-[11px] text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                            프로젝트
                          </Link>
                        )}
                      </td>
                      <td className={tdCls}><Badge v={r.dealStatus} /></td>
                      <td className={tdCls}><Badge v={r.buildStatus} /></td>
                      <td className={tdCls}>{r.hospitalModel ?? '—'} / {r.seersModel ?? '—'}</td>
                      <td className={tdCls}>{r.contractDate ?? '—'}</td>
                      <td className={`${tdCls} max-w-[110px] truncate`} title={[r.wardsText, r.deptsText].filter(Boolean).join(' | ') || undefined}>{r.wardsText ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{r.wardCount ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{r.bedCount ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{fmtWon(r.amountProduct)}</td>
                      <td className={`${tdCls} text-right`}>{fmtWon(r.amountConstruction)}</td>
                      <td className={`${tdCls} text-right`}>{fmtWon(sale(r))}</td>
                      <td className={`${tdCls} text-right font-medium`}>{fmtWon(r.amountActual)}</td>
                      <td className={tdCls}>{r.taxInvoice ?? '—'}</td>
                      <td className={tdCls}>{r.settlement ?? '—'}</td>
                      <td className={tdCls}>{r.startDate ?? '—'}</td>
                      <td className={tdCls}>{r.endDateExpected ?? '—'}</td>
                      <td className={tdCls}>{r.educationDate ?? '—'}</td>
                    </tr>
                  ))}
                  {many && (
                    <tr className={`${groupBg}`}>
                      <td colSpan={6} className="px-2.5 py-1 text-right text-[12px] font-medium text-gray-400">소계 ({g.deals.length}건)</td>
                      <td className={subtotalTd}>{sum(g.deals, (r) => r.wardCount) || '—'}</td>
                      <td className={subtotalTd}>{sum(g.deals, (r) => r.bedCount) || '—'}</td>
                      <td className={subtotalTd}>{fmtWon(sum(g.deals, (r) => r.amountProduct))}</td>
                      <td className={subtotalTd}>{fmtWon(sum(g.deals, (r) => r.amountConstruction))}</td>
                      <td className={subtotalTd}>{fmtWon(sum(g.deals, sale))}</td>
                      <td className={subtotalTd}>{fmtWon(sum(g.deals, (r) => r.amountActual))}</td>
                      <td colSpan={5} />
                    </tr>
                  )}
                </FragmentGroup>
              )
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="sticky bottom-0 border-t border-gray-300 bg-gray-50">
              <tr>
                <td colSpan={9} className="px-2.5 py-2 text-xs font-medium text-gray-500">합계 (병원 {groups.length}곳 · 계약 {filtered.length}건)</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{sum(filtered, (r) => r.wardCount) || '—'}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{sum(filtered, (r) => r.bedCount) || '—'}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{fmtWon(sum(filtered, (r) => r.amountProduct))}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{fmtWon(sum(filtered, (r) => r.amountConstruction))}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{fmtWon(sum(filtered, sale))}</td>
                <td className="px-2.5 py-2 text-right text-[13px] font-semibold text-gray-900">{fmtWon(sum(filtered, (r) => r.amountActual))}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

/** key를 가진 그룹 래퍼 — React.Fragment에 key만 부여 */
function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
