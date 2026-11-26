import { NextRequest, NextResponse } from 'next/server'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { ViewError, createView, listViews } from '@/lib/usage/views'
import { usageError, usageGate } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * 사용량 대시보드 — 저장된 보기 (projects/usage_dashboard_filter_design.md §4.3)
 * GET  내 보기 + 공유된 보기
 * POST 만들기 { name, isShared?, filters } — 사용량을 볼 수 있으면 누구나
 */
export async function GET(req: NextRequest) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  try {
    return NextResponse.json({ views: await listViews(gate.user) })
  } catch (e) {
    return usageError(e)
  }
}

export async function POST(req: NextRequest) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  const body = await req.json().catch(() => ({}))
  try {
    const view = await createView(gate.user, body)
    await logAudit({
      req,
      actor: auditActorFromJWT(gate.user),
      action: 'CREATE',
      resource: 'usage_dashboard_view',
      resourceId: view.id,
      resourceLabel: `사용량 보기 '${view.name}'${view.isShared ? ' (공유)' : ''}`,
      after: { name: view.name, isShared: view.isShared, filters: view.filters },
    })
    return NextResponse.json({ view }, { status: 201 })
  } catch (e) {
    if (e instanceof ViewError) return NextResponse.json({ error: e.message }, { status: e.status })
    return usageError(e)
  }
}
