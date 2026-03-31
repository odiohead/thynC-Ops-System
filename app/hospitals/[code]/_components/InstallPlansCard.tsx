'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface InstallPlan {
  id: number
  requestDate: string | null
  writeStatus: string
  replyStatus: string
  replyDate: string | null
  author: { id: string; name: string } | null
}

interface Props {
  hospitalCode: string
  installPlans: InstallPlan[]
  isAdmin: boolean
}

function fmt(d: string | null) {
  if (!d) return '-'
  return d.slice(0, 10)
}

function StatusBadge({ value }: { value: string }) {
  if (value === '완료') return <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">완료</span>
  if (value === '미완료') return <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">미완료</span>
  return <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">-</span>
}

export default function InstallPlansCard({ hospitalCode, installPlans, isAdmin }: Props) {
  const router = useRouter()

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-700">설치계획(가안) 관리</h2>
        {isAdmin && (
          <Link
            href={`/install-plans/new?hospitalCode=${hospitalCode}`}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            + 등록
          </Link>
        )}
      </div>
      {installPlans.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">등록된 설치계획이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['요청일', '작성완료여부', '회신여부', '작성자', '회신일'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {installPlans.map((ip) => (
                <tr
                  key={ip.id}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                  onClick={() => router.push(`/install-plans/${ip.id}`)}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{fmt(ip.requestDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={ip.writeStatus} /></td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={ip.replyStatus} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{ip.author?.name ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{fmt(ip.replyDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
