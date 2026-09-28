/**
 * 채널톡 상담 원천 적재 — 동기화 본체 (projects/voc_channeltalk_intake_design.md §4)
 *
 * runChanneltalkVocSync(mode)
 *  - incremental: ① 매니저 마스터 ② 활성(opened·snoozed) 전량 ③ 종료(closed) 최신부터 순회 → DB 종료시각 최대값−24h 이전 행에서 중단
 *                 ④ 신규·변경 상담의 메시지 수집 (신규=asc 전량, 변경=desc로 이미 저장된 메시지 id를 만날 때까지)
 *  - backfill:    closed asc 전량을 AppSetting 커서로 이어가며 적재(틱당 호출 상한 도달 시 커서 저장 후 이월) → 완료 후 활성 전량. 완료되면 done=true
 *  - manual:      incremental과 같음 (설정 화면 [지금 실행] 표기용)
 *
 * 멱등성: 채널톡 id PK upsert. 변경 감지는 rawHash(유의미 필드만 — updatedAt·응답시간 통계는 제외, 실측 §9 #4).
 * 병원 힌트: user.profile.OpsCode 정확 일치(hospitals에 존재) → profile.hospital 매처 → 상담 name 매처 → 미매칭. 확정은 승격 단계.
 * 개인정보·상담 본문은 이 모듈 밖으로 재전파하지 않는다(알림·AI 인덱스 금지 — 설계 §9 거버넌스).
 */
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadHospitalMatcher, type HospitalMatcher } from '@/lib/hospitalNameMatcher'
import {
  ChanneltalkClient, CallBudgetExceeded,
  type ChanneltalkUserChatRaw, type ChanneltalkUserRaw, type ChanneltalkManagerRaw, type ChanneltalkMessageRaw,
} from './client'
import {
  CHANNELTALK_VOC_BACKFILL_KEY, CHANNELTALK_VOC_MAX_CALLS_KEY, EMPTY_BACKFILL,
  type BackfillState, type ChanneltalkSyncMode,
} from './shared'

const CLOSED_SAFETY_MS = 24 * 3600 * 1000
const DEFAULT_MAX_CALLS = 200
const RUN_RETENTION_DAYS = 30

export interface ChanneltalkVocSyncResult {
  mode: ChanneltalkSyncMode
  runId: number
  scannedChats: number
  upsertedChats: number // 신규+변경
  newChats: number
  fetchedMessages: number
  apiCalls: number
  rateLimited: number
  backfillDone: boolean | null // backfill 모드에서만 의미
  budgetExceeded: boolean
  error: string | null
}

export interface ChanneltalkVocSyncOptions {
  client?: ChanneltalkClient
  maxCalls?: number
  /** backfill 모드에서 이 일자 이전 상담은 건너뜀(개발 소량 적재용) — closedAt 기준 */
  backfillSince?: Date
  log?: (line: string) => void
}

// ─── 변환 ───
const ms2date = (v: unknown) => (typeof v === 'number' && v > 0 ? new Date(v) : null)
/** PostgreSQL TEXT·JSONB는 NUL(0x00)을 거부 — 채널톡 메시지 본문에 실제로 섞여 옴(PROD 백필 2026-09-28). 문자열에서 제거 */
const stripNul = (v: string) => (v.includes('\u0000') ? v.replace(/\u0000/g, '') : v)
const deepStripNul = (o: unknown): unknown =>
  typeof o === 'string' ? stripNul(o)
  : Array.isArray(o) ? o.map(deepStripNul)
  : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [stripNul(k), deepStripNul(v)]))
  : o
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? stripNul(v.trim()) : null)
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(stripNul) : [])
const sha = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex')
const json = (o: unknown) => deepStripNul(o) as Prisma.InputJsonValue

/** 상담 변경 감지용 유의미 필드 (updatedAt·통계 제외) */
function chatSignature(c: ChanneltalkUserChatRaw) {
  return sha({
    state: c.state, assigneeId: c.assigneeId ?? null, managerIds: c.managerIds ?? [], tags: c.tags ?? [],
    name: c.name ?? null, description: c.description ?? null, userId: c.userId ?? null,
    openedAt: c.openedAt ?? null, closedAt: c.closedAt ?? null, firstAskedAt: c.firstAskedAt ?? null,
    userLastMessageId: c.userLastMessageId ?? null, frontMessageId: c.frontMessageId ?? null, deskMessageId: c.deskMessageId ?? null,
  })
}
function userSignature(u: ChanneltalkUserRaw) {
  return sha({ name: u.name ?? null, profile: u.profile ?? null, tags: u.tags ?? [], memberId: u.memberId ?? null, unifiedId: u.unifiedId ?? null })
}

