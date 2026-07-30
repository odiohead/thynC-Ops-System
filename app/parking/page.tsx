'use client'

import { useState } from 'react'
import PageHeader from '@/app/components/ui/PageHeader'
import Button from '@/app/components/ui/Button'
import { Input } from '@/app/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/Card'

interface ParkedCar {
  id: string
  carNo: string
  entryTime: string
  elapsed: string
  dscntCnt: number
}
interface DiscountType {
  id: string
  name: string
  price: number
  value: number
  free: boolean
}
interface AccountState {
  userId: string
  label: string
  ok: boolean
  error?: string
  remainBasic: number | null
  remainCharge: number | null
  discountTypes: DiscountType[]
  hasFree: boolean
  freeApplied: boolean
  paidEnabled: boolean
}
interface AppliedDiscount {
  seq: number
  discountName: string
  account: string
  name: string
  time: string
  free: boolean
}
interface CarInfo {
  carNo: string
  entryTime: string
  elapsed: string
  gate: string
}
interface CarDiscountState {
  car: CarInfo | null
  appliedDiscounts: AppliedDiscount[]
  accounts: AccountState[]
  paidUnlocked: boolean
}
interface PlanStep {
  userId: string
  label: string
  discountType: string
  name: string
  minutes: number
  price: number
}
interface AutoPlan {
  ok: boolean
  reason?: string
  elapsedMin: number
  alreadyMin: number
  deficitMin: number
  steps: PlanStep[]
  freeCount: number
  paidCount: number
  addMin: number
  coveredAfterMin: number
  totalCost: number
  balance: number | null
  insufficientBalance: boolean
}

function fmtMin(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return h > 0 ? `${h}시간 ${mm}분` : `${mm}분`
}

