import { redirect } from 'next/navigation'

// P10: tasks 롤업은 티켓 목록으로 대체됨 (ticket_dev_schedule.md)
// force-dynamic: 정적 프리렌더 시 Location 헤더 없는 307이 되는 문제 방지
export const dynamic = 'force-dynamic'

export default function TasksPage() {
  redirect('/tickets')
}
