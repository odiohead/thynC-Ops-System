import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.inventory.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '인벤토리를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: '인벤토리 이름을 입력해주세요.' }, { status: 400 })

  const duplicate = await prisma.inventory.findFirst({ where: { name, id: { not: id } } })
  if (duplicate) return NextResponse.json({ error: '이미 존재하는 인벤토리입니다.' }, { status: 409 })

  const inventory = await prisma.inventory.update({
    where: { id },
    data: {
      name,
      isTransferLocked: body.isTransferLocked !== undefined ? !!body.isTransferLocked : undefined,
      linkHospital: body.linkHospital !== undefined ? !!body.linkHospital : undefined,
      memo: body.memo !== undefined ? (body.memo?.trim() || null) : undefined,
      isActive: body.isActive !== undefined ? !!body.isActive : undefined,
      sortOrder: body.sortOrder !== undefined ? body.sortOrder : undefined,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:inventory',
    resourceId: id,
    resourceLabel: inventory.name,
    before,
    after: inventory,
  })

  return NextResponse.json({ inventory })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const inv = await prisma.inventory.findUnique({ where: { id } })
  if (!inv) return NextResponse.json({ error: '인벤토리를 찾을 수 없습니다.' }, { status: 404 })

  // 재고·전표·개체에서 사용 중이면 삭제 금지 (이력 보존)
  const [stockCnt, txCnt, unitCnt] = await Promise.all([
    prisma.inventoryStock.count({ where: { inventoryId: id } }),
    prisma.inventoryTransaction.count({ where: { OR: [{ inventoryId: id }, { toInventoryId: id }] } }),
    prisma.inventoryUnit.count({ where: { inventoryId: id } }),
  ])
  if (stockCnt + txCnt + unitCnt > 0) {
    return NextResponse.json(
      { error: `이 인벤토리를 사용하는 재고·전표·개체가 있어 삭제할 수 없습니다. (재고 ${stockCnt}·전표 ${txCnt}·개체 ${unitCnt}) 비활성화를 사용하세요.` },
      { status: 409 },
    )
  }

  await prisma.inventory.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:inventory',
    resourceId: id,
    resourceLabel: inv.name,
    before: inv,
  })

  return NextResponse.json({ success: true })
}
