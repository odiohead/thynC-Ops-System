/**
 * 채널톡 상담 → AS접수 인입 (projects/as_channeltalk_intake_design.md §4, 2026-10-27)
 *
 * vocSync 틱 후처리에서 intakeAsFromChats(changedChatIds) 호출.
 *  - 후보: AS 태그(f_AS_고장접수·f_AS_분실접수) ∧ as_intake_links 없음 ∧ 고객 첫 발화 ≥ 컷오버
 *  - L1: ALF 확정 확인문(alfParser) → AsExtract → 검증 통과면 createAsReceipt(기존 경로: 티켓·AS표시·알림·SLA, source CHANNELTALK, VOC 마스터 parentId)
 *  - 실패 → as_intake_links PENDING(+fail_class) = 등록대기 큐. 사람이 큐 상세에서 등록·제외
 *  - 연결(LINKED) 상담이 변경되면 재추출 → 접수 필드 diff를 change_diff에 기록만(반영은 사람 — 설계 §6)
 *  - 모드 off/dry/on (AppSetting channeltalk_as_intake). dry = 판정·추출 결과 로그만, 생성·큐 적재 없음(PROD 그림자)
 * 멱등성: chat_id UNIQUE + 동일 병원·접수일·시리얼 기존 접수 가드(ALREADY_EXISTS → 큐)
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { notifyTicketCreated } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'
import { AS_SERIAL_RE } from '@/lib/asReceiptShared'
import { createAsReceipt, AsServiceError, type LineInput } from '@/lib/asReceiptService'
import { isRegistryTxAbort } from '@/lib/deviceRegistry'
import { loadHospitalMatcher, type HospitalMatcher } from '@/lib/hospitalNameMatcher'
import { CHANNELTALK_BOT_EMAIL } from './shared'
import { isAlfConfirmation, isAlfCompletion, parseAlfConfirmation, resolveDest } from './alfParser'
import {
  AS_INTAKE_TAGS, AS_TAG_FAULT, AS_TAG_LOST, CHANNELTALK_AS_INTAKE_KEY, CHANNELTALK_AS_INTAKE_CUTOVER_KEY,
  type AsExtract, type AsIntakeMode, type AsIntakeDiffItem,
} from './asIntakeShared'

const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

export async function readAsIntakeMode(): Promise<AsIntakeMode> {
  const row = await prisma.appSetting.findUnique({ where: { key: CHANNELTALK_AS_INTAKE_KEY } })
  const v = row?.value ?? 'off'
  return v === 'on' || v === 'dry' ? v : 'off'
}
export async function readAsIntakeCutover(): Promise<Date | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: CHANNELTALK_AS_INTAKE_CUTOVER_KEY } })
  if (!row?.value) return null
  const d = new Date(`${row.value}T00:00:00+09:00`)
  return isNaN(d.getTime()) ? null : d
}

const CHAT_SELECT = {
  id: true, channelId: true, userId: true, state: true, tags: true, name: true, firstUserMessageAt: true, hospitalCode: true,
  user: { select: { name: true, opsCode: true, hospitalNameRaw: true, ward: true } },
  vocLink: { select: { vocId: true } },
  asIntake: { select: { id: true, state: true, receiptId: true, seenMessageId: true, extracted: true } },
} as const
type ChatRow = Prisma.ChanneltalkUserChatGetPayload<{ select: typeof CHAT_SELECT }>

export const hasAsTag = (tags: string[]) => tags.some((t) => (AS_INTAKE_TAGS as readonly string[]).includes(t))

/**
 * 상담 1건 추출 — 확정 확인문(마지막 완료 안내 직전의 마지막 봇 확인문) 파싱 + 병원·구분·선교체·원장 대조.
 * 확인문이 없으면 hasConfirmation=false 로 반환(큐 프리필용 최소 정보: 병원 힌트·구분·접수자·접수일).
 */
