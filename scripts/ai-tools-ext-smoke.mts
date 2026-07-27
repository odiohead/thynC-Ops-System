/**
 * AI 어시스턴트 도구 확장 스모크 (2026-07-27 — 자재·티켓·차량·조직·GW 플래너 10종)
 * LLM 호출 없이 executeTool을 직접 검증한다 (read-only — 데이터 변경 없음, API 비용 0).
 *
 *   npx tsx scripts/ai-tools-ext-smoke.mts
 */

import { PrismaClient } from '@prisma/client'
import { executeTool, AI_TOOLS, TOOL_LABELS } from '../lib/ai/tools'

const prisma = new PrismaClient()

let pass = 0
let fail = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const isErr = (r: unknown): boolean => !!(r as { error?: string })?.error

async function main() {
  console.log('■ 도구 등록 정합')
  {
    const names = AI_TOOLS.map((t) => t.name)
    const added = [
      'search_inventory_items', 'get_stock_summary', 'list_stock_transactions', 'find_serial_unit',
      'list_tickets', 'get_ticket', 'list_vehicle_reservations', 'list_vehicle_logs',
      'search_users', 'list_gateway_plan_jobs',
    ]
    check(`도구 정의 26종 (기존 16 + 신규 10)`, names.length === 26, String(names.length))
    check('신규 10종 전부 정의됨', added.every((n) => names.includes(n)))
    check('신규 10종 전부 진행 라벨 보유', added.every((n) => !!TOOL_LABELS[n]))
    // 디스패처 연결 (알 수 없는 도구 error가 아닌지)
    for (const n of added) {
      const r = await executeTool(n, {})
      const msg = (r as { error?: string })?.error ?? ''
      check(`${n} 디스패처 연결`, !msg.startsWith('알 수 없는 도구'), msg)
    }
  }

  console.log('\n■ 자재관리')
  {
    // 실데이터에서 아무 품목 하나 골라 검색
    const anyItem = await prisma.inventoryItem.findFirst({ where: { isActive: true }, select: { name: true, itemCode: true, inventoryId: true } })
    if (anyItem) {
      const r = (await executeTool('search_inventory_items', { query: anyItem.name.slice(0, 4) })) as any
      check(`search_inventory_items('${anyItem.name.slice(0, 4)}') 결과 있음`, !isErr(r) && r.count > 0, JSON.stringify(r).slice(0, 120))
      check('품목에 재고 합계·위치별 잔량·link 포함', r.items?.[0] && 'totalQty' in r.items[0] && 'stocksByWarehouse' in r.items[0] && !!r.items[0].link)
    } else {
      check('활성 품목 없음 — 검색 스킵', true)
    }
    const r2 = (await executeTool('get_stock_summary', {})) as any
    check('get_stock_summary 인벤토리별 집계', !isErr(r2) && Array.isArray(r2.inventories) && r2.inventories.length >= 3, JSON.stringify(r2).slice(0, 150))
    const daewoong = r2.inventories?.find((i: any) => i.inventory.includes('대웅'))
    check('대웅제약재고 집계 포함 (위치별)', !!daewoong && Array.isArray(daewoong.warehouses))
    const r3 = (await executeTool('list_stock_transactions', { txType: 'OUT', limit: 5 })) as any
    check('list_stock_transactions(OUT) total 반환', !isErr(r3) && typeof r3.total === 'number', JSON.stringify(r3).slice(0, 120))
    if (r3.transactions?.length) {
      check('전표에 출고 표기·품목·수량 포함', r3.transactions[0].type === '출고' && !!r3.transactions[0].item && !!r3.transactions[0].qty)
    }
    const anyUnit = await prisma.inventoryUnit.findFirst({ select: { serialNo: true } })
    if (anyUnit) {
      const r4 = (await executeTool('find_serial_unit', { serialNo: anyUnit.serialNo })) as any
      check(`find_serial_unit('${anyUnit.serialNo}') 개체 추적`, !isErr(r4) && r4.count >= 1 && !!r4.units[0].status, JSON.stringify(r4).slice(0, 150))
      check('개체 이력 포함', Array.isArray(r4.units[0].history))
    }
    const r5 = (await executeTool('find_serial_unit', { serialNo: '__없는시리얼__' })) as any
    check('없는 시리얼 → count 0 안내', r5.count === 0 && !!r5.note)
  }

  console.log('\n■ 티켓')
  {
    const r = (await executeTool('list_tickets', { open: true, limit: 5 })) as any
    check('list_tickets(open) total 반환', !isErr(r) && typeof r.total === 'number' && r.tickets.length > 0, JSON.stringify(r).slice(0, 120))
    check('티켓 행에 코드·상태·큐·link 포함', !!r.tickets[0].ticketCode && !!r.tickets[0].status && !!r.tickets[0].queue && r.tickets[0].link.startsWith('/tickets/'))
    const openCount = await prisma.ticket.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } })
    check(`open total = DB 실측(${openCount})`, r.total === openCount, String(r.total))
    const r2 = (await executeTool('list_tickets', { overdue: true, limit: 3 })) as any
    check('overdue 필터 동작', !isErr(r2) && (r2.tickets as any[]).every((t) => t.overdue === true || r2.tickets.length === 0))
    const r3 = (await executeTool('list_tickets', { queueName: '유지보수', status: 'CLOSED', limit: 3 })) as any
    check('큐+상태 복합 필터', !isErr(r3) && (r3.tickets as any[]).every((t: any) => t.status === 'CLOSED' && t.queue.includes('유지보수')))
    const anyTicket = await prisma.ticket.findFirst({ where: { refType: 'MAINTENANCE' }, select: { ticketCode: true } })
    if (anyTicket) {
      const r4 = (await executeTool('get_ticket', { ticketCode: anyTicket.ticketCode.toLowerCase() })) as any
      check(`get_ticket(소문자 입력 정규화) 상세`, !isErr(r4) && r4.ticketCode === anyTicket.ticketCode, JSON.stringify(r4).slice(0, 120))
      check('연결 업무·타임라인·SLA 시계 포함', r4.linkedWork?.type === 'MAINTENANCE' && Array.isArray(r4.recentLogs) && Array.isArray(r4.slaClocks))
    }
    const r5 = (await executeTool('get_ticket', { ticketCode: 'TK-999999-99999' })) as any
    check('없는 티켓 → error', isErr(r5))
  }

  console.log('\n■ 차량')
  {
    const r = (await executeTool('list_vehicle_reservations', { from: '2026-07-01', to: '2026-07-31' })) as any
    check('list_vehicle_reservations 기간 조회', !isErr(r) && typeof r.total === 'number', JSON.stringify(r).slice(0, 120))
    if (r.reservations?.length) {
      check('예약 행에 차량·예약자·시각 포함', !!r.reservations[0].vehicle && !!r.reservations[0].user && !!r.reservations[0].start)
    }
    const r2 = (await executeTool('list_vehicle_logs', { from: '2026-01-01', to: '2026-12-31', limit: 5 })) as any
    check('list_vehicle_logs 합계 주행거리 반환', !isErr(r2) && typeof r2.totalDistanceKm === 'number', JSON.stringify(r2).slice(0, 120))
  }

  console.log('\n■ 조직 디렉토리')
  {
    const anyFe = await prisma.fieldEngineer.findFirst({ where: { workType: 'MAINTENANCE' }, include: { user: { select: { name: true } } } })
    if (anyFe) {
      const r = (await executeTool('search_users', { query: anyFe.user.name })) as any
      check(`search_users('${anyFe.user.name}')`, !isErr(r) && r.users.length >= 1, JSON.stringify(r).slice(0, 150))
      const u = r.users.find((x: any) => x.name === anyFe.user.name)
      check('담당 풀에 유지보수 포함', !!u?.workPools?.includes('유지보수'), JSON.stringify(u))
      check('연락처(이메일·전화) 미반환 — 사용자 결정', !JSON.stringify(r).includes('@') && !('email' in (u ?? {})) && !('phone' in (u ?? {})))
    }
    const r2 = (await executeTool('search_users', { workType: 'MAINTENANCE', limit: 30 })) as any
    const feCount = await prisma.fieldEngineer.count({ where: { workType: 'MAINTENANCE', user: { isActive: true } } })
    check(`유지보수 풀 필터 total = 실측(${feCount})`, r2.total === feCount, String(r2.total))
  }

  console.log('\n■ GW 플래너')
  {
    const r = (await executeTool('list_gateway_plan_jobs', { limit: 5 })) as any
    check('list_gateway_plan_jobs 조회', !isErr(r) && typeof r.total === 'number', JSON.stringify(r).slice(0, 120))
    if (r.jobs?.length) {
      check('잡에 상태 한글 라벨·link 포함', typeof r.jobs[0].status === 'string' && r.jobs[0].link.startsWith('/gateway-planner/'))
    }
  }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  if (fail > 0) process.exit(1)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
