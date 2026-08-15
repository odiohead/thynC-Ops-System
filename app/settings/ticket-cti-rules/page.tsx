'use client'

/**
 * 티켓 자동생성 규칙 — 5개 업무 통합 설정 (ticket_cti_rule_design.md §6)
 * 목록 페이지 버튼과 같은 모달을 열되, 여기서는 전 업무의 현재 형상을 한 화면에서 본다.
 */
import { useCallback, useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import TicketRuleSettingModal, { type DomainRefType } from '@/app/components/TicketRuleSettingModal'
import { DOMAIN_REF_TYPES } from '@/lib/ticket-domains/meta'

interface RuleRow {
  id: number
  refType: string
  matchStatusCodeId: number | null
  ctiPath: string | null
  fillDescription: boolean
  effectiveQueue: { id: number; name: string } | null
  matchStatusCode: { id: number; name: string } | null
  cti: { isActive: boolean } | null
  updatedAt: string
  updater: { name: string } | null
}
interface Meta {
  label: string
  listPath: string
  descriptionSource: string
  matchLabel: string | null
  fallbackQueueName: string
}

const ORDER: DomainRefType[] = [...DOMAIN_REF_TYPES]

export default function TicketCtiRulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [meta, setMeta] = useState<Record<string, Meta>>({})
  const [matchOptions, setMatchOptions] = useState<Record<string, { id: number; name: string }[]>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<DomainRefType | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/ticket-cti-rules')
    if (res.ok) {
      const data = await res.json()
      setRules(data.rules ?? [])
      setMeta(data.meta ?? {})
      setMatchOptions(data.matchOptions ?? {})
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const closeModal = () => {
    setEditing(null)
    load()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">티켓 자동생성 규칙</h1>
          <p className="mt-1 text-sm text-gray-500">
            업무를 등록할 때 자동으로 만들어지는 티켓의 분류(CTI)·Assignment Group·설명 자동입력을 지정합니다. 변경은 이후
            새로 등록되는 업무부터 적용됩니다.
          </p>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">불러오는 중...</div>
        ) : (
          <div className="space-y-4">
            {ORDER.map((refType) => {
              const m = meta[refType]
              const base = rules.find((r) => r.refType === refType && r.matchStatusCodeId == null)
              const conds = rules.filter((r) => r.refType === refType && r.matchStatusCodeId != null)
              const opts = matchOptions[refType] ?? []
              const unset = opts.filter((o) => !conds.some((c) => c.matchStatusCodeId === o.id))

              return (
                <div key={refType} className="rounded-xl border border-border bg-card p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">{m?.label ?? refType}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {base ? (
                          <>
                            {base.ctiPath}
                            {' · '}
                            {base.effectiveQueue?.name ?? `${m?.fallbackQueueName} (폴백)`}
                            {base.cti && !base.cti.isActive && (
                              <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                                비활성 분류
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-amber-700">규칙 없음 — 코드 기본값으로 동작합니다</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(refType)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Settings2 size={15} />
                      설정
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={
                        base?.fillDescription
                          ? 'rounded bg-emerald-50 px-2 py-1 text-emerald-700'
                          : 'rounded bg-muted px-2 py-1 text-muted-foreground'
                      }
                    >
                      {m?.descriptionSource} → 티켓 설명 {base?.fillDescription ? '자동 입력' : '사용 안 함'}
                    </span>
                    {conds.map((c) => (
                      <span key={c.id} className="rounded bg-muted px-2 py-1 text-muted-foreground">
                        {c.matchStatusCode?.name}: {c.ctiPath?.split(' / ').pop()}
                      </span>
                    ))}
                    {unset.map((o) => (
                      <span key={o.id} className="rounded bg-amber-50 px-2 py-1 text-amber-700">
                        {o.name}: 규칙 미지정
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editing && <TicketRuleSettingModal open onClose={closeModal} refType={editing} />}
    </div>
  )
}
