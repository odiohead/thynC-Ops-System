'use client'

/**
 * 도입 현황 v2 — 영업 파이프라인 테이블 (실험, /sales 비교용)
 * 원칙: 레코드 출발점 = 영업 수기 입력.
 *  - [계약 등록]: 이 화면에서 병원 검색 → 새 차수 생성 (기본 상태 '영업중')
 *  - 미매핑 딜: 계약 전 운영 항목(답사·설치계획 건수) 표시 + [프로젝트 매핑] 액션
 *  - 매핑 딜: 공사 단계·일정 자동 표시 (운영 축 조인)
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/ui/PageHeader'

export interface PipelineRow {
  id: number
  dealCode: string
  roundNo: number
  hospitalCode: string
  hospitalName: string
  hospitalType: string
  sido: string | null
  stage: { name: string; color: string | null } | null
  owner: string | null
  visitCount: number
  planCount: number
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
  projectName: string | null
  remark: string | null
}

export interface PipelineMasters {
  dealStatuses: Array<{ id: number; name: string }>
  models: Array<{ id: number; name: string }>
}

const fmtWon = (v: number | null) => (v === null ? '—' : v.toLocaleString('ko-KR'))
const thCls = 'whitespace-nowrap px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-gray-400'
const tdCls = 'whitespace-nowrap px-2.5 py-1.5 text-[13px] text-gray-800'
const selCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none'
const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'
const labelCls = 'mb-1 block text-xs font-medium text-gray-500'
const btnPrimary = 'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50'
const btnGhost = 'rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100'

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

/** 병원 검색 공용 훅 UI — 2글자 이상 입력 시 검색 */
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
      <input className={inputCls} placeholder="병원명 2글자 이상 입력" value={query} onChange={(e) => setQuery(e.target.value)} />
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

