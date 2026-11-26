'use client'

/**
 * 사용량 대시보드 — 저장된 보기 (projects/usage_dashboard_filter_design.md §3.1)
 * 조건 묶음(기기 · 판매모델 · 종별 · 병원 지정 · 추이 기간)에 이름을 붙여 저장해 두고, 목록에서 눌러 그 조건으로 본다.
 * 공유를 켠 보기는 사용량을 볼 수 있는 모두의 목록에, 끈 보기는 만든 사람의 목록에만 나온다.
 * 저장 · 권한은 서버(lib/usage/views.ts)가 맡는다 — 여기는 목록과 저장 · 관리 창만 그린다.
 */
import { useState } from 'react'
import { Bookmark, Plus, RotateCcw, Save, Settings2, Share2, Trash2 } from 'lucide-react'
import Modal from '@/app/components/ui/Modal'
import { useUnsavedGuard } from '@/app/components/useUnsavedGuard'
import { trendLabel, type ViewFilters } from '@/lib/usage/filters'

export type UsageViewItem = {
  id: number
  name: string
  isShared: boolean
  ownerName: string
  mine: boolean
  canEdit: boolean
  filters: ViewFilters
}

/** 목록에 바로 보여 주는 보기 수 — 나머지는 '보기 관리'에서 */
const INLINE_MAX = 6
const DEVICE_LABEL: Record<string, string> = { ecg: '심전계', spo2: '산소포화도', cart: '카트온' }
const MODEL_LABEL: Record<string, string> = { all: '합산', general: '일반형', usage: '사용량비례형' }

/** 조건 묶음을 한 줄로 */
export function describeFilters(f: ViewFilters): string {
  return [
    DEVICE_LABEL[f.device] ?? f.device,
    MODEL_LABEL[f.model] ?? f.model,
    f.types.length ? `종별 ${f.types.join(' · ')}` : null,
    f.hospitals.length ? `병원 ${f.hospitals.length}곳 지정` : null,
    `추이 ${trendLabel(f.trend)}`,
  ]
    .filter(Boolean)
    .join(' / ')
}

const chip = 'flex h-8 max-w-[220px] items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors'
const chipOn = 'border-primary bg-primary text-primary-foreground'
const chipOff = 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
const smallBtn = 'flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50'

