'use client'

interface UserOption {
  id: string
  name: string
}

interface Props {
  value: string
  onChange: (userId: string) => void
  /** 선택 가능한 전체 사용자 (활성) */
  users: UserOption[]
  /** 현재(또는 라우팅 예정) 큐의 멤버 userId 목록 — 상단 optgroup으로 우선 표시 */
  memberIds: string[]
  disabled?: boolean
  className?: string
  emptyLabel?: string
}

/** 담당자 셀렉트 — 큐 멤버를 상단 그룹으로 우선 표시, 멤버가 아니어도 선택 가능 */
export default function OwnerSelect({
  value,
  onChange,
  users,
  memberIds,
  disabled,
  className,
  emptyLabel = 'Unassigned',
}: Props) {
  const memberSet = new Set(memberIds)
  const members = users.filter((u) => memberSet.has(u.id))
  const others = users.filter((u) => !memberSet.has(u.id))

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={className ?? 'w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50'}
    >
      <option value="">{emptyLabel}</option>
      {members.length > 0 ? (
        <>
          <optgroup label="Queue Members">
            {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </optgroup>
          <optgroup label="All">
            {others.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </optgroup>
        </>
      ) : (
        users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)
      )}
    </select>
  )
}
