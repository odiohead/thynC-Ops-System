'use client'

// 주간업무 관리 (projects/weekly_ops_design.md) — 사업본부 주간 리뷰 보드
// nav 미등록·URL 직접 진입(/weekly). 항목은 지속 레코드, 주차별 진행내용만 쌓인다.
// 주차 네비·?week= URL 동기화는 차량예약 주간 보드 패턴 차용.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/ui/PageHeader'
import Button from '@/app/components/ui/Button'
import Badge from '@/app/components/ui/Badge'
import EmptyState from '@/app/components/ui/EmptyState'
import { Select } from '@/app/components/ui/Input'
import ItemDetailModal from './_components/ItemDetailModal'
import AddItemRow, { type AddItemForm } from './_components/AddItemRow'
import CellEditor from './_components/CellEditor'
import NotesSection from './_components/NotesSection'
import RichContent from './_components/RichContent'
import {
  WEEKLY_ITEM_KINDS,
  WEEKLY_KIND_LABELS,
  type WeeklyItemKind,
  mondayOfLocal,
  ymdLocal,
  addDaysYmd,
  weekLabel,
  type WeeklyBoardResponse,
  type WeeklyItemDto,
  type WeeklyMastersResponse,
} from '@/lib/weekly'

type Tab = 'board' | 'hospital' | 'archive'

const STATUS_VARIANT: Record<string, 'primary' | 'warning' | 'success'> = {
  진행: 'primary',
  보류: 'warning',
  완료: 'success',
}

const BIZ_VARIANT: Record<string, 'primary' | 'success' | 'default'> = {
  thynC: 'primary',
  mobiCARE: 'success',
  공통: 'default',
}

// ── 보드 컬럼 정의 — 순서·기본 폭 (2026-08-20 리사이즈 도입) ─────────────
// 기본 폭 합계 중 담당 팀까지(1288px)가 1400px 컨테이너 안에 들어오고, 이후는 횡스크롤.
const BOARD_COLS: { key: string; label: string; w: number; resizable: boolean }[] = [
  { key: 'move', label: '', w: 40, resizable: false },
  { key: 'biz', label: '업무구분', w: 96, resizable: true },
  { key: 'title', label: '안건', w: 280, resizable: true },
  { key: 'last', label: '지난주 진행', w: 380, resizable: true },
  { key: 'this', label: '금주 진행', w: 380, resizable: true },
  { key: 'team', label: '담당 팀', w: 112, resizable: true },
  { key: 'owner', label: '담당', w: 96, resizable: true },
  { key: 'status', label: '상태', w: 80, resizable: true },
  { key: 'target', label: '목표일', w: 112, resizable: true },
  { key: 'done', label: '', w: 96, resizable: false },
]
const COL_WIDTH_STORAGE_KEY = 'weekly_board_col_widths_v1'
const COL_MIN_WIDTH = 56

