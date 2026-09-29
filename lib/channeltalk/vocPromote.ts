/**
 * 채널톡 상담 → VOC 승격 (2026-09-28, projects/voc_channeltalk_promotion_design.md — 사용자 확정 기준)
 *
 * 승격 기준(전부 결정적):
 *  ① 트리거 = 분류 태그(a~h_ 접두) 존재 — 팀 태그(팀/…)는 조건 아님(보류)
 *  ② 고객 텍스트 발화 1건 이상, 담당자 발신 상담(발송안내 등) 아님, 수동 제외 아님
 *  ③ 컷오버: 고객 첫 발화가 AppSetting channeltalk_voc_cutover(KST 일자) 이후 — 과거 상담은 소급하지 않음(수동 승격만)
 *  ④ 단위: 같은 고객(user_id)의 미종결 VOC가 14일 내 있으면 새로 만들지 않고 그 VOC에 상담 추가(AUTO_FOLLOWUP)
 *  ⑤ 시점: 태그가 걸린 틱에 생성. receivedAt = 고객 첫 발화 시각(SLA 왜곡 방지). 제목 = 첫 발화 1줄
 *  ⑥ 분류 = 상담 tags 중 첫 분류 태그 ↔ status_codes(VOC_TYPE).value / 채널 '채널톡' / 담당 = assignee 매니저 이메일 ↔ users
 *  ⑦ 종결: 상담 closed → VOC '회신완료'(하위 티켓 미종결이면 유지) / 재오픈 → '처리중'
 * 늦게 걸린 태그는 vocSync의 종료 상담 전량 재검사(기본 24h)로 수집.
 */
import { prisma } from '@/lib/prisma'
import { createVocReceipt } from '@/lib/vocService'
import { syncVocToTicket } from '@/lib/ticket-domains/voc'
import { notifyTicketCreated } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'
import { channeltalkDeskChatUrl, CHANNELTALK_BOT_EMAIL, CHANNELTALK_VOC_CUTOVER_KEY, CHANNELTALK_VOC_PROMOTE_KEY, isCategoryTag, VOC_SKIP_LABEL, type VocSkipReason } from './shared'
export { VOC_SKIP_LABEL, type VocSkipReason }

const FOLLOWUP_DAYS = 14


interface ChatForEval {
  id: string; tags: string[]; firstUserMessageAt: Date | null; managerInitiated: boolean; vocExcludedAt: Date | null
  vocLink: { vocId: number } | null
}

/** 자동 승격 대상 판정 — null이면 대상 */
export function evaluateChat(c: ChatForEval, cutover: Date | null): VocSkipReason | null {
  if (c.vocLink) return 'LINKED'
  if (c.vocExcludedAt) return 'EXCLUDED'
  if (!c.firstUserMessageAt) return 'NO_USER_TEXT'
  if (c.managerInitiated) return 'MANAGER_INITIATED'
  if (!c.tags.some(isCategoryTag)) return 'NO_TAG'
  if (cutover && c.firstUserMessageAt < cutover) return 'BEFORE_CUTOVER'
  return null
}

export async function readCutover(): Promise<Date | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: CHANNELTALK_VOC_CUTOVER_KEY } })
  if (!row?.value) return null
  const d = new Date(`${row.value}T00:00:00+09:00`)
  return isNaN(d.getTime()) ? null : d
}
export async function readPromoteOn(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: CHANNELTALK_VOC_PROMOTE_KEY } })
  return (row?.value ?? 'off') === 'on'
}

async function botUserId(): Promise<string> {
  const u = await prisma.user.findUnique({ where: { email: CHANNELTALK_BOT_EMAIL }, select: { id: true } })
  if (!u) throw new Error(`채널톡 봇 계정(${CHANNELTALK_BOT_EMAIL})이 없습니다 — scripts/setup-channeltalk-as.mts`)
  return u.id
}

/** 상담의 첫 분류 태그 → VOC_TYPE id (status_codes.value = 태그명) */
async function vocTypeIdFromTags(tags: string[]): Promise<number | null> {
  const first = tags.find(isCategoryTag)
  if (!first) return null
  const row = await prisma.statusCode.findFirst({ where: { category: 'VOC_TYPE', value: first }, select: { id: true } })
  return row?.id ?? null
}
async function channeltalkChannelId(): Promise<number | null> {
  return (await prisma.statusCode.findFirst({ where: { category: 'VOC_CHANNEL', name: '채널톡' }, select: { id: true } }))?.id ?? null
}
/** 채널톡 assignee → 시스템 사용자 (매니저 이메일 = users.email, 활성) */
async function ownerFromAssignee(assigneeId: string | null): Promise<string | null> {
  if (!assigneeId) return null
  const m = await prisma.channeltalkManager.findUnique({ where: { id: assigneeId }, select: { email: true } })
  if (!m?.email) return null
  const u = await prisma.user.findFirst({ where: { email: { equals: m.email, mode: 'insensitive' }, isActive: true }, select: { id: true } })
  return u?.id ?? null
}
const oneLine = (s: string, max = 100) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t }

