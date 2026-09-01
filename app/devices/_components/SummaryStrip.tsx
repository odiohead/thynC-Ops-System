'use client'

/**
 * 병원 뷰 요약 스트립 (§6.1-B) — GROUP B
 * | 모델 | 배치 중 | 계약 | 차이 | 회수(30일) | WMS 매칭(출고/재고⚠/미매칭) |
 *  - compare 'hard'(ECG): 계약 = expected, 차이 = diff('−2 ▲' / '0 ✔'), 계약 셀 클릭 → 근거 딜 팝오버(contractedDeals '1차 2025-03 40대 · 2차 2026-01 20대' → 병원 상세(영업) 링크,
 *    문구 "계약 = 계약완료 딜의 대웅 디바이스 수 합(ECG 기준) … 도입 병상 수와 무관 — 참고 신호")
 *  - 'soft'(SpO2): 계약 '(참고 n)' 회색, 차이 '—' / 'none'(GW): '—' / 제3자(THIRD_PARTY)는 1행으로 접어 '제3자 기기 ▸' + 펼치면 모델별 세부 행
 *  - expected null: '— (계약완료 딜 없음)'
 *  - 마지막 행 '병동 n개 (미지정 m대)' 클릭 → onWardsClick
 * 빈 상태(원장 0건)에도 전 헤더·모델 행 노출(배치 0). loading 시 스켈레톤.
 */
import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Table, TBody, TD, TH, THead, TR } from '@/app/components/ui/Table'
import { RegistryFloatingPanel } from './RegistryFloatingPanel'
import { diffText, fmtDeal, fmtShortDate, lastEventText, modelLabel } from './deviceDisplay'
import type { HospitalDeviceSummary, ModelSummary } from './types'

export interface SummaryStripProps {
  summary: HospitalDeviceSummary | null
  loading: boolean
  error?: string | null
  /** 계약 셀 클릭(팝오버는 컴포넌트 내부에서 그려도 되고, 이 콜백으로 orchestrator에 알려도 된다) */
  onContractClick?: () => void
  /** '병동 n개' 클릭 → 병동 탭 */
  onWardsClick?: () => void
}

const HEADERS = ['모델', '배치 중', '계약', '차이', '회수(30일)', 'WMS 매칭(출고/재고⚠/미매칭)'] as const

