/**
 * VOC 등록대기 상세 (projects/voc_sheet_import_design.md §4) — 항목 + 초안 + (채널톡이면) 상담 원문 타임라인 / (시트면) 원본 열
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { VOC_INTAKE_FAIL_LABEL, type VocIntakeDraft } from '@/lib/vocIntakeShared'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const item = await prisma.vocIntakeItem.findUnique({
    where: { id },
    include: {
      voc: { select: { id: true, vocCode: true, title: true } },
      decidedBy: { select: { name: true } },
      chat: {
        select: {
          id: true, channelId: true, name: true, state: true, tags: true, createdAtCt: true, firstUserMessageAt: true, assigneeId: true, hospitalCode: true,
          hospital: { select: { hospitalCode: true, hospitalName: true } },
          user: { select: { name: true, mobileNumber: true, landlineNumber: true, opsCode: true, hospitalNameRaw: true, ward: true } },
          vocLink: { select: { voc: { select: { id: true, vocCode: true, title: true } } } },
          messages: { orderBy: { createdAtCt: 'asc' }, select: { id: true, personType: true, personId: true, plainText: true, hasFiles: true, fileMeta: true, createdAtCt: true } },
        },
      },
    },
  })
  if (!item) return NextResponse.json({ error: '등록대기 항목을 찾을 수 없습니다.' }, { status: 404 })
  const d = item.draft as VocIntakeDraft | null
  const [hospital, managers] = await Promise.all([
    d?.hospitalCode ? prisma.hospital.findUnique({ where: { hospitalCode: d.hospitalCode }, select: { hospitalCode: true, hospitalName: true } }) : null,
    item.chat ? prisma.channeltalkManager.findMany({ select: { id: true, name: true } }) : [],
  ])
  let chat: Omit<NonNullable<typeof item.chat>, 'messages'> | null = null
  if (item.chat) { const { messages: _messages, ...rest } = item.chat; void _messages; chat = rest }
  return NextResponse.json({
    item: { id: item.id, source: item.source, chatId: item.chatId, sourceRef: item.sourceRef, state: item.state, failClass: item.failClass, failLabel: item.failClass ? VOC_INTAKE_FAIL_LABEL[item.failClass] ?? item.failClass : null, failNote: item.failNote, createdAt: item.createdAt, decidedAt: item.decidedAt, decidedBy: item.decidedBy?.name ?? null, ignoreReason: item.ignoreReason, voc: item.voc },
    draft: d,
    hospital,
    chat: chat ? { ...chat, assigneeName: chat.assigneeId ? managers.find((m) => m.id === chat.assigneeId)?.name ?? null : null } : null,
    messages: item.chat?.messages ?? [],
    managerNames: Object.fromEntries(managers.map((m) => [m.id, m.name ?? m.id])),
  })
}
