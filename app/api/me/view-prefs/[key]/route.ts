/**
 * 사용자별 화면 설정 (2026-10-01) — GET/PUT/DELETE /api/me/view-prefs/[key] (로그인 본인 전용)
 * body { prefs: object } ≤ 16KB. 뷰 키는 영문·숫자·_·- 60자. 첫 사용처 'as_receipts_list'(열 선택·순서·폭)
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'
type Params = { params: { key: string } }
const KEY_RE = /^[a-zA-Z0-9_-]{1,60}$/

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!KEY_RE.test(params.key)) return NextResponse.json({ error: '잘못된 키' }, { status: 400 })
  const row = await prisma.userViewPref.findUnique({ where: { userId_viewKey: { userId: user.userId, viewKey: params.key } } })
  return NextResponse.json({ prefs: row?.prefs ?? null, updatedAt: row?.updatedAt ?? null })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!KEY_RE.test(params.key)) return NextResponse.json({ error: '잘못된 키' }, { status: 400 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body.prefs !== 'object' || body.prefs === null || Array.isArray(body.prefs)) return NextResponse.json({ error: 'prefs는 객체여야 합니다.' }, { status: 400 })
  if (JSON.stringify(body.prefs).length > 16_384) return NextResponse.json({ error: '설정이 너무 큽니다(16KB 상한).' }, { status: 400 })
  const prefs = body.prefs as Prisma.InputJsonValue
  const row = await prisma.userViewPref.upsert({
    where: { userId_viewKey: { userId: user.userId, viewKey: params.key } },
    create: { userId: user.userId, viewKey: params.key, prefs },
    update: { prefs },
  })
  return NextResponse.json({ prefs: row.prefs, updatedAt: row.updatedAt })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!KEY_RE.test(params.key)) return NextResponse.json({ error: '잘못된 키' }, { status: 400 })
  await prisma.userViewPref.deleteMany({ where: { userId: user.userId, viewKey: params.key } })
  return NextResponse.json({ ok: true })
}
