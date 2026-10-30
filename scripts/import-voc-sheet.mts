/**
 * 구글시트 'thynC VOC 현황' > 'VOC현황_NEW' 과거 이력 → VOC 접수 적재 (projects/voc_sheet_import_design.md §3)
 *
 *   npx tsx scripts/import-voc-sheet.mts --dry [--max-row=10688] [--limit=N] [--match=scripts/data/voc_sheet_match.tsv]
 *   npx tsx scripts/import-voc-sheet.mts --apply ...
 *
 * 행 판정 (멱등 — voc_receipts.source_ref / voc_intake_items.source_ref = 'sheet:VOC현황_NEW:r{n}'):
 *   1) 대조표(--match)에 상담이 있고 그 상담이 이미 VOC에 연결 → 건너뜀(이미 시스템에 있음)
 *   2) 병원명이 '확인불가'·공란·매처 미매칭 → 등록대기 큐(HOSPITAL_UNKNOWN / HOSPITAL_UNMATCHED)
 *   3) 그 외 → VOC 생성(source SHEET, 접수 월 기준 코드, 상태·완료시각 보정, 상담 있으면 연결 link_reason SHEET)
 * Slack 알림·SLA 없음. PROD 실행은 규칙 5(명시 허락) 적용.
 */
import { google } from 'googleapis'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { loadHospitalMatcher } from '../lib/hospitalNameMatcher'
import { createVocFromImport, createVocCodeAllocator, plainToHtml, sheetOriginBlock } from '../lib/vocImport'
import { CHANNELTALK_BOT_EMAIL } from '../lib/channeltalk/shared'
import type { VocIntakeDraft, VocSheetOrigin } from '../lib/vocIntakeShared'

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? 'true'] : [a, 'true'] }))
const DRY = args.apply !== 'true'
const MAX_ROW = parseInt(args['max-row'] ?? '10688', 10)
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity
const MATCH_FILE = args.match ?? 'scripts/data/voc_sheet_match.tsv'
const SHEET_ID = '1rpXzu1ry-JZtGTNp959HbYgDZw0SncTZdyI6c20G1R4'
const TAB = 'VOC현황_NEW'
const SYS_START = new Date('2026-07-14T00:00:00+09:00') // 시스템 VOC 존재 시작 — 이전 행의 완료여부 공란은 '종결'로