// 계획 steps를 (호실·할인권)별로 묶어 미리보기 표시
function groupSteps(steps: PlanStep[]): { label: string; name: string; count: number; minutes: number; price: number }[] {
  const map = new Map<string, { label: string; name: string; count: number; minutes: number; price: number }>()
  for (const s of steps) {
    const k = `${s.label}|${s.name}`
    const g = map.get(k)
    if (g) {
      g.count += 1
      g.minutes += s.minutes
      g.price += s.price
    } else {
      map.set(k, { label: s.label, name: s.name, count: 1, minutes: s.minutes, price: s.price })
    }
  }
  return Array.from(map.values())
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// 브라우저 로컬(KST) 기준 오늘 YYYY-MM-DD
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ParkingPage() {
  const [carNo, setCarNo] = useState('')
  const [searchDate, setSearchDate] = useState(todayLocal())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cars, setCars] = useState<ParkedCar[] | null>(null)
  const [entryDate, setEntryDate] = useState('')
  const [selected, setSelected] = useState<ParkedCar | null>(null)
  const [state, setState] = useState<CarDiscountState | null>(null)
  const [couponsLoading, setCouponsLoading] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)
  const [plan, setPlan] = useState<AutoPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)

  async function doSearch() {
    const q = carNo.trim()
    if (q.length < 2) {
      setError('차량번호 2자리 이상 입력하세요.')
      return
    }
    setLoading(true)
    setError('')
    setCars(null)
    setSelected(null)
    setState(null)
    setPlan(null)
    setToast(null)
    try {
      const res = await fetch('/api/parking/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carNo: q, entryDate: searchDate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '검색 실패')
      setCars(data.cars)
      setEntryDate(data.entryDate)
      if (data.cars.length === 1) selectCar(data.cars[0])
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  async function selectCar(car: ParkedCar) {
    setSelected(car)
    setState(null)
    setPlan(null)
    setToast(null)
    setCouponsLoading(true)
    try {
      const res = await fetch('/api/parking/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carId: car.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '조회 실패')
      setState(data)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setCouponsLoading(false)
    }
  }

  async function register(acc: AccountState, dt: DiscountType) {
    if (!selected) return
    const key = `${acc.userId}:${dt.id}`
    setBusyKey(key)
    setToast(null)
    try {
      const res = await fetch('/api/parking/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: acc.userId,
          carNo: selected.carNo,
          carId: selected.id,
          discountType: dt.id,
          entryDate: entryDate || searchDate,
        }),
      })
      const data = await res.json()
      setToast({ ok: !!data.ok, msg: `[${acc.label}] ${data.message || (data.ok ? '등록 완료' : '등록 실패')}` })
      if (data.ok) await selectCar(selected) // 할인내역·기등록·게이트 즉시 갱신
    } catch (e) {
      setToast({ ok: false, msg: `[${acc.label}] ${errMsg(e)}` })
    } finally {
      setBusyKey(null)
    }
  }

  async function doPlan() {
    if (!selected) return
    setPlanLoading(true)
    setToast(null)
    setPlan(null)
    try {
      const res = await fetch('/api/parking/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carId: selected.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '계산 실패')
      setPlan(data)
    } catch (e) {
      setToast({ ok: false, msg: errMsg(e) })
    } finally {
      setPlanLoading(false)
    }
  }

  async function doAutoApply() {
    if (!selected || !plan) return
    setAutoBusy(true)
    setToast(null)
    try {
      const res = await fetch('/api/parking/auto-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carId: selected.id, carNo: selected.carNo }),
      })
      const data = await res.json()
      setToast({ ok: !!data.ok, msg: data.message || (data.ok ? '자동 등록 완료' : '자동 등록 실패') })
      setPlan(null)
      await selectCar(selected) // 최신 상태(할인내역·잔액) 갱신
    } catch (e) {
      setToast({ ok: false, msg: errMsg(e) })
    } finally {
      setAutoBusy(false)
    }
  }

  const car = state?.car
  const applied = state?.appliedDiscounts ?? []
  const paidUnlocked = state?.paidUnlocked ?? false

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <PageHeader
        title="주차 웹할인 등록"
        description="차량번호 조회 후 계정별 주차권을 필요한 만큼 등록합니다. (시그니처 광교 / pweb.kr)"
      />

      {/* 검색 */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={searchDate}
          onChange={(e) => setSearchDate(e.target.value)}
          className="w-36 shrink-0"
          title="입차일 (입차한 날짜 기준으로 검색)"
        />
        <Input
          value={carNo}
          onChange={(e) => setCarNo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="차량번호 뒤 4자리"
          inputMode="numeric"
          autoFocus
          className="min-w-0 flex-1 sm:max-w-xs"
        />
        <Button onClick={doSearch} disabled={loading} className="w-full sm:w-auto">
          {loading ? '조회 중…' : '조회'}
        </Button>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        입차일 기준으로 검색합니다. 밤새 주차돼 어제 입차한 차량은 날짜를 하루 전으로 바꿔 조회하세요.
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {toast && (
        <div
          className={`mb-4 rounded-md border px-4 py-2 text-sm ${
            toast.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* 검색 결과 (다건일 때 선택) */}
      {cars && cars.length === 0 && (
        <p className="text-sm text-muted-foreground">
          검색 결과가 없습니다. (입차일 {entryDate} 기준 · 출차된 차량은 검색되지 않습니다)
        </p>
      )}

      {cars && cars.length > 1 && (
        <div className="mb-6 space-y-2">
          <p className="text-xs text-muted-foreground">차량이 여러 건입니다. 대상을 선택하세요.</p>
          {cars.map((c) => (
            <button
              key={c.id}
              onClick={() => selectCar(c)}
              className={`flex w-full flex-col gap-0.5 rounded-md border px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent sm:flex-row sm:items-center sm:justify-between sm:gap-2 ${
                selected?.id === c.id ? 'border-primary bg-accent' : 'border-border'
              }`}
            >
              <span className="font-semibold">{c.carNo}</span>
              <span className="text-xs text-muted-foreground sm:text-sm">
                입차 {c.entryTime} · 주차 {c.elapsed}
                {c.dscntCnt > 0 && ` · 기등록 ${c.dscntCnt}건`}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 선택 차량 요약 (주차시간 강조) */}
      {selected && (
        <Card className="mb-4">
          <CardContent className="flex items-start justify-between gap-3 py-4">
            <div className="min-w-0">
              <span className="text-lg font-bold">{car?.carNo ?? selected.carNo}</span>
              <div className="mt-0.5 break-words text-sm text-muted-foreground">
                입차 {selected.entryTime}
                {car?.gate ? ` · ${car.gate}` : ''}
              </div>
            </div>
            <div className="shrink-0 space-y-1.5 text-right">
              <div>
                <div className="text-xs text-muted-foreground">주차시간</div>
                <div className="text-lg font-bold tabular-nums text-primary">
                  {car?.elapsed || selected.elapsed || '-'}
                </div>
              </div>
              <span className="inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                기등록 {applied.length}건
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 자동 계산 */}
      {state && (
        <div className="mb-4">
          {!plan && (
            <Button variant="secondary" className="w-full" onClick={doPlan} disabled={planLoading}>
              {planLoading ? '계산 중…' : '⚡ 주차시간에 맞춰 자동 계산'}
            </Button>
          )}

          {plan && (
            <Card className="border-primary/40">
              <CardHeader className="py-3">
                <CardTitle>자동 계산 미리보기</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">주차시간</div>
                    <div className="font-semibold">{fmtMin(plan.elapsedMin)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">기적용</div>
                    <div className="font-semibold">{fmtMin(plan.alreadyMin)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">이번 커버 대상</div>
                    <div className="font-semibold">{fmtMin(plan.deficitMin)}</div>
                  </div>
                </div>

                {plan.reason && plan.steps.length === 0 && (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{plan.reason}</p>
                )}

                {plan.steps.length > 0 && (
                  <>
                    <div className="divide-y divide-border rounded-md border border-border">
                      {groupSteps(plan.steps).map((g, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate">
                            <span className={g.price === 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium'}>
                              {g.label}호 · {g.name}
                            </span>
                            {g.count > 1 && <span className="ml-1 text-muted-foreground">×{g.count}</span>}
                          </span>
                          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                            {fmtMin(g.minutes)} · {g.price === 0 ? '무료' : `${g.price.toLocaleString()}원`}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">
                        무료 {plan.freeCount}장 · 유료 {plan.paidCount}장 · 총 커버 {fmtMin(plan.coveredAfterMin)}
                        {plan.coveredAfterMin > plan.elapsedMin && ` (여유 ${plan.coveredAfterMin - plan.elapsedMin}분)`}
                      </span>
                      <span className="font-semibold">합계 {plan.totalCost.toLocaleString()}원</span>
                    </div>

                    {plan.balance != null && (
                      <p className={`text-xs ${plan.insufficientBalance ? 'text-destructive' : 'text-muted-foreground'}`}>
                        903호 잔액 {plan.balance.toLocaleString()}원
                        {plan.insufficientBalance
                          ? ' — 잔액이 부족합니다. 등록할 수 없습니다.'
                          : ` → 등록 후 ${(plan.balance - plan.totalCost).toLocaleString()}원`}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        onClick={doAutoApply}
                        disabled={autoBusy || plan.insufficientBalance}
                      >
                        {autoBusy ? '등록 중…' : `이대로 자동 등록 (${plan.steps.length}건)`}
                      </Button>
                      <Button variant="outline" onClick={() => setPlan(null)} disabled={autoBusy}>
                        취소
                      </Button>
                    </div>
                  </>
                )}

                {!plan.ok && plan.steps.length === 0 && plan.reason && (
                  <Button variant="outline" className="w-full" onClick={() => setPlan(null)}>
                    닫기
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {couponsLoading && <p className="text-sm text-muted-foreground">계정별 할인권 조회 중…</p>}

      {/* 적용한 할인내역 */}
      {state && applied.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="py-3">
            <CardTitle>적용한 할인내역 ({applied.length})</CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            <div className="divide-y divide-border">
              {applied.map((a) => (
                <div key={a.seq} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-right text-xs text-muted-foreground">{a.seq}</span>
                    <span className={`truncate ${a.free ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium'}`}>
                      {a.discountName}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{a.account}호</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{a.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 계정별 카드 */}
      {state && (
        <>
          {!paidUnlocked && (
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-500">
              먼저 모든 호실의 <b>무료 1시간할인</b>을 등록해야 유료권 버튼이 열립니다.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {state.accounts.map((acc) => {
              const frees = acc.discountTypes.filter((d) => d.free)
              const paids = acc.discountTypes.filter((d) => !d.free)
              return (
                <Card key={acc.userId}>
                  <CardHeader className="flex-row items-center justify-between gap-2 py-3">
                    <CardTitle className="min-w-0">
                      {acc.label}호
                      {acc.freeApplied && (
                        <span className="ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                          ✓ 무료 등록됨
                        </span>
                      )}
                    </CardTitle>
                    {!acc.ok ? (
                      <span className="shrink-0 text-xs text-destructive">오류</span>
                    ) : (
                      (acc.paidEnabled || (acc.remainCharge ?? 0) > 0) && (
                        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                          잔액 {(acc.remainCharge ?? 0).toLocaleString()}원
                        </span>
                      )
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {!acc.ok && <p className="text-xs text-destructive">{acc.error}</p>}

                    {/* 무료권 */}
                    {frees.map((dt) => (
                      <Button
                        key={dt.id}
                        variant="primary"
                        size="sm"
                        className="w-full justify-between"
                        disabled={busyKey === `${acc.userId}:${dt.id}` || acc.freeApplied}
                        onClick={() => register(acc, dt)}
                      >
                        <span>{dt.name}</span>
                        <span className="text-xs opacity-80">
                          {acc.freeApplied
                            ? '등록됨'
                            : busyKey === `${acc.userId}:${dt.id}`
                              ? '등록 중…'
                              : '무료'}
                        </span>
                      </Button>
                    ))}

                    {/* 유료권 — 구매 계정(903)만 + 모든 호실 무료 등록 후 노출 */}
                    {paidUnlocked &&
                      acc.paidEnabled &&
                      paids.map((dt) => (
                        <Button
                          key={dt.id}
                          variant="outline"
                          size="sm"
                          className="w-full justify-between"
                          disabled={busyKey === `${acc.userId}:${dt.id}`}
                          onClick={() => register(acc, dt)}
                        >
                          <span>{dt.name}</span>
                          <span className="text-xs opacity-80">
                            {busyKey === `${acc.userId}:${dt.id}` ? '등록 중…' : `${dt.price.toLocaleString()}원`}
                          </span>
                        </Button>
                      ))}

                    {acc.ok && frees.length === 0 && !paidUnlocked && (
                      <p className="text-xs text-muted-foreground">사용 가능한 무료권이 없습니다.</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
