import type { TicketSeverity } from '@prisma/client'
import { TICKET_SEVERITY_LABELS, TICKET_SEVERITY_COLORS } from '@/lib/ticket-shared'

export default function TicketSeverityBadge({ severity, short = false }: { severity: TicketSeverity; short?: boolean }) {
  const label = short ? TICKET_SEVERITY_LABELS[severity].split(' · ')[0] : TICKET_SEVERITY_LABELS[severity]
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TICKET_SEVERITY_COLORS[severity]}`}>
      {label}
    </span>
  )
}
