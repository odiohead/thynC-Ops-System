import { stockReasonHandlers } from '@/lib/stockReasonApi'

const h = stockReasonHandlers('STOCK_OUT_TYPE', '출고 유형', 'setting:stock_out_type')
export const PUT = h.PUT
export const DELETE = h.DELETE
