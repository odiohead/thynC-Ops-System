import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canManageStock } from '@/lib/inventory'

type Params = { params: { id: string } }

// 개체 메모/시리얼 정정 (재고 담당자·ADMIN). 상태·위치는 전표로만 변경.
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await canManageStock(user))) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const unit = await prisma.inventoryUnit.findUnique({ where: { id } })
  if (!unit) return NextResponse.json({ error: '개체를 찾을 수 없습니다.' }, { status: 404 })

  const body = await req.json()
  const data: { memo?: string | null; serialNo?: string } = {}
  if (body.memo !== undefined) data.memo = body.memo?.trim() || null
  if (body.serialNo !== undefined && body.serialNo.trim()) {
    const serialNo = body.serialNo.trim()
    if (serialNo !== unit.serialNo) {
      const dup = await prisma.inventoryUnit.findFirst({ where: { itemId: unit.itemId, serialNo, id: { not: id } } })
      if (dup) return NextResponse.json({ error: '같은 품목에 이미 있는 시리얼입니다.' }, { status: 409 })
      data.serialNo = serialNo
    }
  }

  const updated = await prisma.inventoryUnit.update({ where: { id }, data })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'inventory_unit',
    resourceId: id,
    resourceLabel: `${updated.serialNo}`,
    before: unit,
    after: updated,
  })

  return NextResponse.json({ unit: updated })
}
