/**
 * VOC 과거 이력·등록대기 → VOC 생성 공용 (projects/voc_sheet_import_design.md)
 * - createVocReceipt(VOC+CS 마스터 티켓 단일 tx) 위에 과거 이력용 보정: 티켓 created_at = 접수시각, 종결이면 티켓 CLOSED·closed_at = 완료시각
 *   (scripts/fix-voc-retro-promotion.mts 와 같은 방식 — 자동 종결 배치 미경유)
 * - 채널톡 상담 연결(voc_channeltalk_chats) 옵션
 * Slack 알림·SLA 시계는 호출부 책임.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createVocReceipt } from '@/lib/vocService'
import { addTicketEvent } from '@/lib/ticket'
import { syncVocTypesFromChats } from '@/lib/channeltalk/vocPromote'

export interface VocImportInput {
  title: string
  hospitalCode: string | null
  hospitalNameRaw: string | null
  content: string | null
  resolution: string | null // HTML (Tiptap 호환 — 평문은 <p> 래핑)
  channelId: number | null
  vocTypeId: number | null
  statusId: number | null // VOC_STATUS id (없으면 '접수')
  receivedAt: Date
  resolvedAt: Date | null // 완료 시각 — 종결/회신완료 티켓의 closed_at·resolved_at
  source: 'MANUAL' | 'CHANNELTALK' | 'SHEET'
  sourceRef: string | null
  vocCode?: string | null
  /** 연결할 채널톡 상담 (이미 다른 VOC에 연결돼 있으면 생략) */
  chatId?: string | null
  linkReason?: string
  linkedById?: string | null
}

export interface VocImportResult { id: number; vocCode: string; ticketId: number; ticketStatus: string; chatLinked: boolean }

