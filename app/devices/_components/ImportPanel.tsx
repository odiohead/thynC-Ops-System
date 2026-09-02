'use client'

/**
 * 임포트 탭 (입력 → 미리보기 → 결과 + 이력, §6.1-B 임포트 탭 · §7.2) — GROUP D
 * 입력: 모드(● 신규 등록 ○ 온프렘 export 초안 — preview.input.onprem이면 초안 제안) · [텍스트 붙여넣기] | [Excel 업로드 · 템플릿 ↓] · 업무일자(오늘+행≥50이면 확인 배지)
 *  · 병동 [열에서 읽기 ▾ | 고정](WardCombo) · 열 모드 빈 셀(● 미지정 warn / ○ 오류) · 모델 [자동 ▾](summary.models) · 용도 [미지정|판매용|평가용](폼 공통 — E열/붙여넣기 용도 셀이 우선)
 *  · 상품유형 [기본값(계약 딜 기준)|일반|라이트](B-22 — F열/붙여넣기 '일반·라이트' 셀 우선, 혼합 병원은 미지정 행 error) · 메모 → [미리보기] = previewImport(code, source, options)
 * 미리보기: 요약(총·신규·재등록·건너뜀·경고·충돌(기본 제외)·오류) + 판정 필터 칩 · 생성 예정 병동 표(새로 생성 | 기존 병동 매핑 → wardAliases)
 *  · (초안) org ≥2 → 체크 + [이 기관만 등록](재검증 전 [실행] 비활성) · 행 표(☑ | 행 | 시리얼 | 원문 | 모델 | 병동(해석) | 판정 | 메시지/행 액션 [제외▾|이관] [미지정으로 등록])
 *  · [입력으로 돌아가기] [오류 행 제외하고 다시 검증] [실행 (n 등록 · m 재등록)](미제외 오류 있으면 비활성) = executeImport(code, source, { …options, excludeRows, rowActions, wardAliases, orgs })
 * 결과: "118대 등록 · 2대 재등록 · 병동 2개 생성 (배치 #13)" → onDone. 400 rows[] / 409 conflicts[] / 409 rows[](소급 불성립)는 행에 반영.
 * 이력: getImportBatches — | # | 일시 | 작성자 | 출처·모드 | 선택 org | 업무일자 | 행/등록/재등록/건너뜀/이관 | 상태 | [업무일자 정정] [취소](canAdmin) | → patchImportBatchDate / cancelImportBatch → onDone
 * VIEWER(canWrite=false): 입력 영역 대신 EmptyState "임포트는 USER 등급부터 가능합니다" + 이력(읽기). 모바일: 데스크톱 권장 문구.
 * 조회 후 onTotalChange(이력 total)로 탭 카운트 갱신.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { AlertTriangle, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react'
import Badge from '@/app/components/ui/Badge'
import Button from '@/app/components/ui/Button'
import EmptyState from '@/app/components/ui/EmptyState'
import { Input, Select, Textarea } from '@/app/components/ui/Input'
import { TBody, TD, TH, THead, TR, Table } from '@/app/components/ui/Table'
import { cn } from '@/lib/cn'
import {
  IMPORT_BATCH_MODE_LABELS,
  IMPORT_MAX_ROWS,
  IMPORT_SOURCE_KIND_LABELS,
  IMPORT_VERDICT_COLORS,
  IMPORT_VERDICT_LABELS,
  todayKst,
  type ImportBatchMode,
  type ImportRowAction,
  type ImportVerdict, PRODUCT_TYPES, type ProductType, } from '@/lib/deviceRegistryShared'
import { productTypeDefaultLabel } from './deviceDisplay'
import { cancelImportBatch, errorMessage, executeImport, getImportBatches, getUsageTypes, isApiError, patchImportBatchDate, previewImport, type ImportSource } from './api'
import { Pager, StatChip, TableMessageRow, fmtDateTimeKst, ymdOrDash } from './groupd-shared'
import { useDevicesToast } from './toast'
import { WardCombo } from './WardCombo'
import {
  toWardOption,
  type Capabilities,
  type Conflict,
  type HospitalDeviceSummary,
  type ImportBatch,
  type ImportEmptyWardCell,
  type ImportExecuteResponse,
  type ImportOptions,
  type ImportPreviewResponse,
  type ImportPreviewRow,
  type ImportWardMode,
  type MutationDone,
  type RegistryErrorRow,
  type UsageType,
  type WardValue,
} from './types'

export interface ImportPanelProps {
  hospitalCode: string
  capabilities: Capabilities
  /** 모델 옵션·병동 옵션·today */
  summary: HospitalDeviceSummary | null
  /** 실행·배치 취소·업무일자 정정 성공 후 */
  onDone: (result: MutationDone) => void
  onTotalChange?: (total: number) => void
  reloadKey: number
}

type Phase = 'input' | 'preview' | 'result'
type InputTab = 'text' | 'file'
type VerdictFilter = 'all' | ImportVerdict

interface ExecError {
  message: string
  rows?: RegistryErrorRow[]
  conflicts?: Conflict[]
}

const VERDICT_FILTERS: { key: VerdictFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'ok', label: '정상' },
  { key: 'reregister', label: '재등록' },
  { key: 'warn', label: '경고' },
  { key: 'conflict', label: '충돌' },
  { key: 'error', label: '오류' },
  { key: 'skip', label: '건너뜀' },
]

const CONFIRM_ROWS = 50
const HISTORY_LIMIT = 20

