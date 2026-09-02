'use client'

/**
 * 등록 폼 (§6.1-B 폼 · 등록) — GROUP C
 * 시리얼 textarea(parseSerialLines — 줄당 1건, `시리얼<TAB>병동<TAB>메모`, 3열 이후 '평가용'/'판매용' 셀은 용도로 분리, 자동 대문자, 중복 줄 병합) · 모델(자동/고정 select: models) · 병동(WardCombo, allowNew)
 * · 용도 [미지정|판매용|평가용](폼 공통 — 줄에 용도가 있으면 그 값이 우선, 기본 미지정 → body.usageTypeId)
 * · 상품유형 [기본값(계약 딜 기준: 라이트)|일반|라이트](B-22 — 줄에 '일반/라이트' 셀이 있으면 우선; 혼합 병원은 선택 필수 → body.productType). 문맥은 preview 응답 productTypeContext
 * · 업무일자(기본 today, 과거 허용) · 메모 · 유지보수 코드(MaintenanceCodeCombo — 선택 시 업무일자 자동 채움, 사용자가 고친 값은 유지)
 * 실시간 판별 = previewRegister(code, body) (500ms 디바운스, 200줄 초과 시 수동 [판별]) → 판정 패널: 모델별 카운트 · ⚠형식 · 재등록(이전 회수 사유·일자) · 이미 배치 중(skip)
 * · ✖ 타 병원 배치 중 → 행별 [제외][이관 처리](excludeRows / conflicts{serial:'TRANSFER'}) · 폐쇄 병동 → [미지정으로 등록](rowActions[row]='UNASSIGN_WARD')
 * 제출 = registerDevices(code, body) (⌘/Ctrl+Enter). 성공 → onDone({ message:'118대 등록 · 2대 재등록', warnings })
 * 409 conflicts[] → 재판별로 행 패널에 반영, 409 skipped[](전부 이미 배치) → 안내.
 *
 * 제외 상태는 클라이언트가 단일 소스: effective(serial) = override ?? 서버 defaultExcluded. 서버 `excludeRows`는 비어 있지 않으면 목록이 기준이 되므로
 * 미리보기·실행 모두 효과 목록 전체를 보낸다(시리얼 키로 보관 → 줄 순서가 바뀌어도 유지).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import Badge from '@/app/components/ui/Badge'
import { Select, Textarea } from '@/app/components/ui/Input'
import { cn } from '@/lib/cn'
import { IMPORT_MAX_ROWS, IMPORT_VERDICT_COLORS, IMPORT_VERDICT_LABELS, PRODUCT_TYPES, normalizeSerial, parseSerialLines, todayKst, toYmd, type ImportRowAction, type ImportVerdict, type OccurredOnBasis, type ProductType } from '@/lib/deviceRegistryShared'
import { errorMessage, getUsageTypes, isApiError, previewRegister, registerDevices } from './api'
import { productTypeDefaultLabel } from './deviceDisplay'
import type { ContractedDeal, ImportPreviewRow, ModelSummary, MutationDone, RegisterBody, RegisterPreviewResponse, RegistryRef, UsageType, WardOption, WardValue } from './types'
import { WardCombo } from './WardCombo'
import { MaintenanceCodeCombo } from './MaintenanceCodeCombo'
import { FormField, ModalActions, Notice, OccurredOnField, describeWard, isSubmitShortcut, useOccurredOn, wardBody } from './registryFormKit'

export interface RegisterModalProps {
  open: boolean
  onClose: () => void
  hospitalCode: string
  /** 모델 고정 select 옵션(summary.models — serial_tracked 활성 모델) */
  models: ModelSummary[]
  /** 병동 콤보 사전 로드(summary.wards → toWardOption) */
  wards: WardOption[]
  /** 계약건 선택지(summary.contractedDeals — B-23). 선택 시 상품유형은 딜에서 파생 */
  deals: ContractedDeal[]
  /** 서버 KST 오늘(summary.today) — 없으면 todayKst() */
  today: string | null
  /** 미리 채울 시리얼(모바일 스캔·조회 결과 등) */
  initialSerials?: string[]
  onDone: (result: MutationDone) => void
}

