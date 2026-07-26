'use client'

/**
 * 업무 목록 우측 상단의 '티켓 설정' 버튼 (ticket_cti_rule_design.md §6)
 * ADMIN 이상에만 노출 — 역할 조회를 각 목록 페이지에 배선하지 않으려고 버튼이 스스로 확인한다.
 */
import { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import TicketRuleSettingModal, { type DomainRefType } from '@/app/components/TicketRuleSettingModal'

export default function TicketRuleSettingButton({
  refType,
  className,
}: {
  refType: DomainRefType
  className?: string
}) {
  const [allowed, setAllowed] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (alive) setAllowed(me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!allowed) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="티켓 자동생성 설정"
        className={
          className ??
          'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50'
        }
      >
        <Settings2 size={15} />
        <span className="hidden sm:inline">티켓 설정</span>
      </button>
      {open && <TicketRuleSettingModal open={open} onClose={() => setOpen(false)} refType={refType} />}
    </>
  )
}
