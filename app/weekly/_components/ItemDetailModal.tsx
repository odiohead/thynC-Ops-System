'use client'

// 주간업무 항목 상세 모달 — 대형(92vw) 2컬럼: 좌 기본정보·설명(리치텍스트), 우 주차별 진행 타임라인
// (projects/weekly_ops_design.md §6b — 2026-08-20 대형 레이아웃 개정)
import { useCallback, useEffect, useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import Badge from '@/app/components/ui/Badge'
import { Input, Select } from '@/app/components/ui/Input'
import SearchSelect from './SearchSelect'
import RichContent from './RichContent'
import WeeklyRichEditor from './WeeklyRichEditor'
import CellEditor from './CellEditor'
import { isEmptyRichText } from '@/lib/richtext'
import {
  WEEKLY_ITEM_KINDS,
  WEEKLY_KIND_LABELS,
  WEEKLY_ITEM_STATUSES,
  WEEKLY_BIZ_TYPES,
  mondayOfLocal,
  ymdLocal,
  weekLabel,
  type WeeklyItemDetailDto,
  type WeeklyMastersResponse,
} from '@/lib/weekly'

interface Props {
  itemId: number | null
  onClose: () => void
  masters: WeeklyMastersResponse | null
  canWrite: boolean
  /** 저장·완료·재개·삭제 후 부모 목록 리로드 */
  onChanged: () => void
  /** 완료 처리 귀속 주차(월요일 YMD) — 보드 탭에서 열릴 때 조회 중 주차. 없으면 현재 주 */
  completeWeekYmd?: string
}

interface FormState {
  kind: string
  status: string
  bizType: string
  title: string
  hospitalCode: string
  ownerTeamId: string // '' = 미지정, 숫자 문자열
  ownerId: string
  targetDate: string
  detail: string // 리치텍스트 HTML (구 데이터는 plain text)
}

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

/** 목표일 D-day — YMD 문자열 UTC 자정 기준 (보드 overdue 판정과 동일 축) */
function ddayOf(target: string): { label: string; overdue: boolean } {
  const diff = Math.round(
    (new Date(target).getTime() - new Date(ymdLocal(new Date())).getTime()) / 86400000
  )
  if (diff === 0) return { label: 'D-Day', overdue: false }
  return diff > 0 ? { label: `D-${diff}`, overdue: false } : { label: `D+${-diff}`, overdue: true }
}

export default function ItemDetailModal({ itemId, onClose, masters, canWrite, onChanged, completeWeekYmd }: Props) {
  const [detail, setDetail] = useState<WeeklyItemDetailDto | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 진행 이력 인라인 수정 중인 주차 (weekStart YMD) */
  const [editingWeek, setEditingWeek] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (itemId == null) return
    setError('')
    const res = await fetch(`/api/weekly/items/${itemId}`)
    if (res.redirected) {
      window.location.href = '/login'
      return
    }
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      setError(d?.error ?? '항목을 불러오지 못했습니다.')
      return
    }
    const d = await res.json().catch(() => null)
    if (!d?.item) {
      setError('항목을 불러오지 못했습니다.')
      return
    }
    const it: WeeklyItemDetailDto = d.item
    setDetail(it)
    setForm({
      kind: it.kind,
      status: it.status,
      bizType: it.bizType,
      title: it.title,
      hospitalCode: it.hospitalCode ?? '',
      ownerTeamId: it.ownerTeamId != null ? String(it.ownerTeamId) : '',
      ownerId: it.ownerId ?? '',
      targetDate: it.targetDate ?? '',
      detail: it.detail ?? '',
    })
  }, [itemId])

  useEffect(() => {
    setDetail(null)
    setForm(null)
    setEditingWeek(null)
    load()
  }, [load])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f))

  const put = async (body: unknown): Promise<boolean> => {
    if (itemId == null) return false
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/weekly/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.redirected) {
        window.location.href = '/login'
        return false
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.error ?? '저장에 실패했습니다.')
        return false
      }
      return true
    } catch {
      setError('네트워크 오류로 저장하지 못했습니다.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!form) return
    if (!form.title.trim()) {
      setError('제목을 입력하세요.')
      return
    }
    const ok = await put({
      kind: form.kind,
      status: form.status,
      bizType: form.bizType,
      title: form.title.trim(),
      hospitalCode: form.hospitalCode || null,
      ownerTeamId: form.ownerTeamId ? Number(form.ownerTeamId) : null,
      ownerId: form.ownerId || null,
      targetDate: form.targetDate || null,
      detail: isEmptyRichText(form.detail) ? null : form.detail,
    })
    if (ok) {
      onChanged()
      await load()
    }
  }

  /** 주차별 진행 이력 수정 — 빈 내용 저장은 해당 주차 기록 삭제 (보드 셀과 동일 API·규칙) */
  const saveTimelineUpdate = async (week: string, content: string) => {
    if (itemId == null) return
    if (isEmptyRichText(content) && !confirm('내용이 비어 있습니다.\n해당 주차의 진행 기록이 삭제됩니다. 계속할까요?')) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/weekly/items/${itemId}/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, content }),
      })
      if (res.redirected) {
        window.location.href = '/login'
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.error ?? '진행 기록 저장에 실패했습니다.')
        return
      }
      await load()
      setEditingWeek(null)
      onChanged()
    } catch {
      setError('네트워크 오류로 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const complete = async () => {
    if (!detail) return
    // 보드 탭에서 열렸으면 조회 중 주차로 귀속 (보드 행 완료 버튼과 동일 규칙 — 설계 §4)
    const today = ymdLocal(mondayOfLocal(new Date()))
    const week = completeWeekYmd ?? today
    if (week > today) {
      setError('미래 주에는 완료 처리할 수 없습니다.')
      return
    }
    const msg =
      `'${detail.title}' 항목을 ${weekLabel(week)}(${week}) 주로 완료 처리합니다.` +
      (week < today ? '\n과거 주로 완료하면 이번 주 보드에는 표시되지 않습니다.' : '')
    if (!confirm(msg)) return
    if (await put({ complete: { week } })) {
      onChanged()
      await load()
    }
  }

  const reopen = async () => {
    if (!detail) return
    if (!confirm(`'${detail.title}' 항목의 완료를 취소하고 진행 목록으로 되돌립니다.`)) return
    if (await put({ reopen: true })) {
      onChanged()
      await load()
    }
  }

  const remove = async () => {
    if (itemId == null || !detail) return
    if (!confirm(`'${detail.title}' 항목을 삭제합니다.\n주차별 진행 기록도 함께 삭제되며 되돌릴 수 없습니다.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/weekly/items/${itemId}`, { method: 'DELETE' })
      if (res.redirected) {
        window.location.href = '/login'
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.error ?? '삭제에 실패했습니다.')
        return
      }
      onChanged()
      onClose()
    } catch {
      setError('네트워크 오류로 삭제하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const isDone = !!detail?.completedWeek
  const dday = detail?.targetDate && !isDone ? ddayOf(detail.targetDate) : null
  const latest = detail?.updates[0] ?? null
  const fieldLabel = 'mb-1 block text-xs text-muted-foreground'

  return (
    <Modal open={itemId != null} onClose={onClose} title="항목 상세" widthClass="max-w-[92vw] xl:max-w-[1500px]">
      {error && (
        <div className="mb-3 rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
          {error}
        </div>
      )}
      {!detail || !form ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{error ? '' : '불러오는 중…'}</div>
      ) : (
        <div className="space-y-4">
          {/* ── 요약 스트립: 구분·업무구분·상태·D-day + 액션 ── */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {WEEKLY_KIND_LABELS[detail.kind]}
            </span>
            <Badge variant={BIZ_VARIANT[form.bizType] ?? 'default'}>{form.bizType}</Badge>
            <Badge variant={isDone ? 'success' : STATUS_VARIANT[form.status] ?? 'primary'}>
              {isDone ? '완료' : form.status}
            </Badge>
            {isDone && (
              <span className="text-xs text-muted-foreground">
                {weekLabel(detail.completedWeek!)}({detail.completedWeek}) 완료
              </span>
            )}
            {dday && (
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  dday.overdue ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'
                }`}
              >
                목표일 {dday.label}
                {dday.overdue && ' 지남'}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              {canWrite && !isDone && (
                <Button size="sm" variant="outline" onClick={complete} disabled={busy}>
                  완료 처리
                </Button>
              )}
              {canWrite && isDone && (
                <Button size="sm" variant="outline" onClick={reopen} disabled={busy}>
                  재개
                </Button>
              )}
            </div>
          </div>

          {/* ── 2컬럼: 좌 기본정보·설명 / 우 진행 이력 ── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* 좌측 — 기본 정보 + 설명 */}
            <div className="space-y-4 lg:col-span-2">
              <label className="block text-sm">
                <span className={fieldLabel}>제목</span>
                <Input value={form.title} onChange={(e) => set('title', e.target.value)} disabled={!canWrite} />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className={fieldLabel}>구분</span>
                  <Select value={form.kind} onChange={(e) => set('kind', e.target.value)} disabled={!canWrite}>
                    {WEEKLY_ITEM_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {WEEKLY_KIND_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block text-sm">
                  <span className={fieldLabel}>업무구분</span>
                  <Select value={form.bizType} onChange={(e) => set('bizType', e.target.value)} disabled={!canWrite}>
                    {WEEKLY_BIZ_TYPES.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block text-sm">
                  <span className={fieldLabel}>상태 (완료는 완료 처리 버튼으로)</span>
                  <Select value={form.status} onChange={(e) => set('status', e.target.value)} disabled={!canWrite}>
                    {WEEKLY_ITEM_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block text-sm">
                  <span className={fieldLabel}>목표일 (선택)</span>
                  <Input
                    type="date"
                    value={form.targetDate}
                    onChange={(e) => set('targetDate', e.target.value)}
                    disabled={!canWrite}
                  />
                </label>
                <div className="block text-sm">
                  <span className={`${fieldLabel} flex items-center justify-between`}>
                    <span>병원 (선택)</span>
                    {form.hospitalCode && (
                      <a
                        href={`/hospitals/${form.hospitalCode}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        병원 상세 ↗
                      </a>
                    )}
                  </span>
                  <SearchSelect
                    value={form.hospitalCode}
                    onChange={(v) => set('hospitalCode', v)}
                    options={(masters?.hospitals ?? []).map((h) => ({ value: h.hospitalCode, label: h.hospitalName }))}
                    placeholder="병원 검색"
                    emptyLabel="— 병원 미지정 —"
                    disabled={!canWrite}
                  />
                </div>
                <label className="block text-sm">
                  <span className={fieldLabel}>담당 팀 (선택)</span>
                  <Select
                    value={form.ownerTeamId}
                    onChange={(e) => set('ownerTeamId', e.target.value)}
                    disabled={!canWrite}
                  >
                    <option value="">— 팀 미지정 —</option>
                    {(masters?.teams ?? []).map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="block text-sm">
                  <span className={fieldLabel}>담당 (선택)</span>
                  <SearchSelect
                    value={form.ownerId}
                    onChange={(v) => set('ownerId', v)}
                    options={(masters?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
                    placeholder="담당 검색"
                    emptyLabel="— 담당 미지정 —"
                    disabled={!canWrite}
                  />
                </div>
              </div>

              <div className="block text-sm">
                <span className={fieldLabel}>설명 (안건의 배경·기본 정보)</span>
                {canWrite ? (
                  <WeeklyRichEditor
                    key={detail.id}
                    initial={detail.detail ?? ''}
                    placeholder="안건의 배경, 목적, 관련 링크 등"
                    onChange={(html) => set('detail', html)}
                    autoFocus={false}
                    minHeightClass="min-h-[10rem]"
                  />
                ) : detail.detail ? (
                  <RichContent content={detail.detail} className="rounded-md border border-border px-3 py-2 text-sm" />
                ) : (
                  <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">—</div>
                )}
              </div>

              {/* 메타 정보 */}
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <div>
                  등록 {detail.createdByName ?? '—'} · {new Date(detail.createdAt).toLocaleDateString('ko-KR')}
                </div>
                <div className="mt-0.5">
                  진행 기록 {detail.updates.length}건
                  {latest && (
                    <>
                      {' '}
                      · 최근 {weekLabel(latest.weekStart)} ({latest.updatedByName ?? '—'},{' '}
                      {new Date(latest.updatedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })})
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-3">
                <div>
                  {canWrite && (
                    <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
                      삭제
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
                    닫기
                  </Button>
                  {canWrite && (
                    <Button size="sm" onClick={save} disabled={busy}>
                      저장
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* 우측 — 주차별 진행 이력 (넓은 영역 + 자체 스크롤) */}
            <div className="lg:col-span-3">
              <div className="mb-2 flex items-center justify-between border-b border-border pb-1">
                <span className="text-sm font-semibold">주차별 진행 이력</span>
                <span className="text-xs text-muted-foreground">{detail.updates.length}건</span>
              </div>
              {detail.updates.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  진행 기록이 없습니다. 주간 보드의 &lsquo;금주 진행&rsquo; 셀에서 입력하세요.
                </div>
              ) : (
                <ul className="space-y-2 lg:max-h-[62dvh] lg:overflow-y-auto lg:pr-1">
                  {detail.updates.map((u) => (
                    <li key={u.weekStart} className="group rounded-md border border-border bg-muted/40 px-3 py-2">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{weekLabel(u.weekStart)}</span>
                        <span>{u.weekStart} 주</span>
                        <span className="ml-auto flex items-center gap-2">
                          {u.updatedByName && (
                            <span>
                              작성 {u.updatedByName} ·{' '}
                              {new Date(u.updatedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                            </span>
                          )}
                          {canWrite && editingWeek !== u.weekStart && (
                            <button
                              className="rounded px-1 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                              title="이 주차 기록 수정"
                              onClick={() => setEditingWeek(u.weekStart)}
                            >
                              ✎ 수정
                            </button>
                          )}
                        </span>
                      </div>
                      {editingWeek === u.weekStart ? (
                        <CellEditor
                          initial={u.content}
                          busy={busy}
                          onSave={(c) => saveTimelineUpdate(u.weekStart, c)}
                          onCancel={() => setEditingWeek(null)}
                        />
                      ) : (
                        <RichContent content={u.content} className="text-sm" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