/** 평문 → Tiptap 호환 HTML (줄바꿈은 <br>) */
export function plainToHtml(text: string | null | undefined): string | null {
  const t = (text ?? '').trim()
  if (!t) return null
  const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<p>${esc.replace(/\r?\n/g, '<br>')}</p>`
}

const toDateOnly = (d: Date) => new Date(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }))

export async function createVocFromImport(input: VocImportInput, actorId: string): Promise<VocImportResult> {
  const closedLike = input.statusId
    ? await prisma.statusCode.findFirst({ where: { id: input.statusId, category: 'VOC_STATUS' }, select: { ticketStatus: true } })
    : null
  const isDone = closedLike?.ticketStatus === 'CLOSED' || closedLike?.ticketStatus === 'RESOLVED'
  const doneAt = isDone ? input.resolvedAt ?? input.receivedAt : null

  const created = await createVocReceipt({
    title: input.title,
    hospitalCode: input.hospitalCode,
    hospitalNameRaw: input.hospitalCode ? null : input.hospitalNameRaw,
    channelId: input.channelId,
    vocTypeId: input.vocTypeId,
    statusId: input.statusId,
    content: input.content,
    receivedAt: input.receivedAt,
    source: input.source,
    autoCreated: false,
    sourceRef: input.sourceRef,
    vocCode: input.vocCode ?? null,
    resolvedAt: doneAt ? toDateOnly(doneAt) : null,
  }, actorId)

  let chatLinked = false
  await prisma.$transaction(async (tx) => {
    // 과거 이력 보정: 생성 시각이 아니라 접수·완료 시각으로
    await tx.vocReceipt.update({ where: { id: created.id }, data: { statusChangedAt: doneAt ?? input.receivedAt, resolution: input.resolution, createdAt: input.receivedAt } })
    const t = await tx.ticket.findUnique({ where: { id: created.ticketId }, select: { status: true } })
    const ticketData: Prisma.TicketUncheckedUpdateInput = { createdAt: input.receivedAt, statusChangedAt: doneAt ?? input.receivedAt }
    if (doneAt) {
      const target = closedLike!.ticketStatus === 'CLOSED' ? 'CLOSED' : 'RESOLVED'
      Object.assign(ticketData, { status: target, resolvedAt: doneAt, ...(target === 'CLOSED' ? { closedAt: doneAt } : {}), pendingReasonId: null, pendingNote: null })
      if (t && t.status !== target) await addTicketEvent(tx, created.ticketId, 'status_change', actorId, { from: t.status, to: target, via: 'import', at: doneAt.toISOString() })
    }
    await tx.ticket.update({ where: { id: created.ticketId }, data: ticketData })
    if (input.chatId) {
      const exists = await tx.vocChanneltalkChat.findUnique({ where: { chatId: input.chatId }, select: { id: true } })
      if (!exists) {
        await tx.vocChanneltalkChat.create({ data: { vocId: created.id, chatId: input.chatId, linkReason: input.linkReason ?? 'MANUAL', linkedById: input.linkedById ?? null } })
        chatLinked = true
      }
    }
  })
  if (chatLinked) await syncVocTypesFromChats(created.id).catch(() => 0) // 복수 분류 — 대표 분류는 유지
  const t = await prisma.ticket.findUnique({ where: { id: created.ticketId }, select: { status: true } })
  return { id: created.id, vocCode: created.vocCode, ticketId: created.ticketId, ticketStatus: t?.status ?? 'OPEN', chatLinked }
}

/** 접수 월 기준 VOC 코드 채번기 — 대량 적재용 (프리픽스별 다음 번호를 메모리에 유지, P2002 시 bump) */
export function createVocCodeAllocator() {
  const next = new Map<string, number>()
  return {
    async allocate(receivedAt: Date): Promise<string> {
      const prefix = `VOC-${receivedAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7).replace('-', '')}-`
      if (!next.has(prefix)) {
        const last = await prisma.vocReceipt.findFirst({ where: { vocCode: { startsWith: prefix } }, orderBy: { vocCode: 'desc' }, select: { vocCode: true } })
        next.set(prefix, last ? parseInt(last.vocCode.slice(prefix.length), 10) + 1 : 1)
      }
      const n = next.get(prefix)!
      next.set(prefix, n + 1)
      return `${prefix}${String(n).padStart(4, '0')}`
    },
    bump(code: string) { const prefix = code.slice(0, code.lastIndexOf('-') + 1); next.set(prefix, Math.max(next.get(prefix) ?? 0, parseInt(code.slice(prefix.length), 10) + 1)) },
  }
}

/** 시트 원본 메모 블록 — VOC 본문 끝에 붙여 보존 (검색 가능) */
export function sheetOriginBlock(s: { row: number; registrant: string | null; dept: string | null; checker: string | null; typeL: string | null; typeM: string | null; typeS: string | null; ward: string | null; repeat: string | null; phone: boolean; firstDone: string | null; firstDoneAt: string | null; allDone: string | null; allDoneAt: string | null; alf: string | null }): string {
  const j = (xs: (string | null | undefined)[], sep = ' > ') => xs.filter((x) => x && x.trim()).join(sep)
  const lines = [
    `[VOC현황 시트 r${s.row}] ${j([s.registrant ? `등록자 ${s.registrant}` : null, s.dept ? `담당부서 ${s.dept}` : null, s.checker ? `확인담당자 ${s.checker}` : null], ' · ')}`,
    j([j([s.typeL, s.typeM, s.typeS]) ? `문의유형 ${j([s.typeL, s.typeM, s.typeS])}` : null, s.ward ? `병동 ${s.ward}` : null, s.repeat ? `반복문의 ${s.repeat}` : null, s.phone ? '유선문의' : null], ' · '),
    j([s.firstDone ? `1차 대응 ${s.firstDone}${s.firstDoneAt ? ` ${s.firstDoneAt}` : ''}` : null, s.allDone ? `전체 ${s.allDone}${s.allDoneAt ? ` ${s.allDoneAt}` : ''}` : null, s.alf ? `ALF 관여 ${s.alf}` : null], ' · '),
  ].filter((l) => l.trim())
  return lines.join('\n')
}
