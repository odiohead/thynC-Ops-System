/**
 * AS 등록대기 큐 목록 (as_channeltalk_intake_design.md §5) — 로그인 사용자
 * GET ?state=PENDING|LINKED|IGNORED (기본 PENDING) &failClass= &countOnly=1
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import type { AsExtract } from '@/lib/channeltalk/asIntakeShared'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const state = ['PENDING', 'LINKED', 'IGNORED'].includes(sp.get('state') ?? '') ? sp.get('state')! : 'PENDING'
  if (sp.get('countOnly')) return NextResponse.json({ pending: await prisma.asIntakeLink.count({ where: { state: 'PENDING' } }) })
  const failClass = sp.get('failClass') || undefined
  const links = await prisma.asIntakeLink.findMany({
    where: { state, ...(failClass ? { failClass } : {}) },
    orderBy: { createdAt: state === 'PENDING' ? 'asc' : 'desc' },
    take: 300,
    select: {
      id: true, chatId: true, state: true, failClass: true, failNote: true, extracted: true, extractLayer: true, createdAt: true, decidedAt: true, ignoreReason: true,
      receipt: { select: { id: true, asCode: true } },
      decidedBy: { select: { name: true } },
      chat: { select: { name: true, state: true, tags: true, createdAtCt: true, firstUserMessageAt: true, hospital: { select: { hospitalName: true } }, assigneeId: true, vocLink: { select: { voc: { select: { id: true, vocCode: true } } } } } },
    },
  })
  const codes = Array.from(new Set(links.map((l) => (l.extracted as AsExtract | null)?.hospitalCode).filter((c): c is string => !!c)))
  const hospitals = codes.length ? await prisma.hospital.findMany({ where: { hospitalCode: { in: codes } }, select: { hospitalCode: true, hospitalName: true } }) : []
  const nameOf = new Map(hospitals.map((h) => [h.hospitalCode, h.hospitalName]))
  const managers = await prisma.channeltalkManager.findMany({ select: { id: true, name: true } })
  const managerName = new Map(managers.map((m) => [m.id, m.name ?? m.id]))
  const failCounts = state === 'PENDING' ? await prisma.asIntakeLink.groupBy({ by: ['failClass'], where: { state: 'PENDING' }, _count: { _all: true } }) : []
  return NextResponse.json({
    links: links.map((l) => {
      const e = l.extracted as AsExtract | null
      return {
        id: l.id, chatId: l.chatId, state: l.state, failClass: l.failClass, failNote: l.failNote, extractLayer: l.extractLayer, createdAt: l.createdAt, decidedAt: l.decidedAt, ignoreReason: l.ignoreReason,
        receipt: l.receipt, decidedBy: l.decidedBy?.name ?? null,
        chat: { name: l.chat.name, state: l.chat.state, tags: l.chat.tags.filter((t) => t.startsWith('f_')), at: l.chat.firstUserMessageAt ?? l.chat.createdAtCt, assignee: l.chat.assigneeId ? managerName.get(l.chat.assigneeId) ?? null : null, voc: l.chat.vocLink?.voc ?? null },
        hospitalCode: e?.hospitalCode ?? null, hospitalName: e?.hospitalCode ? nameOf.get(e.hospitalCode) ?? null : l.chat.hospital?.hospitalName ?? null, hospitalNameRaw: e?.hospitalNameRaw ?? null,
        category: e?.category ?? null, serialCount: e?.lines.length ?? 0, receiptDate: e?.receiptDate ?? null,
      }
    }),
    failCounts: Object.fromEntries(failCounts.map((f) => [f.failClass ?? 'NONE', f._count._all])),
  })
}
