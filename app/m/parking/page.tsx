'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, Check, X, ChevronDown, Clock, RotateCcw } from 'lucide-react'
import type { ParkedCar, CarDiscountState, AutoPlan, AutoApplyResult, AccountState, DiscountType, PlanStep } from '@/lib/parking'
import MobileHeader from '../_components/MobileHeader'
import Modal from '@/app/components/ui/Modal'
import { MButton, MInput, Notice, Section, errMsg, localDate, safeStorage } from '../_components/ui'
import { useMobileMe } from '../_components/useMobileMe'
import { cn } from '@/lib/cn'

/**
 * 모바일 주차 등록 (mobile_pwa_design.md §5) — 서버 변경 없음, 데스크톱 /parking 과 같은 API 5종.
 * 흐름: 뒤 4자리 검색(입차일 칩) → 차량 선택 → 자동 계산 미리보기 → [자동 등록]. 수동 등록은 접이식.
 * 검색에 쓴 입차일을 이후 모든 호출에 전달 (전날 입차건 실패 사례 2026-10-07).
 */

const RECENT_KEY = 'm.parking.recent'

function fmtMin(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return h > 0 ? `${h}시간 ${mm}분` : `${mm}분`
}

function groupSteps(steps: PlanStep[]) {
  const map = new Map<string, { label: string; name: string; count: number; minutes: number; price: number }>()
  for (const s of steps) {
    const k = `${s.label}|${s.name}`
    const g = map.get(k)
    if (g) { g.count += 1; g.minutes += s.minutes; g.price += s.price }
    else map.set(k, { label: s.label, name: s.name, count: 1, minutes: s.minutes, price: s.price })
  }
  return Array.from(map.values())
}

/** "20261104093012" 또는 "2026-11-04 09:30:12" → "11/04 09:30" */
function shortTime(s: string): string {
  const d = s.replace(/\D/g, '')
  if (d.length >= 12) return `${d.slice(4, 6)}/${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}`
  return s
}

