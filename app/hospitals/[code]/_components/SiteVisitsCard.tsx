'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/app/components/StatusBadge'

interface SiteVisit {
  id: number
  requestDate: string | null
  visitDate: string | null
  replyDate: string | null
  status: { name: string; color: string | null } | null
  daewoongUser: { id: string; name: string } | null
  assignee: { id: string; name: string } | null
}

interface Props {
  hospitalCode: string
  siteVisits: SiteVisit[]
  isAdmin: boolean
}

function fmt(d: string | null) {
  if (!d) return '-'
  return d.slice(0, 10)
}

export default function SiteVisitsCard({ hospitalCode, siteVisits, isAdmin }: Props) {
  const router = useRouter()

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-700">답사 관리</h2>
        {isAdmin && (
          <Link
            href={`/site-visits/new?hospitalCode=${hospitalCode}`}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            + 답사 등록
          </Link>
        )}
      </div>
      {siteVisits.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">등록된 답사가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['요청일', '방문일', '상태', '대웅 담당자', '담당자', '회신일'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {siteVisits.map((sv) => (
                <tr
                  key={sv.id}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                  onClick={() => router.push(`/site-visits/${sv.id}`)}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{fmt(sv.requestDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{fmt(sv.visitDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {sv.status
                      ? <StatusBadge label={sv.status.name} color={sv.status.color} />
                      : <span className="text-gray-400 text-sm">-</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{sv.daewoongUser?.name ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{sv.assignee?.name ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{fmt(sv.replyDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
