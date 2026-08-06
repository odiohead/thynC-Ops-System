import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { canManageStock, canEditTxMeta, canAdminInventory } from '@/lib/inventory'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ canManage: false, canEditTx: false, canAdmin: false })
  return NextResponse.json({
    canManage: await canManageStock(user),
    canEditTx: await canEditTxMeta(user),
    canAdmin: await canAdminInventory(user),
  })
}