function sameSet(a: readonly string[] | null, b: readonly string[]): boolean {
  if (!a) return false
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

/** 템플릿 xlsx — 첫 시트 1행 헤더(A 시리얼 · B 모델 · C 병동 · D 메모 · E 용도), 둘째 시트 안내 */
async function downloadTemplate() {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['시리얼', '모델', '병동', '메모', '용도', '상품유형']])
  sheet['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, sheet, '기기 목록')
  const guide = XLSX.utils.aoa_to_sheet([
    ['기기 현황 임포트 템플릿'],
    [''],
    ['열', '필수', '설명', '예시'],
    ['A 시리얼', '예', '기기 시리얼(대소문자·공백 무시). 합성 시리얼(GW4C11-B008381)·바코드형은 자동 분해', 'A126861'],
    ['B 모델', '아니오', '모델명 또는 제품명. 비우면 접두(A/P/B)로 자동 판별', 'MC200M-T / 심전계'],
    ['C 병동', '아니오', '병동 이름 또는 온프렘 병동 코드. 없는 이름은 새로 생성(미리보기에서 기존 병동으로 매핑 가능)', '6병동'],
    ['D 메모', '아니오', '등록 이벤트 메모(개체 메모는 드로어에서 입력)', 'go-live 1차'],
    ['E 용도', '아니오', '판매용 또는 평가용(SALE/EVAL). 비우면 임포트 옵션의 용도, 그것도 없으면 미지정. 평가용은 계약 대조에서 제외', '평가용'],
    ['F 상품유형', '아니오', '일반 또는 라이트(자리의 판매 조건). 비우면 임포트 옵션의 상품유형, 그것도 없으면 병원 계약 딜 기준 기본값(일반·라이트 딜이 함께 있으면 필수)', '라이트'],
    [''],
    ['· 첫 시트만 읽습니다. 1행은 헤더, 2행부터 데이터. 한 번에 최대 ' + IMPORT_MAX_ROWS.toLocaleString() + '행.'],
    ['· 관리자 콘솔 xlsx(A열만·헤더 없음)는 A1이 시리얼이면 자동 인식됩니다.'],
  ])
  guide['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 70 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, guide, '안내')
  XLSX.writeFile(wb, '기기현황_임포트_템플릿.xlsx')
}

function wardCell(r: ImportPreviewRow): { text: string; tone?: 'new' | 'inactive' | 'unresolved' | 'none' } {
  if (r.wardName) {
    if (r.wardInactive) return { text: `${r.wardName} (폐쇄)`, tone: 'inactive' }
    if (r.wardNew) return { text: `${r.wardName} (신규)`, tone: 'new' }
    return { text: r.wardName }
  }
  if (r.wardInput) return { text: `${r.wardInput} (미해석)`, tone: 'unresolved' }
  return { text: '미지정', tone: 'none' }
}

export function ImportPanel({ hospitalCode, capabilities, summary, onDone, onTotalChange, reloadKey }: ImportPanelProps) {
  const notify = useDevicesToast()
  const { canWrite, canAdmin } = capabilities
  const today = summary?.today ?? todayKst()
  const models = summary?.models ?? []
  const wardOptions = useMemo(() => (summary ? summary.wards.map(toWardOption) : []), [summary])
  const activeWards = useMemo(() => wardOptions.filter((w) => w.isActive), [wardOptions])

  // ── 입력
  const [phase, setPhase] = useState<Phase>('input')
  const [inputTab, setInputTab] = useState<InputTab>('text')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<ImportBatchMode | null>(null) // null = 자동(서버 감지)
  const [occurredOn, setOccurredOn] = useState(today)
  const [wardMode, setWardMode] = useState<ImportWardMode>('column')
  const [fixedWard, setFixedWard] = useState<WardValue>({})
  const [emptyWardCell, setEmptyWardCell] = useState<ImportEmptyWardCell>('warn')
  const [deviceInfoId, setDeviceInfoId] = useState<number | null>(null)
  const [usageTypeId, setUsageTypeId] = useState<number | null>(null)
  const [usageTypes, setUsageTypes] = useState<UsageType[] | null>(null)
  /** 상품유형 공통값 — null = 서버 기본값 규칙(병원 딜 기준) */
  const [productType, setProductType] = useState<ProductType | null>(null)
  /** 계약건 공통값(B-23) — null = 자동(단일 계약완료 딜 기본값)/미지정 */
  const [dealCode, setDealCode] = useState<string | null>(null)
  const contractedDeals = useMemo(() => summary?.contractedDeals ?? [], [summary])
  const [memo, setMemo] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getUsageTypes()
      .then((r) => alive && setUsageTypes(r))
      .catch(() => alive && setUsageTypes([]))
    return () => {
      alive = false
    }
  }, [])

  // 병원이 바뀌면 today 기본값만 따라간다(사용자가 손대지 않았을 때)
  const dateTouched = useRef(false)
  useEffect(() => {
    if (!dateTouched.current) setOccurredOn(today)
  }, [today])

  // ── 미리보기
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set())
  const [rowActions, setRowActions] = useState<Record<number, ImportRowAction>>({})
  const [wardAliases, setWardAliases] = useState<Record<string, number>>({})
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([])
  const [sentOrgs, setSentOrgs] = useState<string[] | null>(null)
  const [stale, setStale] = useState(false)
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all')
  const [execError, setExecError] = useState<ExecError | null>(null)
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<ImportExecuteResponse | null>(null)

  const effectiveMode: ImportBatchMode = mode ?? preview?.input.mode ?? 'REGISTER'
  /** 병원 딜 기준 상품유형 문맥 — 요약(summary) 우선, 미리보기 응답으로 갱신 */
  const ptCtx = preview?.summary.productTypeContext ?? summary?.productTypeContext ?? null
  const isDraft = effectiveMode === 'ONPREM_DRAFT'

  const source: ImportSource | null = useMemo(() => {
    if (inputTab === 'file') return file ? { file } : null
    return text.trim() ? { text } : null
  }, [inputTab, file, text])

  const markStale = useCallback(() => {
    if (phase === 'preview') setStale(true)
  }, [phase])

  const baseOptions = useCallback((): ImportOptions => {
    const o: ImportOptions = { wardMode, emptyWardCell, occurredOn }
    if (mode) o.mode = mode
    if (wardMode === 'fixed' && fixedWard.wardId) o.wardId = fixedWard.wardId
    if (deviceInfoId) o.deviceInfoId = deviceInfoId
    if (usageTypeId) o.usageTypeId = usageTypeId
    if (productType) o.productType = productType
    if (dealCode) o.dealCode = dealCode
    if (memo.trim()) o.memo = memo.trim()
    return o
  }, [wardMode, emptyWardCell, occurredOn, mode, fixedWard.wardId, deviceInfoId, usageTypeId, productType, dealCode, memo])

  /** 미리보기 상태(제외·행 액션·별칭·org)를 옵션에 얹는다 — 재검증·실행 공용 */
  const reviewOptions = useCallback(
    (orgsOverride?: string[] | null): ImportOptions => {
      const o = baseOptions()
      if (!preview) return o
      // 미리보기 이후에는 제외 목록을 빈 배열이라도 항상 명시 전송 — 라우트가 '명시된 빈 배열'을 기본 제외 폴백과 구분한다(사용자가 [이관]으로 푼 충돌 행이 되살아나지 않게)
      o.excludeRows = Array.from(excluded)
      if (Object.keys(rowActions).length) o.rowActions = rowActions
      if (Object.keys(wardAliases).length) o.wardAliases = wardAliases
      const orgs = orgsOverride === undefined ? sentOrgs : orgsOverride
      if (orgs) o.orgs = orgs
      if (preview.input.mode && !o.mode) o.mode = preview.input.mode
      return o
    },
    [baseOptions, preview, excluded, rowActions, wardAliases, sentOrgs]
  )

  const applyPreview = useCallback((p: ImportPreviewResponse, orgsSent: string[] | null) => {
    setPreview(p)
    setExcluded(new Set(p.rows.filter((r) => r.excluded).map((r) => r.row)))
    const ra: Record<number, ImportRowAction> = {}
    for (const r of p.rows) if (r.action) ra[r.row] = r.action
    setRowActions(ra)
    setWardAliases(p.summary.wardAliases ?? {})
    setSelectedOrgs(p.summary.orgs.filter((o) => o.selected).map((o) => o.org))
    setSentOrgs(orgsSent)
    setStale(false)
    setExecError(null)
    setPhase('preview')
  }, [])

  const runPreview = useCallback(
    async (opts: ImportOptions, orgsSent: string[] | null) => {
      if (!source) {
        setInputError(inputTab === 'file' ? 'Excel 파일을 선택하세요.' : '붙여넣을 목록을 입력하세요.')
        return
      }
      setPreviewing(true)
      setInputError(null)
      try {
        const p = await previewImport(hospitalCode, source, opts)
        applyPreview(p, orgsSent)
        if (p.input.onprem && !mode && p.input.mode === 'ONPREM_DRAFT') notify('온프렘 export 형식이 감지되어 초안 모드로 판정했습니다.', 'info')
      } catch (e) {
        const msg = errorMessage(e, '미리보기에 실패했습니다.')
        if (phase === 'input') setInputError(msg)
        else notify(msg, 'error')
      } finally {
        setPreviewing(false)
      }
    },
    [source, inputTab, hospitalCode, applyPreview, mode, notify, phase]
  )

  const firstPreview = () => void runPreview(baseOptions(), null)
  const reverify = (orgsOverride?: string[] | null) => void runPreview(reviewOptions(orgsOverride), orgsOverride === undefined ? sentOrgs : orgsOverride)

  const backToInput = () => {
    setPhase('input')
    setPreview(null)
    setExecError(null)
    setStale(false)
    setSentOrgs(null)
  }

  const resetAll = () => {
    backToInput()
    setResult(null)
    setText('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setMemo('')
  }

  // ── 파생(미리보기)
  const rows = useMemo(() => preview?.rows ?? [], [preview])
  const derived = useMemo(() => {
    let register = 0
    let reregister = 0
    let transfer = 0
    const unresolvedErrors: ImportPreviewRow[] = []
    const unresolvedConflicts: ImportPreviewRow[] = []
    for (const r of rows) {
      const ex = excluded.has(r.row)
      const action = rowActions[r.row]
      if (r.status === 'error') {
        if (!ex && action === 'UNASSIGN_WARD') register += 1
        else if (!ex) unresolvedErrors.push(r)
      } else if (r.status === 'conflict') {
        if (!ex && action === 'TRANSFER') transfer += 1
        else if (!ex) unresolvedConflicts.push(r)
      } else if (!ex && (r.status === 'ok' || r.status === 'warn')) register += 1
      else if (!ex && r.status === 'reregister') reregister += 1
    }
    return { register, reregister, transfer, unresolvedErrors, unresolvedConflicts, executable: register + reregister + transfer }
  }, [rows, excluded, rowActions])

  const orgGateOpen = isDraft && (preview?.summary.orgs.length ?? 0) >= 2 && !sameSet(sentOrgs, selectedOrgs)
  const todayBadge = phase === 'preview' && occurredOn === today && (preview?.input.rowCount ?? 0) >= CONFIRM_ROWS
  const execBlockers: string[] = []
  if (stale) execBlockers.push('옵션·매핑이 바뀌었습니다 — [다시 검증] 후 실행')
  if (orgGateOpen) execBlockers.push('기관 코드가 2개 이상입니다 — 이 병원 소속만 체크하고 [이 기관만 등록]')
  if (derived.unresolvedErrors.length) execBlockers.push(`미제외 오류 ${derived.unresolvedErrors.length}건 — 제외하거나 [오류 행 제외하고 다시 검증]`)
  if (derived.unresolvedConflicts.length) execBlockers.push(`처리 미지정 충돌 ${derived.unresolvedConflicts.length}건 — [제외] 또는 [이관]`)
  if (!stale && !orgGateOpen && derived.executable === 0) execBlockers.push('실행할 행이 없습니다')
  const canExecute = phase === 'preview' && !executing && !previewing && execBlockers.length === 0

  const visibleRows = useMemo(() => (verdictFilter === 'all' ? rows : rows.filter((r) => r.status === verdictFilter)), [rows, verdictFilter])
  const errorRowSet = useMemo(() => new Set((execError?.rows ?? []).map((r) => r.row)), [execError])
  const errorRowMsg = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of execError?.rows ?? []) m.set(r.row, r.message)
    return m
  }, [execError])
  const conflictSerialSet = useMemo(() => new Set((execError?.conflicts ?? []).map((c) => c.serial)), [execError])

  // ── 행 조작
  const toggleExcluded = (row: number, ex: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (ex) next.add(row)
      else next.delete(row)
      return next
    })
  const setAction = (row: number, action: ImportRowAction | null) => {
    setRowActions((prev) => {
      const next = { ...prev }
      if (action) next[row] = action
      else delete next[row]
      return next
    })
    if (action) toggleExcluded(row, false)
  }
  const excludeErrorsAndReverify = () => {
    const next = new Set(excluded)
    for (const r of derived.unresolvedErrors) next.add(r.row)
    setExcluded(next)
    // 상태 반영 후 재검증 — reviewOptions는 excluded를 클로저로 읽으므로 직접 구성
    const o = reviewOptions()
    o.excludeRows = Array.from(next)
    void runPreview(o, sentOrgs)
  }

  // ── 실행
  const execute = async () => {
    if (!canExecute || !source || !preview) return
    const parts = [`${derived.register.toLocaleString()}대 등록`]
    if (derived.reregister) parts.push(`${derived.reregister.toLocaleString()}대 재등록`)
    if (derived.transfer) parts.push(`${derived.transfer.toLocaleString()}대 이관`)
    const name = summary?.hospitalName ?? hospitalCode
    if (!window.confirm(`${name}에 ${parts.join(' · ')} (업무일자 ${occurredOn})\n단일 트랜잭션으로 실행됩니다. 진행할까요?`)) return
    setExecuting(true)
    setExecError(null)
    try {
      const r = await executeImport(hospitalCode, source, reviewOptions())
      const b = r.batch
      const msgParts = [`${b.registeredCount.toLocaleString()}대 등록`]
      if (b.reregisteredCount) msgParts.push(`${b.reregisteredCount.toLocaleString()}대 재등록`)
      if (b.transferredCount) msgParts.push(`${b.transferredCount.toLocaleString()}대 이관`)
      if (b.skippedCount) msgParts.push(`${b.skippedCount.toLocaleString()}대 건너뜀`)
      if (r.result.newWards.length) msgParts.push(`병동 ${r.result.newWards.length}개 생성`)
      const message = `${msgParts.join(' · ')} (배치 #${b.id})`
      setResult(r)
      setPhase('result')
      onDone({ message, warnings: Array.from(new Set([...(r.warnings ?? []), ...(r.result.warnings ?? [])])) })
    } catch (e) {
      if (isApiError(e)) {
        setExecError({ message: e.error, rows: e.rows, conflicts: e.conflicts })
        if (e.rows?.length || e.conflicts?.length) setVerdictFilter('all')
      } else notify(errorMessage(e, '임포트 실행에 실패했습니다.'), 'error')
    } finally {
      setExecuting(false)
    }
  }

  // ── 이력
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [batchTotal, setBatchTotal] = useState(0)
  const [batchPage, setBatchPage] = useState(1)
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState<number | null>(null)
  const [editDateId, setEditDateId] = useState<number | null>(null)
  const [editDate, setEditDate] = useState('')
  const [historyKey, setHistoryKey] = useState(0)
  const onTotalRef = useRef(onTotalChange)
  onTotalRef.current = onTotalChange

  useEffect(() => {
    setBatchPage(1)
  }, [hospitalCode])

  useEffect(() => {
    let alive = true
    setBatchLoading(true)
    setBatchError(null)
    getImportBatches(hospitalCode, { page: batchPage, limit: HISTORY_LIMIT })
      .then((r) => {
        if (!alive) return
        setBatches(r.data)
        setBatchTotal(r.total)
        onTotalRef.current?.(r.total)
      })
      .catch((e) => {
        if (!alive) return
        setBatches([])
        setBatchError(errorMessage(e, '임포트 이력을 불러오지 못했습니다.'))
      })
      .finally(() => alive && setBatchLoading(false))
    return () => {
      alive = false
    }
  }, [hospitalCode, batchPage, reloadKey, historyKey])

  const saveBatchDate = async (b: ImportBatch) => {
    if (!editDate) return
    if (editDate === ymdOrDash(b.occurredOn)) {
      setEditDateId(null)
      return
    }
    setBatchBusy(b.id)
    try {
      const r = await patchImportBatchDate(hospitalCode, b.id, editDate)
      setEditDateId(null)
      onDone({ message: `배치 #${b.id} 업무일자 정정: ${ymdOrDash(r.before)} → ${ymdOrDash(r.after)} (이벤트 ${r.eventCount.toLocaleString()}건 · 기기 ${r.deviceCount.toLocaleString()}대)` })
    } catch (e) {
      notify(errorMessage(e, '업무일자를 정정하지 못했습니다.'), 'error', { duration: 9000 })
    } finally {
      setBatchBusy(null)
    }
  }

  const cancelBatch = async (b: ImportBatch) => {
    if (
      !window.confirm(
        `배치 #${b.id}(${ymdOrDash(b.occurredOn)} · 등록 ${b.registeredCount} · 재등록 ${b.reregisteredCount} · 이관 ${b.transferredCount})를 취소할까요?\n` +
          '이 배치로 등록된 기기는 삭제되고(재등록은 회수 상태로 복원, 이관은 원 병원 복원), 배치 밖 이벤트가 있는 기기가 있으면 취소되지 않습니다. 자동 생성 병동은 남습니다.'
      )
    )
      return
    setBatchBusy(b.id)
    try {
      const r = await cancelImportBatch(hospitalCode, b.id)
      const s = r.summary
      const parts = [`배치 #${b.id} 취소`]
      if (s.deletedDeviceIds.length) parts.push(`${s.deletedDeviceIds.length.toLocaleString()}대 삭제`)
      if (s.restoredDeviceIds.length) parts.push(`${s.restoredDeviceIds.length.toLocaleString()}대 회수 상태 복원`)
      if (s.restoredTransfers.length) parts.push(`${s.restoredTransfers.length.toLocaleString()}대 원 병원 복원`)
      parts.push(`이벤트 ${s.eventCount.toLocaleString()}건`)
      const warnings: string[] = []
      if (s.correctedSerials.length) warnings.push(`정정 이력이 함께 삭제된 시리얼: ${s.correctedSerials.slice(0, 5).join(', ')}${s.correctedSerials.length > 5 ? ' 외' : ''}`)
      if (s.newWardsKept.length) warnings.push(`자동 생성 병동 ${s.newWardsKept.length}개는 남았습니다 — 참조 0이면 병동 탭에서 삭제`)
      onDone({ message: `${parts[0]} — ${parts.slice(1).join(' · ')}`, warnings })
    } catch (e) {
      notify(errorMessage(e, '배치를 취소하지 못했습니다.'), 'error', { duration: 12000 })
    } finally {
      setBatchBusy(null)
    }
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setInputError(null)
    markStale()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────────────────

  const optionsDisabled = previewing || executing

  const optionsBlock = (
    <div className="space-y-3">
      {/* 모드 */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-xs text-muted-foreground">모드</span>
        {(['REGISTER', 'ONPREM_DRAFT'] as ImportBatchMode[]).map((m) => (
          <label key={m} className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="import-mode"
              className="accent-primary"
              checked={effectiveMode === m}
              disabled={optionsDisabled}
              onChange={() => {
                setMode(m)
                markStale()
              }}
            />
            {IMPORT_BATCH_MODE_LABELS[m]}
          </label>
        ))}
        {preview?.input.onprem && (
          <span className="text-xs text-muted-foreground">
            온프렘 export 형식 감지({preview.input.format}) — 초안 모드 제안. 초안 모드는 검토 도구일 뿐 자동 이벤트를 만들지 않습니다.
          </span>
        )}
        {!preview && (
          <span className="text-xs text-muted-foreground">헤더에 시리얼 별칭 + (wardCode | deviceType)이 있거나 deviceRegisterList JSON이면 초안 모드가 자동 제안됩니다.</span>
        )}
      </div>

      {/* 옵션 행 */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            업무일자
            {todayBadge && (
              <Badge variant="warning" className="gap-1">
                <AlertTriangle size={11} /> 오늘 · {preview?.input.rowCount}행 — 백필이면 실제 배치일로
              </Badge>
            )}
          </span>
          <Input
            type="date"
            className="h-9"
            value={occurredOn}
            max={today}
            disabled={optionsDisabled}
            onChange={(e) => {
              dateTouched.current = true
              setOccurredOn(e.target.value)
              markStale()
            }}
          />
          <span className="text-[11px]">이 목록이 병원에 배치된 날(go-live·설치일). 과거 허용, 미래 불가.</span>
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          병동
          <div className="flex items-center gap-2">
            <Select
              className="h-9 w-32"
              value={wardMode}
              disabled={optionsDisabled}
              onChange={(e) => {
                setWardMode(e.target.value as ImportWardMode)
                markStale()
              }}
            >
              <option value="column">열에서 읽기</option>
              <option value="fixed">고정</option>
            </Select>
            {wardMode === 'fixed' && (
              <WardCombo
                hospitalCode={hospitalCode}
                value={fixedWard}
                onChange={(v) => {
                  setFixedWard(v)
                  markStale()
                }}
                allowNew={false}
                wards={wardOptions}
                disabled={optionsDisabled}
                placeholder="고정 병동 선택"
                className="min-w-0 flex-1"
              />
            )}
          </div>
          {wardMode === 'column' ? (
            <span className="flex flex-wrap items-center gap-3 text-[11px]">
              열 모드 빈 셀:
              {(
                [
                  ['warn', '미지정으로 등록(경고)'],
                  ['error', '오류'],
                ] as [ImportEmptyWardCell, string][]
              ).map(([v, l]) => (
                <label key={v} className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name="empty-ward"
                    className="accent-primary"
                    checked={emptyWardCell === v}
                    disabled={optionsDisabled}
                    onChange={() => {
                      setEmptyWardCell(v)
                      markStale()
                    }}
                  />
                  {l}
                </label>
              ))}
            </span>
          ) : (
            <span className="text-[11px]">병동 열은 무시되고 전 행이 선택한 병동으로 등록됩니다(미선택 = 미지정).</span>
          )}
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          모델
          <Select
            className="h-9"
            value={deviceInfoId ?? ''}
            disabled={optionsDisabled}
            onChange={(e) => {
              setDeviceInfoId(e.target.value ? Number(e.target.value) : null)
              markStale()
            }}
          >
            <option value="">자동(접두·모델 열)</option>
            {models.map((m) => (
              <option key={m.deviceInfoId} value={m.deviceInfoId}>
                {m.deviceModel} · {m.deviceName}
              </option>
            ))}
          </Select>
          <span className="text-[11px]">게이트웨이 export처럼 한 모델만 있는 목록은 고정이 안전합니다.</span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          용도
          <Select
            className="h-9"
            value={usageTypeId ?? ''}
            disabled={optionsDisabled || usageTypes == null}
            onChange={(e) => {
              setUsageTypeId(e.target.value ? Number(e.target.value) : null)
              markStale()
            }}
          >
            <option value="">미지정</option>
            {(usageTypes ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <span className="text-[11px]">E열/붙여넣기의 &apos;판매용·평가용&apos; 셀이 우선. 평가용은 계약 대조에서 제외.</span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          계약건
          <Select
            className="h-9"
            value={dealCode ?? ''}
            disabled={optionsDisabled}
            onChange={(e) => {
              setDealCode(e.target.value || null)
              if (e.target.value) setProductType(null) // 딜이 상품유형을 정한다(B-23)
              markStale()
            }}
          >
            <option value="">{contractedDeals.length === 1 ? `자동 (단일 계약건: ${contractedDeals[0].dealCode})` : '미지정'}</option>
            {contractedDeals.map((d) => (
              <option key={d.dealCode} value={d.dealCode}>
                {d.dealCode} · {d.roundNo}차{d.productType ? ` ${d.productType}` : ''} {d.count.toLocaleString()}대
              </option>
            ))}
          </Select>
          <span className="text-[11px]">{dealCode ? '이 계약건의 상품유형이 전 행에 적용됩니다(행에 다른 유형 명시 시 오류)' : '배치가 속한 딜(소프트 참조) — 비우면 단일 계약완료 딜일 때만 자동 지정'}</span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          상품유형{ptCtx?.mixed && !dealCode && <span className="ml-0.5 text-destructive">*</span>}
          <Select
            className="h-9"
            value={productType ?? ''}
            disabled={optionsDisabled || !!dealCode}
            onChange={(e) => {
              setProductType((e.target.value || null) as ProductType | null)
              markStale()
            }}
          >
            <option value="">{dealCode ? '계약건에서 파생' : productTypeDefaultLabel(ptCtx)}</option>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <span className={cn('text-[11px]', ptCtx?.mixed && !productType && !dealCode && 'text-destructive')}>
            {dealCode
              ? '선택한 계약건의 상품유형이 적용됩니다'
              : ptCtx?.mixed && !productType
                ? '일반·라이트 딜이 함께 있는 병원 — F열/붙여넣기 셀이 없는 행은 오류로 판정됩니다. 공통값(또는 계약건)을 고르거나 행마다 지정하세요.'
                : `자리의 판매 조건(배치 속성). F열/붙여넣기의 '일반·라이트' 셀이 우선${ptCtx?.byType.length ? ` · 계약완료 딜: ${ptCtx.byType.map((b) => `${b.type} ${b.devices.toLocaleString()}대`).join(' · ')}` : ''}`}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          메모(배치)
          <Input className="h-9" value={memo} placeholder="go-live 1차" maxLength={200} disabled={optionsDisabled} onChange={(e) => setMemo(e.target.value)} />
          <span className="text-[11px]">배치 이력에 남는 메모. 행별 메모는 D열/3번째 열.</span>
        </label>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground md:hidden">임포트는 데스크톱에서 진행하는 것을 권장합니다.</p>

      {!canWrite ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState title="임포트는 USER 등급부터 가능합니다" description="조회는 전원 가능합니다. 임포트 이력은 아래에서 확인할 수 있습니다." />
        </div>
      ) : phase === 'result' && result ? (
        <ResultBanner result={result} onNew={resetAll} onBack={() => setPhase('preview')} />
      ) : (
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          {/* 입력 영역 */}
          {phase === 'input' && (
            <>
              <div className="flex flex-wrap items-center gap-1 border-b border-border">
                {(
                  [
                    ['text', '텍스트 붙여넣기'],
                    ['file', 'Excel 업로드'],
                  ] as [InputTab, string][]
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={inputTab === k}
                    onClick={() => {
                      setInputTab(k)
                      setInputError(null)
                    }}
                    className={cn(
                      '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                      inputTab === k ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {l}
                  </button>
                ))}
                <button type="button" onClick={() => void downloadTemplate()} className="ml-auto inline-flex items-center gap-1 px-2 py-2 text-xs text-primary hover:underline" title="시리얼·모델·병동·메모 4열 템플릿">
                  <Download size={13} /> 템플릿 ↓
                </button>
              </div>

              {inputTab === 'text' ? (
                <div className="space-y-1">
                  <Textarea
                    className="min-h-40 font-mono text-xs"
                    placeholder={'A126861\nA126862\t6병동\nA126863, A126864 A126865\ngw4c11-b008381\t6병동\t신관 GW\n# 주석 · 빈 줄 무시 — 또는 온프렘 export(TSV/CSV 헤더 · deviceRegisterList JSON) 그대로 붙여넣기'}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value)
                      setInputError(null)
                    }}
                    spellCheck={false}
                    autoFocus
                  />
                  <p className="text-[11px] text-muted-foreground">
                    줄당 1건 — 탭 또는 2칸 공백이면 <span className="font-mono">시리얼 · 병동 · 메모</span> 열 모드(3열 이후 &apos;판매용·평가용&apos; 셀은 용도), 없으면 토큰 전부 시리얼. 최대 {IMPORT_MAX_ROWS.toLocaleString()}행.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground hover:bg-accent/40">
                    <Upload size={20} />
                    {file ? (
                      <span className="inline-flex items-center gap-1 text-foreground">
                        <FileSpreadsheet size={16} /> {file.name} <span className="text-xs text-muted-foreground">({Math.round(file.size / 1024).toLocaleString()} KB)</span>
                      </span>
                    ) : (
                      <span>Excel(.xlsx) 파일 선택 — 첫 시트 A 시리얼 · B 모델 · C 병동 · D 메모 · E 용도(1행 헤더)</span>
                    )}
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={onFileChange} />
                  </label>
                  <p className="text-[11px] text-muted-foreground">관리자 콘솔 xlsx(A열만·헤더 없음)는 A1이 시리얼이면 자동 인식. 온프렘 export(별칭 헤더)는 초안 모드로 제안됩니다.</p>
                </div>
              )}

              {optionsBlock}

              {inputError && <div className="rounded-md border border-destructive/40 bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">{inputError}</div>}

              <div className="flex items-center justify-end gap-2">
                <Button onClick={firstPreview} disabled={!source || previewing}>
                  {previewing ? '판정 중…' : '미리보기'}
                </Button>
              </div>
            </>
          )}

          {/* 미리보기 */}
          {phase === 'preview' && preview && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  입력: {IMPORT_SOURCE_KIND_LABELS[preview.input.sourceKind]}
                  {preview.input.fileName ? ` · ${preview.input.fileName}` : ''} · {preview.input.rowCount.toLocaleString()}행 · 형식 {preview.input.format}
                  {preview.input.header ? ' (헤더 인식)' : ''}
                </div>
                <Button size="sm" variant="ghost" onClick={backToInput} disabled={executing}>
                  입력으로 돌아가기
                </Button>
              </div>

              {optionsBlock}

              {stale && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
                  <span>옵션·매핑이 바뀌었습니다 — 판정을 다시 받아야 실행할 수 있습니다.</span>
                  <Button size="sm" variant="outline" onClick={() => reverify()} disabled={previewing}>
                    <RefreshCw size={13} className={cn(previewing && 'animate-spin')} /> 다시 검증
                  </Button>
                </div>
              )}

              {/* 요약 + 판정 필터 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">요약:</span>
                <StatChip label="총" value={preview.summary.total} active={verdictFilter === 'all'} onClick={() => setVerdictFilter('all')} />
                <StatChip label="신규" value={preview.summary.ok} active={verdictFilter === 'ok'} onClick={() => setVerdictFilter('ok')} />
                <StatChip label="재등록" value={preview.summary.reregister} active={verdictFilter === 'reregister'} onClick={() => setVerdictFilter('reregister')} />
                <StatChip label="건너뜀(이미 배치)" value={preview.summary.skip} active={verdictFilter === 'skip'} onClick={() => setVerdictFilter('skip')} />
                <StatChip label="경고" value={preview.summary.warn} active={verdictFilter === 'warn'} onClick={() => setVerdictFilter('warn')} />
                <StatChip label="충돌(기본 제외)" value={preview.summary.conflict} active={verdictFilter === 'conflict'} onClick={() => setVerdictFilter('conflict')} />
                <StatChip label="오류" value={preview.summary.error} active={verdictFilter === 'error'} onClick={() => setVerdictFilter('error')} />
                <span className="ml-auto text-xs text-muted-foreground">
                  제외 {excluded.size.toLocaleString()} · 실행 예정 {derived.executable.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 border-b border-border">
                {VERDICT_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={verdictFilter === f.key}
                    onClick={() => setVerdictFilter(f.key)}
                    className={cn(
                      '-mb-px border-b-2 px-2.5 py-1.5 text-xs transition-colors',
                      verdictFilter === f.key ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {f.label}
                    {f.key !== 'all' && <span className="ml-1 tabular-nums">({preview.summary[f.key].toLocaleString()})</span>}
                  </button>
                ))}
              </div>

              {/* 생성 예정 병동 */}
              {preview.summary.newWards.length > 0 && (
                <div className="rounded-md border border-border">
                  <div className="border-b border-border bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">생성 예정 병동 {preview.summary.newWards.length}개 — 오타 병동은 실행 전에 기존 병동으로 매핑하세요</div>
                  <Table>
                    <THead>
                      <tr>
                        <TH>입력명</TH>
                        <TH className="text-right">행</TH>
                        <TH>처리</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {preview.summary.newWards.map((w) => (
                        <TR key={w.nameNorm}>
                          <TD className="text-sm">
                            {w.name}
                            {w.fromCode && (
                              <Badge variant="warning" className="ml-2">
                                코드명 — 병동명 확인 필요
                              </Badge>
                            )}
                          </TD>
                          <TD className="text-right text-xs tabular-nums">{w.rows.toLocaleString()}</TD>
                          <TD>
                            <Select
                              className="h-8 w-64 text-xs"
                              value={wardAliases[w.name] ?? ''}
                              disabled={optionsDisabled}
                              onChange={(e) => {
                                const v = e.target.value
                                setWardAliases((prev) => {
                                  const next = { ...prev }
                                  if (v) next[w.name] = Number(v)
                                  else delete next[w.name]
                                  return next
                                })
                                setStale(true)
                              }}
                            >
                              <option value="">새로 생성</option>
                              {activeWards.map((aw) => (
                                <option key={aw.id} value={aw.id}>
                                  기존 병동으로 매핑: {aw.name}
                                  {aw.extWardCode ? ` (${aw.extWardCode})` : ''}
                                </option>
                              ))}
                            </Select>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}

              {/* 초안 모드 org 배너 */}
              {isDraft && preview.summary.orgs.length >= 2 && (
                <div className={cn('flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm', orgGateOpen ? 'border-warning/40 bg-warning-subtle text-warning-subtle-foreground' : 'border-border bg-muted/40 text-foreground')}>
                  <span>이 export에 기관 코드가 {preview.summary.orgs.length}개 있습니다 — 이 병원 소속만 선택:</span>
                  {preview.summary.orgs.map((o) => (
                    <label key={o.org} className="inline-flex items-center gap-1 font-mono text-xs">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={selectedOrgs.includes(o.org)}
                        disabled={optionsDisabled}
                        onChange={(e) => setSelectedOrgs((prev) => (e.target.checked ? [...prev, o.org] : prev.filter((x) => x !== o.org)))}
                      />
                      {o.org} <span className="text-muted-foreground">({o.rows.toLocaleString()}행)</span>
                    </label>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => reverify(selectedOrgs)} disabled={previewing || selectedOrgs.length === 0}>
                    이 기관만 등록
                  </Button>
                  {!orgGateOpen && <span className="text-xs text-muted-foreground">선택 기관 외 행은 건너뜀으로 집계됩니다.</span>}
                </div>
              )}

              {/* 실행 오류 */}
              {execError && (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
                  <div className="font-medium">{execError.message}</div>
                  {execError.rows && execError.rows.length > 0 && (
                    <ul className="list-disc pl-5 text-xs">
                      {execError.rows.slice(0, 10).map((r, i) => (
                        <li key={i}>
                          행 {r.row} {r.serial}: {r.message}
                        </li>
                      ))}
                      {execError.rows.length > 10 && <li>외 {execError.rows.length - 10}건</li>}
                    </ul>
                  )}
                  {execError.conflicts && execError.conflicts.length > 0 && (
                    <ul className="list-disc pl-5 text-xs">
                      {execError.conflicts.slice(0, 10).map((c, i) => (
                        <li key={i}>
                          {c.serial}: {c.hospitalName ?? c.hospitalCode} {c.wardName ?? ''} 배치 중({ymdOrDash(c.placedOn)}) — [제외] 또는 [이관]
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="text-xs">미리보기 이후 데이터가 바뀌었을 수 있습니다 — [다시 검증]으로 최신 판정을 받으세요.</div>
                </div>
              )}

              {/* 행 표 */}
              <div className="overflow-hidden rounded-md border border-border">
                <div className="max-h-[32rem] overflow-auto">
                  <Table>
                    <THead className="sticky top-0 z-10">
                      <tr>
                        <TH className="w-8">
                          <span title="체크 = 실행 대상 · 해제 = 제외">☑</span>
                        </TH>
                        <TH className="w-12 text-right">행</TH>
                        <TH>시리얼(정규화)</TH>
                        <TH>원문</TH>
                        <TH>모델</TH>
                        <TH>용도</TH>
                        <TH>상품유형</TH>
                        <TH>병동(해석)</TH>
                        <TH>판정</TH>
                        <TH>메시지 / 행 액션</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {visibleRows.length === 0 ? (
                        <TableMessageRow colSpan={10}>{verdictFilter === 'all' ? '판정된 행이 없습니다.' : `${IMPORT_VERDICT_LABELS[verdictFilter]} 행이 없습니다.`}</TableMessageRow>
                      ) : (
                        visibleRows.map((r, idx) => {
                          const ex = excluded.has(r.row)
                          const action = rowActions[r.row] ?? null
                          const w = wardCell(r)
                          const isSkip = r.status === 'skip'
                          const flagged = errorRowSet.has(r.row) || conflictSerialSet.has(r.serialNo)
                          const raw = r.serialInput && r.serialInput.replace(/\s+/g, '').toUpperCase() !== r.serialNo ? r.serialInput : r.serialRaw && r.serialRaw !== r.serialNo ? r.serialRaw : ''
                          const canUnassign = r.status === 'error' && r.actions.includes('UNASSIGN_WARD')
                          const canTransfer = r.status === 'conflict' && r.actions.includes('TRANSFER')
                          return (
                            <TR key={`${r.row}-${r.serialNo}-${idx}`} className={cn(ex && !isSkip && 'opacity-60', flagged && 'bg-destructive-subtle/60')}>
                              <TD className="align-top">
                                <input
                                  type="checkbox"
                                  className="accent-primary"
                                  checked={!ex}
                                  disabled={isSkip || optionsDisabled}
                                  title={isSkip ? '변경 없음(집계만)' : ex ? '제외됨 — 체크하면 실행 대상' : '실행 대상 — 해제하면 제외'}
                                  onChange={(e) => {
                                    toggleExcluded(r.row, !e.target.checked)
                                    if (!e.target.checked && action === 'TRANSFER') setAction(r.row, null)
                                  }}
                                />
                              </TD>
                              <TD className="align-top text-right text-xs tabular-nums text-muted-foreground">{r.row}</TD>
                              <TD className="align-top font-mono text-sm">{r.serialNo || <span className="text-muted-foreground">—</span>}</TD>
                              <TD className="align-top font-mono text-xs text-muted-foreground">{raw}</TD>
                              <TD className="whitespace-nowrap align-top text-xs">{r.deviceModel ?? <span className="text-muted-foreground">—</span>}</TD>
                              <TD className="whitespace-nowrap align-top text-xs">{r.usageTypeName ?? <span className="text-muted-foreground">미지정</span>}</TD>
                              <TD className="whitespace-nowrap align-top text-xs">{r.productType ?? <span className={cn('text-muted-foreground', ptCtx?.mixed && !isSkip && 'text-destructive')}>미지정</span>}</TD>
                              <TD className="whitespace-nowrap align-top text-xs">
                                <span className={cn(w.tone === 'new' && 'text-primary', w.tone === 'inactive' && 'text-destructive', w.tone === 'unresolved' && 'text-warning-subtle-foreground', w.tone === 'none' && 'text-muted-foreground')}>
                                  {action === 'UNASSIGN_WARD' ? '미지정(액션)' : w.text}
                                </span>
                                {r.extWardCodeToSet && <span className="ml-1 text-[11px] text-muted-foreground" title="매핑 병동에 이 온프렘 코드를 기록">코드 기록</span>}
                              </TD>
                              <TD className="align-top">
                                <Badge className={IMPORT_VERDICT_COLORS[r.status]}>{IMPORT_VERDICT_LABELS[r.status]}</Badge>
                              </TD>
                              <TD className="align-top text-xs">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  {r.messages.length > 0 ? <span>{r.messages.join(' · ')}</span> : null}
                                  {r.wms && r.wms.status === 'IN_STOCK' && <span className="text-warning-subtle-foreground">⚠ 창고 재고({r.wms.inventoryName})</span>}
                                  {errorRowMsg.has(r.row) && <span className="font-medium text-destructive">{errorRowMsg.get(r.row)}</span>}
                                  {canTransfer && (
                                    <span className="inline-flex overflow-hidden rounded-md border border-border text-[11px]">
                                      <button
                                        type="button"
                                        className={cn('px-2 py-0.5', ex || action !== 'TRANSFER' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-accent')}
                                        disabled={optionsDisabled}
                                        onClick={() => {
                                          setAction(r.row, null)
                                          toggleExcluded(r.row, true)
                                        }}
                                      >
                                        제외
                                      </button>
                                      <button
                                        type="button"
                                        className={cn('border-l border-border px-2 py-0.5', !ex && action === 'TRANSFER' ? 'bg-primary-subtle font-medium text-primary-subtle-foreground' : 'text-muted-foreground hover:bg-accent')}
                                        disabled={optionsDisabled}
                                        title="상대 병원에서 회수(이관) 기록 후 이 병원에 등록 — 같은 배치"
                                        onClick={() => setAction(r.row, 'TRANSFER')}
                                      >
                                        이관
                                      </button>
                                    </span>
                                  )}
                                  {canUnassign &&
                                    (action === 'UNASSIGN_WARD' ? (
                                      <span className="inline-flex items-center gap-1">
                                        <Badge variant="primary">미지정으로 등록 예정</Badge>
                                        <button type="button" className="text-[11px] text-muted-foreground underline" disabled={optionsDisabled} onClick={() => setAction(r.row, null)}>
                                          취소
                                        </button>
                                      </span>
                                    ) : (
                                      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={optionsDisabled} onClick={() => setAction(r.row, 'UNASSIGN_WARD')}>
                                        미지정으로 등록
                                      </Button>
                                    ))}
                                  {r.status === 'error' && !canUnassign && !ex && <span className="text-[11px] text-destructive">제외하거나 원본을 고쳐 다시 검증</span>}
                                </div>
                              </TD>
                            </TR>
                          )
                        })
                      )}
                    </TBody>
                  </Table>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                미리보기에서는 셀을 편집할 수 없습니다 — 오타 행은 체크를 해제(제외)하고 실행한 뒤 등록 폼에서 같은 업무일자로 추가하거나(별도 그룹, 배치 카운트 미포함), 원본을 고쳐 [입력으로 돌아가기] 후 다시 검증하세요. 실행은 단일
                트랜잭션(all-or-nothing)이며 제외 상태는 실행 시 명시 전송됩니다.
              </p>

              {/* 액션 */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={backToInput} disabled={executing}>
                    입력으로 돌아가기
                  </Button>
                  <Button variant="outline" size="sm" onClick={excludeErrorsAndReverify} disabled={previewing || executing || derived.unresolvedErrors.length === 0}>
                    오류 행 제외하고 다시 검증{derived.unresolvedErrors.length ? ` (${derived.unresolvedErrors.length})` : ''}
                  </Button>
                  {!stale && (
                    <Button variant="ghost" size="sm" onClick={() => reverify()} disabled={previewing || executing} title="최신 원장 상태로 재판정">
                      <RefreshCw size={13} className={cn(previewing && 'animate-spin')} /> 다시 검증
                    </Button>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Button onClick={() => void execute()} disabled={!canExecute} title={execBlockers[0]}>
                    {executing ? '실행 중…' : `실행 (${derived.register.toLocaleString()} 등록 · ${derived.reregister.toLocaleString()} 재등록${derived.transfer ? ` · ${derived.transfer.toLocaleString()} 이관` : ''})`}
                  </Button>
                  {execBlockers.length > 0 && <span className="text-[11px] text-muted-foreground">{execBlockers[0]}</span>}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 이력 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">임포트 이력</h3>
          <Button size="sm" variant="ghost" onClick={() => setHistoryKey((k) => k + 1)} disabled={batchLoading} title="새로고침">
            <RefreshCw size={13} className={cn(batchLoading && 'animate-spin')} />
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <THead>
              <tr>
                <TH className="w-14">#</TH>
                <TH>일시</TH>
                <TH>작성자</TH>
                <TH>출처 · 모드</TH>
                <TH>선택 org</TH>
                <TH>업무일자</TH>
                <TH className="whitespace-nowrap">행 / 등록 / 재등록 / 건너뜀 / 이관</TH>
                <TH>상태</TH>
                {canAdmin && <TH className="text-right">관리</TH>}
              </tr>
            </THead>
            <TBody>
              {batchError ? (
                <TableMessageRow colSpan={canAdmin ? 9 : 8} tone="error">
                  {batchError}
                </TableMessageRow>
              ) : batchLoading && batches.length === 0 ? (
                <TableMessageRow colSpan={canAdmin ? 9 : 8}>불러오는 중…</TableMessageRow>
              ) : batches.length === 0 ? (
                <TableMessageRow colSpan={canAdmin ? 9 : 8}>임포트 이력이 없습니다{canWrite ? ' — 위에서 목록을 붙여넣거나 Excel을 올려 시작하세요.' : '.'}</TableMessageRow>
              ) : (
                batches.map((b) => {
                  const cancelled = !!b.cancelledAt
                  const orgs = b.summary?.orgs
                  const rowBusy = batchBusy === b.id
                  const editing = editDateId === b.id
                  return (
                    <TR key={b.id} className={cn(cancelled && 'text-muted-foreground')}>
                      <TD className="align-top text-xs tabular-nums">#{b.id}</TD>
                      <TD className="whitespace-nowrap align-top text-xs">{fmtDateTimeKst(b.createdAt)}</TD>
                      <TD className="whitespace-nowrap align-top text-xs">{b.createdByName ?? b.createdBy?.name ?? '—'}</TD>
                      <TD className="align-top text-xs">
                        <div>
                          {IMPORT_SOURCE_KIND_LABELS[b.sourceKind]} · {IMPORT_BATCH_MODE_LABELS[b.mode]}
                        </div>
                        {b.fileName && <div className="max-w-[14rem] truncate text-[11px] text-muted-foreground" title={b.fileName}>{b.fileName}</div>}
                        {b.note && <div className="max-w-[14rem] truncate text-[11px] text-muted-foreground" title={b.note}>{b.note}</div>}
                      </TD>
                      <TD className="align-top font-mono text-xs">{orgs && orgs.length ? orgs.join(', ') : <span className="text-muted-foreground">—</span>}</TD>
                      <TD className="whitespace-nowrap align-top text-xs tabular-nums">
                        {editing ? (
                          <span className="inline-flex items-center gap-1">
                            <Input type="date" className="h-7 w-36 text-xs" value={editDate} max={today} onChange={(e) => setEditDate(e.target.value)} autoFocus />
                            <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => void saveBatchDate(b)} disabled={rowBusy || !editDate}>
                              저장
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setEditDateId(null)} disabled={rowBusy}>
                              취소
                            </Button>
                          </span>
                        ) : (
                          ymdOrDash(b.occurredOn)
                        )}
                      </TD>
                      <TD className="whitespace-nowrap align-top text-xs tabular-nums">
                        {b.rowCount.toLocaleString()} / {b.registeredCount.toLocaleString()} / {b.reregisteredCount.toLocaleString()} / {b.skippedCount.toLocaleString()} / {b.transferredCount.toLocaleString()}
                      </TD>
                      <TD className="align-top text-xs">
                        {cancelled ? (
                          <div>
                            <Badge variant="destructive">취소됨</Badge>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {fmtDateTimeKst(b.cancelledAt)} {b.cancelledByName ?? b.cancelledBy?.name ?? ''}
                            </div>
                          </div>
                        ) : (
                          <Badge variant="success">완료</Badge>
                        )}
                      </TD>
                      {canAdmin && (
                        <TD className="align-top text-right">
                          {!cancelled && !editing && (
                            <span className="inline-flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                disabled={rowBusy}
                                onClick={() => {
                                  setEditDateId(b.id)
                                  setEditDate(ymdOrDash(b.occurredOn))
                                }}
                                title="배치 이벤트 전체의 업무일자를 일괄 정정(기본값 오늘로 잘못 넣은 백필 구제)"
                              >
                                업무일자 정정
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-destructive hover:text-destructive" disabled={rowBusy} onClick={() => void cancelBatch(b)}>
                                {rowBusy ? '처리 중…' : '취소'}
                              </Button>
                            </span>
                          )}
                        </TD>
                      )}
                    </TR>
                  )
                })
              )}
            </TBody>
          </Table>
        </div>
        <Pager page={batchPage} total={batchTotal} limit={HISTORY_LIMIT} onPage={setBatchPage} />
      </div>
    </div>
  )
}

function ResultBanner({ result, onNew, onBack }: { result: ImportExecuteResponse; onNew: () => void; onBack: () => void }) {
  const b = result.batch
  const warnings = Array.from(new Set([...(result.warnings ?? []), ...(result.result.warnings ?? [])]))
  return (
    <div className="space-y-3 rounded-lg border border-success/40 bg-success-subtle p-4 text-success-subtle-foreground">
      <div className="text-sm font-semibold">
        {b.registeredCount.toLocaleString()}대 등록 · {b.reregisteredCount.toLocaleString()}대 재등록
        {b.transferredCount ? ` · ${b.transferredCount.toLocaleString()}대 이관` : ''}
        {b.skippedCount ? ` · ${b.skippedCount.toLocaleString()}대 건너뜀` : ''}
        {result.result.newWards.length ? ` · 병동 ${result.result.newWards.length}개 생성` : ''} (배치 #{b.id})
      </div>
      <div className="text-xs">
        업무일자 {ymdOrDash(b.occurredOn)} · {IMPORT_SOURCE_KIND_LABELS[b.sourceKind]} · {IMPORT_BATCH_MODE_LABELS[b.mode]}
        {b.fileName ? ` · ${b.fileName}` : ''}
      </div>
      {result.result.newWards.length > 0 && <div className="text-xs">생성된 병동: {result.result.newWards.map((w) => w.name).join(', ')}</div>}
      {warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          {warnings.slice(0, 8).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
          {warnings.length > 8 && <li>외 {warnings.length - 8}건</li>}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onNew}>
          새 임포트
        </Button>
        <Button size="sm" variant="outline" onClick={onBack}>
          판정 표 다시 보기
        </Button>
      </div>
      <p className="text-[11px]">실행 후 병동 오타를 발견하면 아래 이력에서 배치를 취소하고 매핑을 지정해 다시 임포트하세요(배치 밖 이벤트가 없을 때). 그룹 밖 추가 등록은 등록 폼에서.</p>
    </div>
  )
}

export default ImportPanel