function extractUser(u: ChanneltalkUserRaw) {
  const p = (u.profile ?? {}) as Record<string, unknown>
  const addr = [str(p.adress), str(p.adress2)].filter(Boolean).join(' ') || null
  return {
    channelId: str(u.channelId), memberId: str(u.memberId), unifiedId: str(u.unifiedId),
    name: str(u.name) ?? str(p.name),
    mobileNumber: str(p.mobileNumber) ?? str(u.mobileNumber), landlineNumber: str(p.landlineNumber) ?? str(u.landlineNumber),
    email: str(p.email) ?? str(u.email),
    opsCode: str(p.OpsCode)?.toUpperCase() ?? null, hospitalNameRaw: str(p.hospital), ward: str(p.ward), address: addr,
    profile: u.profile ? json(u.profile) : Prisma.JsonNull, tags: arr(u.tags),
  }
}

// ─── 동기화 컨텍스트 ───
class SyncCtx {
  scanned = 0; upserted = 0; newChats = 0; fetchedMessages = 0
  private hospitalCodes: Set<string> | null = null
  private matcher: HospitalMatcher | null = null
  private userCache = new Map<string, { opsCode: string | null; hospitalNameRaw: string | null }>()
  private managerNames = new Map<string, string>()
  constructor(readonly client: ChanneltalkClient, readonly log: (l: string) => void) {}

  private async ensureHospitalIndex() {
    if (this.hospitalCodes) return
    const rows = await prisma.hospital.findMany({ select: { hospitalCode: true } })
    this.hospitalCodes = new Set(rows.map((r) => r.hospitalCode))
    this.matcher = await loadHospitalMatcher()
  }

  async syncManagers(list?: ChanneltalkManagerRaw[]) {
    const managers = list ?? (await this.client.listManagers()).managers ?? []
    for (const m of managers) {
      if (!m?.id) continue
      this.managerNames.set(m.id, str(m.name) ?? m.id)
      await prisma.channeltalkManager.upsert({
        where: { id: m.id },
        create: { id: m.id, channelId: str(m.channelId), name: str(m.name), email: str(m.email), raw: json(m) },
        update: { channelId: str(m.channelId), name: str(m.name), email: str(m.email), raw: json(m), lastSyncedAt: new Date() },
      })
    }
  }

  async upsertUsers(users: ChanneltalkUserRaw[] | undefined) {
    for (const u of users ?? []) {
      if (!u?.id) continue
      const ex = extractUser(u)
      this.userCache.set(u.id, { opsCode: ex.opsCode, hospitalNameRaw: ex.hospitalNameRaw })
      this.knownUsers.add(u.id)
      const rawHash = userSignature(u)
      const cur = await prisma.channeltalkUser.findUnique({ where: { id: u.id }, select: { rawHash: true } })
      if (cur?.rawHash === rawHash) continue
      await prisma.channeltalkUser.upsert({
        where: { id: u.id },
        create: { id: u.id, ...ex, raw: json(u), rawHash },
        update: { ...ex, raw: json(u), rawHash, lastSyncedAt: new Date() },
      })
    }
  }

  /** 상담의 userId가 DB에 없으면 단건 조회로 보충, 그래도 없으면(삭제·병합 고객) null — FK 위반 방지 (PROD 백필 2026-09-28) */
  private knownUsers = new Set<string>()
  async ensureUser(userId: string | null): Promise<string | null> {
    if (!userId) return null
    if (this.knownUsers.has(userId) || this.userCache.has(userId)) { this.knownUsers.add(userId); return userId }
    const exists = await prisma.channeltalkUser.findUnique({ where: { id: userId }, select: { id: true } })
    if (exists) { this.knownUsers.add(userId); return userId }
    try {
      const { user } = await this.client.getUser(userId)
      if (user?.id) { await this.upsertUsers([user]); this.knownUsers.add(userId); return userId }
    } catch (e) {
      if (e instanceof CallBudgetExceeded) throw e
      this.log(`고객 ${userId} 조회 실패 — 상담 user_id 비움 (${e instanceof Error ? e.message.slice(0, 80) : e})`)
    }
    return null
  }