export function ViewBar({
  views,
  activeId,
  changed,
  current,
  onOpen,
  onRevert,
  onReload,
}: {
  /** null = 아직 불러오는 중 */
  views: UsageViewItem[] | null
  activeId: number | null
  /** 연 보기에서 조건을 바꿨는가 */
  changed: boolean
  /** 지금 화면의 조건 묶음 — 저장할 내용 */
  current: ViewFilters
  /** 보기를 연다 (null = 조건 없는 전체) */
  onOpen: (id: number | null) => void
  /** 연 보기의 저장된 조건으로 되돌린다 */
  onRevert: () => void
  /** 목록을 다시 불러온다 (저장 · 수정 · 삭제 뒤) */
  onReload: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [managing, setManaging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = views?.find((v) => v.id === activeId) ?? null

  // 줄에는 앞의 몇 개만 — 지금 연 보기는 순서와 무관하게 항상 보인다
  const inline = (views ?? []).slice(0, INLINE_MAX)
  if (active && !inline.some((v) => v.id === active.id)) inline[inline.length - 1] = active
  const hidden = (views?.length ?? 0) - inline.length

  const overwrite = async () => {
    if (!active) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/usage/views/${active.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: current }) })
    setBusy(false)
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? '저장하지 못했습니다.')
      return
    }
    await onReload()
    onOpen(active.id)
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="overview-views">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Bookmark size={13} aria-hidden />
          보기
        </span>
        <button type="button" data-testid="view-all" aria-pressed={activeId === null} onClick={() => onOpen(null)} className={`${chip} ${activeId === null ? chipOn : chipOff}`}>
          전체
        </button>
        {inline.map((v) => {
          const on = v.id === activeId
          return (
            <button
              key={v.id}
              type="button"
              data-testid={`view-${v.id}`}
              aria-pressed={on}
              onClick={() => onOpen(v.id)}
              title={`${describeFilters(v.filters)}${v.mine ? '' : ` — ${v.ownerName} 님이 공유`}`}
              className={`${chip} ${on ? chipOn : chipOff}`}
            >
              <span className="truncate">{v.name}</span>
              {v.isShared && <Share2 size={12} aria-label="공유된 보기" className="shrink-0 opacity-80" />}
              {on && changed && <span className="shrink-0 rounded bg-primary-foreground/20 px-1 text-[11px]">바뀜</span>}
            </button>
          )
        })}
        {views !== null && (views.length > 0 || hidden > 0) && (
          <button type="button" data-testid="view-manage" onClick={() => setManaging(true)} className={smallBtn}>
            <Settings2 size={13} aria-hidden />
            {hidden > 0 ? `더보기 ${hidden} · 관리` : '보기 관리'}
          </button>
        )}
        <span className="flex-1" />
        {active && changed && (
          <>
            {active.canEdit && (
              <button type="button" data-testid="view-overwrite" disabled={busy} onClick={overwrite} className={smallBtn} title={`'${active.name}' 보기를 지금 조건으로 고쳐 저장합니다`}>
                <Save size={13} aria-hidden />
                저장
              </button>
            )}
            <button type="button" data-testid="view-revert" onClick={onRevert} className={smallBtn} title="저장된 조건으로 되돌립니다">
              <RotateCcw size={13} aria-hidden />
              되돌리기
            </button>
          </>
        )}
        <button type="button" data-testid="view-save" onClick={() => setSaving(true)} className={smallBtn}>
          <Plus size={13} aria-hidden />
          {active ? '새 보기로 저장' : '지금 조건을 보기로 저장'}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {saving && (
        <SaveViewModal
          current={current}
          onClose={() => setSaving(false)}
          onSaved={async (id) => {
            setSaving(false)
            await onReload()
            onOpen(id)
          }}
        />
      )}
      {managing && (
        <ManageViewsModal
          views={views ?? []}
          activeId={activeId}
          onClose={() => setManaging(false)}
          onOpen={(id) => {
            setManaging(false)
            onOpen(id)
          }}
          onChanged={async (deletedId) => {
            await onReload()
            if (deletedId !== null && deletedId === activeId) onOpen(null)
          }}
        />
      )}
    </div>
  )
}