export async function extractAsFromChat(chat: ChatRow, matcher: HospitalMatcher): Promise<{ extract: AsExtract; lastMessageId: string | null }> {
  const msgs = await prisma.channeltalkMessage.findMany({
    where: { chatId: chat.id, plainText: { not: null } },
    select: { id: true, personType: true, plainText: true, createdAtCt: true },
    orderBy: { createdAtCt: 'asc' },
  })
  let lastConfirm: { id: string; text: string; at: Date } | null = null
  let confirmation: { id: string; text: string; at: Date } | null = null
  let completion: { id: string; at: Date } | null = null
  let firstCompletionAt: Date | null = null
  let chatMentionsPreReplace = false
  for (const m of msgs) {
    const t = m.plainText!
    if (/선교체/.test(t) && m.personType === 'user') chatMentionsPreReplace = true // 고객 발언만 — 담당자의 안내("선교체 발송 예정")는 제외 (2026-10-27 보완 2)
    if (m.personType !== 'user' && isAlfCompletion(t)) { if (lastConfirm) { confirmation = lastConfirm; completion = { id: m.id, at: m.createdAtCt }; firstCompletionAt ??= m.createdAtCt } ; continue }
    if (m.personType === 'bot' && isAlfConfirmation(t)) { lastConfirm = { id: m.id, text: t, at: m.createdAtCt }; if (/선교체/.test(t)) chatMentionsPreReplace = true }
  }
  if (!confirmation && lastConfirm) confirmation = lastConfirm
  const parsed = confirmation ? parseAlfConfirmation(confirmation.text) : null

  // 병원: OpsCode 정확 일치 우선, 확인문 병원명 매처와 다르면 충돌(큐)
  const hospitalCodes = await hospitalCodeSet()
  const opsHospital = chat.user?.opsCode && hospitalCodes.has(chat.user.opsCode) ? chat.user.opsCode : null
  const nameRaw = parsed?.hospitalNameRaw ?? chat.user?.hospitalNameRaw ?? null
  const nameHospital = nameRaw ? matcher.match(nameRaw) : null
  let hospitalCode: string | null = opsHospital ?? nameHospital ?? chat.hospitalCode
  let hospitalMatchSource: AsExtract['hospitalMatchSource'] = opsHospital ? 'opscode' : nameHospital ? 'name' : chat.hospitalCode ? 'name' : 'none'
  if (opsHospital && nameHospital && opsHospital !== nameHospital) {
    // 보완 1 (2026-10-27): 고객이 줄여 쓴 병원명('현대병원')이 OpsCode 병원명('광주현대병원')에 포함되면 동명 충돌이 아니라 축약 — OpsCode 채택
    const opsName = (matcher.nameOf(opsHospital) ?? (await prisma.hospital.findUnique({ where: { hospitalCode: opsHospital }, select: { hospitalName: true } }))?.hospitalName ?? '')
    const n = (s: string) => s.replace(/\s+/g, '').replace(/(의료법인|재단법인|사회복지법인|학교법인|의료재단|\(.*?\))/g, '')
    if (nameRaw && n(opsName).includes(n(nameRaw))) hospitalMatchSource = 'opscode'
    else { hospitalMatchSource = 'conflict'; hospitalCode = null }
  }

  const hasFault = chat.tags.includes(AS_TAG_FAULT), hasLost = chat.tags.includes(AS_TAG_LOST)
  const category: AsExtract['category'] = hasLost && !hasFault ? 'LOST' : 'FAULT'
  const mixedCategory = hasFault && hasLost

  const lines = parsed?.lines ?? []
  const serials = lines.map((l) => l.serial)
  const invalidSerials = [...(parsed?.invalidTokens ?? []), ...serials.filter((s) => !AS_SERIAL_RE.test(s))]
  const known = serials.length ? new Set((await prisma.deviceUnit.findMany({ where: { serialNo: { in: serials } }, select: { serialNo: true } })).map((d) => d.serialNo)) : new Set<string>()
  const unknownSerials = serials.filter((s) => AS_SERIAL_RE.test(s) && !known.has(s))

  const dest = parsed ? resolveDest(parsed.destLines) : { destInfo: null, pickupDestInfo: null, pickupDestDiffers: false }
  let preReplaceSource: AsExtract['preReplaceSource'] = parsed?.preReplace ? 'confirmation' : chatMentionsPreReplace ? 'chat' : null
  if (!preReplaceSource && hospitalCode) {
    const tag = await prisma.hospitalTagAssignment.findFirst({ where: { hospitalCode, tag: { key: 'PRE_REPLACE_DEFAULT' } }, select: { id: true } })
    if (tag) preReplaceSource = 'hospital_tag'
  }
  const receiptAt = firstCompletionAt ?? completion?.at ?? chat.firstUserMessageAt ?? new Date()
  // 보완 3 (2026-10-27): 상담명이 닉네임이면('테니스 560') CS가 손으로 고치던 '병원/병동/이름' 형식을 프로필에서 조합
  const chatName = chat.name?.trim() || null
  const looksStructured = !!chatName && (/병원|의원|센터|재단|\//.test(chatName) || /^대웅/.test(chatName))
  const hospName = chat.user?.hospitalNameRaw ?? (hospitalCode ? matcher.nameOf(hospitalCode) ?? null : null) ?? nameRaw
  const userName = chat.user?.name?.trim() || null
  const userStructured = !!userName && /병원|의원|센터|재단|\//.test(userName) // 프로필 이름이 이미 '병원/병동' 형식
  const parts: string[] = []
  for (const v of userStructured ? [userName] : [hospName, parsed?.wards[0] ?? chat.user?.ward, userName]) if (v && v.trim() && !parts.includes(v.trim())) parts.push(v.trim())
  const composed = parts.join('/')
  const reporterName = looksStructured ? chatName : composed || chatName || userName
  // 보완 4: 확인문의 수령지/발송지 구획 수 (2곳 이상이면 다병동 — 분할 판단을 사람에게)
  const destCount = parsed ? parsed.destLines.filter((l) => /^(수령지|발송지|배송지)/.test(l.replace(/^[\s\-•·*▪]+/, ''))).length : 0
  const extract: AsExtract = {
    hospitalNameRaw: nameRaw, hospitalCode, hospitalMatchSource, hospitalNameMatchCode: nameHospital,
    category, mixedCategory,
    receiptDate: kstDate(receiptAt),
    reporterName,
    wards: parsed?.wards ?? [], deviceKindText: parsed?.deviceKindText ?? null,
    lines: lines.map((l) => ({ serial: l.serial, ward: l.ward ?? parsed?.wards[0] ?? null, symptom: l.symptom })),
    invalidSerials: Array.from(new Set(invalidSerials)), unknownSerials,
    destInfo: dest.destInfo, pickupDestInfo: dest.pickupDestInfo, pickupDestDiffers: dest.pickupDestDiffers, destCount,
    preReplace: !!preReplaceSource, preReplaceSource,
    hasConfirmation: !!parsed, hasCompletion: !!completion,
    labels: parsed?.labels ?? [],
    confirmationMessageId: confirmation?.id ?? null, completionMessageId: completion?.id ?? null,
  }
  return { extract, lastMessageId: msgs.length ? msgs[msgs.length - 1].id : null }
}

let hospitalCodeCache: { at: number; set: Set<string> } | null = null
async function hospitalCodeSet(): Promise<Set<string>> {
  if (hospitalCodeCache && Date.now() - hospitalCodeCache.at < 300_000) return hospitalCodeCache.set
  const rows = await prisma.hospital.findMany({ select: { hospitalCode: true } })
  hospitalCodeCache = { at: Date.now(), set: new Set(rows.map((r) => r.hospitalCode)) }
  return hospitalCodeCache.set
}

/** 자동 생성 검증 — 실패 분류 목록(비어 있으면 통과). 설계 §4.4 + 결정 D2·D3·D4 */
export function validateExtract(e: AsExtract): { failClass: string; note: string }[] {
  const out: { failClass: string; note: string }[] = []
  if (!e.hasConfirmation) return [{ failClass: 'NO_CONFIRM', note: 'ALF 확정 확인문이 없는 상담 — 원문을 보고 입력' }]
  if (!e.hasCompletion) out.push({ failClass: 'NO_COMPLETION', note: '접수 완료 안내가 없음(고객 미확정 또는 담당자 수동 처리)' })
  if (e.hospitalMatchSource === 'conflict') out.push({ failClass: 'HOSPITAL_CONFLICT', note: `고객 OpsCode와 확인문 병원명('${e.hospitalNameRaw}' → ${e.hospitalNameMatchCode})이 다름` })
  else if (!e.hospitalCode) out.push({ failClass: 'HOSPITAL_UNMATCHED', note: `병원 매칭 실패: '${e.hospitalNameRaw ?? '-'}'` })
  if (!e.lines.length) out.push({ failClass: 'NO_SERIAL', note: '시리얼을 읽지 못함' })
  if (e.invalidSerials.length) out.push({ failClass: 'BAD_SERIAL', note: `형식 오류: ${e.invalidSerials.join(', ')}` })
  // 기기 원장에 없는 시리얼(unknownSerials)은 큐행이 아니라 시트 경로와 같이 생성 — 라인 '미등록' 배지·[원장확정]/[시리얼 보정]으로 처리 (D3 번복, 2026-10-27 사용자 결정)
  if (e.mixedCategory) out.push({ failClass: 'MIXED_CATEGORY', note: '고장·분실 태그가 함께 걸림 — 구분을 사람이 결정' })
  if (e.destCount >= 2) out.push({ failClass: 'MULTI_DEST', note: `수령지가 ${e.destCount}곳 — 병동별 분할 여부를 사람이 결정` })
  if (!e.labels.includes('symptom') && !e.lines.some((l) => l.symptom)) out.push({ failClass: 'PARSE_INCOMPLETE', note: '접수사유를 읽지 못함' })
  return out
}

/** 동일 병원·접수일·시리얼 전부 포함 기존 접수 (시트 경로와 같은 가드) */
export async function findExistingReceipt(hospitalCode: string, receiptDate: string, serials: string[]) {
  if (!serials.length) return null
  const rec = await prisma.asReceipt.findFirst({
    where: { hospitalCode, receiptDate: new Date(receiptDate), items: { some: { serialNo: { in: serials } } } },
    select: { id: true, asCode: true, items: { select: { serialNo: true } } },
    orderBy: { id: 'desc' },
  })
  return rec && serials.every((s) => rec.items.some((i) => i.serialNo === s)) ? rec : null
}

/** 추출 결과 → createAsReceipt 입력 (큐 등록 경로와 공용). 자동 인입 기본값은 시트 경로와 동일(택배 수거·접수일 익일, 분실은 수거 없음) */
export function extractToCreateInput(e: AsExtract, chatId: string, extraNote?: string | null) {
  const receiptDate = new Date(`${e.receiptDate}T00:00:00Z`)
  const lost = e.category === 'LOST'
  const lines: LineInput[] = e.lines.map((l) => ({ serial: l.serial, symptom: l.symptom, wardName: l.ward }))
  const noteParts = [`[채널톡 상담 ${chatId}]`]
  if (extraNote) noteParts.push(extraNote)
  return {
    hospitalCode: e.hospitalCode!,
    category: e.category,
    receiptDate,
    reporterName: e.reporterName,
    pickupMethod: lost ? 'NONE' : 'PARCEL',
    pickedUpAt: lost ? null : new Date(receiptDate.getTime() + 86400000),
    preReplace: e.preReplace,
    destType: e.destInfo ? 'HOSPITAL' : null,
    destInfo: e.destInfo,
    pickupDestDiffers: e.pickupDestDiffers,
    pickupDestInfo: e.pickupDestInfo,
    note: noteParts.join('\n'),
    lines,
  }
}

async function botUser() {
  return prisma.user.findUnique({ where: { email: CHANNELTALK_BOT_EMAIL }, select: { id: true, name: true, email: true, role: true } })
}

/** 자동 생성 1건 — 성공 시 LINKED 링크까지. 호출부가 검증·가드를 마친 뒤 호출 */
async function autoCreate(chat: ChatRow, e: AsExtract, lastMessageId: string | null, bot: NonNullable<Awaited<ReturnType<typeof botUser>>>, log: (l: string) => void) {
  const warn: string[] = []
  if (e.hospitalMatchSource === 'name') warn.push(`병원명 매칭: '${e.hospitalNameRaw}'`)
  if (e.unknownSerials.length) warn.push(`기기 원장에 없는 시리얼(미등록 라인): ${e.unknownSerials.join(', ')}`)
  const created = await createAsReceipt({ ...extractToCreateInput(e, chat.id, warn.join(' | ') || null), source: 'CHANNELTALK', vocId: chat.vocLink?.vocId ?? null }, { userId: bot.id, name: bot.name })
  await prisma.asIntakeLink.upsert({
    where: { chatId: chat.id },
    create: { chatId: chat.id, receiptId: created.id, state: 'LINKED', extracted: e as unknown as Prisma.InputJsonValue, extractLayer: 'L1', sourceMessageIds: [e.confirmationMessageId, e.completionMessageId].filter((v): v is string => !!v), seenMessageId: lastMessageId },
    update: { receiptId: created.id, state: 'LINKED', failClass: null, failNote: null, extracted: e as unknown as Prisma.InputJsonValue, extractLayer: 'L1', seenMessageId: lastMessageId, changeDetectedAt: null, changeDiff: Prisma.DbNull },
  })
  syncTicketClocksSafe(created.ticketId)
  notifyTicketCreated({ ticketId: created.ticketId, actorName: bot.name, actorId: bot.id }).catch(() => {})
  logAudit({ actor: { id: bot.id, email: bot.email, name: bot.name, role: bot.role }, action: 'CREATE', resource: 'as_receipt', resourceId: created.asCode, resourceLabel: `${created.asCode} ${created.hospitalName} (채널톡 상담 ${chat.id})` }).catch(() => {})
  log(`AS 자동 생성 ${created.asCode} ← 상담 ${chat.id} (${created.hospitalName}, 라인 ${e.lines.length}${created.warnings.length ? `, 경고 ${created.warnings.length}` : ''})`)
  return created
}

async function enqueue(chat: ChatRow, e: AsExtract, lastMessageId: string | null, fails: { failClass: string; note: string }[]) {
  const data = {
    failClass: fails[0]?.failClass ?? null, failNote: fails.map((f) => f.note).join(' / ') || null,
    extracted: e as unknown as Prisma.InputJsonValue, extractLayer: e.hasConfirmation ? 'L1' : 'NONE',
    sourceMessageIds: [e.confirmationMessageId, e.completionMessageId].filter((v): v is string => !!v), seenMessageId: lastMessageId,
  }
  await prisma.asIntakeLink.upsert({ where: { chatId: chat.id }, create: { chatId: chat.id, state: 'PENDING', ...data }, update: { state: 'PENDING', ...data } })
}

/** 접수 필드 diff — 연결 접수 현재값 vs 재추출값 (처리 필드는 비교하지 않음, 설계 §6) */
export async function diffExtractAgainstReceipt(receiptId: number, e: AsExtract): Promise<AsIntakeDiffItem[]> {
  const r = await prisma.asReceipt.findUnique({ where: { id: receiptId }, select: { category: true, destInfo: true, pickupDestInfo: true, pickupDestDiffers: true, preReplace: true, items: { where: { intakeSource: 'RECEIPT' }, select: { serialNo: true, wardName: true, symptom: true } } } })
  if (!r) return []
  const out: AsIntakeDiffItem[] = []
  const norm = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim()
  const cur = r.items.map((i) => i.serialNo).sort().join(', '), chat = e.lines.map((l) => l.serial).sort().join(', ')
  if (cur !== chat) out.push({ field: 'serials', label: '시리얼', current: cur || null, chat: chat || null })
  for (const l of e.lines) {
    const it = r.items.find((i) => i.serialNo === l.serial)
    if (!it) continue
    if (norm(it.symptom) !== norm(l.symptom) && norm(l.symptom)) out.push({ field: `symptom:${l.serial}`, label: `증상 ${l.serial}`, current: it.symptom, chat: l.symptom })
    if (norm(it.wardName) !== norm(l.ward) && norm(l.ward)) out.push({ field: `ward:${l.serial}`, label: `병동 ${l.serial}`, current: it.wardName, chat: l.ward })
  }
  if (r.category !== e.category && !e.mixedCategory) out.push({ field: 'category', label: '구분', current: r.category, chat: e.category })
  if (norm(r.destInfo) !== norm(e.destInfo) && norm(e.destInfo)) out.push({ field: 'destInfo', label: '발송지', current: r.destInfo, chat: e.destInfo })
  if (norm(r.pickupDestInfo) !== norm(e.pickupDestInfo) && norm(e.pickupDestInfo)) out.push({ field: 'pickupDestInfo', label: '회수지', current: r.pickupDestInfo, chat: e.pickupDestInfo })
  if (r.pickupDestDiffers !== e.pickupDestDiffers) out.push({ field: 'pickupDestDiffers', label: '회수지 상이', current: String(r.pickupDestDiffers), chat: String(e.pickupDestDiffers) })
  if (r.preReplace !== e.preReplace && e.preReplace) out.push({ field: 'preReplace', label: '선교체', current: String(r.preReplace), chat: String(e.preReplace) })
  return out
}

export interface AsIntakeResult { mode: AsIntakeMode; candidates: number; created: number; queued: number; retried: number; changes: number; dryAuto: number; dryQueue: number; errors: string[] }

/** 틱 후처리 — 변경 상담 ∪ DB상 미처리 대상에 대해 판정·추출·생성/큐·변경 감지 */
export async function intakeAsFromChats(changedChatIds: string[], log: (l: string) => void): Promise<AsIntakeResult> {
  const mode = await readAsIntakeMode()
  const r: AsIntakeResult = { mode, candidates: 0, created: 0, queued: 0, retried: 0, changes: 0, dryAuto: 0, dryQueue: 0, errors: [] }
  if (mode === 'off') return r
  const cutover = await readAsIntakeCutover()
  if (mode === 'on' && !cutover) { log('AS 인입 ON인데 컷오버 미설정 — 스킵(설정 화면에서 컷오버 지정)'); return r }
  const cutoverYmd = cutover ? new Date(cutover.getTime() + 9 * 3600_000).toISOString().slice(0, 10) : '' // KST 날짜 — extract.receiptDate(YYYY-MM-DD)와 비교
  const bot = mode === 'on' ? await botUser() : null
  if (mode === 'on' && !bot) { r.errors.push(`봇 계정(${CHANNELTALK_BOT_EMAIL}) 없음`); return r }
  const tags = Array.from(AS_INTAKE_TAGS)
  const chats = await prisma.channeltalkUserChat.findMany({
    where: {
      tags: { hasSome: tags },
      OR: [
        { id: { in: changedChatIds } },
        { asIntake: { is: null }, firstUserMessageAt: cutover ? { gte: cutover } : { not: null } },
      ],
    },
    select: CHAT_SELECT,
  })
  r.candidates = chats.length
  if (!chats.length) return r
  const matcher = await loadHospitalMatcher()
  for (const chat of chats) {
    try {
      const link = chat.asIntake
      if (link?.state === 'IGNORED') continue
      // 컷오버 이전에 시작된 미처리 상담 — 바로 버리지 않고 추출 후 ALF 완료(접수일) 기준으로 판정 (2026-10-29)
      const preCutover = !!cutover && !link && (!chat.firstUserMessageAt || chat.firstUserMessageAt < cutover)
      // 연결된 접수 — 상담 변경 시 재추출·diff 기록 (반영은 사람)
      if (link?.state === 'LINKED') {
        if (mode !== 'on' || !link.receiptId) continue
        const { extract, lastMessageId } = await extractAsFromChat(chat, matcher)
        if (lastMessageId && lastMessageId === link.seenMessageId) continue
        const diff = await diffExtractAgainstReceipt(link.receiptId, extract)
        // diff가 있으면 최신 추출값도 저장 — [반영]/[새 접수로 만들기]가 생성 시점 값이 아니라 현재 상담 값을 쓰도록 (2026-10-27 보완 6 검증에서 발견)
        await prisma.asIntakeLink.update({ where: { id: link.id }, data: { seenMessageId: lastMessageId, changeDetectedAt: diff.length ? new Date() : null, changeDiff: diff.length ? (diff as unknown as Prisma.InputJsonValue) : Prisma.DbNull, ...(diff.length ? { extracted: extract as unknown as Prisma.InputJsonValue } : {}) } })
        if (diff.length) { r.changes++; log(`채널톡 변경 감지 — 접수 #${link.receiptId} ← 상담 ${chat.id} (${diff.map((d) => d.label).join(', ')})`) }
        continue
      }
      const { extract, lastMessageId } = await extractAsFromChat(chat, matcher)
      // 컷오버 이전 상담이라도 ALF 완료(접수일)가 컷오버 이후면 처리 — 카테고리만 고른 뒤 며칠 뒤 같은 상담에서 접수한 사례
      // (2026-10-29 부산백병원 P030666: 10/26 상담 → 10/29 접수. 종전엔 첫 발화 기준으로 스킵돼 시트/수기 등록만 됨)
      if (preCutover) {
        if (!extract.hasCompletion || extract.receiptDate < cutoverYmd) continue
        log(`컷오버 이전 상담의 사후 접수 — ${chat.id} 접수일 ${extract.receiptDate} (첫 발화 ${chat.firstUserMessageAt?.toISOString().slice(0, 10) ?? '-'})`)
      }
      const fails = validateExtract(extract)
      if (!fails.length && extract.hospitalCode) {
        const dup = await findExistingReceipt(extract.hospitalCode, extract.receiptDate, extract.lines.map((l) => l.serial))
        if (dup) fails.push({ failClass: 'ALREADY_EXISTS', note: `동일 병원·접수일·시리얼 접수 ${dup.asCode} 존재 — 연결 또는 등록 선택` })
      }
      if (mode === 'dry') {
        if (fails.length) { r.dryQueue++; log(`[dry] 큐행 ${chat.id} ${extract.hospitalNameRaw ?? '-'} [${fails.map((f) => f.failClass).join(',')}]`) }
        else { r.dryAuto++; log(`[dry] 자동 생성 가능 ${chat.id} ${extract.hospitalCode} ${extract.category} 시리얼 ${extract.lines.map((l) => l.serial).join(',')} 접수일 ${extract.receiptDate}`) }
        continue
      }
      if (fails.length) {
        await enqueue(chat, extract, lastMessageId, fails)
        if (link) r.retried++; else r.queued++
        log(`등록대기 ${link ? '갱신' : '적재'} ${chat.id} ${extract.hospitalNameRaw ?? '-'} [${fails.map((f) => f.failClass).join(',')}]`)
        continue
      }
      await autoCreate(chat, extract, lastMessageId, bot!, log)
      r.created++
    } catch (e) {
      if (isRegistryTxAbort(e)) { log(`기기 동시 변경 — 상담 ${chat.id} 다음 틱 재시도`); continue } // 링크 없이 두면 다음 틱 후보로 다시 잡힘
      const msg = e instanceof AsServiceError ? e.message : e instanceof Error ? e.message : String(e)
      r.errors.push(`상담 ${chat.id}: ${msg}`)
      log(`AS 인입 실패 — 상담 ${chat.id}: ${msg}`)
      if (mode === 'on') {
        try {
          const { extract, lastMessageId } = await extractAsFromChat(chat, matcher)
          await enqueue(chat, extract, lastMessageId, [{ failClass: 'ERROR', note: msg.slice(0, 300) }])
          r.queued++
        } catch { /* 추출 자체 실패 — 다음 틱 재시도 */ }
      }
    }
  }
  return r
}
