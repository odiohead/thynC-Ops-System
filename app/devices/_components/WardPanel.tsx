'use client'

/**
 * 병동 탭 (§6.1-B 병동 탭) — GROUP D
 * getWards(code) → | 순서 ↑↓ | 병동명 ✎ | 온프렘 코드 | 배치 중 | 회수(누계) | 활성 | [기기 일괄 이동] [비활성](canAdmin, 배치 0) [삭제](canAdmin, 참조 0) | + 추가 행(createWard)
 *  - ↑↓ = updateWard(sortOrder) · ✎ = updateWard({name, extWardCode}) (동명 409 '같은 이름의 병동이 이미 있습니다') · 비활성 = updateWard({isActive:false}) (409 activeCount) · 삭제 = deleteWard (409 deviceCount/eventCount)
 *  - [기기 일괄 이동] → onBulkMove(wardId) (orchestrator가 그 병동 배치 중 전체를 선택해 MoveWardModal을 연다)
 *  - 표 상단 '미지정 n대'(unassigned). canWrite=false면 ✎·↑↓·추가 미렌더(읽기 값만).
 * 빈 상태: "병동이 없습니다 — 임포트 시 자동 생성되거나 여기서 추가". mutation 후 onMutated(). 조회 후 onTotalChange(total).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import Badge from '@/app/components/ui/Badge'
import Button from '@/app/components/ui/Button'
import { Input } from '@/app/components/ui/Input'
import { TBody, TD, TH, THead, TR, Table } from '@/app/components/ui/Table'
import { cn } from '@/lib/cn'
import { createWard, deleteWard, errorMessage, getWards, isApiError, updateWard } from './api'
import { TableMessageRow } from './groupd-shared'
import { useDevicesToast } from './toast'
import type { Capabilities, Ward } from './types'

export interface WardPanelProps {
  hospitalCode: string
  capabilities: Capabilities
  onMutated: () => void
  /** [기기 일괄 이동] — 이 병동(배치 중 전체)을 대상으로 병동 이동 모달 */
  onBulkMove: (wardId: number) => void
  onTotalChange?: (total: number) => void
  reloadKey: number
}

const EMPTY_TEXT = '병동이 없습니다 — 임포트 시 자동 생성되거나 여기서 추가'

/** 409 부가 필드까지 포함한 사용자 문구 */
function wardErrorText(e: unknown, fallback: string): string {
  const base = errorMessage(e, fallback)
  if (!isApiError(e)) return base
  const b = e.body
  const extras: string[] = []
  if (typeof b.activeCount === 'number') extras.push(`배치 중 ${b.activeCount}대`)
  if (typeof b.deviceCount === 'number') extras.push(`기기 ${b.deviceCount}대`)
  if (typeof b.eventCount === 'number') extras.push(`이벤트 ${b.eventCount}건`)
  const existing = b.existing as { name?: string } | undefined
  if (existing?.name) extras.push(`기존: ${existing.name}`)
  return extras.length ? `${base} (${extras.join(' · ')})` : base
}

