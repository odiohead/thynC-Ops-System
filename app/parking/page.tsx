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
  dscntCnt: number
}
interface DiscountType {
  id: string
  name: string
  price: number
  value: number
  free: boolean
}
interface AccountCoupons {
  userId: string
  label: string
  ok: boolean
  error?: string
  remainBasic: number | null
  remainCharge: number | null
  discountTypes: DiscountType[]
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
  const [accounts, setAccounts] = useState<AccountCoupons[] | null>(null)
  const [couponsLoading, setCouponsLoading] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)

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
    setAccounts(null)
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
    setAccounts(null)
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
      setAccounts(data.accounts)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setCouponsLoading(false)
    }
  }

  async function register(acc: AccountCoupons, dt: DiscountType) {
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
      if (data.ok) await selectCar(selected) // 잔여·건수 갱신
    } catch (e) {
      setToast({ ok: false, msg: `[${acc.label}] ${errMsg(e)}` })
    } finally {
      setBusyKey(null)
    }
  }

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
          className="w-40"
          title="입차일 (입차한 날짜 기준으로 검색)"
        />
        <Input
          value={carNo}
          onChange={(e) => setCarNo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="차량번호 (뒤 4자리 이상)"
          inputMode="numeric"
          autoFocus
          className="max-w-xs"
        />
        <Button onClick={doSearch} disabled={loading}>
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
          검색 결과가 없습니다. (영업일 {entryDate} 기준 · 출차된 차량은 검색되지 않습니다)
        </p>
      )}

      {cars && cars.length > 1 && (
        <div className="mb-6 space-y-2">
          <p className="text-xs text-muted-foreground">차량이 여러 건입니다. 대상을 선택하세요.</p>
          {cars.map((c) => (
            <button
              key={c.id}
              onClick={() => selectCar(c)}
              className={`flex w-full items-center justify-between rounded-md border px-4 py-2 text-left text-sm transition-colors hover:bg-accent ${
                selected?.id === c.id ? 'border-primary bg-accent' : 'border-border'
              }`}
            >
              <span className="font-semibold">{c.carNo}</span>
              <span className="text-muted-foreground">
                입차 {c.entryTime}
                {c.dscntCnt > 0 && ` · 기등록 ${c.dscntCnt}건`}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 선택 차량 요약 */}
      {selected && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <span className="text-lg font-bold">{selected.carNo}</span>
              <span className="ml-3 text-sm text-muted-foreground">입차 {selected.entryTime}</span>
            </div>
            {selected.dscntCnt > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                기등록 {selected.dscntCnt}건
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {couponsLoading && <p className="text-sm text-muted-foreground">계정별 할인권 조회 중…</p>}

      {/* 계정별 카드 */}
      {accounts && (
        <div className="grid gap-4 sm:grid-cols-2">
          {accounts.map((acc) => (
            <Card key={acc.userId}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>
                  계정 {acc.label}
                  {acc.label !== acc.userId && (
                    <span className="text-muted-foreground"> ({acc.userId})</span>
                  )}
                </CardTitle>
                {acc.ok ? (
                  <span className="text-xs text-muted-foreground">
                    잔여 {acc.remainBasic ?? '-'}
                    {acc.remainCharge != null && acc.remainCharge > 0 && ` (+충전 ${acc.remainCharge})`}
                  </span>
                ) : (
                  <span className="text-xs text-destructive">오류</span>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {!acc.ok && <p className="text-xs text-destructive">{acc.error}</p>}
                {acc.ok && acc.discountTypes.length === 0 && (
                  <p className="text-xs text-muted-foreground">등록 가능한 할인권이 없습니다.</p>
                )}
                {acc.discountTypes.map((dt) => (
                  <Button
                    key={dt.id}
                    variant={dt.free ? 'primary' : 'outline'}
                    size="sm"
                    className="w-full justify-between"
                    disabled={busyKey === `${acc.userId}:${dt.id}`}
                    onClick={() => register(acc, dt)}
                  >
                    <span>{dt.name}</span>
                    <span className="text-xs opacity-80">
                      {dt.free ? '무료' : `${dt.price.toLocaleString()}원`}
                      {busyKey === `${acc.userId}:${dt.id}` && ' · 등록 중…'}
                    </span>
                  </Button>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
