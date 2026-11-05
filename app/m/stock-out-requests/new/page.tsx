'use client'

/**
 * 모바일 출고요청 등록 — 영업 유형(평가용·판매용·오산영업소) (projects/stock_out_sales_request_design.md §6)
 * 유형 → 목적(유형별, 1개면 자동) → 납품처(병원 검색 / 기타 텍스트) → 수령지·수취인 → 희망 출고일 → 품목별 수량 → 비고 → 등록.
 * 품목 목록 = 설정 > 출고 품목 관리의 해당 유형 탭 체크 품목 (체크한 품목의 인벤토리에서 출고).
 * 등록 = 출고업무(STOCK_OUT) 도메인 레코드 + 연결 티켓 자동 생성 (기존 POST /api/stock-out-requests).
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Minus, Plus } from 'lucide-react'
import MobileHeader from '../../_components/MobileHeader'
import HospitalSearch, { type HospitalPick } from '../../_components/HospitalSearch'
import { MButton, MInput, Notice, Section, Segmented, localDate } from '../../_components/ui'
import { useMobileMe } from '../../_components/useMobileMe'
import { cn } from '@/lib/cn'
import {
  STOCK_OUT_SALES_TYPES, STOCK_OUT_PURPOSE_LABELS, STOCK_OUT_SUB_PURPOSES, STOCK_OUT_GUIDE_FIELDS,
  type StockOutSalesType, type StockOutGuideKey,
} from '@/lib/stockOutShared'

interface ItemOption { id: number; name: string; modelName: string | null; stockTotal: number }
interface InventoryGroup { id: number; name: string; items: ItemOption[] }

const DEFAULT_GUIDES = Object.fromEntries(STOCK_OUT_GUIDE_FIELDS.map((f) => [f.key, f.fallback])) as Record<StockOutGuideKey, string>

/** 항목 블록 — 제목 바로 아래 가이드 (설정 > 출고 품목 관리 > 입력 가이드) */
function Block({ title, guide, required, children }: { title: string; guide?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">
        {title}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </p>
      {guide && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{guide}</p>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" aria-label="빼기" onClick={() => onChange(Math.max(0, value - 1))} disabled={value === 0}
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground active:bg-accent disabled:opacity-30">
        <Minus size={18} />
      </button>
      <input
        type="number" inputMode="numeric" min={0} value={value === 0 ? '' : value} placeholder="0"
        onChange={(e) => onChange(Math.max(0, Math.min(999, Math.trunc(Number(e.target.value) || 0))))}
        className={cn('h-10 w-14 rounded-lg border bg-card text-center text-base font-semibold focus:border-primary focus:outline-none', value > 0 ? 'border-primary text-primary' : 'border-border')}
      />
      <button type="button" aria-label="더하기" onClick={() => onChange(Math.min(999, value + 1))}
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground active:bg-accent">
        <Plus size={18} />
      </button>
    </div>
  )
}

export default function MobileStockOutRequestNewPage() {
  const router = useRouter()
  const { me } = useMobileMe()
  const [guides, setGuides] = useState<Record<StockOutGuideKey, string>>(DEFAULT_GUIDES)

  const [type, setType] = useState<StockOutSalesType | ''>('')
  const [subPurpose, setSubPurpose] = useState('')
  const [destType, setDestType] = useState<'HOSPITAL' | 'OTHER' | ''>('')
  const [hospital, setHospital] = useState<HospitalPick | null>(null)
  const [destText, setDestText] = useState('')
  const [shipAddress, setShipAddress] = useState('')
  const [recipient, setRecipient] = useState('')
  const [requestDate, setRequestDate] = useState(localDate())
  const [qty, setQty] = useState<Record<number, number>>({})
  const [note, setNote] = useState('')

  const [groups, setGroups] = useState<InventoryGroup[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ id: number; sorCode: string; ticketCode: string | null } | null>(null)

  useEffect(() => {
    fetch('/api/settings/stock-out-guides', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.guides && setGuides({ ...DEFAULT_GUIDES, ...d.guides }))
      .catch(() => {})
  }, [])

  // 유형 변경 → 목적·품목 초기화, 목적이 1개면 자동 선택, 해당 유형 노출 품목 로드
  useEffect(() => {
    setQty({})
    setGroups([])
    if (!type) { setSubPurpose(''); return }
    const opts = STOCK_OUT_SUB_PURPOSES[type]
    setSubPurpose(opts.length === 1 ? opts[0].code : '')
    setItemsLoading(true)
    fetch(`/api/settings/stock-out-items?purpose=${type}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { inventories: [] }))
      .then((d) => setGroups(d.inventories ?? []))
      .catch(() => setGroups([]))
      .finally(() => setItemsLoading(false))
  }, [type])

  const lines = useMemo(() => Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ inventoryItemId: Number(id), quantity: q })), [qty])
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0)

  function validate(): string {
    if (!type) return '유형을 선택하세요.'
    if (!subPurpose) return '목적을 선택하세요.'
    if (!destType) return '납품처(병원/기타)를 선택하세요.'
    if (destType === 'HOSPITAL' && !hospital) return '납품처 병원을 검색해서 선택하세요.'
    if (destType === 'OTHER' && !destText.trim()) return '납품처를 입력하세요.'
    if (!shipAddress.trim()) return '수령지를 입력하세요.'
    if (!recipient.trim()) return '수취인을 입력하세요.'
    if (!requestDate) return '희망 출고일을 선택하세요.'
    if (lines.length === 0) return '품목 수량을 1개 이상 입력하세요.'
    return ''
  }

  async function submit() {
    const v = validate()
    if (v) { setError(v); return }
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/stock-out-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: type, subPurpose, destType,
          destHospitalCode: destType === 'HOSPITAL' ? hospital?.hospitalCode : null,
          destText: destType === 'OTHER' ? destText.trim() : null,
          shipAddress: shipAddress.trim(), recipient: recipient.trim(),
          requestDate, items: lines, note: note.trim() || null,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? '등록하지 못했습니다.'); return }
      router.refresh()
      const r = d.stockOutRequest
      setDone({ id: r.id, sorCode: r.sorCode, ticketCode: r.ticket?.ticketCode ?? null })
      window.scrollTo({ top: 0 })
    } catch {
      setError('네트워크 오류로 등록하지 못했습니다. 다시 시도하세요.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <>
        <MobileHeader title="출고요청" />
        <main className="mx-auto max-w-lg space-y-4 p-4">
          <Section>
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-subtle text-success"><Check size={30} strokeWidth={3} /></span>
              <p className="text-lg font-bold">출고요청을 등록했습니다</p>
              <p className="font-mono text-sm text-muted-foreground">{done.sorCode}{done.ticketCode ? ` · ${done.ticketCode}` : ''}</p>
              <p className="text-sm text-muted-foreground">자재 담당자에게 알림이 갑니다.</p>
            </div>
          </Section>
          <MButton size="lg" className="w-full" onClick={() => router.push(`/m/stock-out-requests/${done.id}`)}>요청 내용 보기</MButton>
          <MButton size="lg" variant="outline" className="w-full" onClick={() => router.push('/m/stock-out-requests')}>내 출고요청 목록</MButton>
        </main>
      </>
    )
  }

  const viewer = me?.role === 'VIEWER'
  const typeInventory = groups.filter((g) => g.name !== 'thynC운영팀재고')
  const commonInventory = groups.filter((g) => g.name === 'thynC운영팀재고')

  return (
    <>
      <MobileHeader title="출고요청 등록" back />
      <main className="mx-auto max-w-lg space-y-4 p-4 pb-28">
        {viewer && <Notice tone="warning">뷰어 등급은 출고요청을 등록할 수 없습니다.</Notice>}

        <Section>
          <div className="space-y-5">
            <Block title="유형" guide={guides.type} required>
              <Segmented
                value={type as StockOutSalesType}
                options={STOCK_OUT_SALES_TYPES.map((t) => ({ value: t, label: STOCK_OUT_PURPOSE_LABELS[t] }))}
                onChange={(v) => setType(v)}
              />
            </Block>

            {type && (
              <Block title="목적" guide={STOCK_OUT_SUB_PURPOSES[type].length > 1 ? guides.subPurpose : undefined} required>
                {STOCK_OUT_SUB_PURPOSES[type].length === 1 ? (
                  <div className="flex h-11 items-center gap-2 rounded-xl bg-muted px-3.5 text-sm font-medium">
                    <Check size={16} className="text-primary" /> {STOCK_OUT_SUB_PURPOSES[type][0].label}
                    <span className="text-xs font-normal text-muted-foreground">(자동 선택)</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {STOCK_OUT_SUB_PURPOSES[type].map((o) => (
                      <button key={o.code} type="button" onClick={() => setSubPurpose(o.code)}
                        className={cn('h-10 rounded-full border px-4 text-sm font-medium', subPurpose === o.code ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground active:bg-accent')}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </Block>
            )}
          </div>
        </Section>

        <Section>
          <div className="space-y-5">
            <Block title="납품처" guide={guides.dest} required>
              <Segmented
                value={destType as 'HOSPITAL' | 'OTHER'}
                options={[{ value: 'HOSPITAL', label: '병원' }, { value: 'OTHER', label: '기타' }]}
                onChange={(v) => setDestType(v)}
              />
              {destType === 'HOSPITAL' && <div className="mt-2"><HospitalSearch value={hospital} onChange={setHospital} /></div>}
              {destType === 'OTHER' && (
                <MInput className="mt-2" value={destText} maxLength={200} onChange={(e) => setDestText(e.target.value)} placeholder="납품처 이름 (예: OO학회 부스)" />
              )}
            </Block>

            <Block title="수령지" guide={guides.shipAddress} required>
              <textarea
                rows={2} maxLength={500} value={shipAddress} onChange={(e) => setShipAddress(e.target.value)} placeholder="받을 주소"
                className="w-full rounded-xl border border-input bg-card px-3.5 py-3 text-base placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </Block>

            <Block title="수취인" guide={guides.recipient} required>
              <MInput value={recipient} maxLength={100} onChange={(e) => setRecipient(e.target.value)} placeholder="이름 / 연락처" />
            </Block>

            <Block title="희망 출고일" guide={guides.requestDate} required>
              <MInput type="date" value={requestDate} min={localDate()} onChange={(e) => setRequestDate(e.target.value)} />
            </Block>
          </div>
        </Section>

        <Section title={<span>품목·수량<span className="ml-0.5 text-destructive">*</span></span>} right={totalQty > 0 ? <span className="text-sm font-semibold text-primary">{lines.length}종 · {totalQty}개</span> : undefined}>
          {guides.items && <p className="-mt-2 mb-3 text-xs leading-relaxed text-muted-foreground">{guides.items}</p>}
          {!type ? (
            <p className="py-4 text-center text-sm text-muted-foreground">유형을 먼저 선택하세요</p>
          ) : itemsLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : groups.length === 0 ? (
            <Notice tone="warning">이 유형에 노출된 품목이 없습니다. 관리자에게 설정 &gt; 출고 품목 관리 확인을 요청하세요.</Notice>
          ) : (
            <div className="space-y-4">
              {[...typeInventory, ...commonInventory].map((g) => (
                <div key={g.id}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{g.name}</p>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {g.items.map((it) => (
                      <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{it.modelName || it.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{it.modelName ? it.name : ''}{it.modelName ? ' · ' : ''}재고 {it.stockTotal}</p>
                        </div>
                        <Stepper value={qty[it.id] ?? 0} onChange={(n) => setQty((q) => ({ ...q, [it.id]: n }))} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section>
          <Block title="비고" guide={guides.note}>
            <textarea
              rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="부가 정보"
              className="w-full rounded-xl border border-input bg-card px-3.5 py-3 text-base placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </Block>
        </Section>

        {error && <Notice tone="error">{error}</Notice>}
      </main>

      {/* 하단 고정 등록 버튼 — 하단 탭 위 */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <MButton size="lg" className="w-full" disabled={busy || viewer} onClick={() => void submit()}>
            {busy ? '등록 중…' : totalQty > 0 ? `등록 · ${lines.length}종 ${totalQty}개` : '등록'}
          </MButton>
        </div>
      </div>
    </>
  )
}