  private async userHint(userId: string | null) {
    if (!userId) return null
    const c = this.userCache.get(userId)
    if (c) return c
    const row = await prisma.channeltalkUser.findUnique({ where: { id: userId }, select: { opsCode: true, hospitalNameRaw: true } })
    if (row) this.userCache.set(userId, row)
    return row
  }

  /** 병원 힌트 — 설계 §4.3 (①OpsCode ②profile.hospital ③상담 name) */
  async hospitalHint(c: ChanneltalkUserChatRaw): Promise<{ hospitalCode: string | null; hospitalMatchSource: string; hospitalMatchNote: string | null }> {
    await this.ensureHospitalIndex()
    const u = await this.userHint(str(c.userId))
    if (u?.opsCode && this.hospitalCodes!.has(u.opsCode)) return { hospitalCode: u.opsCode, hospitalMatchSource: 'opscode', hospitalMatchNote: null }
    const notes: string[] = []
    if (u?.opsCode) notes.push(`OpsCode ${u.opsCode} 병원 없음`)
    for (const cand of [u?.hospitalNameRaw, str(c.name)]) {
      if (!cand) continue
      const code = this.matcher!.match(cand)
      if (code) return { hospitalCode: code, hospitalMatchSource: 'name', hospitalMatchNote: `'${cand}' → ${this.matcher!.nameOf(code) ?? code}` }
      const cands = this.matcher!.candidates(cand)
      notes.push(cands.length ? `'${cand}' 후보 ${cands.length}건: ${cands.slice(0, 3).map((x) => this.matcher!.nameOf(x) ?? x).join(', ')}` : `'${cand}' 후보 없음`)
    }
    return { hospitalCode: null, hospitalMatchSource: 'none', hospitalMatchNote: notes.join(' / ') || null }
  }

  /** 상담 upsert → 메시지 수집 필요 여부 반환 */
  async upsertChat(c: ChanneltalkUserChatRaw): Promise<{ isNew: boolean; changed: boolean }> {
    this.scanned++
    const rawHash = chatSignature(c)
    const cur = await prisma.channeltalkUserChat.findUnique({ where: { id: c.id }, select: { rawHash: true, messageCount: true } })
    if (cur && cur.rawHash === rawHash && cur.messageCount > 0) return { isNew: false, changed: false }
    const userId = await this.ensureUser(str(c.userId))
    const hint = await this.hospitalHint(c)
    const data = {
      channelId: str(c.channelId), userId, state: c.state, assigneeId: str(c.assigneeId),
      managerIds: arr(c.managerIds), tags: arr(c.tags), name: str(c.name), description: str(c.description),
      contactMediumType: str(c.contactMediumType), sourceType: str(c.source?.medium?.mediumType) ?? (c.source?.workflow ? 'workflow' : null),
      firstAskedAt: ms2date(c.firstAskedAt), openedAt: ms2date(c.openedAt), closedAt: ms2date(c.closedAt),
      createdAtCt: ms2date(c.createdAt), updatedAtCt: ms2date(c.updatedAt),
      raw: json(c), rawHash, ...hint,
    }
    await prisma.channeltalkUserChat.upsert({
      where: { id: c.id },
      create: { id: c.id, ...data },
      update: { ...data, lastSyncedAt: new Date() },
    })
    this.upserted++
    if (!cur) this.newChats++
    return { isNew: !cur, changed: true }
  }