const CHAT_SELECT = {
  id: true, channelId: true, userId: true, state: true, assigneeId: true, tags: true, firstAskText: true, firstUserMessageAt: true, managerInitiated: true,
  vocExcludedAt: true, hospitalCode: true, vocLink: { select: { vocId: true } },
  user: { select: { name: true, mobileNumber: true, landlineNumber: true, hospitalNameRaw: true } },
} as const

/** 같은 고객의 미종결 VOC (14일 내 접수) — 있으면 후속 상담으로 연결 */
async function findOpenVocForCustomer(userId: string | null, since: Date): Promise<number | null> {
  if (!userId) return null
  const row = await prisma.vocChanneltalkChat.findFirst({
    where: {
      chat: { userId },
      voc: { receivedAt: { gte: since }, OR: [{ status: null }, { status: { ticketStatus: { notIn: ['RESOLVED', 'CLOSED'] } } }] },
    },
    orderBy: { voc: { receivedAt: 'desc' } },
    select: { vocId: true },
  })
  return row?.vocId ?? null
}

export interface PromoteResult { created: number; followups: number; resolved: number; reopened: number; errors: string[] }

/**
 * 상담 1건 승격 (자동·수동 공용). 수동(actorId 지정)은 컷오버·태그 조건을 건너뛴다(사용자 판단).
 * 반환: 생성/연결된 vocId
 */
export async function promoteChat(chatId: string, opts: { actorId?: string; manual?: boolean } = {}): Promise<{ vocId: number; vocCode: string; reason: 'AUTO_TAG' | 'AUTO_FOLLOWUP' | 'MANUAL' }> {
  const c = await prisma.channeltalkUserChat.findUnique({ where: { id: chatId }, select: CHAT_SELECT })
  if (!c) throw new Error('상담을 찾을 수 없습니다')
  if (c.vocLink) throw new Error('이미 VOC에 연결된 상담입니다')
  if (!opts.manual) {
    const skip = evaluateChat(c, await readCutover())
    if (skip) throw new Error(`승격 대상 아님: ${VOC_SKIP_LABEL[skip]}`)
  }
  const actorId = opts.actorId ?? (await botUserId())
  const receivedAt = c.firstUserMessageAt ?? new Date()

  // ④ 같은 고객 미종결 VOC → 후속 연결
  const openVoc = opts.manual ? null : await findOpenVocForCustomer(c.userId, new Date(receivedAt.getTime() - FOLLOWUP_DAYS * 86400_000))
  if (openVoc) {
    await prisma.vocChanneltalkChat.create({ data: { vocId: openVoc, chatId: c.id, linkReason: 'AUTO_FOLLOWUP', linkedById: null } })
    const v = await prisma.vocReceipt.findUnique({ where: { id: openVoc }, select: { vocCode: true } })
    return { vocId: openVoc, vocCode: v!.vocCode, reason: 'AUTO_FOLLOWUP' }
  }

  const [vocTypeId, channelId, ownerId, userTexts] = await Promise.all([
    vocTypeIdFromTags(c.tags), channeltalkChannelId(), ownerFromAssignee(c.assigneeId),
    prisma.channeltalkMessage.findMany({ where: { chatId: c.id, personType: 'user', plainText: { not: null } }, orderBy: { createdAtCt: 'asc' }, take: 5, select: { plainText: true } }),
  ])
  const texts = userTexts.map((m) => m.plainText!.trim()).filter(Boolean)
  // 제목: 인사말만인 발화("안녕하세요", "As")는 건너뛰고 첫 의미 있는 고객 메시지(8자 이상), 없으면 첫 발화
  const titleSource = texts.find((t) => t.replace(/[\s!?.~,]/g, '').length >= 8 && !/^(안녕하세요|안녕하십니까|수고하세요)[^가-힣a-z0-9]*$/i.test(t)) ?? texts[0] ?? c.firstAskText ?? '(채널톡 상담)'
  const deskUrl = channeltalkDeskChatUrl(c.channelId, c.id)
  const created = await createVocReceipt({
    title: oneLine(titleSource),
    hospitalCode: c.hospitalCode,
    hospitalNameRaw: c.hospitalCode ? null : c.user?.hospitalNameRaw ?? null,
    customerName: c.user?.name ?? null,
    customerPhone: c.user?.mobileNumber ?? c.user?.landlineNumber ?? null,
    channelId, vocTypeId,
    content: `${texts.join('\n') || c.firstAskText || ''}\n\n[채널톡 상담] ${deskUrl}`.trim(),
    receivedAt,
    source: 'CHANNELTALK',
    autoCreated: !opts.manual,
    ownerId,
  }, actorId)
  await prisma.vocChanneltalkChat.create({ data: { vocId: created.id, chatId: c.id, linkReason: opts.manual ? 'MANUAL' : 'AUTO_TAG', linkedById: opts.manual ? actorId : null } })
  // 상담이 이미 종료돼 있으면(늦은 태그) 즉시 회신완료 판정
  if (c.state === 'closed') await syncVocStatusFromChat(created.id, actorId)
  syncTicketClocksSafe(created.ticketId)
  notifyTicketCreated({ ticketId: created.ticketId, actorName: '채널톡 접수봇', actorId }).catch(() => {})
  return { vocId: created.id, vocCode: created.vocCode, reason: opts.manual ? 'MANUAL' : 'AUTO_TAG' }
}

