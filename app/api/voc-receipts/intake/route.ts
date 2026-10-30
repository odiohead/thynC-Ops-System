/**
 * VOC 등록대기 큐 목록 (projects/voc_sheet_import_design.md §4) — 로그인 사용자
 * GET ?state=PENDING|REGISTERED|IGNORED (기본 PENDING) &failClass= &source= &countOnly=1
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { VOC_INTAKE_STATES, type VocIntakeDraft } from '@/lib/vocIntakeShared'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  if (sp.get('countOnly')) return NextResponse.json({ pending: await prisma.vocIntakeItem.count({ where: { state: 'PENDING' } }) })
  const state = (VOC_INTAKE_STATES as readonly string[]).includes(sp.get('state') ?? '') ? sp.get('state')! : 'PENDING'
  const failClass = sp.get('failClass') || undefined
  const source = sp.get('source') || undefined
  const items = await prisma.vocIntakeItem.findMany({
    where: { state, ...(failClass ? { failClass } : {}), ...(source ? { source } : {}) },
    orderBy: state === 'PENDING' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ decidedAt: 'desc' }],
    take: 500,
    select: {
      id: true, source: true, chatId: true, sourceRef: true, state: true, failClass: true, failNote: true, draft: true, createdAt: true, decidedAt: true, ignoreReason: true,
      voc: { select: { id: true, vocCode: true } },
      decidedBy: { select: { name: true } },
      chat: { select: { name: true, state: true, tags: true, hospital: { select: { hospitalName: true } } } },
    },
  })
  const codes = Array.from(new Set(items.map((i) => (i.draft as VocIntakeDraft | null)?.hospitalCode).filter((c): c is string => !!c)))
  const hospitals = codes.length ? await prisma.hospital.findMany({ where: { hospitalCode: { in: codes } }, select: { hospitalCode: true, hospitalName: true } }) : []
  const nameOf = new Map(hospitals.map((h) => [h.hospitalCode, h.hospitalName]))
  const failCounts = state === 'PENDING' ? await prisma.vocIntakeItem.groupBy({ by: ['failClass'], where: { state: 'PENDING' }, _count: { _all: true } }) : []
  const sourceCounts = state === 'PENDING' ? await prisma.vocIntakeItem.groupBy({ by: ['source'], where: { state: 'PENDING' }, _count: { _all: true } }) : []
  return NextResponse.json({
    items: items.map((i) => {
      const d = i.draft as VocIntakeDraft | null
      return {
        id: i.id, source: i.source, chatId: i.chatId, sourceRef: i.sourceRef, state: i.state, failClass: i.failClass, failNote: i.failNote, createdAt: i.createdAt, decidedAt: i.decidedAt, ignoreReason: i.ignoreReason,
        voc: i.voc, decidedBy: i.decidedBy?.name ?? null,
        receivedAt: d?.receivedAt ?? null, title: d?.title ?? null, tag: d?.tag ?? d?.tagRaw ?? null, statusName: d?.statusName ?? null, registrantName: d?.registrantName ?? null,
        hospitalCode: d?.hospitalCode ?? null, hospitalName: d?.hospitalCode ? nameOf.get(d.hospitalCode) ?? null : i.chat?.hospital?.hospitalName ?? null, hospitalNameRaw: d?.hospitalNameRaw ?? null,
        sheetRow: d?.sheet?.row ?? null,
        chat: i.chat ? { name: i.chat.name, state: i.chat.state, tags: i.chat.tags } : null,
      }
    }),
    failCounts: Object.fromEntries(failCounts.map((f) => [f.failClass ?? 'NONE', f._count._all])),
    sourceCounts: Object.fromEntries(sourceCounts.map((f) => [f.source, f._count._all])),
  })
}