// ── 시트 읽기 ──
function serviceAccount() {
  const env = readFileSync('.env', 'utf8')
  const start = env.indexOf('{', env.indexOf('GOOGLE_SERVICE_ACCOUNT_JSON='))
  let depth = 0, end = start
  for (let i = start; i < env.length; i++) { if (env[i] === '{') depth++; else if (env[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } } }
  return JSON.parse(env.slice(start, end))
}
const auth = new google.auth.GoogleAuth({ credentials: serviceAccount(), scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
const sheets = google.sheets({ version: 'v4', auth })
const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A2:Z${MAX_ROW}`, valueRenderOption: 'FORMATTED_VALUE' })
const raw = res.data.values ?? []
const cell = (r: unknown[], i: number) => String(r[i] ?? '').replace(/\r\n?/g, '\n').trim()
const nz = (s: string) => (s ? s : null)

interface SheetRow { n: number; o: VocSheetOrigin }
const rows: SheetRow[] = []
for (let i = 0; i < raw.length; i++) {
  const r = raw[i]; const n = i + 2
  const date = cell(r, 2), hospital = cell(r, 3), content = cell(r, 7)
  if (!date && !hospital && !content) continue
  rows.push({ n, o: {
    row: n, date, hospital, ward: nz(cell(r, 4)), phone: cell(r, 5).toUpperCase() === 'TRUE', registrant: nz(cell(r, 6)), content, resolution: nz(cell(r, 8)),
    dept: nz(cell(r, 9)), checker: nz(cell(r, 10)), typeL: nz(cell(r, 11)), typeM: nz(cell(r, 12)), typeS: nz(cell(r, 13)), repeat: nz(cell(r, 14)),
    firstDone: nz(cell(r, 15)), receivedTime: nz(cell(r, 16)), firstDoneAt: nz(cell(r, 17)), allDone: nz(cell(r, 19)), allDoneAt: nz(cell(r, 20)), tag: nz(cell(r, 22)), alf: nz(cell(r, 25)),
  } })
}
console.log(`시트 ${TAB}: 2~${MAX_ROW}행 중 내용 있는 행 ${rows.length}`)

// ── 대조표 (행 → 상담) ──
const matchByRow = new Map<number, string>()
try {
  for (const line of readFileSync(MATCH_FILE, 'utf8').split('\n').slice(1)) { const [row, chatId] = line.split('\t'); if (row && chatId) matchByRow.set(parseInt(row, 10), chatId) }
} catch { console.warn(`대조표 없음 (${MATCH_FILE}) — 상담 연결 없이 진행`) }

// ── 마스터·사용자 ──
const [types, statuses, channels, users, bot, matcher] = await Promise.all([
  prisma.statusCode.findMany({ where: { category: 'VOC_TYPE', value: { not: null } }, select: { id: true, value: true, name: true } }),
  prisma.statusCode.findMany({ where: { category: 'VOC_STATUS' }, select: { id: true, name: true, ticketStatus: true } }),
  prisma.statusCode.findMany({ where: { category: 'VOC_CHANNEL' }, select: { id: true, name: true } }),
  prisma.user.findMany({ select: { id: true, name: true } }),
  prisma.user.findUnique({ where: { email: CHANNELTALK_BOT_EMAIL }, select: { id: true } }),
  loadHospitalMatcher(),
])
if (!bot) throw new Error(`채널톡 봇 계정(${CHANNELTALK_BOT_EMAIL})이 없습니다`)
const typeByTag = new Map(types.map((t) => [t.value!, t.id]))
const statusByName = new Map(statuses.map((s) => [s.name, s.id]))
const channelByName = new Map(channels.map((c) => [c.name, c.id]))
const userByName = new Map<string, string>()
for (const u of users) if (u.name && !userByName.has(u.name)) userByName.set(u.name, u.id)
for (const need of ['종결', '처리중', '접수']) if (!statusByName.has(need)) throw new Error(`VOC_STATUS '${need}' 없음`)

// ── 기존 적재분 ──
const existingRefs = new Set<string>([
  ...(await prisma.vocReceipt.findMany({ where: { sourceRef: { startsWith: `sheet:${TAB}:` } }, select: { sourceRef: true } })).map((v) => v.sourceRef!),
  ...(await prisma.vocIntakeItem.findMany({ where: { sourceRef: { startsWith: `sheet:${TAB}:` } }, select: { sourceRef: true } })).map((v) => v.sourceRef!),
])
const chatIds = Array.from(new Set(matchByRow.values()))
const chatRows = chatIds.length ? await prisma.channeltalkUserChat.findMany({ where: { id: { in: chatIds } }, select: { id: true, state: true, closedAt: true, vocLink: { select: { vocId: true } } } }) : []
const chatInDb = new Map(chatRows.map((c) => [c.id, { vocId: c.vocLink?.vocId ?? null, state: c.state, closedAt: c.closedAt }]))
const RECENT = new Date(Date.now() - 14 * 86400_000) // 완료여부 공란·상담 없음 행: 14일보다 오래됐으면 종결로 간주
const linkedInRun = new Set<string>() // 이번 실행에서 연결한 상담 (같은 상담의 2번째 행은 연결 생략)

// ── 파싱 ──
const DT = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/
function parseKst(s: string | null): Date | null {
  const m = s?.match(DT); if (!m) return null
  const [, y, mo, d, h, mi] = m
  return new Date(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${(h ?? '9').padStart(2, '0')}:${(mi ?? '00')}:00+09:00`)
}
const oneLine = (s: string, max = 100) => { const t = s.split('\n').map((x) => x.trim()).find(Boolean) ?? ''; return t.length > max ? `${t.slice(0, max - 1)}…` : t }

