import { stockReasonHandlers } from '@/lib/stockReasonApi'

const h = stockReasonHandlers('STOCK_IN_TYPE', '입고 유형', 'setting:stock_in_type')
export const PUT = h.PUT
export const DELETE = h.DELETE