function defaultColWidths(): Record<string, number> {
  return Object.fromEntries(BOARD_COLS.map((c) => [c.key, c.w]))
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export default function WeeklyPage() {
  const router = useRouter()

  const [weekStart, setWeekStart] = useState<Date>(() => mondayOfLocal(new Date()))
  const [tab, setTab] = useState<Tab>('board')
  const [me, setMe] = useState<{ role: string } | null>(null)
  const [denied, setDenied] = useState<{ title: string; message: string } | null>(null)
  const [board, setBoard] = useState<WeeklyBoardResponse | null>(null)
  const [listItems, setListItems] = useState<WeeklyItemDto[] | null>(null)
  const [includeDone, setIncludeDone] = useState(false)
  const [masters, setMasters] = useState<WeeklyMastersResponse | null>(null)
  const [ownerFilter, setOwnerFilter] = useState('')

  // 인라인 편집 상태 — 텍스트 draft는 각 에디터 컴포넌트 로컬 (타이핑 시 보드 전체 리렌더·IME 버벅임 방지)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState<WeeklyItemKind | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  /** 펼쳐진 행 — 지난주·금주 진행을 2줄 clamp 대신 전체 표시 */
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  // ── 컬럼 폭 — localStorage 영속 + 마우스 드래그 리사이즈 ──────────
  const [colWidths, setColWidths] = useState<Record<string, number>>(defaultColWidths)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COL_WIDTH_STORAGE_KEY) ?? '')
      if (saved && typeof saved === 'object') {
        setColWidths((w) => {
          const next = { ...w }
          for (const c of BOARD_COLS) {
            const v = (saved as Record<string, unknown>)[c.key]
            if (typeof v === 'number' && v >= COL_MIN_WIDTH && v <= 2000) next[c.key] = Math.round(v)
          }
          return next
        })
      }
    } catch {
      // 저장값 없음/파손 — 기본 폭 사용
    }
  }, [])

  const startResize = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidths[key]
    let latest = colWidths
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(COL_MIN_WIDTH, startW + ev.clientX - startX)
      setColWidths((prev) => {
        latest = { ...prev, [key]: w }
        return latest
      })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      try {
        localStorage.setItem(COL_WIDTH_STORAGE_KEY, JSON.stringify(latest))
      } catch {
        // 저장 실패는 무시 (다음 세션에 기본 폭)
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
  }

  const toggleExpand = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const weekYmd = ymdLocal(weekStart)
  const todayMondayYmd = ymdLocal(mondayOfLocal(new Date()))
  const todayYmd = ymdLocal(new Date())
  const canWrite = !!me && me.role !== 'VIEWER'

  // 최초 마운트: ?week= 파라미터 → 해당 주 월요일로 스냅 (차량예약 패턴)
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('week')
    if (m && /^\d{4}-\d{2}-\d{2}$/.test(m)) {
      const d = new Date(`${m}T00:00:00`)
      if (!Number.isNaN(d.getTime())) setWeekStart(mondayOfLocal(d))
    }
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMe({ role: d.role }))
      .catch(() => {})
  }, [])

  // 주차 변경 시 URL 동기화 (얕은 replaceState)
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('week', weekYmd)
    window.history.replaceState(null, '', url.toString())
  }, [weekYmd])

  // 주차 빠른 전환 시 늦게 도착한 이전 요청이 최신 보드를 덮지 않도록 시퀀스 가드
  const boardSeq = useRef(0)

  const loadBoard = useCallback(async () => {
    const seq = ++boardSeq.current
    const res = await fetch(`/api/weekly/board?week=${weekYmd}`)
    if (seq !== boardSeq.current) return
    if (res.redirected) {
      window.location.href = '/login'
      return
    }
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      setDenied({
        title: res.status === 403 ? '접근 권한이 없습니다' : '불러오지 못했습니다',
        message: d?.error ?? '주간 보드를 불러오지 못했습니다.',
      })
      return
    }
    setDenied(null)
    const d = await res.json().catch(() => null)
    if (d) setBoard(d)
  }, [weekYmd])

  const loadList = useCallback(async () => {
    if (tab === 'board') return
    setListItems(null)
    const scope = tab === 'archive' ? 'archive' : 'hospital'
    const qs = tab === 'hospital' && includeDone ? '&includeDone=1' : ''
    const res = await fetch(`/api/weekly/items?scope=${scope}${qs}`)
    if (res.redirected) {
      window.location.href = '/login'
      return
    }
    if (!res.ok) {
      setListItems([])
      return
    }
    const d = await res.json().catch(() => null)
    setListItems(d?.items ?? [])
  }, [tab, includeDone])

  useEffect(() => {
    loadBoard()
  }, [loadBoard])

  useEffect(() => {
    loadList()
  }, [loadList])

  useEffect(() => {
    if (denied) return
    fetch('/api/weekly/masters')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMasters(d))
      .catch(() => {})
  }, [denied])

  // 주차 이동 시 진행 중이던 인라인 편집 초기화
  useEffect(() => {
    setEditingId(null)
    setAdding(null)
  }, [weekYmd])

  const reloadAll = useCallback(() => {
    loadBoard()
    loadList()
    router.refresh() // mutation 후 Router Cache 무효화 (CLAUDE.md 컨벤션)
  }, [loadBoard, loadList, router])

  // ── mutation 핸들러 ─────────────────────────────────────────
  const saveUpdate = async (itemId: number, content: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/weekly/items/${itemId}/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekYmd, content }),
      })
      if (res.redirected) {
        window.location.href = '/login'
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        alert(d?.error ?? '진행내용 저장에 실패했습니다.')
        return
      }
      // 보드 리로드 완료 후 에디터를 닫아야 stale 셀 재편집(방금 저장분 유실)이 없다
      await loadBoard()
      setEditingId(null)
      router.refresh()
    } catch {
      alert('네트워크 오류로 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const createItem = async (kind: WeeklyItemKind, form: AddItemForm) => {
    if (busy) return // 중복 제출 방지
    setBusy(true)
    try {
      const res = await fetch('/api/weekly/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: form.title,
          bizType: form.bizType,
          hospitalCode: form.hospitalCode || undefined,
          ownerTeamId: form.ownerTeamId ? Number(form.ownerTeamId) : undefined,
          ownerId: form.ownerId || undefined,
          targetDate: form.targetDate || undefined,
        }),
      })
      if (res.redirected) {
        window.location.href = '/login'
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        alert(d?.error ?? '항목 등록에 실패했습니다.')
        return
      }
      setAdding(null)
      reloadAll()
    } catch {
      alert('네트워크 오류로 등록하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const completeItem = async (item: WeeklyItemDto) => {
    if (weekYmd > todayMondayYmd) {
      alert('미래 주에는 완료 처리할 수 없습니다.')
      return
    }
    const past = weekYmd < todayMondayYmd
    const msg =
      `'${item.title}' 항목을 ${weekLabel(weekYmd)}(${weekYmd}) 주로 완료 처리합니다.` +
      (past ? '\n과거 주로 완료하면 이번 주 보드에는 표시되지 않습니다.' : '')
    if (!confirm(msg)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/weekly/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complete: { week: weekYmd } }),
      })
      if (res.redirected) {
        window.location.href = '/login'
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        alert(d?.error ?? '완료 처리에 실패했습니다.')
        return
      }
      reloadAll()
    } catch {
      alert('네트워크 오류로 완료 처리하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const moveItem = async (item: WeeklyItemDto, dir: 'up' | 'down') => {
    setBusy(true)
    try {
      const res = await fetch(`/api/weekly/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ move: dir }),
      })
      if (res.redirected) {
        window.location.href = '/login'
        return
      }
      if (res.ok) reloadAll()
    } catch {
      // 순서 이동 실패는 치명적이지 않음 — 다음 시도로 복구
    } finally {
      setBusy(false)
    }
  }

  // ── 파생 데이터 ─────────────────────────────────────────────
  const boardItems = useMemo(() => {
    const items = board?.items ?? []
    return ownerFilter ? items.filter((it) => it.ownerId === ownerFilter) : items
  }, [board, ownerFilter])

  const sectionItems = (kind: WeeklyItemKind) => boardItems.filter((it) => it.kind === kind)

  /** 선택 주차 기준 표시 상태 — 완료 배지는 completedWeek === W인 주에만 (§4 과거 주 렌더 규칙) */
  const displayStatus = (it: WeeklyItemDto): '진행' | '보류' | '완료' => {
    if (it.completedWeek === weekYmd) return '완료'
    return it.status === '보류' ? '보류' : '진행'
  }

  const hospitalGroups = useMemo(() => {
    if (!listItems) return []
    const map = new Map<string, { name: string; items: WeeklyItemDto[] }>()
    for (const it of listItems) {
      const key = it.hospitalCode ?? ''
      const name = it.hospitalName ?? '(병원 미지정)'
      if (!map.has(key)) map.set(key, { name, items: [] })
      map.get(key)!.items.push(it)
    }
    return Array.from(map.entries())
      .sort(([aKey, a], [bKey, b]) => {
        if (!aKey) return 1 // 미지정 그룹은 맨 뒤
        if (!bKey) return -1
        return a.name.localeCompare(b.name, 'ko')
      })
      .map(([key, g]) => ({ key: key || '__none__', ...g }))
  }, [listItems])

  // ── 렌더 ────────────────────────────────────────────────────
  const weekRangeLabel = `${weekStart.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} ~ ${addDays(weekStart, 6).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}`

  const thCls = 'px-4 py-2 text-left text-xs font-medium text-muted-foreground'
  const tdCls = 'px-4 py-3 align-top text-sm'
  const totalColWidth = BOARD_COLS.reduce((sum, c) => sum + colWidths[c.key], 0)

  const renderBoardRow = (it: WeeklyItemDto, activeList: WeeklyItemDto[]) => {
    const st = displayStatus(it)
    const doneThisWeek = it.completedWeek === weekYmd
    const active = !it.completedWeek
    const overdue = !!it.targetDate && !it.completedWeek && it.targetDate < todayYmd
    // amber는 진행·미완료·금주 미입력에만 — 미래 주는 당연히 미입력이라 신호가 무의미하므로 제외
    const needsUpdate = active && it.status === '진행' && !it.thisWeek && weekYmd <= todayMondayYmd
    const prevWeekYmd = addDaysYmd(weekYmd, -7)
    const isEditing = editingId === it.id
    const editable = canWrite && active
    const expanded = expandedIds.has(it.id)
    // ↑↓ 경계는 서버 move와 동일 목록(같은 kind·미완료 전체, 담당 필터 미적용) 기준으로 판정
    const activeIdx = activeList.findIndex((x) => x.id === it.id)

    return (
      <tr key={it.id} className={`border-t border-border ${doneThisWeek ? 'bg-muted/40' : 'hover:bg-accent/40'}`}>
        <td className={`${tdCls} w-10 whitespace-nowrap`}>
          {canWrite && active && !ownerFilter && (
            <span className="flex flex-col leading-none">
              <button
                className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                disabled={activeIdx <= 0 || busy}
                onClick={() => moveItem(it, 'up')}
                title="위로"
              >
                ↑
              </button>
              <button
                className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                disabled={activeIdx === -1 || activeIdx === activeList.length - 1 || busy}
                onClick={() => moveItem(it, 'down')}
                title="아래로"
              >
                ↓
              </button>
            </span>
          )}
        </td>
        <td className={`${tdCls} whitespace-nowrap`}>
          <Badge variant={BIZ_VARIANT[it.bizType] ?? 'default'}>{it.bizType}</Badge>
        </td>
        <td className={tdCls}>
          <button
            className={`text-left font-medium hover:underline ${doneThisWeek ? 'text-muted-foreground line-through' : ''}`}
            onClick={() => setDetailId(it.id)}
          >
            {it.title}
          </button>
          {it.hospitalName && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{it.hospitalName}</span>
            </div>
          )}
        </td>
        {/* 지난주·금주 진행 — 기본 2줄 clamp, 셀 클릭으로 펼침/접기. 편집은 ✎ 버튼으로만 진입 (2026-08-20) */}
        <td
          className={`${tdCls} ${it.lastWeek ? 'cursor-pointer' : ''}`}
          onClick={() => it.lastWeek && toggleExpand(it.id)}
          title={it.lastWeek && !expanded ? '클릭하여 펼치기' : undefined}
        >
          {it.lastWeek ? (
            <div>
              {it.lastWeek.weekStart !== prevWeekYmd && (
                <div className="mb-0.5 text-xs font-medium text-warning">{weekLabel(it.lastWeek.weekStart)}:</div>
              )}
              <RichContent content={it.lastWeek.content} clampLines={expanded ? undefined : 2} />
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td
          className={`group ${tdCls} ${needsUpdate && !isEditing ? 'bg-warning-subtle/60' : ''} ${!isEditing && (it.thisWeek || editable) ? 'cursor-pointer' : ''}`}
          onClick={() => {
            if (isEditing) return
            if (it.thisWeek) toggleExpand(it.id) // 내용 있으면 클릭=펼침/접기
            else if (editable) setEditingId(it.id) // 빈 셀은 바로 입력 진입
          }}
          title={it.thisWeek && !expanded ? '클릭하여 펼치기' : undefined}
        >
          {isEditing ? (
            <CellEditor
              initial={it.thisWeek?.content ?? ''}
              busy={busy}
              onSave={(c) => saveUpdate(it.id, c)}
              onCancel={() => setEditingId(null)}
            />
          ) : it.thisWeek ? (
            <div className="flex items-start gap-1">
              <RichContent content={it.thisWeek.content} clampLines={expanded ? undefined : 2} className="min-w-0 flex-1" />
              {editable && (
                <button
                  className="shrink-0 rounded px-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                  title="수정"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingId(it.id)
                  }}
                >
                  ✎
                </button>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">{editable ? '클릭하여 입력' : '—'}</span>
          )}
        </td>
        <td className={`${tdCls} whitespace-nowrap`}>{it.ownerTeamName ?? '—'}</td>
        <td className={`${tdCls} whitespace-nowrap`}>{it.ownerName ?? '—'}</td>
        <td className={`${tdCls} whitespace-nowrap`}>
          <Badge variant={STATUS_VARIANT[st]}>{st}</Badge>
        </td>
        <td className={`${tdCls} whitespace-nowrap ${overdue ? 'font-medium text-destructive' : ''}`}>
          {it.targetDate ?? '—'}
        </td>
        <td className={`${tdCls} w-28 whitespace-nowrap text-right`}>
          {canWrite && !it.completedWeek && weekYmd <= todayMondayYmd && (
            <Button size="sm" variant="outline" onClick={() => completeItem(it)} disabled={busy}>
              완료
            </Button>
          )}
          {doneThisWeek && <Badge variant="success">완료</Badge>}
        </td>
      </tr>
    )
  }

  const renderSection = (kind: WeeklyItemKind) => {
    const items = sectionItems(kind)
    // ↑↓ 이동 경계 판정용 — 서버 move 목록과 동일 기준 (같은 kind·미완료, 담당 필터 미적용)
    const activeList = (board?.items ?? []).filter((x) => x.kind === kind && !x.completedWeek)
    return (
      <section key={kind} className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{WEEKLY_KIND_LABELS[kind]}</h2>
          <span className="text-xs text-muted-foreground">{items.length}건</span>
        </div>
        <div className="overflow-x-auto">
          {/* 기본 폭에서 담당 팀까지 한 화면 노출, 나머지는 횡스크롤. 헤더 경계 드래그로 폭 조절 (2026-08-20) */}
          <table className="w-full table-fixed text-sm" style={{ minWidth: totalColWidth }}>
            <colgroup>
              {BOARD_COLS.map((c) => (
                <col key={c.key} style={{ width: colWidths[c.key] }} />
              ))}
            </colgroup>
            <thead className="bg-muted/60">
              <tr>
                {BOARD_COLS.map((c) => (
                  <th key={c.key} className={`relative ${thCls}`}>
                    {c.label}
                    {c.resizable && (
                      <span
                        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize select-none hover:bg-primary/30"
                        onMouseDown={startResize(c.key)}
                        title="드래그로 폭 조절"
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && adding !== kind && (
                <tr className="border-t border-border">
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    등록된 항목이 없습니다.
                  </td>
                </tr>
              )}
              {items.map((it) => renderBoardRow(it, activeList))}
            </tbody>
          </table>
        </div>
        {/* 추가 폼은 overflow 래퍼 밖 — SearchSelect 드롭다운 클리핑 방지 */}
        {adding === kind && (
          <AddItemRow
            masters={masters}
            busy={busy}
            onSave={(f) => createItem(kind, f)}
            onCancel={() => setAdding(null)}
          />
        )}
        {canWrite && adding !== kind && (
          <button
            className="w-full border-t border-border px-4 py-2 text-left text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            onClick={() => setAdding(kind)}
          >
            + 항목 추가
          </button>
        )}
      </section>
    )
  }

  const renderListTable = (items: WeeklyItemDto[], mode: 'hospital' | 'archive') => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1020px] text-sm">
        <thead className="bg-muted/60">
          <tr>
            {mode === 'archive' && <th className={thCls}>완료주차</th>}
            <th className={thCls}>구분</th>
            <th className={thCls}>업무구분</th>
            <th className={thCls}>안건</th>
            {mode === 'archive' && <th className={thCls}>병원</th>}
            <th className={thCls}>최근 진행</th>
            <th className={thCls}>담당 팀</th>
            <th className={thCls}>담당</th>
            <th className={thCls}>상태</th>
            <th className={thCls}>목표일</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const st = it.completedWeek ? '완료' : it.status === '보류' ? '보류' : '진행'
            return (
              <tr
                key={it.id}
                className="cursor-pointer border-t border-border hover:bg-accent/40"
                onClick={() => setDetailId(it.id)}
              >
                {mode === 'archive' && (
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {it.completedWeek ? `${weekLabel(it.completedWeek)} (${it.completedWeek})` : '—'}
                  </td>
                )}
                <td className={`${tdCls} whitespace-nowrap text-xs text-muted-foreground`}>
                  {WEEKLY_KIND_LABELS[it.kind]}
                </td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  <Badge variant={BIZ_VARIANT[it.bizType] ?? 'default'}>{it.bizType}</Badge>
                </td>
                <td className={`${tdCls} font-medium`}>{it.title}</td>
                {mode === 'archive' && <td className={`${tdCls} whitespace-nowrap`}>{it.hospitalName ?? '—'}</td>}
                <td className={tdCls}>
                  {it.latestUpdate ? (
                    <div>
                      <div className="mb-0.5 text-xs text-muted-foreground">{weekLabel(it.latestUpdate.weekStart)}:</div>
                      <RichContent content={it.latestUpdate.content} clampLines={2} />
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className={`${tdCls} whitespace-nowrap`}>{it.ownerTeamName ?? '—'}</td>
                <td className={`${tdCls} whitespace-nowrap`}>{it.ownerName ?? '—'}</td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  <Badge variant={STATUS_VARIANT[st]}>{st}</Badge>
                </td>
                <td className={`${tdCls} whitespace-nowrap`}>{it.targetDate ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {items.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">항목이 없습니다.</div>
      )}
    </div>
  )

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <PageHeader
        title="주간업무 관리"
        description="사업본부 주간 리뷰 — 주요 안건 진척과 주요 이슈를 주차별로 관리합니다."
      />

      {denied ? (
        <EmptyState title={denied.title} description={denied.message} />
      ) : (
        <>
          {/* 주차 네비게이션 */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => mondayOfLocal(addDays(w, -7)))}>
              ◀ 이전 주
            </Button>
            <Button size="sm" variant="outline" onClick={() => setWeekStart(mondayOfLocal(new Date()))}>
              오늘
            </Button>
            <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => mondayOfLocal(addDays(w, 7)))}>
              다음 주 ▶
            </Button>
            <span className="ml-1 text-sm font-medium">
              {weekRangeLabel}
              {weekYmd === todayMondayYmd && <Badge variant="primary" className="ml-2">이번 주</Badge>}
            </span>
            {tab === 'board' && (
              <Select
                className="ml-auto w-36"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <option value="">담당 전체</option>
                {(masters?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {/* 탭 */}
          <div className="mb-4 flex gap-1 border-b border-border">
            {(
              [
                ['board', '주간 보드'],
                ['hospital', '병원별'],
                ['archive', '완료 아카이브'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                  tab === key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 선택 주차 데이터가 도착하기 전에는 이전 주 보드를 보여주지 않는다 (stale 편집 방지) */}
          {tab === 'board' &&
            (!board || board.week !== weekYmd ? (
              <div className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</div>
            ) : (
              <div className="space-y-4">
                {WEEKLY_ITEM_KINDS.map((kind) => renderSection(kind))}
                {/* 주간 특이사항 — 주차별 자유 기재 보드, 최하단 배치 (key로 주차 전환 시 편집 상태 초기화) */}
                <NotesSection
                  key={weekYmd}
                  weekYmd={weekYmd}
                  notes={board.weekNotes}
                  canWrite={canWrite}
                  onChanged={reloadAll}
                />
              </div>
            ))}

          {tab === 'hospital' && (
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeDone}
                  onChange={(e) => setIncludeDone(e.target.checked)}
                />
                완료 항목 포함
              </label>
              {listItems === null ? (
                <div className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</div>
              ) : hospitalGroups.length === 0 ? (
                <EmptyState title="항목이 없습니다" description="주간 보드에서 항목을 등록하면 병원별로 모아 볼 수 있습니다." />
              ) : (
                hospitalGroups.map((g) => (
                  <section key={g.key} className="rounded-lg border border-border bg-card">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                      <h2 className="text-sm font-semibold">{g.name}</h2>
                      <span className="text-xs text-muted-foreground">{g.items.length}건</span>
                    </div>
                    {renderListTable(g.items, 'hospital')}
                  </section>
                ))
              )}
            </div>
          )}

          {tab === 'archive' && (
            <section className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-2.5">
                <h2 className="text-sm font-semibold">완료 아카이브</h2>
              </div>
              {listItems === null ? (
                <div className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</div>
              ) : (
                renderListTable(listItems, 'archive')
              )}
            </section>
          )}
        </>
      )}

      <ItemDetailModal
        itemId={detailId}
        onClose={() => setDetailId(null)}
        masters={masters}
        canWrite={canWrite}
        onChanged={reloadAll}
        completeWeekYmd={tab === 'board' ? weekYmd : undefined}
      />
    </div>
  )
}
