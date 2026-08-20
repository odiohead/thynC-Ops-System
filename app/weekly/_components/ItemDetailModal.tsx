'use client'

// 주간업무 항목 상세 모달 — 필드 편집 + 주차별 진행 타임라인 + 완료/재개/삭제
// (projects/weekly_ops_design.md §6b)
import { useCallback, useEffect, useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import Badge from '@/app/components/ui/Badge'
import { Input, Select, Textarea } from '@/app/components/ui/Input'
import SearchSelect from './SearchSelect'
import RichContent from './RichContent'
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
  detail: string
}

const STATUS_VARIANT: Record<string, 'primary' | 'warning' | 'success'> = {
  진행: 'primary',
  보류: 'warning',
  완료: 'success',
}

export default function ItemDetailModal({ itemId, onClose, masters, canWrite, onChanged, completeWeekYmd }: Props) {
  const [detail, setDetail] = useState<WeeklyItemDetailDto | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
      detail: form.detail.trim() ? form.detail : null,
    })
    if (ok) {
      onChanged()
      await load()
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

  return (
    <Modal open={itemId != null} onClose={onClose} title="항목 상세" widthClass="max-w-2xl">
      {error && (
        <div className="mb-3 rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
          {error}
        </div>
      )}
      {!detail || !form ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{error ? '' : '불러오는 중…'}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isDone ? 'success' : STATUS_VARIANT[form.status] ?? 'primary'}>
              {isDone ? '완료' : form.status}
            </Badge>
            {isDone && (
              <span className="text-xs text-muted-foreground">
                {weekLabel(detail.completedWeek!)}({detail.completedWeek}) 완료
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">구분</span>
              <Select value={form.kind} onChange={(e) => set('kind', e.target.value)} disabled={!canWrite}>
                {WEEKLY_ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {WEEKLY_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">상태 (완료는 완료 처리 버튼으로)</span>
              <Select value={form.status} onChange={(e) => set('status', e.target.value)} disabled={!canWrite}>
                {WEEKLY_ITEM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">제목</span>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} disabled={!canWrite} />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">업무구분</span>
              <Select value={form.bizType} onChange={(e) => set('bizType', e.target.value)} disabled={!canWrite}>
                {WEEKLY_BIZ_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </label>
            <div className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">병원 (선택)</span>
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
              <span className="mb-1 block text-xs text-muted-foreground">담당 팀 (선택)</span>
              <Select value={form.ownerTeamId} onChange={(e) => set('ownerTeamId', e.target.value)} disabled={!canWrite}>
                <option value="">— 팀 미지정 —</option>
                {(masters?.teams ?? []).map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">담당 (선택)</span>
              <Select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} disabled={!canWrite}>
                <option value="">— 담당 미지정 —</option>
                {(masters?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">목표일 (선택)</span>
              <Input type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} disabled={!canWrite} />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">설명 (안건의 기본 정보)</span>
            <Textarea rows={3} value={form.detail} onChange={(e) => set('detail', e.target.value)} disabled={!canWrite} />
          </label>

          <div>
            <div className="mb-2 border-b border-border pb-1 text-sm font-semibold">주차별 진행 이력</div>
            {detail.updates.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">진행 기록이 없습니다.</div>
            ) : (
              <ul className="space-y-2">
                {detail.updates.map((u) => (
                  <li key={u.weekStart} className="rounded-md border border-border bg-muted/40 px-3 py-2">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{weekLabel(u.weekStart)}</span>
                      <span>{u.weekStart} 주</span>
                      {u.updatedByName && <span className="ml-auto">작성 {u.updatedByName}</span>}
                    </div>
                    <RichContent content={u.content} className="text-sm" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
            <span>
              등록 {detail.createdByName ?? '—'} · {new Date(detail.createdAt).toLocaleDateString('ko-KR')}
            </span>
            <div className="flex gap-2">
              {canWrite && (
                <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
                  삭제
                </Button>
              )}
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
      )}
    </Modal>
  )
}