export function WardPanel({ hospitalCode, capabilities, onMutated, onBulkMove, onTotalChange, reloadKey }: WardPanelProps) {
  const notify = useDevicesToast()
  const { canWrite, canAdmin } = capabilities
  const [wards, setWards] = useState<Ward[]>([])
  const [unassigned, setUnassigned] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | 'reorder' | 'create' | null>(null)
  const [localKey, setLocalKey] = useState(0)

  const onTotalRef = useRef(onTotalChange)
  onTotalRef.current = onTotalChange

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    getWards(hospitalCode)
      .then((r) => {
        if (!alive) return
        setWards(r.data)
        setUnassigned(r.unassigned)
        onTotalRef.current?.(r.total)
      })
      .catch((e) => {
        if (!alive) return
        setWards([])
        setError(errorMessage(e, '병동 목록을 불러오지 못했습니다.'))
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [hospitalCode, reloadKey, localKey])

  /** 변경 후 — 로컬 재조회 + orchestrator(요약 wards·탭 카운트) */
  const afterMutation = useCallback(() => {
    setLocalKey((k) => k + 1)
    onMutated()
  }, [onMutated])

  // ── 추가
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const submitAdd = async (e: FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      setAddError('병동명을 입력하세요')
      return
    }
    setBusyId('create')
    setAddError(null)
    try {
      await createWard(hospitalCode, { name, extWardCode: newCode.trim() || null })
      notify(`병동 '${name}' 추가`)
      setNewName('')
      setNewCode('')
      setAdding(false)
      afterMutation()
    } catch (err) {
      setAddError(wardErrorText(err, '병동을 추가하지 못했습니다.'))
    } finally {
      setBusyId(null)
    }
  }

  // ── 인라인 개명(이름 + 온프렘 코드)
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const startEdit = (w: Ward) => {
    setEditId(w.id)
    setEditName(w.name)
    setEditCode(w.extWardCode ?? '')
    setEditError(null)
  }
  const cancelEdit = () => {
    setEditId(null)
    setEditError(null)
  }
  const submitEdit = async (w: Ward) => {
    const name = editName.trim()
    const code = editCode.trim()
    if (!name) {
      setEditError('병동명을 입력하세요')
      return
    }
    const body: { name?: string; extWardCode?: string | null } = {}
    if (name !== w.name) body.name = name
    if (code !== (w.extWardCode ?? '')) body.extWardCode = code || null
    if (Object.keys(body).length === 0) {
      cancelEdit()
      return
    }
    setBusyId(w.id)
    setEditError(null)
    try {
      await updateWard(hospitalCode, w.id, body)
      notify(body.name ? `병동명 변경: ${w.name} → ${name} (이력 표시에 즉시 반영)` : `온프렘 코드 변경: ${w.name}`)
      cancelEdit()
      afterMutation()
    } catch (err) {
      setEditError(wardErrorText(err, '병동을 수정하지 못했습니다.'))
    } finally {
      setBusyId(null)
    }
  }

  // ── 순서 ↑↓ — 이웃과 자리를 바꾼 뒤 sortOrder가 어긋난 행만 PUT(동일 값이 섞여 있으면 전체 재번호)
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= wards.length) return
    const next = wards.slice()
    ;[next[index], next[target]] = [next[target], next[index]]
    const updates = next.map((w, i) => ({ w, sortOrder: i + 1 })).filter(({ w, sortOrder }) => w.sortOrder !== sortOrder)
    if (updates.length === 0) return
    setBusyId('reorder')
    // 낙관적 반영
    setWards(next.map((w, i) => ({ ...w, sortOrder: i + 1 })))
    try {
      for (const { w, sortOrder } of updates) await updateWard(hospitalCode, w.id, { sortOrder })
      afterMutation()
    } catch (err) {
      notify(wardErrorText(err, '순서를 변경하지 못했습니다.'), 'error')
      setLocalKey((k) => k + 1)
    } finally {
      setBusyId(null)
    }
  }

  // ── 비활성 / 활성 / 삭제
  const setActive = async (w: Ward, isActive: boolean) => {
    if (!isActive && !window.confirm(`'${w.name}' 병동을 비활성으로 전환할까요?\n비활성 병동은 폼·임포트에서 선택할 수 없고, 이 병동을 가리키는 임포트 행은 오류로 판정됩니다.`)) return
    setBusyId(w.id)
    try {
      await updateWard(hospitalCode, w.id, { isActive })
      notify(isActive ? `병동 '${w.name}' 재활성` : `병동 '${w.name}' 비활성`)
      afterMutation()
    } catch (err) {
      notify(wardErrorText(err, '병동 상태를 변경하지 못했습니다.'), 'error')
    } finally {
      setBusyId(null)
    }
  }
  const remove = async (w: Ward) => {
    if (!window.confirm(`'${w.name}' 병동을 삭제할까요?\n기기·이벤트가 참조하는 병동은 삭제할 수 없습니다(대신 비활성).`)) return
    setBusyId(w.id)
    try {
      await deleteWard(hospitalCode, w.id)
      notify(`병동 '${w.name}' 삭제`)
      afterMutation()
    } catch (err) {
      notify(wardErrorText(err, '병동을 삭제하지 못했습니다.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const colCount = canWrite ? 7 : 6
  const busy = busyId != null
  const activeTotal = wards.reduce((s, w) => s + w.activeCount, 0)

  return (
    <div className="space-y-3">
      {/* 상단 요약 + 추가 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>
            병동 <span className="font-semibold text-foreground tabular-nums">{wards.length}</span>개
          </span>
          <span>
            · 배치 중 <span className="font-semibold text-foreground tabular-nums">{activeTotal.toLocaleString()}</span>대
          </span>
          <span className={cn(unassigned > 0 && 'text-warning-subtle-foreground')}>
            · 미지정 <span className="font-semibold tabular-nums">{unassigned.toLocaleString()}</span>대
          </span>
          {!canWrite && <span className="text-xs">(읽기 전용)</span>}
        </div>
        {canWrite && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={busy}>
            <Plus size={14} /> 추가
          </Button>
        )}
      </div>

      {canWrite && adding && (
        <form onSubmit={submitAdd} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            병동명
            <Input autoFocus className="h-8 w-48 text-sm" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 6병동 · ICU" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            온프렘 코드(선택)
            <Input className="h-8 w-40 font-mono text-sm" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="BSHOSP_W006" />
          </label>
          <Button type="submit" size="sm" disabled={busyId === 'create'}>
            {busyId === 'create' ? '추가 중…' : '추가'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdding(false)
              setAddError(null)
            }}
          >
            취소
          </Button>
          {addError && <span className="basis-full text-xs text-destructive">{addError}</span>}
        </form>
      )}

      {/* 표 */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <THead>
            <tr>
              <TH className="w-20">순서</TH>
              <TH>병동명</TH>
              <TH>온프렘 코드</TH>
              <TH className="text-right">배치 중</TH>
              <TH className="text-right">회수(누계)</TH>
              <TH>활성</TH>
              {canWrite && <TH className="text-right">작업</TH>}
            </tr>
          </THead>
          <TBody>
            {error ? (
              <TableMessageRow colSpan={colCount} tone="error">
                {error}
              </TableMessageRow>
            ) : loading && wards.length === 0 ? (
              <TableMessageRow colSpan={colCount}>불러오는 중…</TableMessageRow>
            ) : wards.length === 0 ? (
              <TableMessageRow colSpan={colCount}>{EMPTY_TEXT}</TableMessageRow>
            ) : (
              wards.map((w, i) => {
                const editing = editId === w.id
                const rowBusy = busyId === w.id
                return (
                  <TR key={w.id} className={cn(!w.isActive && 'text-muted-foreground')}>
                    <TD className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                        {canWrite && (
                          <>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                              onClick={() => move(i, -1)}
                              disabled={busy || i === 0}
                              aria-label="위로"
                              title="위로"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                              onClick={() => move(i, 1)}
                              disabled={busy || i === wards.length - 1}
                              aria-label="아래로"
                              title="아래로"
                            >
                              <ArrowDown size={14} />
                            </button>
                          </>
                        )}
                      </span>
                    </TD>
                    <TD>
                      {editing ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            autoFocus
                            className="h-8 w-48 text-sm"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void submitEdit(w)
                              } else if (e.key === 'Escape') cancelEdit()
                            }}
                            aria-label="병동명"
                          />
                          {editError && <span className="text-xs text-destructive">{editError}</span>}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className={cn('font-medium', w.isActive ? 'text-foreground' : 'line-through')}>{w.name}</span>
                          {canWrite && (
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={() => startEdit(w)}
                              disabled={busy}
                              aria-label="이름 변경"
                              title="이름·온프렘 코드 변경(같은 실체의 개명 — 이력 표시에 즉시 반영)"
                            >
                              <Pencil size={13} />
                            </button>
                          )}
                        </span>
                      )}
                    </TD>
                    <TD className="font-mono text-xs">
                      {editing ? (
                        <Input
                          className="h-8 w-40 font-mono text-xs"
                          value={editCode}
                          onChange={(e) => setEditCode(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void submitEdit(w)
                            } else if (e.key === 'Escape') cancelEdit()
                          }}
                          placeholder="(없음)"
                          aria-label="온프렘 코드"
                        />
                      ) : (
                        w.extWardCode ?? <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{w.activeCount.toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">{w.recoveredCount.toLocaleString()}</TD>
                    <TD>{w.isActive ? <Badge variant="success">활성</Badge> : <Badge variant="outline">비활성</Badge>}</TD>
                    {canWrite && (
                      <TD className="text-right">
                        {editing ? (
                          <span className="inline-flex items-center gap-1">
                            <Button size="sm" onClick={() => void submitEdit(w)} disabled={rowBusy}>
                              {rowBusy ? '저장 중…' : '저장'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={rowBusy}>
                              취소
                            </Button>
                          </span>
                        ) : (
                          <span className="inline-flex flex-wrap items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onBulkMove(w.id)}
                              disabled={busy || w.activeCount === 0 || !w.isActive}
                              title={w.activeCount === 0 ? '배치 중인 기기가 없습니다' : `이 병동 배치 중 ${w.activeCount}대를 다른 병동으로 이동`}
                            >
                              기기 일괄 이동
                            </Button>
                            {canAdmin && w.isActive && (
                              <Button size="sm" variant="ghost" onClick={() => void setActive(w, false)} disabled={busy || w.activeCount > 0} title={w.activeCount > 0 ? '배치 중 기기가 있으면 비활성할 수 없습니다' : '폼·임포트에서 선택 불가로 전환'}>
                                비활성
                              </Button>
                            )}
                            {!w.isActive && (
                              <Button size="sm" variant="ghost" onClick={() => void setActive(w, true)} disabled={busy}>
                                재활성
                              </Button>
                            )}
                            {canAdmin && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => void remove(w)}
                                disabled={busy || w.activeCount > 0}
                                title={w.activeCount > 0 ? '배치 중 기기가 있으면 삭제할 수 없습니다' : '참조(기기·이벤트)가 없을 때만 삭제됩니다'}
                                aria-label="삭제"
                              >
                                <Trash2 size={14} />
                              </Button>
                            )}
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
      <p className="text-[11px] text-muted-foreground">동명(공백·대소문자·전각 무시)은 추가할 수 없습니다. 이름 변경은 같은 실체의 개명으로 과거 이력에도 새 이름이 표시됩니다. 비활성·삭제는 관리자만.</p>
    </div>
  )
}

export default WardPanel
