/**
 * AS 등록대기 큐 상세 (as_channeltalk_intake_design.md §5) — 연결 행 + 추출 결과 + 상담 원문 타임라인 + 매칭 병원명 + 동일 접수 후보
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { findExistingReceipt } from '@/lib/channeltalk/asIntake'
import { AS_INTAKE_FAIL_LABEL, type AsExtract } from '@/lib/channeltalk/asIntakeShared'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const link = await prisma.asIntakeLink.findUnique({
    where: { id },
    include: {
      receipt: { select: { id: true, asCode: true } },
      decidedBy: { select: { name: true } },
      aiRequestedBy: { select: { name: true } },
      chat: {
        select: {
          id: true, channelId: true, name: true, state: true, tags: true, createdAtCt: true, firstUserMessageAt: true, assigneeId: true, hospitalCode: true, hospitalMatchSource: true,
          hospital: { select: { hospitalCode: true, hospitalName: true } },
          user: { select: { name: true, mobileNumber: true, landlineNumber: true, opsCode: true, hospitalNameRaw: true, ward: true } },
          vocLink: { select: { voc: { select: { id: true, vocCode: true, title: true } } } },
          messages: { orderBy: { createdAtCt: 'asc' }, select: { id: true, personType: true, personId: true, plainText: true, hasFiles: true, fileMeta: true, createdAtCt: true } },
        },
      },
    },
  })
  if (!link) return NextResponse.json({ error: '등록대기 항목을 찾을 수 없습니다.' }, { status: 404 })
  const e = link.extracted as AsExtract | null
  const [hospital, managers, existing] = await Promise.all([
    e?.hospitalCode ? prisma.hospital.findUnique({ where: { hospitalCode: e.hospitalCode }, select: { hospitalCode: true, hospitalName: true } }) : null,
    prisma.channeltalkManager.findMany({ select: { id: true, name: true } }),
    e?.hospitalCode && e.lines.length ? findExistingReceipt(e.hospitalCode, e.receiptDate, e.lines.map((l) => l.serial)) : null,
  ])
  const { messages, ...chat } = link.chat
  return NextResponse.json({
    link: { id: link.id, chatId: link.chatId, state: link.state, failClass: link.failClass, failLabel: link.failClass ? AS_INTAKE_FAIL_LABEL[link.failClass] ?? link.failClass : null, failNote: link.failNote, extractLayer: link.extractLayer, createdAt: link.createdAt, decidedAt: link.decidedAt, decidedBy: link.decidedBy?.name ?? null, ignoreReason: link.ignoreReason, aiRequestedAt: link.aiRequestedAt, aiRequestedBy: link.aiRequestedBy?.name ?? null, receipt: link.receipt, changeDiff: link.changeDiff },
    extracted: e,
    hospital,
    existing: existing ? { id: existing.id, asCode: existing.asCode } : null,
    chat: { ...chat, assigneeName: chat.assigneeId ? managers.find((m) => m.id === chat.assigneeId)?.name ?? null : null },
    messages,
    managerNames: Object.fromEntries(managers.map((m) => [m.id, m.name ?? m.id])),
  })
}
