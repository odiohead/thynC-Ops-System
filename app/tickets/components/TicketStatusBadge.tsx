import type { TicketStatus } from '@prisma/client'
import { TICKET_STATUS_LABELS, TICKET_STATUS_COLORS } from '@/lib/ticket-shared'

export default function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TICKET_STATUS_COLORS[status]}`}>
      {TICKET_STATUS_LABELS[status]}
    </span>
  )
}
