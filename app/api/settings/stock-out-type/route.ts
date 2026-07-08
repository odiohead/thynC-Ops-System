import { stockReasonHandlers } from '@/lib/stockReasonApi'

export const dynamic = 'force-dynamic'

const h = stockReasonHandlers('STOCK_OUT_TYPE', '출고 유형', 'setting:stock_out_type')
export const GET = h.GET
export const POST = h.POST
