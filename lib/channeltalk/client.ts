/**
 * 채널톡 Open API v5 클라이언트 (서버 전용) — projects/voc_channeltalk_intake_design.md §2·§4.4
 * - 인증: x-access-key / x-access-secret (.env CHANNELTALK_ACCESS_KEY / CHANNELTALK_ACCESS_SECRET)
 * - 페이지: since=<next> 커서, limit ≤ 500
 * - 레이트리밋: x-ratelimit-remaining 소진 임박 시 reset까지 대기, 429는 지수 백오프 최대 3회
 * - 호출 카운트·상한: 틱당 maxCalls 초과 시 CallBudgetExceeded — 호출부가 커서를 저장하고 다음 틱으로 이월
 */

const BASE = 'https://api.channel.io/open/v5/'

export class ChanneltalkApiError extends Error {
  constructor(public status: number, public path: string, body: string) {
    super(`채널톡 API ${status} ${path}: ${body.slice(0, 200)}`)
  }
}
export class CallBudgetExceeded extends Error {
  constructor(public calls: number) { super(`틱당 API 호출 상한 도달 (${calls})`) }
}

export interface ChanneltalkUserChatRaw {
  id: string
  channelId?: string
  userId?: string
  state: 'opened' | 'snoozed' | 'closed'
  assigneeId?: string
  managerIds?: string[]
  tags?: string[]
  name?: string
  description?: string
  contactMediumType?: string
  source?: { medium?: { mediumType?: string }; workflow?: unknown; page?: string }
  firstAskedAt?: number
  askedAt?: number
  openedAt?: number
  closedAt?: number
  createdAt?: number
  updatedAt?: number
  userLastMessageId?: string
  frontMessageId?: string
  deskMessageId?: string
  version?: number
  [k: string]: unknown
}
export interface ChanneltalkUserRaw {
  id: string
  channelId?: string
  memberId?: string
  unifiedId?: string
  name?: string
  profile?: Record<string, unknown> | null
  tags?: string[]
  [k: string]: unknown
}
export interface ChanneltalkManagerRaw { id: string; channelId?: string; name?: string; email?: string; [k: string]: unknown }
export interface ChanneltalkMessageRaw {
  id: string
  chatId: string
  personType?: string
  personId?: string
  plainText?: string
  blocks?: { type: string; value?: string }[]
  files?: { id: string; name?: string; type?: string; size?: number; contentType?: string; bucket?: string; key?: string }[]
  createdAt: number
  [k: string]: unknown
}
export interface UserChatListPage {
  userChats: ChanneltalkUserChatRaw[]
  users?: ChanneltalkUserRaw[]
  managers?: ChanneltalkManagerRaw[]
  messages?: ChanneltalkMessageRaw[]
  next?: string
}
export interface MessageListPage { messages: ChanneltalkMessageRaw[]; next?: string }

export interface ChanneltalkClientOptions {
  accessKey?: string
  accessSecret?: string
  /** 이 클라이언트 인스턴스가 허용하는 총 호출 수 (기본 무제한) */
  maxCalls?: number
  /** 테스트 주입용 fetch */
  fetchImpl?: typeof fetch
  /** 테스트 주입용 sleep */
  sleepImpl?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class ChanneltalkClient {
  calls = 0
  rateLimited = 0
  private readonly key: string
  private readonly secret: string
  private readonly maxCalls: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(opts: ChanneltalkClientOptions = {}) {
    this.key = opts.accessKey ?? process.env.CHANNELTALK_ACCESS_KEY ?? ''
    this.secret = opts.accessSecret ?? process.env.CHANNELTALK_ACCESS_SECRET ?? ''
    this.maxCalls = opts.maxCalls ?? Number.POSITIVE_INFINITY
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleep = opts.sleepImpl ?? defaultSleep
  }

  static isConfigured() {
    return !!(process.env.CHANNELTALK_ACCESS_KEY && process.env.CHANNELTALK_ACCESS_SECRET)
  }

  async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    if (!this.key || !this.secret) throw new Error('채널톡 API 키 미설정 (CHANNELTALK_ACCESS_KEY / CHANNELTALK_ACCESS_SECRET)')
    const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    const url = BASE + path + (qs ? `?${qs}` : '')
    for (let attempt = 0; ; attempt++) {
      if (this.calls >= this.maxCalls) throw new CallBudgetExceeded(this.calls)
      this.calls++
      const res = await this.fetchImpl(url, { headers: { 'x-access-key': this.key, 'x-access-secret': this.secret, accept: 'application/json' } })
      const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? NaN)
      const reset = Number(res.headers.get('x-ratelimit-reset') ?? NaN)
      if (res.status === 429) {
        this.rateLimited++
        if (attempt >= 3) throw new ChanneltalkApiError(429, path, await res.text().catch(() => ''))
        const retryAfter = Number(res.headers.get('retry-after') ?? NaN)
        const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : Number.isFinite(reset) ? Math.max(0, reset * 1000 - Date.now()) : 1000 * 2 ** attempt
        await this.sleep(Math.min(waitMs, 15_000))
        continue
      }
      if (!res.ok) throw new ChanneltalkApiError(res.status, path, await res.text().catch(() => ''))
      const body = (await res.json()) as T
      // 소진 임박 — reset까지 잠깐 대기해 다음 호출의 429를 예방 (실측 윈도 1,000회)
      if (Number.isFinite(remaining) && remaining < 10 && Number.isFinite(reset)) {
        await this.sleep(Math.min(Math.max(0, reset * 1000 - Date.now()), 15_000))
      }
      return body
    }
  }

  listUserChats(state: 'opened' | 'snoozed' | 'closed', sortOrder: 'asc' | 'desc', since?: string | null, limit = 500) {
    return this.get<UserChatListPage>('user-chats', { state, sortOrder, since: since ?? undefined, limit })
  }
  getUserChat(id: string) {
    return this.get<{ userChat: ChanneltalkUserChatRaw; user?: ChanneltalkUserRaw; chatTags?: unknown[] }>(`user-chats/${id}`)
  }
  listMessages(chatId: string, sortOrder: 'asc' | 'desc', since?: string | null, limit = 500) {
    return this.get<MessageListPage>(`user-chats/${chatId}/messages`, { sortOrder, since: since ?? undefined, limit })
  }
  listManagers(limit = 500) {
    return this.get<{ managers: ChanneltalkManagerRaw[] }>('managers', { limit })
  }
  getUser(id: string) {
    return this.get<{ user: ChanneltalkUserRaw }>(`users/${id}`)
  }
}
