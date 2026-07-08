import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

/**
 * 입고/출고 유형(StatusCode STOCK_IN_TYPE / STOCK_OUT_TYPE) 설정 API 공용 핸들러.
 * value가 있는 행은 시스템 유형(회수 RETURN·폐기/불량 DISPOSE — 로직 결합)이라 이름 수정만 허용, 삭제 금지.
 * 전표에서 사용 중인 유형도 삭제 금지 (이력 보존).
 */
export function stockReasonHandlers(category: 'STOCK_IN_TYPE' | 'STOCK_OUT_TYPE', label: string, resource: string) {
  async function GET() {
    const statusCodes = await prisma.statusCode.findMany({
      where: { category },
      orderBy: { order: 'asc' },
    })
    return NextResponse.json({ statusCodes })
  }

  async function POST(request: NextRequest) {
    const user = await getAuthUser(request)
    if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { name, order } = await request.json()

    if (!name?.trim()) return NextResponse.json({ error: `${label} 이름을 입력해주세요.` }, { status: 400 })

    const existing = await prisma.statusCode.findFirst({ where: { name: name.trim(), category } })
    if (existing) return NextResponse.json({ error: `이미 존재하는 ${label}입니다.` }, { status: 409 })

    const statusCode = await prisma.statusCode.create({
      data: { name: name.trim(), order: order ?? 0, category },
    })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'CREATE',
      resource,
      resourceId: statusCode.id,
      resourceLabel: statusCode.name,
      after: statusCode,
    })

    return NextResponse.json({ statusCode }, { status: 201 })
  }

  async function PUT(request: NextRequest, { params }: Params) {
    const user = await getAuthUser(request)
    if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const id = parseInt(params.id)
    if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

    const { name, order } = await request.json()
    if (!name?.trim()) return NextResponse.json({ error: `${label} 이름을 입력해주세요.` }, { status: 400 })

    const before = await prisma.statusCode.findUnique({ where: { id } })
    if (!before || before.category !== category) {
      return NextResponse.json({ error: `${label}을(를) 찾을 수 없습니다.` }, { status: 404 })
    }

    const duplicate = await prisma.statusCode.findFirst({
      where: { name: name.trim(), category, id: { not: id } },
    })
    if (duplicate) return NextResponse.json({ error: `이미 존재하는 ${label}입니다.` }, { status: 409 })

    const statusCode = await prisma.statusCode.update({
      where: { id },
      data: { name: name.trim(), order },
    })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource,
      resourceId: id,
      resourceLabel: statusCode.name,
      before,
      after: statusCode,
    })

    return NextResponse.json({ statusCode })
  }

  async function DELETE(request: NextRequest, { params }: Params) {
    const user = await getAuthUser(request)
    if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const id = parseInt(params.id)
    if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

    const sc = await prisma.statusCode.findUnique({ where: { id } })
    if (!sc || sc.category !== category) {
      return NextResponse.json({ error: `${label}을(를) 찾을 수 없습니다.` }, { status: 404 })
    }

    // 시스템 유형(회수·폐기·불량 — 재고 로직이 걸린 유형)은 삭제 불가
    if (sc.value) {
      return NextResponse.json({ error: `'${sc.name}'은(는) 시스템 동작이 연결된 유형이라 삭제할 수 없습니다.` }, { status: 409 })
    }

    const txCnt = await prisma.inventoryTransaction.count({ where: { reasonId: id } })
    if (txCnt > 0) {
      return NextResponse.json({ error: `이 유형을 사용하는 전표가 ${txCnt}건 있어 삭제할 수 없습니다.` }, { status: 409 })
    }

    await prisma.statusCode.delete({ where: { id } })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'DELETE',
      resource,
      resourceId: id,
      resourceLabel: sc.name,
      before: sc,
    })

    return NextResponse.json({ success: true })
  }

  return { GET, POST, PUT, DELETE }
}
