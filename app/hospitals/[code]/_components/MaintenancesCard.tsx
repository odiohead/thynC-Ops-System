'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/app/components/StatusBadge'

interface Maintenance {
  id: number
  reportedAt: string | null
  resolvedAt: string | null
  title: string
  priority: string
  isRemote: boolean
  type: { name: string; color: string | null } | null
  status: { name: string; color: string | null } | null
  assignees: { user: { id: string; name: string } }[]
}

interface Props {
  hospitalCode: string
  maintenances: Maintenance[]
  isAdmin: boolean
}

function fmt(d: string | null) {
  if (!d) return '-'
  return d.slice(0, 10)
}

const priorityColors: Record<string, string> = {
  '긴급': 'bg-red-100 text-red-700 border-red-300',
  '높음': 'bg-amber-100 text-amber-700 border-amber-300',
  '보통': 'bg-blue-100 text-blue-700 border-blue-300',
  '낮음': 'bg-gray-100 text-gray-600 border-gray-300',
}

export default function MaintenancesCard({ hospitalCode, maintenances, isAdmin }: Props) {
  const router = useRouter()

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-700">유지보수</h2>
        {isAdmin && (
          <Link
            href={`/maintenances/new?hospitalCode=${hospitalCode}`}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            + 유지보수 등록
          </Link>
        )}
      </div>
      {maintenances.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">등록된 유지보수가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['접��일', '제목', '장애유형', '우선순위', '상태', '담당자', '완료일'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {maintenances.map((m) => {
                const priCls = priorityColors[m.priority] ?? 'bg-gray-100 text-gray-600 border-gray-300'
                return (
                  <tr
                    key={m.id}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                    onClick={() => router.push(`/maintenances/${m.id}`)}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{fmt(m.reportedAt)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">{m.title}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {m.type
                        ? <StatusBadge label={m.type.name} color={m.type.color} />
                        : <span className="text-gray-400 text-sm">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${priCls}`}>
                        {m.priority}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {m.status
                        ? <StatusBadge label={m.status.name} color={m.status.color} />
                        : <span className="text-gray-400 text-sm">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{m.assignees?.length > 0 ? m.assignees.map((a) => a.user.name).join(', ') : '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{fmt(m.resolvedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