/** 이 줄 수를 넘으면 자동 판별 대신 수동 [판별] (§6.1) */
const AUTO_PREVIEW_MAX = 200
const PREVIEW_DEBOUNCE_MS = 500

interface ParsedItem {
  key: string
  serialInput: string
  wardInput?: string
  memo?: string
  usageInput?: string
  productTypeInput?: string
  line: number
}

export function RegisterModal(props: RegisterModalProps) {
  const { open, onClose } = props
  return (
    <Modal open={open} onClose={onClose} title="기기 등록" widthClass="max-w-3xl">
      {open && <RegisterForm {...props} />}
    </Modal>
  )
}

function RegisterForm({ onClose, hospitalCode, models, wards, deals, today: todayProp, initialSerials, onDone }: RegisterModalProps) {
  const today = todayProp ?? todayKst()
  const [text, setText] = useState(() => (initialSerials && initialSerials.length > 0 ? initialSerials.join('\n') + '\n' : ''))
  const [modelId, setModelId] = useState<number | ''>('')
  const [ward, setWard] = useState<WardValue>({})
  const [usageId, setUsageId] = useState<number | ''>('')
  const [usageTypes, setUsageTypes] = useState<UsageType[] | null>(null)
  /** 상품유형 공통값 — '' = 서버 기본값 규칙(병원 딜 기준) */
  const [productType, setProductType] = useState<ProductType | ''>('')
  /** 계약건 공통값(B-23) — '' = 자동(단일 계약완료 딜 기본값)/미지정 */
  const [dealCode, setDealCode] = useState('')
  const selectedDeal = useMemo(() => deals.find((d) => d.dealCode === dealCode) ?? null, [deals, dealCode])
  const occ = useOccurredOn(today)
  const [memo, setMemo] = useState('')
  const [refCode, setRefCode] = useState('')

  useEffect(() => {
    let alive = true
    getUsageTypes()
      .then((r) => alive && setUsageTypes(r))
      .catch(() => alive && setUsageTypes([]))
    return () => {
      alive = false
    }
  }, [])

  const [preview, setPreview] = useState<RegisterPreviewResponse | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const previewSeq = useRef(0)

  // 행 액션·제외 — 시리얼 키 기준(줄 순서 변경에 견고)
  const [excludeOverrides, setExcludeOverrides] = useState<Map<string, boolean>>(() => new Map())
  const [transfers, setTransfers] = useState<Set<string>>(() => new Set())
  const [unassign, setUnassign] = useState<Set<string>>(() => new Set())
  const [showAll, setShowAll] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorRows, setErrorRows] = useState<string[] | null>(null)

  // ── 파싱(중복 병합)
  const parsed = useMemo(() => {
    const lines = parseSerialLines(text, IMPORT_MAX_ROWS)
    const overflow = lines.length > IMPORT_MAX_ROWS
    const seen = new Set<string>()
    const items: ParsedItem[] = []
    let dup = 0
    for (const l of lines.slice(0, IMPORT_MAX_ROWS)) {
      const key = normalizeSerial(l.serialInput).serialNo
      if (!key) continue
      if (seen.has(key)) {
        dup += 1
        continue
      }
      seen.add(key)
      items.push({ key, serialInput: l.serialInput, wardInput: l.wardInput, memo: l.memo, usageInput: l.usageInput, productTypeInput: l.productTypeInput, line: l.row })
    }
    return { items, dup, overflow }
  }, [text])
  const items = parsed.items
  const manualMode = items.length > AUTO_PREVIEW_MAX

  // 마지막 미리보기 행(시리얼 키 → 행)
  const rowBySerial = useMemo(() => new Map((preview?.rows ?? []).map((r) => [r.serialNo, r])), [preview])
  const effectiveExcluded = useCallback((key: string) => excludeOverrides.get(key) ?? rowBySerial.get(key)?.defaultExcluded ?? false, [excludeOverrides, rowBySerial])

  const buildBody = useCallback((): RegisterBody => {
    const rowOf = new Map(items.map((it, i) => [it.key, i + 1]))
    const rowActions: Record<number, ImportRowAction> = {}
    Array.from(unassign).forEach((s) => {
      const row = rowOf.get(s)
      if (row) rowActions[row] = 'UNASSIGN_WARD'
    })
    const conflicts: Record<string, 'TRANSFER'> = {}
    Array.from(transfers).forEach((s) => {
      if (rowOf.has(s)) conflicts[s] = 'TRANSFER'
    })
    const excludeRows = items.map((it, i) => (effectiveExcluded(it.key) ? i + 1 : 0)).filter((n) => n > 0)
    const ref: RegistryRef | null = refCode ? { type: 'MAINTENANCE', code: refCode } : null
    return {
      items: items.map((it) => ({ serialInput: it.serialInput, ...(it.wardInput ? { wardName: it.wardInput } : {}), ...(it.memo ? { memo: it.memo } : {}), ...(it.usageInput ? { usageType: it.usageInput } : {}), ...(it.productTypeInput ? { productType: it.productTypeInput } : {}) })),
      ...(modelId !== '' ? { deviceInfoId: modelId } : {}),
      ...(usageId !== '' ? { usageTypeId: usageId } : {}),
      ...(productType !== '' ? { productType } : {}),
      ...(dealCode !== '' ? { dealCode } : {}),
      ...wardBody(ward),
      occurredOn: occ.value,
      memo: memo.trim() || null,
      ref,
      ...(Object.keys(conflicts).length > 0 ? { conflicts } : {}),
      ...(Object.keys(rowActions).length > 0 ? { rowActions } : {}),
      ...(excludeRows.length > 0 ? { excludeRows } : {}),
    }
  }, [items, unassign, transfers, effectiveExcluded, refCode, modelId, usageId, productType, dealCode, ward, occ.value, memo])

  // 판별 입력 키 — 제외 목록은 클라이언트가 계산하므로 키에 넣지 않는다(재판별 불필요)
  const currentKey = useMemo(
    () => JSON.stringify({ items: items.map((it) => [it.serialInput, it.wardInput ?? '', it.memo ?? '', it.usageInput ?? '', it.productTypeInput ?? '']), modelId, usageId, productType, dealCode, ward, occurredOn: occ.value, transfers: Array.from(transfers).sort(), unassign: Array.from(unassign).sort(), nonce }),
    [items, modelId, usageId, productType, dealCode, ward, occ.value, transfers, unassign, nonce]
  )
  const ptCtx = preview?.productTypeContext ?? null
  const stale = preview != null && previewKey !== currentKey

  const runPreview = useCallback(async () => {
    if (items.length === 0 || parsed.overflow) return
    if (!occ.value || occ.error) return
    const key = currentKey
    const seq = ++previewSeq.current
    setPreviewing(true)
    setPreviewError(null)
    try {
      const r = await previewRegister(hospitalCode, buildBody())
      if (seq !== previewSeq.current) return
      setPreview(r)
      setPreviewKey(key)
    } catch (e) {
      if (seq !== previewSeq.current) return
      setPreviewError(errorMessage(e, '판별 실패'))
      setPreview(null)
      setPreviewKey(null)
    } finally {
      if (seq === previewSeq.current) setPreviewing(false)
    }
  }, [items.length, parsed.overflow, occ.value, occ.error, currentKey, hospitalCode, buildBody])

  // 자동 판별(디바운스) — 200줄 이하만
  useEffect(() => {
    if (items.length === 0) {
      setPreview(null)
      setPreviewKey(null)
      setPreviewError(null)
      return
    }
    if (manualMode) return
    if (previewKey === currentKey) return
    const t = window.setTimeout(() => void runPreview(), PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, items.length, manualMode])

  // ── 행 뷰모델
  type RowVM = ImportPreviewRow & { excludedEff: boolean; actionEff: ImportRowAction | null; executableEff: boolean }
  const rows = useMemo<RowVM[]>(() => {
    if (!preview) return []
    return preview.rows.map((r) => {
      const excludedEff = effectiveExcluded(r.serialNo)
      const actionEff: ImportRowAction | null = transfers.has(r.serialNo) ? 'TRANSFER' : unassign.has(r.serialNo) ? 'UNASSIGN_WARD' : r.action
      const executableEff = !excludedEff && (r.status === 'ok' || r.status === 'warn' || r.status === 'reregister' || (r.status === 'conflict' && actionEff === 'TRANSFER'))
      return { ...r, excludedEff, actionEff, executableEff }
    })
  }, [preview, effectiveExcluded, transfers, unassign])

  const stats = useMemo(() => {
    const byStatus: Record<ImportVerdict, number> = { ok: 0, reregister: 0, skip: 0, warn: 0, conflict: 0, error: 0 }
    const byModel = new Map<string, number>()
    let excluded = 0
    let errorsLeft = 0
    let conflictsLeft = 0
    let willRegister = 0
    let willRereg = 0
    let willTransfer = 0
    for (const r of rows) {
      byStatus[r.status] += 1
      if (r.excludedEff) excluded += 1
      if (r.status === 'error' && !r.excludedEff) errorsLeft += 1
      if (r.status === 'conflict' && !r.excludedEff && r.actionEff !== 'TRANSFER') conflictsLeft += 1
      if (r.executableEff) {
        const m = r.deviceModel ?? '모델 미상'
        byModel.set(m, (byModel.get(m) ?? 0) + 1)
        if (r.status === 'reregister') willRereg += 1
        else if (r.status === 'conflict') willTransfer += 1
        else willRegister += 1
      }
    }
    return { byStatus, byModel, excluded, errorsLeft, conflictsLeft, willRegister, willRereg, willTransfer, executable: willRegister + willRereg + willTransfer }
  }, [rows])

  const visibleRows = useMemo(() => (showAll ? rows : rows.filter((r) => r.status !== 'ok')), [rows, showAll])

  const canSubmit =
    !submitting && items.length > 0 && !parsed.overflow && !!preview && !stale && !previewing && !occ.error && stats.errorsLeft === 0 && stats.conflictsLeft === 0 && stats.executable > 0

  const toggleExclude = (key: string, excluded: boolean) => {
    setExcludeOverrides((prev) => {
      const next = new Map(prev)
      next.set(key, excluded)
      return next
    })
  }
  const toggleTransfer = (key: string) => {
    const adding = !transfers.has(key)
    setTransfers((prev) => {
      const next = new Set(prev)
      if (adding) next.add(key)
      else next.delete(key)
      return next
    })
    if (adding) toggleExclude(key, false)
  }
  const toggleUnassign = (key: string) => {
    const adding = !unassign.has(key)
    setUnassign((prev) => {
      const next = new Set(prev)
      if (adding) next.add(key)
      else next.delete(key)
      return next
    })
    if (adding) toggleExclude(key, false)
  }

  const onRefChange = (code: string | null, suggested: string | null, basis: OccurredOnBasis | null) => {
    setRefCode(code ?? '')
    if (code) occ.suggest(suggested, basis)
    else occ.suggest(null, null)
  }

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setErrorRows(null)
    try {
      const r = await registerDevices(hospitalCode, buildBody())
      const parts: string[] = []
      if (r.created.length > 0) parts.push(`${r.created.length.toLocaleString()}대 등록`)
      if (r.reregistered.length > 0) parts.push(`${r.reregistered.length.toLocaleString()}대 재등록`)
      if (r.transferred.length > 0) parts.push(`${r.transferred.length.toLocaleString()}대 이관`)
      if (r.skipped.length > 0) parts.push(`${r.skipped.length.toLocaleString()}대 건너뜀`)
      const warnings = [...r.warnings]
      if (r.skipped.length > 0) warnings.push(`건너뜀(이미 배치 중): ${r.skipped.slice(0, 5).map((s) => s.serialNo).join(', ')}${r.skipped.length > 5 ? ' 외' : ''}`)
      if (r.newWards.length > 0) warnings.push(`병동 생성: ${r.newWards.map((w) => w.name).join(', ')}`)
      onDone({ message: parts.length > 0 ? parts.join(' · ') : '변경 없음', warnings })
    } catch (e) {
      setError(errorMessage(e))
      if (isApiError(e)) {
        if (e.conflicts && e.conflicts.length > 0) {
          setErrorRows(e.conflicts.map((c) => `${c.serial}: ${c.hospitalName ?? c.hospitalCode} ${c.wardName ?? ''} 배치 중${c.placedOn ? ` (${toYmd(c.placedOn)})` : ''}`))
          setNonce((n) => n + 1) // 재판별 → 충돌 행에 [제외][이관 처리] 노출
        } else if (e.skipped && e.skipped.length > 0) setErrorRows(e.skipped.map((s) => `${s.serialNo}: ${s.reason}`))
        else if (e.rows && e.rows.length > 0) setErrorRows(e.rows.map((r) => `${r.row}행 ${r.serial}: ${r.message}`))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const submitLabel = submitting
    ? '등록 중…'
    : stats.executable > 0
      ? `등록 (${[stats.willRegister > 0 ? `${stats.willRegister} 등록` : null, stats.willRereg > 0 ? `${stats.willRereg} 재등록` : null, stats.willTransfer > 0 ? `${stats.willTransfer} 이관` : null].filter(Boolean).join(' · ')})`
      : '등록'

  return (
    <div
      className="space-y-4"
      onKeyDown={(e) => {
        if (isSubmitShortcut(e)) {
          e.preventDefault()
          void submit()
        }
      }}
    >
      {/* ── 입력 */}
      <FormField
        label="시리얼"
        htmlFor="register-serials"
        required
        right={
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {items.length.toLocaleString()}건{parsed.dup > 0 ? ` · 중복 ${parsed.dup}줄 병합` : ''}
            {parsed.overflow && <span className="ml-1 text-destructive">· 최대 {IMPORT_MAX_ROWS.toLocaleString()}건 초과</span>}
          </span>
        }
        hint={
          <>
            줄당 1건. <code className="font-mono">시리얼</code> 또는 <code className="font-mono">시리얼⇥병동⇥메모</code>(탭·2칸 공백 구분). 공백·쉼표로 여러 시리얼도 가능, <code>#</code> 뒤는 주석. 스캐너 입력은 ↵마다 줄이 추가됩니다.
          </>
        }
      >
        <Textarea
          id="register-serials"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={submitting}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          rows={6}
          className={cn('font-mono uppercase placeholder:normal-case', parsed.overflow && 'border-destructive')}
          placeholder={'A126861\nA126862\t6병동\ngw4c11-b008381\t6병동\t신관 GW'}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="모델" htmlFor="register-model" hint={modelId === '' ? '자동: A→심전계 · P→산소포화도 · B/GW→게이트웨이 · 접두 판별 불가 시 오류로 표시' : '모든 줄에 이 모델을 적용합니다 (접두 불일치는 경고)'}>
          <Select id="register-model" value={modelId} disabled={submitting} onChange={(e) => setModelId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">자동 판별 (접두)</option>
            {models.map((m) => (
              <option key={m.deviceInfoId} value={m.deviceInfoId}>
                {m.deviceName} {m.deviceModel}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="병동" htmlFor="register-ward" hint="공통 병동 — 줄에 병동이 있으면 그 값이 우선. 비우면 미지정(경고)">
          <WardCombo id="register-ward" hospitalCode={hospitalCode} value={ward} onChange={setWard} allowNew wards={wards} disabled={submitting} />
        </FormField>
        <FormField
          label="계약건"
          htmlFor="register-deal"
          hint={
            deals.length === 0
              ? '이 병원에 계약완료 딜이 없습니다 — 계약건 미지정으로 등록됩니다'
              : selectedDeal
                ? `이 계약건의 상품유형(${selectedDeal.productType ?? '미지정'})이 적용됩니다`
                : deals.length === 1
                  ? `비우면 단일 계약건(${deals[0].dealCode})이 자동 지정됩니다`
                  : '배치가 속한 딜(소프트 참조) — 비우면 미지정'
          }
        >
          <Select
            id="register-deal"
            value={dealCode}
            disabled={submitting}
            onChange={(e) => {
              setDealCode(e.target.value)
              if (e.target.value) setProductType('') // 딜이 상품유형을 정한다(B-23)
            }}
          >
            <option value="">{deals.length === 1 ? `자동 (단일 계약건: ${deals[0].dealCode})` : '미지정'}</option>
            {deals.map((d) => (
              <option key={d.dealCode} value={d.dealCode}>
                {d.dealCode} · {d.roundNo}차{d.productType ? ` ${d.productType}` : ''} {d.count.toLocaleString()}대
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="상품유형"
          htmlFor="register-product-type"
          required={!!ptCtx?.mixed && !selectedDeal}
          hint={
            selectedDeal ? (
              '선택한 계약건의 상품유형이 적용됩니다 (줄에 다른 유형을 명시하면 400)'
            ) : ptCtx?.mixed && productType === '' ? (
              <span className="text-destructive">이 병원은 일반·라이트 딜이 함께 있습니다 — 상품유형(또는 계약건)을 선택해야 등록할 수 있습니다 (줄에 &apos;일반&apos;/&apos;라이트&apos; 셀이 있으면 그 값 우선)</span>
            ) : ptCtx ? (
              `계약완료 딜: ${ptCtx.byType.length ? ptCtx.byType.map((b) => `${b.type} ${b.devices.toLocaleString()}대`).join(' · ') : '없음'} — 자리의 판매 조건(배치 속성). 줄의 3번째 열 이후 '일반'/'라이트' 셀이 우선`
            ) : (
              '자리의 판매 조건(배치 속성) — 비우면 병원 계약 딜 기준 기본값(1종이면 그 값, 없으면 미지정, 혼합이면 선택 필수)'
            )
          }
        >
          {selectedDeal ? (
            <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground" aria-readonly="true">
              {selectedDeal.productType ?? '미지정'}
              <span className="ml-2 text-xs text-muted-foreground">계약건에서 파생</span>
            </div>
          ) : (
            <Select id="register-product-type" value={productType} disabled={submitting} onChange={(e) => setProductType(e.target.value as ProductType | '')}>
              <option value="">{productTypeDefaultLabel(ptCtx)}</option>
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="용도" htmlFor="register-usage" hint="공통 용도 — 줄의 3번째 열 이후에 '판매용'/'평가용'이 있으면 그 값이 우선. 평가용은 계약 대조에서 제외">
          <Select id="register-usage" value={usageId} disabled={submitting || usageTypes == null} onChange={(e) => setUsageId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">미지정</option>
            {(usageTypes ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </FormField>
        <OccurredOnField id="register-date" state={occ} today={today} disabled={submitting} />
        <FormField label="유지보수 코드" htmlFor="register-ref" hint="선택 시 업무일자를 제안값으로 채웁니다 (직접 고친 값은 유지)">
          <MaintenanceCodeCombo id="register-ref" hospitalCode={hospitalCode} value={refCode} onChange={onRefChange} disabled={submitting} />
        </FormField>
      </div>
      <FormField label="메모" htmlFor="register-memo" hint="이벤트 메모(모든 줄 공통). 줄의 3번째 열은 개체 메모">
        <Textarea id="register-memo" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={submitting} rows={2} className="min-h-0" placeholder="예: go-live 추가분" />
      </FormField>

      {/* ── 판별 패널 */}
      <section className="rounded-lg border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-foreground">판별</span>
            {preview ? (
              <>
                <span className="tabular-nums text-muted-foreground">총 {rows.length.toLocaleString()}</span>
                {(['ok', 'reregister', 'skip', 'warn', 'conflict', 'error'] as ImportVerdict[]).map((s) =>
                  stats.byStatus[s] > 0 ? (
                    <span key={s} className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums', IMPORT_VERDICT_COLORS[s])}>
                      {IMPORT_VERDICT_LABELS[s]} {stats.byStatus[s]}
                    </span>
                  ) : null
                )}
                {stats.excluded > 0 && <span className="tabular-nums text-muted-foreground">제외 {stats.excluded}</span>}
              </>
            ) : (
              <span className="text-muted-foreground">{items.length === 0 ? '시리얼을 입력하면 판별합니다' : manualMode ? `${AUTO_PREVIEW_MAX}줄 초과 — [판별]을 눌러 확인하세요` : previewing ? '판별 중…' : '대기 중…'}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {preview && rows.some((r) => r.status === 'ok') && (
              <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? '정상 행 숨기기' : `정상 ${stats.byStatus.ok}건 보기`}
              </button>
            )}
            {(manualMode || stale || previewError) && items.length > 0 && (
              <Button size="sm" variant={stale || !preview ? 'primary' : 'outline'} onClick={() => void runPreview()} disabled={previewing || submitting || parsed.overflow || !!occ.error}>
                {previewing ? '판별 중…' : preview ? '다시 판별' : '판별'}
              </Button>
            )}
          </div>
        </div>

        {stale && preview && (
          <div className="border-b border-border bg-warning-subtle px-3 py-1.5 text-[11px] text-warning-subtle-foreground">
            입력이 바뀌었습니다 — {occ.error ? `업무일자를 확인하세요 (${occ.error})` : manualMode ? '[다시 판별] 후 등록할 수 있습니다' : '판별을 갱신하는 중…'}
          </div>
        )}
        {previewError && <div className="border-b border-border px-3 py-2 text-xs text-destructive">{previewError}</div>}

        {preview && stats.byModel.size > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-xs">
            <span className="text-muted-foreground">모델별(실행 대상):</span>
            {Array.from(stats.byModel.entries()).map(([m, n]) => (
              <span key={m} className="tabular-nums text-foreground">
                {m} <span className="font-semibold">{n.toLocaleString()}</span>
              </span>
            ))}
            {ward.wardId != null || ward.wardName ? <span className="text-muted-foreground">· 공통 병동 {describeWard(ward, wards)}</span> : null}
          </div>
        )}

        {preview && visibleRows.length > 0 && (
          <div className="max-h-72 overflow-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="sticky top-0 bg-muted/80 text-left text-[11px] text-muted-foreground backdrop-blur">
                <tr>
                  <th className="w-10 px-2 py-1.5 font-medium">포함</th>
                  <th className="w-10 px-2 py-1.5 font-medium">행</th>
                  <th className="px-2 py-1.5 font-medium">시리얼</th>
                  <th className="px-2 py-1.5 font-medium">모델</th>
                  <th className="px-2 py-1.5 font-medium">용도</th>
                  <th className="px-2 py-1.5 font-medium">상품유형</th>
                  <th className="px-2 py-1.5 font-medium">병동</th>
                  <th className="px-2 py-1.5 font-medium">판정</th>
                  <th className="px-2 py-1.5 font-medium">메시지 / 행 액션</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const canToggle = r.status !== 'skip'
                  const item = items[r.row - 1]
                  return (
                    <tr key={r.row} className={cn('border-t border-border align-top', r.excludedEff && 'opacity-60')}>
                      <td className="px-2 py-1.5">
                        <input type="checkbox" aria-label={`${r.serialNo} 포함`} checked={!r.excludedEff} disabled={!canToggle || submitting} onChange={(e) => toggleExclude(r.serialNo, !e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground" title={item ? `입력 ${item.line}줄` : undefined}>
                        {r.row}
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {r.serialNo || r.serialInput}
                        {r.serialRaw && r.serialRaw !== r.serialNo && <div className="text-[10px] text-muted-foreground">{r.serialRaw}</div>}
                      </td>
                      <td className="px-2 py-1.5">{r.deviceModel ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-1.5">{r.usageTypeName ?? <span className="text-muted-foreground">미지정</span>}</td>
                      <td className="px-2 py-1.5">{r.productType ?? <span className={cn('text-muted-foreground', ptCtx?.mixed && r.status !== 'skip' && 'text-destructive')}>미지정</span>}</td>
                      <td className="px-2 py-1.5">
                        {r.actionEff === 'UNASSIGN_WARD' ? (
                          <span className="text-muted-foreground">미지정 (강제)</span>
                        ) : r.wardName ?? r.wardInput ? (
                          <>
                            {r.wardName ?? r.wardInput}
                            {r.wardNew && <span className="ml-1 rounded bg-primary-subtle px-1 py-0.5 text-[10px] text-primary-subtle-foreground">신규</span>}
                            {r.wardInactive && <span className="ml-1 rounded bg-destructive-subtle px-1 py-0.5 text-[10px] text-destructive-subtle-foreground">폐쇄</span>}
                          </>
                        ) : (
                          <span className="text-muted-foreground">미지정</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', IMPORT_VERDICT_COLORS[r.status])}>
                          {r.status === 'conflict' ? '✖ ' : r.status === 'warn' ? '⚠ ' : ''}
                          {IMPORT_VERDICT_LABELS[r.status]}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="text-foreground">{r.messages.length > 0 ? r.messages.join(' · ') : r.status === 'reregister' && r.existing ? `${r.existing.lastHospitalName ?? r.existing.lastHospitalCode ?? ''}에서 ${toYmd(r.existing.recoveredOn) ?? ''} ${r.existing.recoverReason ?? ''} 회수 → 재등록으로 이력 연결` : r.status === 'skip' ? '이 병원에 이미 배치 중(변경 없음)' : ''}</div>
                        {(r.status === 'conflict' || r.actions.includes('UNASSIGN_WARD') || r.actionEff === 'UNASSIGN_WARD') && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.status === 'conflict' && (
                              <>
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => toggleExclude(r.serialNo, true)}
                                  className={cn('rounded border px-2 py-0.5 text-[11px]', r.excludedEff ? 'border-border bg-muted font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-accent')}
                                >
                                  {r.excludedEff ? '제외됨 ✓' : '제외'}
                                </button>
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => toggleTransfer(r.serialNo)}
                                  aria-pressed={r.actionEff === 'TRANSFER'}
                                  className={cn('rounded border px-2 py-0.5 text-[11px]', r.actionEff === 'TRANSFER' ? 'border-primary bg-primary-subtle font-medium text-primary-subtle-foreground' : 'border-border text-muted-foreground hover:bg-accent')}
                                >
                                  {r.actionEff === 'TRANSFER' ? '이관 처리 ✓' : '이관 처리'}
                                </button>
                              </>
                            )}
                            {(r.actions.includes('UNASSIGN_WARD') || r.actionEff === 'UNASSIGN_WARD') && (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => toggleUnassign(r.serialNo)}
                                aria-pressed={r.actionEff === 'UNASSIGN_WARD'}
                                className={cn('rounded border px-2 py-0.5 text-[11px]', r.actionEff === 'UNASSIGN_WARD' ? 'border-primary bg-primary-subtle font-medium text-primary-subtle-foreground' : 'border-border text-muted-foreground hover:bg-accent')}
                              >
                                {r.actionEff === 'UNASSIGN_WARD' ? '미지정으로 등록 ✓' : '미지정으로 등록'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {preview && visibleRows.length === 0 && rows.length > 0 && <div className="px-3 py-3 text-xs text-muted-foreground">모든 행이 정상입니다 — {stats.executable.toLocaleString()}건 등록 가능</div>}
        {preview && (stats.errorsLeft > 0 || stats.conflictsLeft > 0) && (
          <div className="border-t border-border px-3 py-2 text-[11px] text-destructive">
            {stats.errorsLeft > 0 && <span>오류 {stats.errorsLeft}건을 제외하거나 입력을 고치세요. </span>}
            {stats.conflictsLeft > 0 && <span>충돌 {stats.conflictsLeft}건은 [제외] 또는 [이관 처리]를 지정하세요.</span>}
          </div>
        )}
      </section>

      {error && (
        <Notice tone="error">
          {error}
          {errorRows && (
            <ul className="mt-1 list-disc pl-4">
              {errorRows.slice(0, 8).map((s, i) => (
                <li key={i} className="font-mono">
                  {s}
                </li>
              ))}
              {errorRows.length > 8 && <li>외 {errorRows.length - 8}건</li>}
            </ul>
          )}
        </Notice>
      )}

      <ModalActions
        left={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {preview && !stale && stats.byStatus.skip > 0 && <Badge>건너뜀 {stats.byStatus.skip}</Badge>}
            {preview && !stale && stats.excluded > 0 && <Badge variant="outline">제외 {stats.excluded}</Badge>}
            <span className="hidden sm:inline">⌘/Ctrl+Enter 제출</span>
          </span>
        }
      >
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          취소
        </Button>
        <Button onClick={() => void submit()} disabled={!canSubmit} title={stale ? '판별을 갱신한 뒤 등록할 수 있습니다' : undefined}>
          {submitLabel}
        </Button>
      </ModalActions>
    </div>
  )
}

export default RegisterModal