  /** 메시지 수집 — 신규: asc 전량 / 기존: desc로 저장된 id를 만날 때까지 */
  async syncMessages(chatId: string, isNew: boolean) {
    const rows: ChanneltalkMessageRaw[] = []
    if (isNew) {
      let since: string | null = null
      for (;;) {
        const page = await this.client.listMessages(chatId, 'asc', since)
        rows.push(...(page.messages ?? []))
        if (!page.next || !page.messages?.length) break
        since = page.next
      }
    } else {
      const known = new Set((await prisma.channeltalkMessage.findMany({ where: { chatId }, select: { id: true } })).map((r) => r.id))
      let since: string | null = null
      outer: for (;;) {
        const page = await this.client.listMessages(chatId, 'desc', since)
        for (const m of page.messages ?? []) {
          if (known.has(m.id)) break outer
          rows.push(m)
        }
        if (!page.next || !page.messages?.length) break
        since = page.next
      }
    }
    if (rows.length) {
      await prisma.channeltalkMessage.createMany({
        skipDuplicates: true,
        data: rows.map((m) => ({
          id: m.id, chatId, personType: str(m.personType), personId: str(m.personId),
          plainText: str(m.plainText) ?? (str((m.blocks ?? []).map((b) => b.value ?? '').filter(Boolean).join('\n'))),
          hasFiles: !!m.files?.length, fileMeta: m.files?.length ? json(m.files) : Prisma.JsonNull,
          createdAtCt: new Date(m.createdAt), raw: json(m),
        })),
      })
      this.fetchedMessages += rows.length
    }
    const [count, firstAsk, last] = await Promise.all([
      prisma.channeltalkMessage.count({ where: { chatId } }),
      prisma.channeltalkMessage.findFirst({ where: { chatId, personType: 'user', plainText: { not: null } }, orderBy: { createdAtCt: 'asc' }, select: { plainText: true } }),
      prisma.channeltalkMessage.findFirst({ where: { chatId }, orderBy: { createdAtCt: 'desc' }, select: { id: true } }),
    ])
    await prisma.channeltalkUserChat.update({
      where: { id: chatId },
      data: { messageCount: count, firstAskText: firstAsk?.plainText ?? undefined, messageCursor: last?.id ?? null, messagesSyncedAt: new Date() },
    })
  }

  /** 목록 페이지 1장 처리 (users → chats → messages) */
  async processPage(page: { userChats: ChanneltalkUserChatRaw[]; users?: ChanneltalkUserRaw[]; managers?: ChanneltalkManagerRaw[] }) {
    await this.upsertUsers(page.users)
    if (page.managers?.length) await this.syncManagers(page.managers)
    for (const c of page.userChats ?? []) {
      const r = await this.upsertChat(c)
      if (r.changed) await this.syncMessages(c.id, r.isNew)
    }
  }

  async syncActive() {
    for (const state of ['opened', 'snoozed'] as const) {
      let since: string | null = null
      for (;;) {
        const page = await this.client.listUserChats(state, 'asc', since)
        await this.processPage(page)
        if (!page.next || !page.userChats?.length) break
        since = page.next
      }
    }
  }

  /** 종료 상담 증분 — 최신부터, DB 최대 closedAt−24h 이전을 만나면 중단 */
  async syncClosedIncremental() {
    const agg = await prisma.channeltalkUserChat.aggregate({ _max: { closedAt: true }, where: { state: 'closed' } })
    const floor = agg._max.closedAt ? agg._max.closedAt.getTime() - CLOSED_SAFETY_MS : null
    let since: string | null = null
    for (;;) {
      const page = await this.client.listUserChats('closed', 'desc', since)
      const chats = page.userChats ?? []
      const cut = floor === null ? -1 : chats.findIndex((c) => typeof c.closedAt === 'number' && c.closedAt <= floor)
      const slice = cut >= 0 ? chats.slice(0, cut) : chats
      await this.processPage({ ...page, userChats: slice })
      if (cut >= 0 || !page.next || !chats.length) break
      if (floor === null) { this.log('종료 상담 기준선 없음 — 첫 페이지만 적재 (백필 필요)'); break }
      since = page.next
    }
  }
}

// ─── 설정·실행 로그 ───
async function readBackfill(): Promise<BackfillState> {
  const row = await prisma.appSetting.findUnique({ where: { key: CHANNELTALK_VOC_BACKFILL_KEY } })
  if (!row?.value) return { ...EMPTY_BACKFILL }
  try { return { ...EMPTY_BACKFILL, ...(JSON.parse(row.value) as Partial<BackfillState>) } } catch { return { ...EMPTY_BACKFILL } }
}
async function writeBackfill(s: BackfillState) {
  const value = JSON.stringify(s)
  await prisma.appSetting.upsert({ where: { key: CHANNELTALK_VOC_BACKFILL_KEY }, update: { value }, create: { key: CHANNELTALK_VOC_BACKFILL_KEY, value } })
}
export async function getChanneltalkBackfillState() { return readBackfill() }
/** 백필 처음부터 다시 (커서 초기화 — 데이터는 upsert라 안전) */
export async function resetChanneltalkBackfill() { await writeBackfill({ ...EMPTY_BACKFILL }) }

