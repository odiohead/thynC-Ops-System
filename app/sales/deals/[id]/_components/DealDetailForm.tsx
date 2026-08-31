'use client'

/**
 * 딜(계약 이력) 상세 편집 폼 — 엑셀 B~AK 전 항목 입력.
 * 병원·지역·종별은 자동 표시(수정 불가), 운영 축(공사 단계·일정·교육일·오더)은 연결 프로젝트에서 읽기 전용.
 * 저장은 기존 병원 스코프 딜 API(PUT /api/hospitals/[code]/sales/deals/[id]) 재사용.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/ui/PageHeader'

export interface DealMasters {
  dealStatuses: { id: number; name: string }[]
  models: { id: number; name: string }[]
  taxInvoices: { id: number; name: string }[]
  settlements: { id: number; name: string }[]
  projects: { projectCode: string; projectName: string }[]
  devices: { id: number; deviceName: string; deviceModel: string }[]
}

export interface DealDetail {
  id: number
  dealCode: string
  roundNo: number
  hospitalCode: string
  hospitalName: string
  hospitalType: string
  sido: string | null
  sigungu: string | null
  statusId: number | null
  hospitalModelId: number | null
  seersModelId: number | null
  productType: string
  contractDate: string | null
  firstContactDate: string | null
  warrantyText: string | null
  wardsText: string | null
  deptsText: string | null
  wardCount: number | null
  bedCount: number | null
  deviceQuantities: Record<number, number>
  amountProduct: number | null
  amountConstruction: number | null
  amountActual: number | null
  taxInvoiceId: number | null
  settlementId: number | null
  daewoongClientCode: string | null
  daewoongCountType: string | null
  daewoongOrderStatus: string | null
  daewoongModelKind: string | null
  daewoongModel: string | null
  daewoongDeviceCount: number | null
  daewoongAmountTotal: number | null
  daewoongBuildDate: string | null
  daewoongAmountProduct: number | null
  daewoongAmountConstruction: number | null
  daewoongAmountActual: number | null
  daewoongAmountService: number | null
  daewoongTaxInvoice: string | null
  daewoongSettlement: string | null
  daewoongPriceType: string | null
  daewoongDivision: string | null
  daewoongOffice: string | null
  daewoongManager: string | null
  daewoongPhone: string | null
  projectCode: string | null
  remark: string | null
  projectInfo: {
    projectCode: string
    projectName: string
    buildStatus: { name: string; color: string | null } | null
    startDate: string | null
    endDateExpected: string | null
    educationDate: string | null
    hasOrder: boolean
  } | null
}

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none'
const labelCls = 'mb-1 block text-xs font-medium text-gray-500'
const btnPrimary = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50'
const btnGhost = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100'
const cardCls = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm'
const sectionTitle = 'text-sm font-semibold text-gray-800'
const readonlyCls = 'rounded-lg bg-gray-50 px-3 py-1.5 text-sm text-gray-700'

export default function DealDetailForm({ deal, masters }: { deal: DealDetail; masters: DealMasters }) {
  const router = useRouter()
  const [form, setForm] = useState({
    roundNo: deal.roundNo.toString(),
    statusId: deal.statusId?.toString() ?? '',
    hospitalModelId: deal.hospitalModelId?.toString() ?? '',
    seersModelId: deal.seersModelId?.toString() ?? '',
    productType: deal.productType,
    contractDate: deal.contractDate ?? '',
    firstContactDate: deal.firstContactDate ?? '',
    warrantyText: deal.warrantyText ?? '',
    wardsText: deal.wardsText ?? '',
    deptsText: deal.deptsText ?? '',
    wardCount: deal.wardCount?.toString() ?? '',
    bedCount: deal.bedCount?.toString() ?? '',
    amountProduct: deal.amountProduct?.toString() ?? '',
    amountConstruction: deal.amountConstruction?.toString() ?? '',
    amountActual: deal.amountActual?.toString() ?? '',
    taxInvoiceId: deal.taxInvoiceId?.toString() ?? '',
    settlementId: deal.settlementId?.toString() ?? '',
    daewoongClientCode: deal.daewoongClientCode ?? '',
    daewoongCountType: deal.daewoongCountType ?? '',
    daewoongOrderStatus: deal.daewoongOrderStatus ?? '',
    daewoongModelKind: deal.daewoongModelKind ?? '',
    daewoongModel: deal.daewoongModel ?? '',
    daewoongDeviceCount: deal.daewoongDeviceCount?.toString() ?? '',
    daewoongAmountTotal: deal.daewoongAmountTotal?.toString() ?? '',
    daewoongBuildDate: deal.daewoongBuildDate ?? '',
    daewoongAmountProduct: deal.daewoongAmountProduct?.toString() ?? '',
    daewoongAmountConstruction: deal.daewoongAmountConstruction?.toString() ?? '',
    daewoongAmountActual: deal.daewoongAmountActual?.toString() ?? '',
    daewoongAmountService: deal.daewoongAmountService?.toString() ?? '',
    daewoongTaxInvoice: deal.daewoongTaxInvoice ?? '',
    daewoongSettlement: deal.daewoongSettlement ?? '',
    daewoongPriceType: deal.daewoongPriceType ?? '',
    daewoongDivision: deal.daewoongDivision ?? '',
    daewoongOffice: deal.daewoongOffice ?? '',
    daewoongManager: deal.daewoongManager ?? '',
    daewoongPhone: deal.daewoongPhone ?? '',
    projectCode: deal.projectCode ?? '',
    remark: deal.remark ?? '',
  })
  // 기기 수량 — 마스터 전체를 키로 초기화 (미저장 기기는 0). 새 기기가 늘어나도 기존 딜에 0으로 노출
  const [deviceQty, setDeviceQty] = useState<Record<number, string>>(
    Object.fromEntries(masters.devices.map((d) => [d.id, (deal.deviceQuantities[d.id] ?? 0).toString()]))
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const num = (s: string) => (s === '' ? null : Number(s.replace(/,/g, '')))
  const sale = (num(form.amountProduct) ?? 0) + (num(form.amountConstruction) ?? 0)
  const dwSale = (num(form.daewoongAmountProduct) ?? 0) + (num(form.daewoongAmountConstruction) ?? 0)

  const save = async () => {
    setBusy(true); setError(null); setSaved(false)
    const res = await fetch(`/api/hospitals/${deal.hospitalCode}/sales/deals/${deal.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roundNo: form.roundNo === '' ? null : parseInt(form.roundNo),
        statusId: form.statusId === '' ? null : parseInt(form.statusId),
        hospitalModelId: form.hospitalModelId === '' ? null : parseInt(form.hospitalModelId),
        seersModelId: form.seersModelId === '' ? null : parseInt(form.seersModelId),
        productType: form.productType,
        contractDate: form.contractDate || null,
        firstContactDate: form.firstContactDate || null,
        warrantyText: form.warrantyText,
        wardsText: form.wardsText,
        deptsText: form.deptsText,
        wardCount: form.wardCount === '' ? null : form.wardCount,
        bedCount: form.bedCount === '' ? null : form.bedCount,
        amountProduct: form.amountProduct,
        amountConstruction: form.amountConstruction,
        amountActual: form.amountActual,
        taxInvoiceId: form.taxInvoiceId === '' ? null : parseInt(form.taxInvoiceId),
        settlementId: form.settlementId === '' ? null : parseInt(form.settlementId),
        daewoongClientCode: form.daewoongClientCode,
        daewoongCountType: form.daewoongCountType,
        daewoongOrderStatus: form.daewoongOrderStatus,
        daewoongModelKind: form.daewoongModelKind,
        daewoongModel: form.daewoongModel,
        daewoongDeviceCount: form.daewoongDeviceCount === '' ? null : parseInt(form.daewoongDeviceCount),
        daewoongAmountTotal: form.daewoongAmountTotal,
        daewoongBuildDate: form.daewoongBuildDate || null,
        daewoongAmountProduct: form.daewoongAmountProduct,
        daewoongAmountConstruction: form.daewoongAmountConstruction,
        daewoongAmountActual: form.daewoongAmountActual,
        daewoongAmountService: form.daewoongAmountService,
        daewoongTaxInvoice: form.daewoongTaxInvoice,
        daewoongSettlement: form.daewoongSettlement,
        daewoongPriceType: form.daewoongPriceType,
        daewoongDivision: form.daewoongDivision,
        daewoongOffice: form.daewoongOffice,
        daewoongManager: form.daewoongManager,
        daewoongPhone: form.daewoongPhone,
        projectCode: form.projectCode || null,
        remark: form.remark,
        devices: masters.devices.map((d) => ({ deviceId: d.id, quantity: parseInt(deviceQty[d.id] || '0') || 0 })),
      }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '저장에 실패했습니다.'); return }
    setSaved(true)
    router.refresh()
  }

  const remove = async () => {
    if (!confirm(`${deal.hospitalName} ${deal.roundNo}차 딜(${deal.dealCode})을 삭제할까요?`)) return
    const res = await fetch(`/api/hospitals/${deal.hospitalCode}/sales/deals/${deal.id}`, { method: 'DELETE' })
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '삭제에 실패했습니다.'); return }
    router.refresh()
    router.push('/sales/deals')
  }

  // 금액 입력 — 표시값은 천 단위 쉼표, 상태값은 숫자만 보관
  const Money = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        inputMode="numeric"
        className={inputCls}
        value={value === '' ? '' : Number(value).toLocaleString('ko-KR')}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
      />
    </div>
  )

  const Sel = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { id: number; name: string }[] }) => (
    <div>
      <label className={labelCls}>{label}</label>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">미지정</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  )

  const p = deal.projectInfo

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        title={`${deal.hospitalName} ${deal.roundNo}차 — 계약 이력 상세`}
        description={`${deal.dealCode} · 병원·지역·종별은 자동 표시되며, 공사 일정·교육일은 연결 프로젝트에서 가져옵니다.`}
        actions={
          <>
            <Link href="/sales/deals" className={btnGhost}>목록으로</Link>
            <button onClick={remove} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50">삭제</button>
          </>
        }
      />

      {/* 병원 (매핑 완료 — 읽기 전용) */}
      <div className={cardCls}>
        <h3 className={sectionTitle}>병원 (등록 시 매핑 — 변경 불가)</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className={labelCls}>병원명</label>
            <div className={readonlyCls}>
              <Link href={`/hospitals/${deal.hospitalCode}`} className="font-medium text-blue-700 hover:underline">{deal.hospitalName}</Link>
            </div>
          </div>
          <div><label className={labelCls}>종별 (자동)</label><div className={readonlyCls}>{deal.hospitalType}</div></div>
          <div><label className={labelCls}>지역 (자동)</label><div className={readonlyCls}>{[deal.sido, deal.sigungu].filter(Boolean).join(' ') || '—'}</div></div>
          <div><label className={labelCls}>차수</label><input type="number" min={1} className={inputCls} value={form.roundNo} onChange={(e) => setForm({ ...form, roundNo: e.target.value })} /></div>
        </div>
        <p className="mt-2 text-xs text-gray-400">병원을 잘못 매핑했다면 이 딜을 삭제하고 다시 등록하세요.</p>
      </div>

      {/* 규모 · 계약 */}
      <div className={`${cardCls} mt-4`}>
        <h3 className={sectionTitle}>규모 · 계약</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Sel label="딜 상태" value={form.statusId} onChange={(v) => setForm({ ...form, statusId: v })} options={masters.dealStatuses} />
          <Sel label="병원 판매모델" value={form.hospitalModelId} onChange={(v) => setForm({ ...form, hospitalModelId: v })} options={masters.models} />
          <Sel label="씨어스 판매방식" value={form.seersModelId} onChange={(v) => setForm({ ...form, seersModelId: v })} options={masters.models} />
          <div>
            <label className={labelCls}>상품유형</label>
            <select className={inputCls} value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value })}>
              <option value="일반">일반</option>
              <option value="라이트">라이트</option>
            </select>
          </div>
          <div><label className={labelCls}>보증기간</label><input className={inputCls} placeholder="예: 1년" value={form.warrantyText} onChange={(e) => setForm({ ...form, warrantyText: e.target.value })} /></div>
          <div><label className={labelCls}>최초 인입일</label><input type="date" className={inputCls} value={form.firstContactDate} onChange={(e) => setForm({ ...form, firstContactDate: e.target.value })} /></div>
          <div><label className={labelCls}>계약일</label><input type="date" className={inputCls} value={form.contractDate} onChange={(e) => setForm({ ...form, contractDate: e.target.value })} /></div>
          <div><label className={labelCls}>도입병동</label><input className={inputCls} placeholder="예: IM, ICU" value={form.wardsText} onChange={(e) => setForm({ ...form, wardsText: e.target.value })} /></div>
          <div><label className={labelCls}>도입진료과</label><input className={inputCls} placeholder="예: 내과계, 중환자실" value={form.deptsText} onChange={(e) => setForm({ ...form, deptsText: e.target.value })} /></div>
          <div><label className={labelCls}>병동수 (계약 스냅샷)</label><input type="number" min={0} className={inputCls} value={form.wardCount} onChange={(e) => setForm({ ...form, wardCount: e.target.value })} /></div>
          <div><label className={labelCls}>병상수 (계약 스냅샷)</label><input type="number" min={0} className={inputCls} value={form.bedCount} onChange={(e) => setForm({ ...form, bedCount: e.target.value })} /></div>
        </div>

        {/* 도입 기기 수량 — 설정 > 장비 정보 마스터 기준 (계약 스냅샷, 운영 실측은 연결 프로젝트) */}
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500">
            도입 기기 수량
            <span className="ml-2 font-normal text-gray-400">
              설정 &gt; 장비 정보 목록 기준 · 합계 {masters.devices.reduce((a, d) => a + (parseInt(deviceQty[d.id] || '0') || 0), 0)}대
            </span>
          </p>
          {masters.devices.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">등록된 기기가 없습니다. 설정 &gt; 장비 정보에서 기기를 먼저 등록하세요.</p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
              {masters.devices.map((d) => (
                <div key={d.id}>
                  <label className={labelCls} title={d.deviceModel}>{d.deviceName} <span className="font-normal text-gray-400">({d.deviceModel})</span></label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={deviceQty[d.id] ?? '0'}
                    onChange={(e) => setDeviceQty({ ...deviceQty, [d.id]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 금액 · 정산 (씨어스 축 — 수기 입력) */}
      <div className={`${cardCls} mt-4`}>
        <h3 className={sectionTitle}>금액 · 정산 (씨어스) <span className="text-xs font-normal text-gray-400">— 씨어스 자체 관리 금액 (대웅 원장 금액은 아래 대웅제약 카드) · &lsquo;판매&rsquo; 합계 = 제품가+공사비: {sale ? sale.toLocaleString('ko-KR') : '—'}원</span></h3>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Money label="제품(구성품) 금액 (원)" value={form.amountProduct} onChange={(v) => setForm({ ...form, amountProduct: v })} />
          <Money label="공사비 (원)" value={form.amountConstruction} onChange={(v) => setForm({ ...form, amountConstruction: v })} />
          <Money label="실판매액 (원)" value={form.amountActual} onChange={(v) => setForm({ ...form, amountActual: v })} />
          <Sel label="세금계산서 발행" value={form.taxInvoiceId} onChange={(v) => setForm({ ...form, taxInvoiceId: v })} options={masters.taxInvoices} />
          <Sel label="정산 상태" value={form.settlementId} onChange={(v) => setForm({ ...form, settlementId: v })} options={masters.settlements} />
        </div>
      </div>

      {/* 대웅제약 (대웅 축 — DW 원장 + 구파일 보강) */}
      <div className={`${cardCls} mt-4`}>
        <h3 className={sectionTitle}>대웅제약 <span className="text-xs font-normal text-gray-400">— 원천: 대웅 원장(thynC_status_DW) · 씨어스 금액과 분리 관리 · 대웅 판매 = 제품가+공사비: {dwSale ? dwSale.toLocaleString('ko-KR') : '—'}원</span></h3>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className={labelCls}>거래처코드</label><input className={inputCls} value={form.daewoongClientCode} onChange={(e) => setForm({ ...form, daewoongClientCode: e.target.value })} /></div>
          <div><label className={labelCls}>카운팅 구분</label><input className={inputCls} placeholder="병원/추가/로컬/이슈" value={form.daewoongCountType} onChange={(e) => setForm({ ...form, daewoongCountType: e.target.value })} /></div>
          <div><label className={labelCls}>오더 구분</label><input className={inputCls} placeholder="완료/미완료" value={form.daewoongOrderStatus} onChange={(e) => setForm({ ...form, daewoongOrderStatus: e.target.value })} /></div>
          <div><label className={labelCls}>공사일 (대웅)</label><input type="date" className={inputCls} value={form.daewoongBuildDate} onChange={(e) => setForm({ ...form, daewoongBuildDate: e.target.value })} /></div>
          <div><label className={labelCls}>판매모델 구분</label><input className={inputCls} placeholder="일반/사용량" value={form.daewoongModelKind} onChange={(e) => setForm({ ...form, daewoongModelKind: e.target.value })} /></div>
          <div><label className={labelCls}>판매모델</label><input className={inputCls} placeholder="구독형/구축형/분납형/사용량" value={form.daewoongModel} onChange={(e) => setForm({ ...form, daewoongModel: e.target.value })} /></div>
          <div><label className={labelCls}>디바이스수</label><input type="number" min={0} className={inputCls} value={form.daewoongDeviceCount} onChange={(e) => setForm({ ...form, daewoongDeviceCount: e.target.value })} /></div>
          <Money label="계약금액(총견적가) (원)" value={form.daewoongAmountTotal} onChange={(v) => setForm({ ...form, daewoongAmountTotal: v })} />
          <Money label="제품(구성품) 금액 (원)" value={form.daewoongAmountProduct} onChange={(v) => setForm({ ...form, daewoongAmountProduct: v })} />
          <Money label="공사비 (원)" value={form.daewoongAmountConstruction} onChange={(v) => setForm({ ...form, daewoongAmountConstruction: v })} />
          <Money label="실판매액 (원)" value={form.daewoongAmountActual} onChange={(v) => setForm({ ...form, daewoongAmountActual: v })} />
          <Money label="용역매출 (원)" value={form.daewoongAmountService} onChange={(v) => setForm({ ...form, daewoongAmountService: v })} />
          <div><label className={labelCls}>세금계산서</label><input className={inputCls} placeholder="완료/미정/씨어스 계약" value={form.daewoongTaxInvoice} onChange={(e) => setForm({ ...form, daewoongTaxInvoice: e.target.value })} /></div>
          <div><label className={labelCls}>정산</label><input className={inputCls} placeholder="완료/미완" value={form.daewoongSettlement} onChange={(e) => setForm({ ...form, daewoongSettlement: e.target.value })} /></div>
          <div><label className={labelCls}>판매가 유형</label><input className={inputCls} placeholder="기존/권장/최소판매가" value={form.daewoongPriceType} onChange={(e) => setForm({ ...form, daewoongPriceType: e.target.value })} /></div>
          <div><label className={labelCls}>사업부</label><input className={inputCls} placeholder="예: 서울1" value={form.daewoongDivision} onChange={(e) => setForm({ ...form, daewoongDivision: e.target.value })} /></div>
          <div><label className={labelCls}>사무소</label><input className={inputCls} placeholder="예: 병원강원" value={form.daewoongOffice} onChange={(e) => setForm({ ...form, daewoongOffice: e.target.value })} /></div>
          <div><label className={labelCls}>담당자</label><input className={inputCls} value={form.daewoongManager} onChange={(e) => setForm({ ...form, daewoongManager: e.target.value })} /></div>
          <div><label className={labelCls}>연락처</label><input className={inputCls} placeholder="010-0000-0000" value={form.daewoongPhone} onChange={(e) => setForm({ ...form, daewoongPhone: e.target.value })} /></div>
        </div>
      </div>

      {/* 프로젝트 연결 · 운영 축 (읽기 전용) */}
      <div className={`${cardCls} mt-4`}>
        <h3 className={sectionTitle}>프로젝트 연결 · 공사 정보 <span className="text-xs font-normal text-gray-400">— 단계·일정·교육일·오더는 연결 프로젝트에서 자동 표시</span></h3>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2">
            <label className={labelCls}>연결 프로젝트 (계약 완료 후 매핑)</label>
            <select className={inputCls} value={form.projectCode} onChange={(e) => setForm({ ...form, projectCode: e.target.value })}>
              <option value="">없음 — 영업 단계</option>
              {masters.projects.map((pr) => <option key={pr.projectCode} value={pr.projectCode}>{pr.projectName}</option>)}
            </select>
          </div>
          {p && (
            <>
              <div>
                <label className={labelCls}>공사 단계</label>
                <div className={readonlyCls}>
                  {p.buildStatus ? (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: p.buildStatus.color || '#94a3b8' }}>{p.buildStatus.name}</span>
                  ) : '—'}
                  <span className="ml-2 text-xs">{p.hasOrder ? '발주' : '미발주'}</span>
                </div>
              </div>
              <div><label className={labelCls}>공사시작 / 완료(예정) / 교육일</label><div className={readonlyCls}>{p.startDate ?? '—'} / {p.endDateExpected ?? '—'} / {p.educationDate ?? '—'}</div></div>
            </>
          )}
        </div>
        {p && (
          <p className="mt-2 text-xs text-gray-400">
            연결됨: <Link href={`/projects/${p.projectCode}`} className="text-blue-600 hover:underline">{p.projectName}</Link>
          </p>
        )}
      </div>

      {/* 비고 */}
      <div className={`${cardCls} mt-4`}>
        <h3 className={sectionTitle}>비고</h3>
        <textarea rows={3} className={`${inputCls} mt-3`} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
      </div>

      <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-3 border-t border-gray-200 bg-white/90 py-3 backdrop-blur">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && <p className="text-sm text-emerald-600">저장되었습니다.</p>}
        <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? '저장 중…' : '저장'}</button>
      </div>
    </div>
  )
}