export function SummaryStrip({ summary, loading, error, onContractClick, onWardsClick }: SummaryStripProps) {
  const [thirdOpen, setThirdOpen] = useState(false)
  const [popAnchor, setPopAnchor] = useState<HTMLElement | null>(null)
  const closePop = useCallback(() => setPopAnchor(null), [])

  const { regular, third } = useMemo(() => {
    const models = summary?.models ?? []
    return {
      regular: models.filter((m) => m.deviceClass !== 'THIRD_PARTY'),
      third: models.filter((m) => m.deviceClass === 'THIRD_PARTY'),
    }
  }, [summary])

  const thirdTotals = useMemo(() => {
    const active = third.reduce((s, m) => s + m.active, 0)
    const recovered30d = third.reduce((s, m) => s + m.recovered30d, 0)
    let last: { type: string; on: string } | null = null
    for (const m of third) if (m.lastEvent && (!last || m.lastEvent.on > last.on)) last = m.lastEvent
    return { active, recovered30d, last }
  }, [third])

  const today = summary?.today
  const deals = summary?.contractedDeals ?? []
  const expected = summary?.expectedDeviceCount ?? null

  const openContract = (e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget // 업데이터 실행 시점엔 currentTarget이 null이므로 먼저 캡처
    setPopAnchor((prev) => (prev ? null : el))
    onContractClick?.()
  }

  const showSkeleton = loading && !summary
  const empty = !loading && !summary

  return (
    <section className={cn('rounded-lg border border-border bg-card text-card-foreground', loading && summary && 'opacity-70 transition-opacity')} aria-label="기기 요약">
      <Table className="text-sm">
        <THead>
          <TR className="hover:bg-transparent">
            {HEADERS.map((h, i) => (
              <TH key={h} className={cn(i > 0 && 'text-right', i === 5 && 'whitespace-nowrap')}>
                {h}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {showSkeleton &&
            [0, 1, 2].map((i) => (
              <TR key={`sk-${i}`} className="hover:bg-transparent">
                {HEADERS.map((h) => (
                  <TD key={h}>
                    <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  </TD>
                ))}
              </TR>
            ))}
          {empty && (
            <TR className="hover:bg-transparent">
              <TD colSpan={6} className="py-4 text-center text-xs text-muted-foreground">
                {error ? <span className="text-destructive">{error}</span> : '요약을 불러올 수 없습니다.'}
              </TD>
            </TR>
          )}
          {summary &&
            regular.map((m) => (
              <ModelRow key={m.deviceInfoId} m={m} today={today} onContractClick={openContract} contractOpen={popAnchor != null} />
            ))}
          {summary && third.length > 0 && (
            <>
              <TR className="cursor-pointer" onClick={() => setThirdOpen((v) => !v)}>
                <TD className="font-medium">
                  <span className="inline-flex items-center gap-1">
                    {thirdOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                    제3자 기기
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {third.map((m) => `${m.deviceName} ${m.active.toLocaleString()}`).join(' · ')}
                    </span>
                  </span>
                </TD>
                <TD className="text-right tabular-nums font-medium">{thirdTotals.active.toLocaleString()}</TD>
                <TD className="text-right text-muted-foreground">—</TD>
                <TD className="text-right text-muted-foreground">—</TD>
                <TD className="text-right tabular-nums">{thirdTotals.recovered30d.toLocaleString()}</TD>
                <TD className="text-right text-muted-foreground">—</TD>
              </TR>
              {thirdOpen &&
                third.map((m) => (
                  <TR key={m.deviceInfoId} className="bg-muted/30 text-xs">
                    <TD className="pl-10 text-muted-foreground">{modelLabel(m.deviceName, m.deviceModel)}</TD>
                    <TD className="text-right tabular-nums">{m.active.toLocaleString()}</TD>
                    <TD className="text-right text-muted-foreground">—</TD>
                    <TD className="text-right text-muted-foreground">—</TD>
                    <TD className="text-right tabular-nums">{m.recovered30d.toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">
                      <WmsCounts wms={m.wms} />
                    </TD>
                  </TR>
                ))}
            </>
          )}
          {summary && summary.models.length === 0 && (
            <TR className="hover:bg-transparent">
              <TD colSpan={6} className="py-3 text-center text-xs text-muted-foreground">
                시리얼 추적 대상 모델이 없습니다 — 설정 &gt; 디바이스 모델에서 &apos;원장 대상&apos;을 지정하세요.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>

      {/* 병동 줄 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm">
        {summary ? (
          <button
            type="button"
            onClick={onWardsClick}
            className="inline-flex items-center gap-1 rounded text-foreground underline-offset-2 hover:underline disabled:no-underline"
            disabled={!onWardsClick}
          >
            병동 {summary.wards.length.toLocaleString()}개
            <span className={cn('text-muted-foreground', summary.unassigned > 0 && 'text-warning-subtle-foreground')}>(미지정 {summary.unassigned.toLocaleString()}대)</span>
          </button>
        ) : (
          <span className="text-muted-foreground">병동 —</span>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {summary ? (
            <>
              배치 중 합계 {summary.activeTotal.toLocaleString()}대 · 회수(30일) {summary.recovered30dTotal.toLocaleString()} · 마지막 이벤트 {fmtShortDate(summary.lastEventOn, today) ?? '—'} · 마지막 임포트{' '}
              {summary.lastImport ? `${fmtShortDate(summary.lastImport.createdAt, today) ?? '—'} (${summary.lastImport.rowCount.toLocaleString()}행)` : '—'}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>

      {/* 계약 근거 팝오버 */}
      <RegistryFloatingPanel open={popAnchor != null} anchor={popAnchor} onClose={closePop} align="left" className="w-80 max-w-[calc(100vw-1rem)] p-3 text-xs" keepOnScroll>
        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
          <Info size={14} className="text-muted-foreground" />
          계약 근거 딜(계약완료)
        </div>
        {deals.length > 0 ? (
          <ul className="mb-2 space-y-1">
            {deals.map((d) => (
              <li key={d.dealCode} className="flex items-center justify-between gap-2">
                <Link href={`/hospitals/${encodeURIComponent(summary?.hospitalCode ?? '')}`} className="text-primary hover:underline" onClick={closePop}>
                  {fmtDeal(d)}
                </Link>
                <span className="font-mono text-[11px] text-muted-foreground">{d.dealCode}</span>
              </li>
            ))}
            <li className="border-t border-border pt-1 text-right font-medium tabular-nums">합계 {expected == null ? '—' : `${expected.toLocaleString()}대`}</li>
          </ul>
        ) : (
          <p className="mb-2 text-muted-foreground">— (계약완료 딜 없음)</p>
        )}
        <p className="text-muted-foreground">
          계약 = 계약완료 딜의 대웅 디바이스 수 합(ECG 기준). SpO2는 참고(ECG 동수 가정), GW는 계약 축 없음. 도입 병상 수와 무관합니다.
        </p>
        <p className="mt-1 text-muted-foreground">대조는 참고 신호입니다 — 차이가 있어도 딜 데이터 정정 요청 대상이 아니며, 원장 등록·회수 누락 여부를 먼저 확인하세요.</p>
      </RegistryFloatingPanel>
    </section>
  )
}

function ModelRow({ m, today, onContractClick, contractOpen }: { m: ModelSummary; today?: string; onContractClick: (e: MouseEvent<HTMLElement>) => void; contractOpen: boolean }) {
  const hard = m.compare === 'hard'
  const soft = m.compare === 'soft'
  const contractCell = (() => {
    if (hard) {
      return (
        <button
          type="button"
          onClick={onContractClick}
          aria-expanded={contractOpen}
          className={cn('rounded tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary', m.expected == null && 'text-muted-foreground')}
          title="근거 딜 보기"
        >
          {m.expected == null ? '— (계약완료 딜 없음)' : m.expected.toLocaleString()}
        </button>
      )
    }
    if (soft) return <span className="text-muted-foreground tabular-nums">{m.expected == null ? '—' : `(참고 ${m.expected.toLocaleString()})`}</span>
    return <span className="text-muted-foreground">—</span>
  })()

  const diffCell = (() => {
    if (!hard || m.diff == null) return <span className="text-muted-foreground">—</span>
    return <span className={cn('tabular-nums font-medium', m.diff === 0 ? 'text-success-subtle-foreground' : 'text-warning-subtle-foreground')}>{diffText(m.diff)}</span>
  })()

  return (
    <TR>
      <TD className="font-medium">
        {modelLabel(m.deviceName, m.deviceModel)}
        {m.lastEvent && <span className="ml-2 text-xs font-normal text-muted-foreground">{lastEventText(m.lastEvent.type, m.lastEvent.on, today)}</span>}
      </TD>
      <TD className="text-right tabular-nums font-medium">{m.active.toLocaleString()}</TD>
      <TD className="text-right">{contractCell}</TD>
      <TD className="text-right">{diffCell}</TD>
      <TD className="text-right tabular-nums">{m.recovered30d.toLocaleString()}</TD>
      <TD className="text-right tabular-nums">
        <WmsCounts wms={m.wms} />
      </TD>
    </TR>
  )
}

function WmsCounts({ wms }: { wms: ModelSummary['wms'] }) {
  return (
    <span className="whitespace-nowrap" title="출고(OUT) / 재고(IN_STOCK ⚠ 배치 중인데 창고 재고) / 미매칭">
      {wms.out.toLocaleString()} /{' '}
      <span className={cn(wms.inStock > 0 && 'font-medium text-warning-subtle-foreground')}>
        {wms.inStock.toLocaleString()}
        {wms.inStock > 0 && '⚠'}
      </span>{' '}
      / {wms.unmatched.toLocaleString()}
    </span>
  )
}

export default SummaryStrip
