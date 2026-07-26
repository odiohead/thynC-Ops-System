/**
 * 개인 알림 수신 설정 (1.1 P5 — §6.1·§6.4)
 *
 * GET : 내 설정 (행이 없는 kind는 코드 기본값으로 채워 반환)
 * PUT : `{ prefs: [{ kind, inApp, slackDm }] }` — upsert
 *
 * 본인 설정만 다룬다(관리자가 타인 설정을 바꾸지 않는다 — 개인 수신 여부는 본인 소관).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { NOTIFY_KINDS, NOTIFY_KIND_DEFAULTS, NOTIFY_KIND_LABELS, type NotifyKind } from '@/lib/notify-center'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.notificationPref.findMany({ where: { userId: user.userId } })
  const byKind = new Map(rows.map((r) => [r.kind, r]))

  return NextResponse.json({
    prefs: NOTIFY_KINDS.map((kind) => {
      const row = byKind.get(kind)
      const def = NOTIFY_KIND_DEFAULTS[kind]
      return {
        kind,
        label: NOTIFY_KIND_LABELS[kind],
        inApp: row?.inApp ?? def.inApp,
        slackDm: row?.slackDm ?? def.slackDm,
        isDefault: !row,
      }
    }),
  })
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const prefs: { kind: string; inApp?: boolean; slackDm?: boolean }[] = Array.isArray(body.prefs) ? body.prefs : []

  for (const p of prefs) {
    if (!(NOTIFY_KINDS as readonly string[]).includes(p.kind)) continue
    const def = NOTIFY_KIND_DEFAULTS[p.kind as NotifyKind]
    await prisma.notificationPref.upsert({
      where: { userId_kind: { userId: user.userId, kind: p.kind } },
      create: {
        userId: user.userId,
        kind: p.kind,
        inApp: p.inApp ?? def.inApp,
        slackDm: p.slackDm ?? def.slackDm,
      },
      update: {
        ...(typeof p.inApp === 'boolean' ? { inApp: p.inApp } : {}),
        ...(typeof p.slackDm === 'boolean' ? { slackDm: p.slackDm } : {}),
      },
    })
  }

  return NextResponse.json({ ok: true, saved: prefs.length })
}