interface Plan { ref: string; n: number; kind: 'SKIP_EXISTS' | 'SKIP_COVERED' | 'QUEUE' | 'CREATE'; failClass?: string; hospitalCode: string | null; chatId: string | null; draft: VocIntakeDraft; receivedAt: Date; resolvedAt: Date | null; statusName: string; registrantId: string }
const plans: Plan[] = []
let taken = 0
for (const { n, o } of rows) {
  if (taken >= LIMIT) break
  const ref = `sheet:${TAB}:r${n}`
  const chatId = matchByRow.get(n) ?? null
  const chat = chatId ? chatInDb.get(chatId) : undefined
  const chatVoc = chat?.vocId ?? null
  const date = parseKst(o.date)
  if (!date) { console.warn(`r${n}: 날짜 해석 불가 '${o.date}' — 건너뜀`); continue }
  const receivedAt = parseKst(o.receivedTime) ?? date
  const doneAt = parseKst(o.allDoneAt) ?? parseKst(o.firstDoneAt)
  // 상태: 시트 완료여부(T) 우선. 2026-08부터 T·1차대응 열은 기재되지 않으므로(채널톡 태그만) 공란이면 상담 상태 → 없으면 14일 경과 시 종결
  const statusName = o.allDone === '처리완료' ? '종결'
    : o.allDone === '진행중' ? '처리중'
    : date < SYS_START ? '종결'
    : chat ? (chat.state === 'closed' ? '종결' : '처리중')
    : date < RECENT ? '종결' : o.firstDone === '1차대응완료' ? '처리중' : '접수'
  const isDone = statusName === '종결'
  const resolvedAt = isDone ? [doneAt, chat?.closedAt ?? null].find((x) => x && x >= receivedAt) ?? receivedAt : null
  const channelName = o.phone ? '전화' : o.receivedTime || chat ? '채널톡' : null
  const hospRaw = o.hospital
  const unknown = !hospRaw || /^(확인불가|알수없음|미확인|-)$/.test(hospRaw)
  const hospitalCode = unknown ? null : matcher.match(hospRaw)
  const tagOk = o.tag && typeByTag.has(o.tag) ? o.tag : null
  const typeLabel = o.typeS?.replace(/^[\d.]+\s*/, '') || tagOk?.split('_').slice(-1)[0] || ''
  const title = oneLine(o.content).replace(/[\s!?.~,]/g, '').length >= 4 ? oneLine(o.content) : [hospRaw && !unknown ? hospRaw : null, typeLabel, oneLine(o.content)].filter(Boolean).join(' ') || '(내용 없음)'
  const content = [o.content, sheetOriginBlock(o)].filter(Boolean).join('\n\n')
  const draft: VocIntakeDraft = {
    hospitalCode, hospitalNameRaw: unknown ? null : hospRaw, title, content, resolution: o.resolution,
    receivedAt: receivedAt.toISOString(), resolvedAt: resolvedAt ? resolvedAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : null,
    statusName, channelName: channelName ?? null, tag: tagOk, tagRaw: o.tag, registrantName: o.registrant, sheet: o,
  }
  const registrantId = (o.registrant && o.registrant !== 'ALF' ? userByName.get(o.registrant) : null) ?? bot.id
  let kind: Plan['kind']; let failClass: string | undefined
  if (existingRefs.has(ref)) kind = 'SKIP_EXISTS'
  else if (chatVoc) kind = 'SKIP_COVERED'
  else if (unknown) { kind = 'QUEUE'; failClass = 'HOSPITAL_UNKNOWN' }
  else if (!hospitalCode) { kind = 'QUEUE'; failClass = 'HOSPITAL_UNMATCHED' }
  else kind = 'CREATE'
  plans.push({ ref, n, kind, failClass, hospitalCode, chatId: chatId && chatInDb.has(chatId) ? chatId : null, draft, receivedAt, resolvedAt, statusName, registrantId })
  if (kind === 'CREATE' || kind === 'QUEUE') taken++
}