/**
 * ⑦ 상담 상태 → VOC 상태: 연결된 상담이 전부 closed면 '회신완료'(하위 티켓 미종결이면 유지), 하나라도 열려 있고 VOC가 회신완료면 '처리중'
 * 사람이 보류·종결로 바꾼 VOC는 건드리지 않는다.
 */
export async function syncVocStatusFromChat(vocId: number, actorId: string | null): Promise<'resolved' | 'reopened' | null> {
  const v = await prisma.vocReceipt.findUnique({
    where: { id: vocId },
    select: { id: true, ticketId: true, resolvedAt: true, status: { select: { id: true, name: true, ticketStatus: true } }, channeltalkChats: { select: { chat: { select: { state: true } } } } },
  })
  if (!v || !v.channeltalkChats.length) return null
  const allClosed = v.channeltalkChats.every((l) => l.chat.state === 'closed')
  const cur = v.status?.ticketStatus ?? null
  if (allClosed && (cur === 'OPEN' || cur === 'IN_PROGRESS' || cur === null)) {
    if (v.ticketId) {
      const openChildren = await prisma.ticket.count({ where: { parentId: v.ticketId, status: { notIn: ['RESOLVED', 'CLOSED'] } } })
      if (openChildren > 0) return null
    }
    const resolved = await prisma.statusCode.findFirst({ where: { category: 'VOC_STATUS', ticketStatus: 'RESOLVED' }, orderBy: { order: 'asc' }, select: { id: true } })
    if (!resolved) return null
    await prisma.$transaction(async (tx) => {
      await tx.vocReceipt.update({ where: { id: v.id }, data: { statusId: resolved.id, statusChangedAt: new Date(), resolvedAt: v.resolvedAt ?? new Date() } })
      await syncVocToTicket(tx, v.id, actorId)
    })
    return 'resolved'
  }
  if (!allClosed && cur === 'RESOLVED') {
    const inProgress = await prisma.statusCode.findFirst({ where: { category: 'VOC_STATUS', ticketStatus: 'IN_PROGRESS' }, orderBy: { order: 'asc' }, select: { id: true } })
    if (!inProgress) return null
    await prisma.$transaction(async (tx) => {
      await tx.vocReceipt.update({ where: { id: v.id }, data: { statusId: inProgress.id, statusChangedAt: new Date(), resolvedAt: null } })
      await syncVocToTicket(tx, v.id, actorId)
    })
    return 'reopened'
  }
  return null
}

/** 틱 후처리 — 변경된 상담 id 집합에 대해 승격·상태 동기화 */
export async function promoteChanneltalkVocs(changedChatIds: string[], log: (l: string) => void): Promise<PromoteResult> {
  const r: PromoteResult = { created: 0, followups: 0, resolved: 0, reopened: 0, errors: [] }
  if (!(await readPromoteOn())) return r
  const cutover = await readCutover()
  const categoryTags = (await prisma.statusCode.findMany({ where: { category: 'VOC_TYPE', value: { not: null } }, select: { value: true } })).map((r) => r.value!)
  const chats = await prisma.channeltalkUserChat.findMany({
    where: {
      OR: [
        { id: { in: changedChatIds } },
        // 변경이 없어도 아직 승격 안 된 대상 (설정 변경·자동 승격 ON 직후 누락 방지 — DB 조회만, API 호출 없음)
        { vocLink: { is: null }, vocExcludedAt: null, managerInitiated: false, tags: { hasSome: categoryTags }, firstUserMessageAt: cutover ? { gte: cutover } : { not: null } },
      ],
    },
    select: CHAT_SELECT,
  })
  const actorId = await botUserId()
  for (const c of chats) {
    try {
      if (c.vocLink) {
        const s = await syncVocStatusFromChat(c.vocLink.vocId, actorId)
        if (s === 'resolved') r.resolved++; else if (s === 'reopened') r.reopened++
        continue
      }
      if (evaluateChat(c, cutover)) continue
      const p = await promoteChat(c.id, { actorId })
      if (p.reason === 'AUTO_FOLLOWUP') r.followups++; else r.created++
      log(`VOC ${p.reason === 'AUTO_FOLLOWUP' ? '후속 연결' : '생성'} ${p.vocCode} ← 상담 ${c.id}`)
    } catch (e) {
      const msg = `상담 ${c.id}: ${e instanceof Error ? e.message : String(e)}`
      r.errors.push(msg); log(`승격 실패 — ${msg}`)
    }
  }
  return r
}
