import { prisma } from '@/lib/prisma'
import MaintenanceForm from '../MaintenanceForm'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: { hospitalCode?: string; parentTicketId?: string }
}

export default async function NewMaintenancePage({ searchParams }: Props) {
  let hospitalCode = searchParams.hospitalCode ?? ''

  // CS 마스터 티켓의 하위 생성 (cs_ticket_workflow_design.md P3) — 병원 프리필 + 배너
  let parentTicket: { id: number; ticketCode: string; title: string } | null = null
  let parentInvalidReason: string | null = null
  const parentTicketId = searchParams.parentTicketId ? parseInt(searchParams.parentTicketId) : NaN
  if (searchParams.parentTicketId !== undefined) {
    const t = isNaN(parentTicketId)
      ? null
      : await prisma.ticket.findUnique({
          where: { id: parentTicketId },
          select: { id: true, ticketCode: true, title: true, hospitalCode: true, parentId: true, status: true },
        })
    if (t && !t.parentId && t.status !== 'CLOSED') {
      parentTicket = { id: t.id, ticketCode: t.ticketCode, title: t.title }
      if (!hospitalCode && t.hospitalCode) hospitalCode = t.hospitalCode
    } else {
      // 연결 의도를 조용히 버리지 않는다 — 무효 사유를 화면에 알린다 (리뷰 2026-08-15)
      parentInvalidReason = !t
        ? '마스터 티켓을 찾을 수 없습니다.'
        : t.parentId
          ? '서브 티켓 아래에는 서브를 둘 수 없습니다 (2레벨 고정).'
          : '종결된 티켓의 서브로 연결할 수 없습니다.'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">유지보수 등록</h1>
        </div>
        {parentInvalidReason && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            하위 티켓 연결 불가 — {parentInvalidReason} 아래에서 등록하면 <b>연결 없이</b> 일반 유지보수로 생성됩니다.
          </div>
        )}
        <MaintenanceForm
          mode="create"
          initialData={hospitalCode ? { hospitalCode } : undefined}
          parentTicket={parentTicket}
        />
      </div>
    </div>
  )
}