/** 계약 등록 모달 — 영업 수기 입력의 시작점. 상세 필드는 병원 상세에서 이어서 입력 */
function CreateDealModal({ masters, existingRounds, onClose, onDone }: {
  masters: PipelineMasters
  existingRounds: Map<string, number>
  onClose: () => void
  onDone: () => void
}) {
  const [target, setTarget] = useState<HospitalPick | null>(null)
  const [form, setForm] = useState({ statusId: '', hospitalModelId: '', wardCount: '', bedCount: '', remark: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextRound = target ? (existingRounds.get(target.hospitalCode) ?? 0) + 1 : null

  const submit = async () => {
    if (!target) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/hospitals/${target.hospitalCode}/sales/deals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusId: form.statusId === '' ? null : parseInt(form.statusId), // 미지정 시 서버 기본 '영업중'
        hospitalModelId: form.hospitalModelId === '' ? null : parseInt(form.hospitalModelId),
        wardCount: form.wardCount === '' ? null : form.wardCount,
        bedCount: form.bedCount === '' ? null : form.bedCount,
        remark: form.remark,
      }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '등록에 실패했습니다.'); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-800">계약 등록 (영업 시작)</h3>
        <p className="mt-1 text-xs text-gray-500">새 도입 추진 건을 만듭니다. 기본 상태는 &lsquo;영업중&rsquo;, 금액·도입병동 등 상세는 병원 상세 &gt; 계약 이력에서 이어서 입력하세요.</p>
        <div className="mt-4">
          <label className={labelCls}>병원 *</label>
          <HospitalSearch target={target} setTarget={setTarget} />
          {nextRound !== null && <p className="mt-1 text-xs text-blue-600">{nextRound}차로 등록됩니다</p>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>상태</label>
            <select className={inputCls} value={form.statusId} onChange={(e) => setForm({ ...form, statusId: e.target.value })}>
              <option value="">영업중 (기본)</option>
              {masters.dealStatuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>병원 판매모델</label>
            <select className={inputCls} value={form.hospitalModelId} onChange={(e) => setForm({ ...form, hospitalModelId: e.target.value })}>
              <option value="">미지정</option>
              {masters.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>병동수 (예상)</label><input type="number" min={0} className={inputCls} value={form.wardCount} onChange={(e) => setForm({ ...form, wardCount: e.target.value })} /></div>
          <div><label className={labelCls}>병상수 (예상)</label><input type="number" min={0} className={inputCls} value={form.bedCount} onChange={(e) => setForm({ ...form, bedCount: e.target.value })} /></div>
          <div className="col-span-2"><label className={labelCls}>비고</label><input className={inputCls} placeholder="예: 3차 확장 희망 — 재활병동" value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} /></div>
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

/** 프로젝트 매핑 모달 — 계약 완료 후 구축 프로젝트 연결/해제 (다른 필드 불변) */
function MapProjectModal({ row, onClose, onDone }: { row: PipelineRow; onClose: () => void; onDone: () => void }) {
  const [projects, setProjects] = useState<Array<{ projectCode: string; projectName: string }> | null>(null)
  const [selected, setSelected] = useState<string>(row.projectCode ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/hospitals/${row.hospitalCode}/sales`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setProjects(json?.masters?.projects ?? []))
      .catch(() => setProjects([]))
  }, [row.hospitalCode])

  const submit = async () => {
    setBusy(true); setError(null)
    const res = await fetch(`/api/hospitals/${row.hospitalCode}/sales/deals/${row.id}/map-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: selected || null }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '매핑에 실패했습니다.'); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-800">{row.hospitalName} {row.roundNo}차 — 프로젝트 매핑</h3>
        <p className="mt-1 text-xs text-gray-500">계약 완료 후 구축 실무자가 만든 프로젝트를 연결합니다. 연결하면 공사 단계·일정이 자동 표시됩니다.</p>
        <div className="mt-4">
          {projects === null ? (
            <p className="text-sm text-gray-400">프로젝트 목록 불러오는 중…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-gray-400">이 병원에 등록된 프로젝트가 없습니다. 구축 실무자가 프로젝트를 생성한 뒤 매핑하세요.</p>
          ) : (
            <ul className="max-h-52 space-y-1 overflow-y-auto">
              <li>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <input type="radio" name="proj" checked={selected === ''} onChange={() => setSelected('')} />
                  연결 안 함 (영업 단계)
                </label>
              </li>
              {projects.map((p) => (
                <li key={p.projectCode}>
                  <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <input type="radio" name="proj" checked={selected === p.projectCode} onChange={() => setSelected(p.projectCode)} />
                    {p.projectName} <span className="text-xs text-gray-400">{p.projectCode}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>취소</button>
          <button onClick={submit} disabled={busy || projects === null} className={btnPrimary}>저장</button>
        </div>
      </div>
    </div>
  )
}

interface HospitalGroup { key: string; deals: PipelineRow[] }

export default function SalesPipelineTable({ rows, masters }: { rows: PipelineRow[]; masters: PipelineMasters }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [dealStatus, setDealStatus] = useState('')
  const [model, setModel] = useState('')
  const [sido, setSido] = useState('')
  const [owner, setOwner] = useState('')
  const [creating, setCreating] = useState(false)
  const [mapping, setMapping] = useState<PipelineRow | null>(null)

  const options = useMemo(() => ({
    dealStatuses: uniq(rows.map((r) => r.dealStatus?.name ?? null)),
    models: uniq([...rows.map((r) => r.hospitalModel), ...rows.map((r) => r.seersModel)]),
    sidos: uniq(rows.map((r) => r.sido)),
    owners: uniq(rows.map((r) => r.owner)),
  }), [rows])

  const existingRounds = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.hospitalCode, Math.max(m.get(r.hospitalCode) ?? 0, r.roundNo))
    return m
  }, [rows])

  const filtered = useMemo(() => rows.filter((r) => {
    if (q && !r.hospitalName.toLowerCase().includes(q.trim().toLowerCase())) return false
    if (dealStatus && r.dealStatus?.name !== dealStatus) return false
    if (model && r.hospitalModel !== model && r.seersModel !== model) return false
    if (sido && r.sido !== sido) return false
    if (owner && r.owner !== owner) return false
    return true
  }), [rows, q, dealStatus, model, sido, owner])

  const groups = useMemo<HospitalGroup[]>(() => {
    const map = new Map<string, PipelineRow[]>()
    for (const r of filtered) {
      const list = map.get(r.hospitalCode)
      if (list) list.push(r)
      else map.set(r.hospitalCode, [r])
    }
    const latest = (deals: PipelineRow[]) => deals.reduce<string>((m, d) => (d.contractDate && d.contractDate > m ? d.contractDate : m), '')
    return Array.from(map.entries())
      .map(([key, deals]) => ({ key, deals: deals.sort((a, b) => a.roundNo - b.roundNo) }))
      .sort((g1, g2) => latest(g2.deals).localeCompare(latest(g1.deals)))
  }, [filtered])

  const sum = (list: PipelineRow[], f: (r: PipelineRow) => number | null) => list.reduce((a, r) => a + (f(r) ?? 0), 0)
  const sale = (r: PipelineRow): number | null =>
    r.amountProduct === null && r.amountConstruction === null ? null : (r.amountProduct ?? 0) + (r.amountConstruction ?? 0)

  const refresh = () => router.refresh()
  const goHospital = (code: string) => router.push(`/hospitals/${code}`)
  const subtotalTd = 'whitespace-nowrap px-2.5 py-1 text-right text-[12px] font-semibold text-gray-700'

  return (
    <div className="p-6">
      <PageHeader
        title="도입 현황 v2 (영업 파이프라인)"
        description="영업 수기 입력이 원본 — 이 화면에서 새 차수를 등록(기본 '영업중')하고, 계약 완료 후 프로젝트를 매핑하면 공사 정보가 자동으로 붙습니다. 답사·설치계획은 계약 전 영업 과정의 운영 항목으로 병원 레벨 건수를 표시합니다."
        actions={<button onClick={() => setCreating(true)} className={btnPrimary}>+ 계약 등록</button>}
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
        <span className="ml-auto text-sm text-gray-500">병원 {groups.length}곳 · 계약 {filtered.length}건 / 전체 {rows.length}건</span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className={thCls}>병원명</th>
              <th className={thCls}>종별</th>
              <th className={thCls}>지역</th>
              <th className={thCls}>도입계약</th>
              <th className={thCls}>딜 상태</th>
              <th className={thCls}>프로젝트 (계약 후 매핑)</th>
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
              <tr><td colSpan={21} className="px-3 py-8 text-center text-sm text-gray-400">표시할 도입 건이 없습니다. 우측 상단 [계약 등록]으로 영업 건을 만들어보세요.</td></tr>
            )}
            {groups.map((g, gi) => {
              const h = g.deals[0]
              const many = g.deals.length > 1
              const span = g.deals.length + (many ? 1 : 0)
              const groupBg = gi % 2 === 1 ? 'bg-gray-50/50' : ''
              return (
                <FragmentGroup key={g.key}>
                  {g.deals.map((r, i) => (
                    <tr key={r.id} className={`border-t ${i === 0 ? 'border-gray-300' : 'border-gray-100'} ${groupBg} hover:bg-blue-50/40`} title={r.remark ?? undefined}>
                      {i === 0 && (
                        <>
                          <td rowSpan={span} className={`${tdCls} cursor-pointer align-top`} onClick={() => goHospital(g.key)}>
                            <div className="font-medium text-blue-700 hover:underline">{h.hospitalName}</div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <Badge v={h.stage} />
                              {h.owner && <span className="text-[11px] text-gray-500">담당 {h.owner}</span>}
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-400">답사 {h.visitCount}건 · 설치계획 {h.planCount}건</div>
                          </td>
                          <td rowSpan={span} className={`${tdCls} align-top`}>{h.hospitalType}</td>
                          <td rowSpan={span} className={`${tdCls} align-top`}>{h.sido ?? '—'}</td>
                        </>
                      )}
                      <td className={`${tdCls} cursor-pointer`} onClick={() => goHospital(g.key)}>
                        <span className="font-medium">{r.roundNo}차</span>
                        <span className="ml-1 text-[11px] text-gray-400">{r.dealCode}</span>
                      </td>
                      <td className={tdCls}><Badge v={r.dealStatus} /></td>
                      <td className={tdCls}>
                        {r.projectCode ? (
                          <span className="flex items-center gap-1.5">
                            <Link href={`/projects/${r.projectCode}`} className="text-blue-600 hover:underline">{r.projectName}</Link>
                            <button onClick={() => setMapping(r)} className="text-[11px] text-gray-400 hover:underline">변경</button>
                          </span>
                        ) : (
                          <button onClick={() => setMapping(r)} className="rounded border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-500 hover:border-blue-400 hover:text-blue-600">매핑</button>
                        )}
                      </td>
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
                    <tr className={groupBg}>
                      <td colSpan={7} className="px-2.5 py-1 text-right text-[12px] font-medium text-gray-400">소계 ({g.deals.length}건)</td>
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
                <td colSpan={10} className="px-2.5 py-2 text-xs font-medium text-gray-500">합계 (병원 {groups.length}곳 · 계약 {filtered.length}건)</td>
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

      {creating && (
        <CreateDealModal masters={masters} existingRounds={existingRounds} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh() }} />
      )}
      {mapping && (
        <MapProjectModal row={mapping} onClose={() => setMapping(null)} onDone={() => { setMapping(null); refresh() }} />
      )}
    </div>
  )
}

function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