function SaveViewModal({ current, onClose, onSaved }: { current: ViewFilters; onClose: () => void; onSaved: (id: number) => void }) {
  const [name, setName] = useState('')
  const [isShared, setIsShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guard = useUnsavedGuard(true, onClose, { dirty: name.trim().length > 0 })

  const submit = async () => {
    if (!name.trim()) {
      setError('보기 이름을 입력하세요.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch('/api/usage/views', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, isShared, filters: current }) })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(body.error ?? '저장하지 못했습니다.')
      return
    }
    onSaved(body.view.id as number)
  }

  return (
    <Modal open onClose={guard.requestClose} title="지금 조건을 보기로 저장" closeOnBackdrop={false} dialogRef={guard.ref}>
      <form
        className="flex flex-col gap-4"
        data-testid="view-save-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div>
          <label htmlFor="view-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            보기 이름
          </label>
          <input
            id="view-name"
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 수도권 종합병원"
            className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="rounded-md border border-border bg-muted/50 px-3.5 py-2.5 text-[13px]">
          <div className="mb-1 text-xs font-medium text-muted-foreground">저장되는 조건</div>
          <div className="text-foreground" data-testid="view-save-summary">
            {describeFilters(current)}
          </div>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
          <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" data-testid="view-save-shared" />
          <span>
            <span className="font-medium text-foreground">공유</span>
            <span className="block text-xs text-muted-foreground">켜면 사용량을 볼 수 있는 모두의 목록에 나옵니다. 끄면 내 목록에만 보입니다.</span>
          </span>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={guard.requestClose} className="h-9 rounded-md border border-border px-3.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground">
            취소
          </button>
          <button type="submit" disabled={busy} data-testid="view-save-submit" className="h-9 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50">
            {busy ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** 보기 관리 — 전부 나열 · 열기 · 이름 바꾸기 · 공유 켜기/끄기 · 삭제 (만든 사람과 ADMIN 이상만 고친다) */
function ManageViewsModal({
  views,
  activeId,
  onClose,
  onOpen,
  onChanged,
}: {
  views: UsageViewItem[]
  activeId: number | null
  onClose: () => void
  onOpen: (id: number) => void
  onChanged: (deletedId: number | null) => Promise<void>
}) {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const call = async (v: UsageViewItem, init: RequestInit, deleted = false) => {
    setBusyId(v.id)
    setError(null)
    const res = await fetch(`/api/usage/views/${v.id}`, { headers: { 'Content-Type': 'application/json' }, ...init })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? '처리하지 못했습니다.')
    else await onChanged(deleted ? v.id : null)
    setBusyId(null)
  }
  const rename = (v: UsageViewItem) => {
    const name = window.prompt('보기 이름', v.name)
    if (name === null || name.trim() === '' || name.trim() === v.name) return
    void call(v, { method: 'PATCH', body: JSON.stringify({ name }) })
  }
  const remove = (v: UsageViewItem) => {
    if (!window.confirm(`'${v.name}' 보기를 지울까요?${v.isShared ? '\n공유된 보기라 다른 사람의 목록에서도 사라집니다.' : ''}`)) return
    void call(v, { method: 'DELETE' }, true)
  }
  const needle = q.trim().toLowerCase()
  const shown = views.filter((v) => !needle || v.name.toLowerCase().includes(needle) || v.ownerName.toLowerCase().includes(needle))
  const groups: { title: string; list: UsageViewItem[] }[] = [
    { title: '내 보기', list: shown.filter((v) => v.mine) },
    { title: '공유된 보기', list: shown.filter((v) => !v.mine) },
  ]

  return (
    <Modal open onClose={onClose} title="보기 관리" widthClass="max-w-2xl">
      <div className="flex flex-col gap-3" data-testid="view-manager">
        {views.length > 6 && (
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="보기 이름 · 만든 사람 검색" aria-label="보기 검색" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground" />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {views.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">저장한 보기가 없습니다. 조건을 맞춘 뒤 [지금 조건을 보기로 저장]을 누르세요.</p>}
        {groups.map(
          (g) =>
            g.list.length > 0 && (
              <section key={g.title}>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  {g.title} {g.list.length}
                </h3>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {g.list.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5" data-testid={`manage-view-${v.id}`}>
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => onOpen(v.id)} className="block max-w-full truncate text-left text-sm font-medium text-foreground hover:underline" title="이 보기로 열기">
                          {v.name}
                          {v.id === activeId && <span className="ml-2 rounded bg-primary/10 px-1.5 text-[11px] font-medium text-primary">보는 중</span>}
                        </button>
                        <p className="truncate text-xs text-muted-foreground">
                          {describeFilters(v.filters)}
                          {!v.mine && ` · ${v.ownerName}`}
                        </p>
                      </div>
                      <label className={`flex items-center gap-1.5 text-xs ${v.canEdit ? 'cursor-pointer text-foreground' : 'text-muted-foreground'}`} title={v.canEdit ? '켜면 모두의 목록에 나옵니다' : '만든 사람과 관리자만 바꿀 수 있습니다'}>
                        <input
                          type="checkbox"
                          checked={v.isShared}
                          disabled={!v.canEdit || busyId === v.id}
                          onChange={(e) => void call(v, { method: 'PATCH', body: JSON.stringify({ isShared: e.target.checked }) })}
                          className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                          data-testid={`manage-share-${v.id}`}
                        />
                        공유
                      </label>
                      {v.canEdit && (
                        <>
                          <button type="button" disabled={busyId === v.id} onClick={() => rename(v)} className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground" data-testid={`manage-rename-${v.id}`}>
                            이름 바꾸기
                          </button>
                          <button type="button" disabled={busyId === v.id} onClick={() => remove(v)} aria-label={`${v.name} 삭제`} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`manage-delete-${v.id}`}>
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ),
        )}
      </div>
    </Modal>
  )
}
