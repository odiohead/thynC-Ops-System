'use client'

/**
 * 병원 뷰 요약 스트립 (§6.1-B) — GROUP B
 * | 모델 | 배치 중 | 계약 | 차이 | 회수(30일) | WMS 매칭(출고/재고⚠/미매칭) |
 *  - 배치 중: 계약 축(hard) 행은 activeForCompare(평가용 제외) + activeEval>0이면 '(평가용 n 별도)' 작은 표기 · none 행은 active(+같은 표기). 병동 줄에 '평가용 n' 칩(evalTotal>0)
 *  - compare 'hard'(ECG): 계약 = expected, 차이 = diff('−2 ▲' / '0 ✔' — 평가용 제외 §9.1), 계약 셀 클릭 → 근거 딜 팝오버(contractedDeals '1차 2025-03 40대 · 2차 2026-01 20대' → 병원 상세(영업) 링크,
 *    문구 "계약 = 딜 모델별 도입 기기 수량 합 … 디바이스수는 참고 표기 전용")
 *  - 'none'(모델 행 없음·GW): '—' — 2026-09-02 개정으로 'soft'는 더 이상 생산되지 않음(타입만 호환) / 제3자(THIRD_PARTY)는 1행으로 접어 '제3자 기기 ▸' + 펼치면 모델별 세부 행
 *  - expected null: '— (계약완료 딜 없음)'
 *  - 마지막 행 '병동 n개 (미지정 m대)' 클릭 → onWardsClick
 *  - 상품유형 매트릭스(B-22): summary.productTypeMixed(계약 딜 2종 또는 배치에 상품유형 있음)면 모델 행 아래 '└ 일반 | 라이트 | 미지정' 소행(배치(대조)/계약/차이 = byProductType),
 *    하단에 '교체: 전체 n (일반 a · 라이트 b) · 최근 30일 m'. 혼합이 아니면 단일 행 + 계약 팝오버에 상품유형 라벨
 * 빈 상태(원장 0건)에도 전 헤더·모델 행 노출(배치 0). loading 시 스켈레톤.
 */
import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Table, TBody, TD, TH, THead, TR } from '@/app/components/ui/Table'
import { RegistryFloatingPanel } from './RegistryFloatingPanel'
import { PRODUCT_TYPES, PRODUCT_TYPE_UNSET_LABEL } from '@/lib/deviceRegistryShared'
import { diffText, fmtDeal, fmtShortDate, lastEventText, modelLabel, productTypeBadgeVariant } from './deviceDisplay'
import Badge from '@/app/components/ui/Badge'
import type { HospitalDeviceSummary, ModelSummary, ProductTypeKey } from './types'