// ── 요약 ──
const count = (f: (p: Plan) => boolean) => plans.filter(f).length
console.log(`판정: 이미 적재 ${count((p) => p.kind === 'SKIP_EXISTS')} · 시스템에 있음(상담 연결 VOC) ${count((p) => p.kind === 'SKIP_COVERED')} · 등록대기 ${count((p) => p.kind === 'QUEUE')} (확인불가 ${count((p) => p.failClass === 'HOSPITAL_UNKNOWN')} / 미매칭 ${count((p) => p.failClass === 'HOSPITAL_UNMATCHED')}) · VOC 생성 ${count((p) => p.kind === 'CREATE')} (상담 연결 ${count((p) => p.kind === 'CREATE' && !!p.chatId)}, 태그 미매핑 ${count((p) => p.kind === 'CREATE' && !p.draft.tag)})`)
const byMonth = new Map<string, { create: number; queue: number }>()
for (const p of plans) { if (p.kind !== 'CREATE' && p.kind !== 'QUEUE') continue; const k = p.draft.receivedAt.slice(0, 7); const v = byMonth.get(k) ?? { create: 0, queue: 0 }; if (p.kind === 'CREATE') v.create++; else v.queue++; byMonth.set(k, v) }
console.log('월별 생성/큐:', Array.from(byMonth.entries()).sort().map(([k, v]) => `${k} ${v.create}/${v.queue}`).join(' · '))
console.log('상태:', ['종결', '처리중', '접수'].map((s) => `${s} ${count((p) => p.kind === 'CREATE' && p.statusName === s)}`).join(' · '), '| 채널:', ['채널톡', '전화', null].map((c) => `${c ?? '(없음)'} ${count((p) => p.kind === 'CREATE' && p.draft.channelName === c)}`).join(' · '))
const unmatchedNames = new Map<string, number>()
for (const p of plans) if (p.failClass === 'HOSPITAL_UNMATCHED') unmatchedNames.set(p.draft.hospitalNameRaw!, (unmatchedNames.get(p.draft.hospitalNameRaw!) ?? 0) + 1)
console.log('미매칭 병원명 상위:', Array.from(unmatchedNames.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}(${v})`).join(', '))
if (DRY) {
  console.log('\n[DRY] 생성 샘플:')
  for (const p of plans.filter((p) => p.kind === 'CREATE').filter((_, i) => i % Math.max(1, Math.floor(count((p) => p.kind === 'CREATE') / 8)) === 0).slice(0, 8)) console.log(`  r${p.n} ${p.draft.receivedAt.slice(0, 16)} ${matcher.nameOf(p.hospitalCode!)} [${p.draft.tag ?? p.draft.tagRaw}] ${p.statusName}/${p.draft.channelName} "${p.draft.title}"${p.chatId ? ` ↔ ${p.chatId.slice(0, 8)}` : ''}`)
  console.log('\n[DRY] 적용하려면 --apply')
  await prisma.$disconnect(); process.exit(0)
}

// ── 적용 ──
const alloc = createVocCodeAllocator()
let created = 0, queued = 0, linked = 0, errors = 0
const t0 = Date.now()
for (const p of plans) {
  if (p.kind !== 'CREATE' && p.kind !== 'QUEUE') continue
  try {
    if (p.kind === 'QUEUE') {
      await prisma.vocIntakeItem.create({ data: { source: 'SHEET', sourceRef: p.ref, chatId: p.chatId && !linkedInRun.has(p.chatId) ? (linkedInRun.add(p.chatId), p.chatId) : null, failClass: p.failClass, failNote: p.failClass === 'HOSPITAL_UNMATCHED' ? `시트 병원명 '${p.draft.hospitalNameRaw}'` : `시트 병원 '${p.draft.sheet?.hospital || '(공란)'}'`, draft: p.draft as unknown as Prisma.InputJsonValue } })
      queued++
      continue
    }
    const chatId = p.chatId && !linkedInRun.has(p.chatId) ? p.chatId : null
    for (let attempt = 0; ; attempt++) {
      const vocCode = await alloc.allocate(p.receivedAt)
      try {
        const r = await createVocFromImport({
          title: p.draft.title, hospitalCode: p.hospitalCode, hospitalNameRaw: null,
          content: p.draft.content, resolution: plainToHtml(p.draft.resolution),
          channelId: p.draft.channelName ? channelByName.get(p.draft.channelName) ?? null : null, vocTypeId: p.draft.tag ? typeByTag.get(p.draft.tag)! : null,
          statusId: statusByName.get(p.statusName)!, receivedAt: p.receivedAt, resolvedAt: p.resolvedAt,
          source: 'SHEET', sourceRef: p.ref, vocCode, chatId, linkReason: 'SHEET', linkedById: null,
        }, p.registrantId)
        if (r.chatLinked) { linked++; linkedInRun.add(chatId!) }
        break
      } catch (e) {
        if (attempt < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target ?? '').includes('voc_code')) { alloc.bump(vocCode); continue }
        throw e
      }
    }
    created++
    if ((created + queued) % 500 === 0) console.log(`  … ${created + queued} 처리 (${Math.round((Date.now() - t0) / 1000)}s)`)
  } catch (e) {
    errors++
    console.error(`r${p.n} 실패: ${e instanceof Error ? e.message : String(e)}`)
    if (errors > 20) { console.error('오류 20건 초과 — 중단'); break }
  }
}
console.log(`완료: VOC 생성 ${created} (상담 연결 ${linked}) · 등록대기 ${queued} · 오류 ${errors} · ${Math.round((Date.now() - t0) / 1000)}s`)
await prisma.$disconnect()
