/**
 * VOC 접수 생성 서비스 (2026-09-28) — POST /api/voc-receipts 와 채널톡 자동 승격(lib/channeltalk/vocPromote.ts)이 공용
 * VOC 레코드 + CS 마스터 티켓을 한 트랜잭션으로 생성(티켓 없는 VOC를 만들지 않음). 코드 발번 UNIQUE 충돌(P2002)은 1회 재시도.
 * 담당 배정은 티켓 단독 소유 — ownerId가 주어지면 티켓 생성 직후 같은 tx에서 배정(OPEN→ASSIGNED, assign 이벤트).
 * Slack 알림·SLA 시계는 호출부 책임(규칙 1 — notifyTicketCreated 단일 소스).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextVocCode } from '@/lib/csCodes'
import { createTicketForVoc } from '@/lib/ticket-domains/voc'
import { addTicketEvent } from '@/lib/ticket'

export interface CreateVocInput {
  title: string
  hospitalCode?: string | null
  hospitalNameRaw?: string | null
  customerName?: string | null
  customerPhone?: string | null
  channelId?: number | null
  vocTypeId?: number | null
  statusId?: number | null // 없으면 '접수'
  content?: string | null
  receivedAt?: Date | null
  source?: 'MANUAL' | 'CHANNELTALK'
  autoCreated?: boolean
  /** 티켓 담당자 (활성 사용자 id) — 채널톡 assignee 매핑 */
  ownerId?: string | null
}

export async function createVocReceipt(input: CreateVocInput, actorId: string): Promise<{ id: number; vocCode: string; ticketId: number }> {
  let statusId = input.statusId ?? null
  if (!statusId) {
    const accept = await prisma.statusCode.findFirst({ where: { category: 'VOC_STATUS', name: '접수' }, select: { id: true } })
    statusId = accept?.id ?? null
  }
  const statusRow = statusId ? await prisma.statusCode.findUnique({ where: { id: statusId }, select: { name: true } }) : null
  const ownerId = input.ownerId
    ? (await prisma.user.findUnique({ where: { id: input.ownerId }, select: { id: true, isActive: true } }))?.isActive ? input.ownerId : null
    : null

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const voc = await tx.vocReceipt.create({
          data: {
            vocCode: await nextVocCode(tx),
            title: input.title,
            hospitalCode: input.hospitalCode ?? null,
            hospitalNameRaw: input.hospitalCode ? null : input.hospitalNameRaw ?? null,
            customerName: input.customerName ?? null,
            customerPhone: input.customerPhone ?? null,
            channelId: input.channelId ?? null,
            vocTypeId: input.vocTypeId ?? null,
            statusId,
            content: input.content ?? null,
            receivedAt: input.receivedAt ?? undefined,
            createdById: actorId,
            source: input.source ?? 'MANUAL',
            autoCreated: input.autoCreated ?? false,
          },
        })
        const ticketId = await createTicketForVoc(tx, {
          id: voc.id, vocCode: voc.vocCode, title: voc.title, hospitalCode: voc.hospitalCode, hospitalName: null,
          statusName: statusRow?.name ?? null, statusId: voc.statusId, vocTypeId: voc.vocTypeId, content: voc.content,
          receivedAt: voc.receivedAt, resolvedAt: null, createdAt: voc.createdAt,
        }, actorId, 'domain')
        if (ownerId) {
          const t = await tx.ticket.findUnique({ where: { id: ticketId }, select: { status: true } })
          const next = t?.status === 'OPEN' ? 'ASSIGNED' : undefined
          await tx.ticket.update({ where: { id: ticketId }, data: { ownerId, ...(next ? { status: next, statusChangedAt: new Date() } : {}) } })
          await addTicketEvent(tx, ticketId, 'assign', actorId, { from: null, to: ownerId, via: 'channeltalk' })
          if (next) await addTicketEvent(tx, ticketId, 'status_change', actorId, { from: 'OPEN', to: next, auto: true })
        }
        return { id: voc.id, vocCode: voc.vocCode, ticketId }
      })
    } catch (err) {
      if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
}
