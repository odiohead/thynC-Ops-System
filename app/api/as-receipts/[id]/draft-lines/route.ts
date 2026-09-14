import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { draftAsLines, AsServiceError } from '@/lib/asReceiptService'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 라인 처리방법 초안 저장 (2026-09-14) — 최종확정 전까지 변경 가능, 기기현황·티켓·시트에 영향 없음
 * POST { lines: [{ itemId, outcome: 'REPAIR_RETURN'|'REPLACE'|'LOST'|'CANCELED'|null, newSerial? }] } — null = 초안 해제
 * 권한: USER 이상 전원 (라인 처리와 동일)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()
  try {
    const r = await draftAsLines(id, {
      lines: Array.isArray(body.lines)
        ? (body.lines as Record<string, unknown>[]).map((l) => ({
            itemId: Number(l.itemId),
            outcome: (l.outcome ?? null) as never,
            newSerial: typeof l.newSerial === 'string' ? l.newSerial : null,
          }))
        : [],
    })
    return NextResponse.json({ success: true, updated: r.updated })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
}