/** 매트릭스 소행 키 순서 — 일반 · 라이트 · 미지정(있을 때만) */
const PT_KEYS: readonly ProductTypeKey[] = [...PRODUCT_TYPES, PRODUCT_TYPE_UNSET_LABEL]

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
    const activeEval = third.reduce((s, m) => s + (m.activeEval ?? 0), 0)
    const recovered30d = third.reduce((s, m) => s + m.recovered30d, 0)
    let last: { type: string; on: string } | null = null
    for (const m of third) if (m.lastEvent && (!last || m.lastEvent.on > last.on)) last = m.lastEvent
    return { active, activeEval, recovered30d, last }
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
              <ModelRow key={m.deviceInfoId} m={m} today={today} onContractClick={openContract} contractOpen={popAnchor != null} matrix={summary.productTypeMixed} />
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
                <TD className="text-right tabular-nums font-medium">
                  {thirdTotals.active.toLocaleString()}
                  <EvalNote n={thirdTotals.activeEval} />
                </TD>
                <TD className="text-right text-muted-foreground">—</TD>
                <TD className="text-right text-muted-foreground">—</TD>
                <TD className="text-right tabular-nums">{thirdTotals.recovered30d.toLocaleString()}</TD>
                <TD className="text-right text-muted-foreground">—</TD>
              </TR>
              {thirdOpen &&
                third.map((m) => (
                  <TR key={m.deviceInfoId} className="bg-muted/30 text-xs">
                    <TD className="pl-10 text-muted-foreground">{modelLabel(m.deviceName, m.deviceModel)}</TD>
                    <TD className="text-right tabular-nums">
                      {m.active.toLocaleString()}
                      <EvalNote n={m.activeEval} />
                    </TD>
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
        {summary && (summary.evalTotal ?? 0) > 0 && (
          <span
            className="inline-flex items-center rounded-full border border-warning/40 bg-warning-subtle px-2 py-0.5 text-xs font-medium tabular-nums text-warning-subtle-foreground"
            title="평가용(EVAL) 기기 — 배치 중이지만 계약 수량 대조에서는 제외됩니다"
          >
            평가용 {summary.evalTotal.toLocaleString()}
          </span>
        )}
        {summary && summary.productTypeContext?.mixed && (
          <Badge variant="primary" title="계약완료 딜에 일반·라이트가 함께 있는 병원 — 등록 시 상품유형 선택 필수">
            상품유형 혼합
          </Badge>
        )}
        {summary && summary.replacements && (summary.productTypeMixed || summary.replacements.total > 0) && (
          <span className="text-xs text-muted-foreground tabular-nums" title="교체 = 같은 병원 RECOVER와 짝지어진 교체 등록(REGISTER) 건수 — RECOVER 시점 상품유형 기준">
            교체: 전체 {summary.replacements.total.toLocaleString()}
            {summary.productTypeMixed && (
              <>
                {' '}
                ({PT_KEYS.filter((k) => k !== PRODUCT_TYPE_UNSET_LABEL || summary.replacements.byType[k] > 0)
                  .map((k) => `${k} ${(summary.replacements.byType[k] ?? 0).toLocaleString()}`)
                  .join(' · ')})
              </>
            )}{' '}
            · 최근 30일 {summary.replacements.last30d.total.toLocaleString()}
          </span>
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
            {summary?.productTypeContext && summary.productTypeContext.byType.length > 0 && (
              <li className="flex flex-wrap items-center gap-1 pt-0.5 text-muted-foreground">
                상품유형:
                {summary.productTypeContext.byType.map((b) => (
                  <span key={b.type} className="inline-flex items-center gap-1">
                    <Badge variant={productTypeBadgeVariant(b.type) ?? 'default'}>{b.type}</Badge>
                    <span className="tabular-nums">{b.devices.toLocaleString()}대 ({b.deals}건)</span>
                  </span>
                ))}
                {summary.productTypeContext.mixed && <span>— 혼합(등록 시 선택 필수)</span>}
              </li>
            )}
          </ul>
        ) : (
          <p className="mb-2 text-muted-foreground">— (계약완료 딜 없음)</p>
        )}
        <p className="text-muted-foreground">
          계약 = 딜 모델별 도입 기기 수량(딜 상세 규모·계약 카드) 합. 수량 미입력 딜은 대조에서 제외(— 표기), GW는 계약 축 없음. 대웅 디바이스수·도입 병상 수는 참고 표기일 뿐 대조에 쓰지 않습니다. 배치 중·차이는 평가용(EVAL) 기기를 제외한 수입니다.
        </p>
        <p className="mt-1 text-muted-foreground">대조는 참고 신호입니다 — 차이가 있어도 딜 데이터 정정 요청 대상이 아니며, 원장 등록·회수 누락 여부를 먼저 확인하세요.</p>
      </RegistryFloatingPanel>
    </section>
  )
}

function ModelRow({ m, today, onContractClick, contractOpen, matrix }: { m: ModelSummary; today?: string; onContractClick: (e: MouseEvent<HTMLElement>) => void; contractOpen: boolean; matrix: boolean }) {
  const hard = m.compare === 'hard'
  const ptRows = matrix ? PT_KEYS.filter((k) => m.byProductType?.[k]) : []
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
    return <span className="text-muted-foreground">—</span>
  })()

  const diffCell = (() => {
    if (!hard || m.diff == null) return <span className="text-muted-foreground">—</span>
    return <span className={cn('tabular-nums font-medium', m.diff === 0 ? 'text-success-subtle-foreground' : 'text-warning-subtle-foreground')}>{diffText(m.diff)}</span>
  })()

  // 계약 축 행은 대조 기준(평가용 제외)을 본 수치로, 평가용은 별도 표기 — none 행은 전체 배치 수
  const activeEval = m.activeEval ?? 0
  const shown = m.compare === 'none' ? m.active : (m.activeForCompare ?? m.active - activeEval)

  return (
    <>
      <TR>
        <TD className="font-medium">
          {modelLabel(m.deviceName, m.deviceModel)}
          {m.lastEvent && <span className="ml-2 text-xs font-normal text-muted-foreground">{lastEventText(m.lastEvent.type, m.lastEvent.on, today)}</span>}
        </TD>
        <TD className="text-right tabular-nums font-medium" title={activeEval > 0 ? `배치 중 전체 ${m.active.toLocaleString()}대 (평가용 ${activeEval.toLocaleString()}대는 계약 대조 제외)` : undefined}>
          {shown.toLocaleString()}
          <EvalNote n={activeEval} />
        </TD>
        <TD className="text-right">{contractCell}</TD>
        <TD className="text-right">{diffCell}</TD>
        <TD className="text-right tabular-nums">{m.recovered30d.toLocaleString()}</TD>
        <TD className="text-right tabular-nums">
          <WmsCounts wms={m.wms} />
        </TD>
      </TR>
      {ptRows.map((k) => {
        const c = m.byProductType[k]!
        const evalN = c.active - c.activeForCompare
        const unset = k === PRODUCT_TYPE_UNSET_LABEL
        return (
          <TR key={`${m.deviceInfoId}-${k}`} className="bg-muted/30 text-xs hover:bg-muted/40">
            <TD className="pl-8">
              <span className="mr-1 text-muted-foreground">└</span>
              {unset ? (
                <span className="text-warning-subtle-foreground" title="상품유형 미지정 배치 — 선택 바 [상품유형 지정]으로 정리">
                  {PRODUCT_TYPE_UNSET_LABEL}
                </span>
              ) : (
                <Badge variant={productTypeBadgeVariant(k) ?? 'default'}>{k}</Badge>
              )}
            </TD>
            <TD className="text-right tabular-nums" title={evalN > 0 ? `배치 중 ${c.active.toLocaleString()}대 (평가용 ${evalN.toLocaleString()}대 제외)` : undefined}>
              {(m.compare === 'none' ? c.active : c.activeForCompare).toLocaleString()}
              <EvalNote n={evalN} />
            </TD>
            <TD className="text-right tabular-nums">
              {unset || c.expected == null || !hard ? <span className="text-muted-foreground">—</span> : c.expected.toLocaleString()}
            </TD>
            <TD className="text-right">
              {hard && c.diff != null ? <span className={cn('tabular-nums font-medium', c.diff === 0 ? 'text-success-subtle-foreground' : 'text-warning-subtle-foreground')}>{diffText(c.diff)}</span> : <span className="text-muted-foreground">—</span>}
            </TD>
            <TD className="text-right text-muted-foreground">—</TD>
            <TD className="text-right text-muted-foreground">—</TD>
          </TR>
        )
      })}
    </>
  )
}

/** '(평가용 n 별도)' — 0이면 렌더하지 않음 */
function EvalNote({ n }: { n: number | undefined }) {
  if (!n || n <= 0) return null
  return <span className="ml-1 whitespace-nowrap text-[11px] font-normal text-warning-subtle-foreground">(평가용 {n.toLocaleString()} 별도)</span>
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
