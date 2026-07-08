import { stockReasonHandlers } from '@/lib/stockReasonApi'

export const dynamic = 'force-dynamic'

const h = stockReasonHandlers('STOCK_IN_TYPE', '입고 유형', 'setting:stock_in_type')
export const GET = h.GET
export const POST = h.POST
