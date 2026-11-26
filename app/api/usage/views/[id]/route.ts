import { NextRequest, NextResponse } from 'next/server'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { ViewError, deleteView, updateView } from '@/lib/usage/views'
import { usageError, usageGate } from '../../_shared'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 저장된 보기 하나 — 만든 사람 또는 ADMIN 이상만
 * PATCH  { name?, isShared?, filters? }
 * DELETE
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: '잘못된 번호입니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  try {
    const { before, after } = await updateView(id, gate.user, body)
    await logAudit({
      req,
      actor: auditActorFromJWT(gate.user),
      action: 'UPDATE',
      resource: 'usage_dashboard_view',
      resourceId: id,
      resourceLabel: `사용량 보기 '${after.name}'${after.isShared ? ' (공유)' : ''}`,
      before: { name: before.name, isShared: before.isShared, filters: before.filters },
      after: { name: after.name, isShared: after.isShared, filters: after.filters },
    })
    return NextResponse.json({ view: after })
  } catch (e) {
    if (e instanceof ViewError) return NextResponse.json({ error: e.message }, { status: e.status })
    return usageError(e)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: '잘못된 번호입니다.' }, { status: 400 })
  try {
    const view = await deleteView(id, gate.user)
    await logAudit({
      req,
      actor: auditActorFromJWT(gate.user),
      action: 'DELETE',
      resource: 'usage_dashboard_view',
      resourceId: id,
      resourceLabel: `사용량 보기 '${view.name}'${view.isShared ? ' (공유)' : ''}`,
      before: { name: view.name, isShared: view.isShared, ownerName: view.ownerName, filters: view.filters },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    if (e instanceof ViewError) return NextResponse.json({ error: e.message }, { status: e.status })
    return usageError(e)
  }
}