export default function MobileParkingPage() {
  const { me } = useMobileMe()
  const isViewer = me?.role === 'VIEWER'

  const [carNo, setCarNo] = useState('')
  const [dateOffset, setDateOffset] = useState<0 | -1 | null>(0) // null = 직접 선택
  const [customDate, setCustomDate] = useState(localDate(-2))
  const searchDate = dateOffset === null ? customDate : localDate(dateOffset)
  const [recent, setRecent] = useState<string[]>([])

  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [cars, setCars] = useState<ParkedCar[] | null>(null)
  const [entryDate, setEntryDate] = useState('')
  const [selected, setSelected] = useState<ParkedCar | null>(null)

  const [state, setState] = useState<CarDiscountState | null>(null)
  const [plan, setPlan] = useState<AutoPlan | null>(null)
  const [loadingCar, setLoadingCar] = useState(false)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<AutoApplyResult | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { setRecent(JSON.parse(safeStorage.get(RECENT_KEY) ?? '[]')) } catch { setRecent([]) }
  }, [])

  function remember(q: string) {
    const next = [q, ...recent.filter((r) => r !== q)].slice(0, 5)
    setRecent(next)
    safeStorage.set(RECENT_KEY, JSON.stringify(next))
  }

  function resetCar() {
    setSelected(null); setState(null); setPlan(null); setResult(null); setToast(null); setManualOpen(false)
  }

  async function search(q0?: string) {
    const q = (q0 ?? carNo).trim()
    if (q0) setCarNo(q0)
    if (q.length < 2) { setError('차량번호 2자리 이상 입력하세요.'); return }
    inputRef.current?.blur()
    setSearching(true); setError(''); setCars(null); resetCar()
    try {
      const res = await fetch('/api/parking/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carNo: q, entryDate: searchDate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '검색 실패')
      setCars(data.cars)
      setEntryDate(data.entryDate)
      remember(q)
      if (data.cars.length === 1) void selectCar(data.cars[0])
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSearching(false)
    }
  }

  /** 차량 선택 → 할인 현황 + 자동 계산을 병렬로 */
  async function selectCar(car: ParkedCar) {
    resetCar()
    setSelected(car)
    setLoadingCar(true)
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/parking/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carId: car.id }) }),
        fetch('/api/parking/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carId: car.id }) }),
      ])
      const s = await sRes.json()
      const p = await pRes.json()
      if (sRes.ok) setState(s); else setError(s.error || '할인 현황 조회 실패')
      if (pRes.ok) setPlan(p); else setError(p.error || '자동 계산 실패')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoadingCar(false)
    }
  }

  async function refreshCar() {
    if (selected) await selectCar(selected)
  }

  async function autoApply() {
    if (!selected) return
    setApplying(true)
    try {
      const res = await fetch('/api/parking/auto-apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carId: selected.id, carNo: selected.carNo, entryDate: entryDate || searchDate }),
      })
      const data = await res.json()
      setConfirmOpen(false)
      if (res.status === 403) { setToast({ ok: false, msg: '등록 권한이 없습니다.' }); return }
      // 502(예외)는 { ok:false, message } 만 온다 — results 없을 수 있음
      setResult({ ...data, results: Array.isArray(data.results) ? data.results : [] })
      setPlan(null)
      // 결과는 남겨 두고 현황만 갱신 (서버가 준 최종 상태 우선)
      if (data.finalState) setState(data.finalState)
      else {
        const sRes = await fetch('/api/parking/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carId: selected.id }) })
        if (sRes.ok) setState(await sRes.json())
      }
    } catch (e) {
      setConfirmOpen(false)
      setToast({ ok: false, msg: errMsg(e) })
    } finally {
      setApplying(false)
    }
  }

  async function registerManual(acc: AccountState, dt: DiscountType) {
    if (!selected) return
    const key = `${acc.userId}:${dt.id}`
    setBusyKey(key); setToast(null)
    try {
      const res = await fetch('/api/parking/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: acc.userId, carNo: selected.carNo, carId: selected.id, discountType: dt.id, entryDate: entryDate || searchDate }),
      })
      const data = await res.json()
      setToast({ ok: !!data.ok, msg: `[${acc.label}호] ${data.message || data.error || (data.ok ? '등록 완료' : '등록 실패')}` })
      if (data.ok) await refreshCar()
    } catch (e) {
      setToast({ ok: false, msg: `[${acc.label}호] ${errMsg(e)}` })
    } finally {
      setBusyKey(null)
    }
  }

  const applied = state?.appliedDiscounts ?? []

  return (
    <>
      <MobileHeader title="주차 등록" />
      <main className="mx-auto max-w-lg space-y-4 p-4">
        {/* 1. 검색 */}
        <Section>
          <form onSubmit={(e) => { e.preventDefault(); void search() }} className="space-y-3">
            <div className="flex gap-2">
              <MInput
                ref={inputRef}
                inputMode="numeric"
                enterKeyHint="search"
                placeholder="차량번호 뒤 4자리"
                value={carNo}
                onChange={(e) => setCarNo(e.target.value)}
                className="text-lg font-semibold tracking-wider"
              />
              <MButton type="submit" className="h-12 w-14 shrink-0 px-0" disabled={searching} aria-label="검색">
                <Search size={22} />
              </MButton>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">입차일</span>
              {([[0, '오늘'], [-1, '어제']] as const).map(([off, label]) => (
                <button key={off} type="button" onClick={() => setDateOffset(off)}
                  className={cn('h-9 rounded-full px-3.5 text-sm font-medium', dateOffset === off ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                  {label}
                </button>
              ))}
              <label className={cn('flex h-9 items-center rounded-full px-3 text-sm font-medium', dateOffset === null ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                <input type="date" value={customDate} max={localDate(0)}
                  onChange={(e) => { setCustomDate(e.target.value); setDateOffset(null) }}
                  onFocus={() => setDateOffset(null)}
                  className="w-[7.5rem] bg-transparent text-sm outline-none" />
              </label>
            </div>
            {recent.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Clock size={14} className="text-muted-foreground" />
                {recent.map((r) => (
                  <button key={r} type="button" onClick={() => void search(r)} className="h-8 rounded-full border border-border px-3 text-sm text-foreground active:bg-accent">
                    {r}
                  </button>
                ))}
              </div>
            )}
          </form>
        </Section>

        {error && <Notice tone="error">{error}</Notice>}
        {searching && <p className="px-1 text-sm text-muted-foreground">검색 중…</p>}

        {/* 2. 검색 결과 */}
        {cars && !selected && (
          cars.length === 0 ? (
            <Notice>
              {searchDate} 입차 기록에서 찾지 못했습니다. 입차일을 바꿔 다시 검색해 보세요.
            </Notice>
          ) : (
            <div className="space-y-2">
              {cars.map((c) => (
                <button key={c.id} type="button" onClick={() => void selectCar(c)}
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left active:bg-accent">
                  <span>
                    <span className="block text-lg font-bold tracking-wide">{c.carNo}</span>
                    <span className="block text-sm text-muted-foreground">입차 {shortTime(c.entryTime)} · 경과 {c.elapsed}</span>
                  </span>
                  {c.dscntCnt > 0 && <span className="rounded-full bg-success-subtle px-2.5 py-1 text-xs font-semibold text-success">할인 {c.dscntCnt}건</span>}
                </button>
              ))}
            </div>
          )
        )}

        {/* 3. 선택 차량 */}
        {selected && (
          <>
            <Section
              title={<span className="text-lg font-bold tracking-wide">{selected.carNo}</span>}
              right={
                <div className="flex gap-1">
                  <button type="button" onClick={() => void refreshCar()} aria-label="새로고침" className="rounded-lg p-2 text-muted-foreground active:bg-accent"><RotateCcw size={18} /></button>
                  {cars && cars.length > 1 && (
                    <button type="button" onClick={resetCar} className="rounded-lg px-2 text-sm text-primary">다른 차량</button>
                  )}
                </div>
              }
            >
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">입차</dt><dd className="text-right">{shortTime(state?.car?.entryTime ?? selected.entryTime)}</dd>
                <dt className="text-muted-foreground">주차 시간</dt><dd className="text-right font-semibold">{state?.car?.elapsed ?? selected.elapsed}</dd>
                {state?.car?.gate && (<><dt className="text-muted-foreground">게이트</dt><dd className="text-right">{state.car.gate}</dd></>)}
              </dl>
              {applied.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">적용된 할인 {applied.length}건</p>
                  <ul className="space-y-1 text-sm">
                    {applied.map((a) => (
                      <li key={a.seq} className="flex justify-between gap-2">
                        <span className={cn('truncate', a.free && 'text-success')}>{a.discountName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{a.account}호</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            {loadingCar && <p className="px-1 text-sm text-muted-foreground">할인 현황·자동 계산 중…</p>}

            {/* 자동 등록 결과 */}
            {result && (
              <Notice tone={result.ok ? 'success' : 'error'}>
                <p className="font-semibold">{result.message || (result.ok ? '자동 등록 완료' : '자동 등록 실패')}</p>
                {result.results.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {result.results.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-foreground">
                        {r.applied ? <Check size={16} className="mt-0.5 shrink-0 text-success" /> : <X size={16} className="mt-0.5 shrink-0 text-destructive" />}
                        <span>{r.label}호 · {r.name}{!r.applied && r.message ? <span className="text-muted-foreground"> — {r.message}</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Notice>
            )}

            {/* 자동 계산 미리보기 */}
            {plan && (
              <Section title="자동 계산">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-muted p-2.5"><p className="text-xs text-muted-foreground">주차</p><p className="text-sm font-semibold">{fmtMin(plan.elapsedMin)}</p></div>
                  <div className="rounded-xl bg-muted p-2.5"><p className="text-xs text-muted-foreground">기적용</p><p className="text-sm font-semibold">{fmtMin(plan.alreadyMin)}</p></div>
                  <div className="rounded-xl bg-muted p-2.5"><p className="text-xs text-muted-foreground">추가</p><p className="text-sm font-semibold text-primary">{fmtMin(plan.addMin)}</p></div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">기본 무료 30분 · 출차 여유 10분 반영</p>

                {plan.freeBlocked && (
                  <Notice tone="warning" className="mt-3"><b>재입차 — 무료권 제외.</b> {plan.freeBlockReason ?? '오늘 이미 무료권을 쓴 차량이라 유료권만 계산했습니다.'}</Notice>
                )}
                {plan.reason && plan.steps.length === 0 && <Notice className="mt-3">{plan.reason}</Notice>}

                {plan.steps.length > 0 && (
                  <>
                    <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
                      {groupSteps(plan.steps).map((g, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                          <span className={cn('min-w-0 truncate font-medium', g.price === 0 && 'text-success')}>
                            {g.label}호 · {g.name}{g.count > 1 && <span className="ml-1 text-muted-foreground">×{g.count}</span>}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{g.price === 0 ? '무료' : `${g.price.toLocaleString()}원`}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground">무료 {plan.freeCount} · 유료 {plan.paidCount}장</span>
                      <span className="text-lg font-bold">{plan.totalCost.toLocaleString()}원</span>
                    </div>
                    {plan.balance != null && (
                      <p className={cn('mt-1 text-right text-xs', plan.insufficientBalance ? 'text-destructive' : 'text-muted-foreground')}>
                        903호 잔액 {plan.balance.toLocaleString()}원{plan.insufficientBalance ? ' — 잔액 부족' : ''}
                      </p>
                    )}
                  </>
                )}
              </Section>
            )}

            {/* 수동 등록 */}
            {state && (
              <Section className="p-0">
                <button type="button" onClick={() => setManualOpen((v) => !v)} className="flex w-full items-center justify-between p-4 text-sm font-semibold">
                  수동 등록 (계정별 할인권)
                  <ChevronDown size={18} className={cn('transition-transform', manualOpen && 'rotate-180')} />
                </button>
                {manualOpen && (
                  <div className="space-y-3 border-t border-border p-4">
                    {state.freeBlocked ? (
                      <Notice tone="warning">재입차 차량 — 무료권 사용 불가. {state.freeBlockReason ?? ''}</Notice>
                    ) : !state.paidUnlocked && (
                      <p className="text-xs text-warning">모든 호실의 무료권을 먼저 등록해야 유료권이 열립니다.</p>
                    )}
                    {state.accounts.map((acc) => {
                      const frees = acc.discountTypes.filter((d) => d.free)
                      const paids = acc.discountTypes.filter((d) => !d.free)
                      return (
                        <div key={acc.userId} className="rounded-xl border border-border p-3">
                          <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="font-semibold">{acc.label}호{acc.freeApplied && <span className="ml-1.5 text-xs font-normal text-success">✓ 무료 등록됨</span>}</span>
                            {acc.ok && (acc.paidEnabled || (acc.remainCharge ?? 0) > 0) && <span className="text-xs text-muted-foreground">잔액 {(acc.remainCharge ?? 0).toLocaleString()}원</span>}
                          </div>
                          {!acc.ok && <p className="text-xs text-destructive">{acc.error}</p>}
                          <div className="space-y-1.5">
                            {frees.map((dt) => (
                              <MButton key={dt.id} className="w-full justify-between" variant="primary"
                                disabled={isViewer || busyKey === `${acc.userId}:${dt.id}` || acc.freeApplied || state.freeBlocked}
                                onClick={() => void registerManual(acc, dt)}>
                                <span>{dt.name}</span>
                                <span className="text-xs opacity-80">{acc.freeApplied ? '등록됨' : busyKey === `${acc.userId}:${dt.id}` ? '등록 중…' : '무료'}</span>
                              </MButton>
                            ))}
                            {state.paidUnlocked && acc.paidEnabled && paids.map((dt) => (
                              <MButton key={dt.id} className="w-full justify-between" variant="outline"
                                disabled={isViewer || busyKey === `${acc.userId}:${dt.id}`}
                                onClick={() => void registerManual(acc, dt)}>
                                <span>{dt.name}</span>
                                <span className="text-xs opacity-80">{busyKey === `${acc.userId}:${dt.id}` ? '등록 중…' : `${dt.price.toLocaleString()}원`}</span>
                              </MButton>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>
            )}

            {toast && <Notice tone={toast.ok ? 'success' : 'error'}>{toast.msg}</Notice>}
          </>
        )}
      </main>

      {/* 하단 고정 — 자동 등록 */}
      {selected && plan && plan.steps.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            {isViewer ? (
              <p className="text-center text-sm text-muted-foreground">뷰어 계정은 등록할 수 없습니다.</p>
            ) : (
              <MButton size="lg" className="w-full" disabled={plan.insufficientBalance || applying} onClick={() => setConfirmOpen(true)}>
                자동 등록 · {plan.steps.length}건 · {plan.totalCost.toLocaleString()}원
              </MButton>
            )}
          </div>
        </div>
      )}
      {/* 하단 고정 버튼이 내용 가리지 않게 여백 */}
      {selected && plan && plan.steps.length > 0 && <div className="h-20" />}

      <Modal open={confirmOpen} onClose={() => !applying && setConfirmOpen(false)} title="자동 등록">
        {plan && selected && (
          <div className="space-y-4">
            <p className="text-sm">
              <b className="text-base">{selected.carNo}</b>에 할인권 <b>{plan.steps.length}건</b>(무료 {plan.freeCount} · 유료 {plan.paidCount})을 등록합니다.
            </p>
            <p className="text-sm text-muted-foreground">유료 합계 {plan.totalCost.toLocaleString()}원 · 무료권부터 순서대로 등록하고, 실패하면 그 자리에서 멈춥니다.</p>
            <div className="flex gap-2">
              <MButton variant="outline" className="flex-1" disabled={applying} onClick={() => setConfirmOpen(false)}>취소</MButton>
              <MButton className="flex-1" disabled={applying} onClick={() => void autoApply()}>{applying ? '등록 중…' : '등록'}</MButton>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
