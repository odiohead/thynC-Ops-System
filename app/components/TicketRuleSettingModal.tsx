'use client'

/**
 * 업무 → 티켓 자동생성 규칙 설정 (ticket_cti_rule_design.md §6)
 * 5개 업무 목록 페이지와 통합 설정 페이지가 같은 컴포넌트를 쓴다 —
 * 메뉴마다 별도 화면을 만들면 5벌을 유지보수하게 된다.
 */
import { useCallback, useEffect, useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'

export type DomainRefType = 'SITE_VISIT' | 'INSTALL_PLAN' | 'PROJECT' | 'ETC' | 'MAINTENANCE'

interface CtiNode {
  id: number
  parentId: number | null
  level: number
  name: string
  isActive: boolean
  defaultQueueId: number | null
}
interface QueueOpt {
  id: number
  name: string
}
interface MatchOpt {
  id: number
  name: string
}
interface RuleRow {
  id: number
  refType: string
  matchStatusCodeId: number | null
  ctiId: number
  queueId: number | null
  fillDescription: boolean
  ctiPath: string | null
}
interface DomainMeta {
  label: string
  descriptionSource: string
  matchLabel: string | null
  fallbackQueueName: string
}

/** 편집 상태: 조건(NULL=기본) → { ctiId, queueId } */
type Draft = Record<string, { ctiId: number | null; queueId: number | null }>

const KEY_DEFAULT = 'default'
const keyOf = (matchId: number | null) => (matchId == null ? KEY_DEFAULT : String(matchId))

export default function TicketRuleSettingModal({
  open,
  onClose,
  refType,
}: {
  open: boolean
  onClose: () => void
  refType: DomainRefType
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ctiNodes, setCtiNodes] = useState<CtiNode[]>([])
  const [queues, setQueues] = useState<QueueOpt[]>([])
  const [matchOptions, setMatchOptions] = useState<MatchOpt[]>([])
  const [meta, setMeta] = useState<DomainMeta | null>(null)
  const [fillDescription, setFillDescription] = useState(true)
  const [draft, setDraft] = useState<Draft>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/settings/ticket-cti-rules?refType=${refType}`)
      if (!res.ok) throw new Error('규칙을 불러오지 못했습니다.')
      const data = await res.json()
      setCtiNodes(data.ctiNodes ?? [])
      setQueues(data.queues ?? [])
      setMatchOptions(data.matchOptions?.[refType] ?? [])
      setMeta(data.meta?.[refType] ?? null)

      const rules: RuleRow[] = data.rules ?? []
      const next: Draft = {}
      for (const r of rules) next[keyOf(r.matchStatusCodeId)] = { ctiId: r.ctiId, queueId: r.queueId }
      if (!next[KEY_DEFAULT]) next[KEY_DEFAULT] = { ctiId: null, queueId: null }
      setDraft(next)
      const base = rules.find((r) => r.matchStatusCodeId == null)
      setFillDescription(base ? base.fillDescription : true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [refType])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const setRow = (key: string, patch: Partial<{ ctiId: number | null; queueId: number | null }>) =>
    setDraft((d) => ({ ...d, [key]: { ctiId: d[key]?.ctiId ?? null, queueId: d[key]?.queueId ?? null, ...patch } }))

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const rules = Object.entries(draft).map(([key, v]) => ({
        matchStatusCodeId: key === KEY_DEFAULT ? null : Number(key),
        ctiId: v.ctiId,
        queueId: v.queueId,
      }))
      const res = await fetch('/api/settings/ticket-cti-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refType, fillDescription, rules }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`${meta?.label ?? ''} → 티켓 자동생성 설정`} widthClass="max-w-2xl">
      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">불러오는 중...</div>
      ) : (
        <div className="space-y-5">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* 기본 규칙 */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground">기본 규칙</h3>
            <CtiPicker
              nodes={ctiNodes}
              value={draft[KEY_DEFAULT]?.ctiId ?? null}
              onChange={(ctiId) => setRow(KEY_DEFAULT, { ctiId })}
            />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Assignment Group</span>
              <select
                value={draft[KEY_DEFAULT]?.queueId ?? ''}
                onChange={(e) => setRow(KEY_DEFAULT, { queueId: e.target.value ? Number(e.target.value) : null })}
                className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
              >
                <option value="">분류(CTI)의 기본 그룹 사용</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {/* 조건별 규칙 (유지보수 장애유형) */}
          {meta?.matchLabel && matchOptions.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground">{meta.matchLabel}별 규칙</h3>
              <p className="text-[11px] text-muted-foreground">
                지정하지 않은 {meta.matchLabel}은 위 기본 규칙을 사용합니다.
              </p>
              <div className="space-y-2">
                {matchOptions.map((opt) => {
                  const key = keyOf(opt.id)
                  const row = draft[key]
                  return (
                    <div key={opt.id} className="rounded-md border border-border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{opt.name}</span>
                        {row?.ctiId ? (
                          <button
                            type="button"
                            onClick={() => setRow(key, { ctiId: null })}
                            className="text-[11px] text-muted-foreground underline hover:text-foreground"
                          >
                            규칙 삭제
                          </button>
                        ) : (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">규칙 미지정</span>
                        )}
                      </div>
                      <CtiPicker nodes={ctiNodes} value={row?.ctiId ?? null} onChange={(ctiId) => setRow(key, { ctiId })} compact />
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* 설명 자동 입력 */}
          <section>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={fillDescription}
                onChange={(e) => setFillDescription(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                {meta?.label} &apos;{meta?.descriptionSource}&apos;를 티켓 설명으로 자동 입력
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  등록 시점의 내용을 1회 복사합니다. 이후 {meta?.descriptionSource} 수정은 티켓 설명에 반영되지 않습니다.
                </span>
              </span>
            </label>
          </section>

          <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
            변경은 이후 새로 등록되는 {meta?.label}부터 적용됩니다. 이미 만들어진 티켓의 분류는 바뀌지 않습니다.
          </p>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              취소
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** CTI 3단 셀렉트 — Item(level 3)만 값으로 인정 */
function CtiPicker({
  nodes,
  value,
  onChange,
  compact,
}: {
  nodes: CtiNode[]
  value: number | null
  onChange: (id: number | null) => void
  compact?: boolean
}) {
  const item = nodes.find((n) => n.id === value)
  const type = item ? nodes.find((n) => n.id === item.parentId) : null
  const cat = type ? nodes.find((n) => n.id === type.parentId) : null

  const [catId, setCatId] = useState<number | null>(cat?.id ?? null)
  const [typeId, setTypeId] = useState<number | null>(type?.id ?? null)

  useEffect(() => {
    const it = nodes.find((n) => n.id === value)
    const ty = it ? nodes.find((n) => n.id === it.parentId) : null
    setTypeId(ty?.id ?? null)
    setCatId(ty ? nodes.find((n) => n.id === ty.parentId)?.id ?? null : null)
  }, [value, nodes])

  const cats = nodes.filter((n) => n.level === 1 && (n.isActive || n.id === catId))
  const types = nodes.filter((n) => n.level === 2 && n.parentId === catId && (n.isActive || n.id === typeId))
  const items = nodes.filter((n) => n.level === 3 && n.parentId === typeId && (n.isActive || n.id === value))

  const cls = 'h-9 w-full rounded-md border border-border bg-card px-2 text-sm'
  return (
    <div>
      {!compact && <span className="mb-1 block text-xs font-medium text-muted-foreground">티켓 분류(CTI)</span>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          value={catId ?? ''}
          onChange={(e) => {
            setCatId(e.target.value ? Number(e.target.value) : null)
            setTypeId(null)
            onChange(null)
          }}
          className={cls}
        >
          <option value="">Category</option>
          {cats.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <select
          value={typeId ?? ''}
          onChange={(e) => {
            setTypeId(e.target.value ? Number(e.target.value) : null)
            onChange(null)
          }}
          disabled={!catId}
          className={cls}
        >
          <option value="">Type</option>
          {types.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          disabled={!typeId}
          className={cls}
        >
          <option value="">Item</option>
          {items.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