async function readMaxCalls() {
  const row = await prisma.appSetting.findUnique({ where: { key: CHANNELTALK_VOC_MAX_CALLS_KEY } })
  const n = Number(row?.value)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CALLS
}

let running = false
export function isChanneltalkVocSyncRunning() { return running }

export async function runChanneltalkVocSync(mode: ChanneltalkSyncMode = 'incremental', opts: ChanneltalkVocSyncOptions = {}): Promise<ChanneltalkVocSyncResult> {
  if (running) throw new Error('채널톡 동기화가 이미 진행 중입니다')
  running = true
  const log = opts.log ?? ((l) => console.log(`[channeltalk-voc] ${l}`))
  const client = opts.client ?? new ChanneltalkClient({ maxCalls: opts.maxCalls ?? (await readMaxCalls()) })
  const ctx = new SyncCtx(client, log)
  const run = await prisma.channeltalkSyncRun.create({ data: { mode } })
  let error: string | null = null
  let budgetExceeded = false
  let backfillDone: boolean | null = null
  try {
    if (mode === 'backfill') {
      const st = await readBackfill()
      if (st.done) { backfillDone = true; log('백필 이미 완료 — incremental로 전환') ; await ctx.syncActive(); await ctx.syncClosedIncremental() }
      else {
        if (!st.startedAt) st.startedAt = new Date().toISOString()
        await ctx.syncManagers()
        const sinceMs = opts.backfillSince?.getTime()
        try {
          for (;;) {
            const page = await client.listUserChats('closed', 'asc', st.since)
            const chats = sinceMs ? (page.userChats ?? []).filter((c) => typeof c.closedAt === 'number' && c.closedAt >= sinceMs) : page.userChats ?? []
            await ctx.processPage({ ...page, userChats: chats })
            st.processed += chats.length
            if (!page.next || !page.userChats?.length) { st.done = true; st.finishedAt = new Date().toISOString(); break }
            st.since = page.next
            await writeBackfill(st)
          }
          await ctx.syncActive()
          backfillDone = st.done
        } catch (e) {
          if (e instanceof CallBudgetExceeded) { budgetExceeded = true; backfillDone = false; log(`호출 상한 — 커서 저장 후 이월 (processed=${st.processed})`) }
          else throw e
        } finally {
          // 부분 백필(--since)은 전체 이력을 덮지 않았으므로 커서를 남기지 않는다 — 이후 전체 백필이 처음부터 진행 가능(upsert라 중복 없음)
          if (opts.backfillSince) { log(`부분 백필(closedAt ≥ ${opts.backfillSince.toISOString()}) — 백필 커서 초기화(전체 백필 미완료 상태 유지)`); await writeBackfill({ ...EMPTY_BACKFILL }) }
          else await writeBackfill(st)
        }
      }
    } else {
      await ctx.syncManagers()
      await ctx.syncActive()
      await ctx.syncClosedIncremental()
    }
  } catch (e) {
    if (e instanceof CallBudgetExceeded) { budgetExceeded = true; log('호출 상한 도달 — 다음 틱에 이어서') }
    else { error = e instanceof Error ? e.message : String(e); log(`실패: ${error}`) }
  } finally {
    running = false
    await prisma.channeltalkSyncRun.update({
      where: { id: run.id },
      data: {
        endedAt: new Date(), scannedChats: ctx.scanned, upsertedChats: ctx.upserted, fetchedMessages: ctx.fetchedMessages,
        apiCalls: client.calls, rateLimited: client.rateLimited, error,
        stats: { newChats: ctx.newChats, budgetExceeded, backfillDone },
      },
    }).catch(() => {})
    prisma.channeltalkSyncRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - RUN_RETENTION_DAYS * 86400_000) } } }).catch(() => {})
  }
  return { mode, runId: run.id, scannedChats: ctx.scanned, upsertedChats: ctx.upserted, newChats: ctx.newChats, fetchedMessages: ctx.fetchedMessages, apiCalls: client.calls, rateLimited: client.rateLimited, backfillDone, budgetExceeded, error }
}
