/**
 * thynC AS이력 마스터(3,537행·174병원) → AS접수 도메인 + 기기현황 이벤트 (thync_as_migration_design.md)
 *
 *   npx tsx scripts/migrate-thync-as-history.mts report [--file <xlsx>]   # 분석·게이트(쓰기 없음)
 *   npx tsx scripts/migrate-thync-as-history.mts apply  [--file <xlsx>] [--report-dir <디렉토리>]
 *
 * apply (2026-09-05 사용자 승인):
 *  - 대상: 원장(ACTIVE) 보유 병원 − 메디인(기적용) − 소급률 30%+ 보류 4곳 — 전역 접수일순 replay(이동 시리얼 직렬화)
 *  - 행=AS접수 1건(접수월 코드·티켓 backfill 생성일 소급), 라인=기기(수리반환/교체/AS접수만/분실), 규칙은 §3(X열 판정·보정 3종)
 *  - 행 내 중복 시리얼 dedupe(첫 값), 병원 간 기간 겹침(얽힘) 시리얼 라인은 사전 제외+목록
 *  - 실패는 행·라인 단위 격리(전체 중단 없음). 재실행 가드: note '마스터 AS이력' 존재 시 중단
 *  - 결과: report-dir에 as-migration-result.json + xlsx 리포트
 */
import 'dotenv/config'
import * as XLSX from 'xlsx'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Prisma, PrismaClient } from '@prisma/client'
import { registerDevices } from '../lib/deviceRegistry/write'
import { editEvent } from '../lib/deviceRegistry/admin'
import { RegistryError } from '../lib/deviceRegistry/core'
import { matchSerials, openAsFlags, resolveAsLines, AsServiceError } from '../lib/asReceiptService'
import { createTicketForAsReceipt } from '../lib/ticket-domains/asReceipt'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const MODE = args.includes('apply') ? 'apply' : 'report'
const fileIdx = args.indexOf('--file')
const FILE = fileIdx >= 0 ? args[fileIdx + 1] : '/mnt/c/Users/USER/Documents/thynC_AS이력.xlsx'
const rdIdx = args.indexOf('--report-dir')
const REPORT_DIR = rdIdx >= 0 ? args[rdIdx + 1] : '/mnt/c/Users/USER/Documents/기기현황_초기임포트'
const MEDIIN = 'HOSP-000042'
const NOTE_TAG = '마스터 AS이력'
/** 소급률 30%+ — 원장 대비 이력 불일치 커서 보류 (2026-09-05 report 실측) */
const HOLD_NAMES = ['의료법인성지의료재단성지병원', '명지성모병원', '세웅종합병원', '아주대학교의료원']

function excelDate(n: unknown): string | null {
  if (typeof n !== 'number' || !isFinite(n) || n < 40000 || n > 50000) return null
  return new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().slice(0, 10)
}
const CANON = /^[APB]\d{6}$/
interface Tok { serial: string; ward: string | null; canonical: boolean }
function serialTokens(cell: unknown): { toks: Tok[]; bares: string[] } {
  const toks: Tok[] = []
  const bares: string[] = []
  if (cell == null) return { toks, bares }
  for (let line of String(cell).split(/[\r\n]+/)) {
    const arrow = line.split(/->|→/)
    if (arrow.length > 1) line = arrow[arrow.length - 1]
    const up = line.toUpperCase()
    const wardM = line.match(/(\d+[A-Za-z가-힣]*\s*병동|중환자실|응급실)/)
    const ward = wardM ? wardM[1].replace(/\s+/g, '') : null
    const found = up.match(/[A-Z]{1,2}\d{4,8}/g)
    if (found) {
      for (let t of found) {
        if (/^PO\d/.test(t)) t = 'P0' + t.slice(2)
        toks.push({ serial: t, ward, canonical: CANON.test(t) })
      }
    } else {
      const digits = up.match(/(?<![A-Z0-9])\d{5,7}(?![0-9])/g)
      if (digits) bares.push(...digits)
    }
  }
  return { toks, bares }
}

type Kind = 'repair' | 'replace' | 'open-only' | 'lost'
interface Line { serial: string; ward: string | null; kind: Kind; newSerial?: string; canonical: boolean; symptomHint?: string | null }
interface Row {
  row: number; hospRaw: string; date: string; outDate: string
  category: 'FAULT' | 'LOST'; lines: Line[]; extraNews: string[]
}

async function main() {
  const wb = XLSX.read(readFileSync(FILE))
  const raw = XLSX.utils.sheet_to_json(wb.Sheets['AS'], { header: 1 }) as unknown[][]
  const rows = raw.slice(1).filter((r) => r && (r[0] != null || r[1] != null))

  // ── 병원명 매칭 — 고객사 풀(프로젝트 보유) + 별칭(학교 축약·법인·괄호) ──
  const hospitals = await prisma.hospital.findMany({ where: { projects: { some: {} } }, select: { hospitalCode: true, hospitalName: true } })
  const norm = (x: string) =>
    x.replace(/^\d{8}[_ ]?/, '').replace(/[_ ]?\d+차$/, '').replace(/\(.*?\)/g, '')
      .replace(/^(의료법인|재단법인|사회복지법인|학교법인)\S*재단/, '').replace(/^\(의\)|^\(재\)|^\(의료\)/, '').replace(/\s+/g, '')
  const aliases = (rawName: string): Set<string> => {
    const out = new Set<string>()
    const b = norm(rawName)
    if (b) out.add(b)
    const sh = b.replace(/학교|의과대학|대학\s*교/g, '')
    if (sh) out.add(sh)
    for (const m of rawName.matchAll(/\(([^)]+)\)/g)) {
      const inner = m[1].replace(/\s+/g, '')
      if (inner.length >= 3 && /병원|의료원|센터/.test(inner)) { out.add(inner); out.add(inner.replace(/학교|의과대학/g, '')) }
    }
    return out
  }
  const byAlias = new Map<string, string[]>()
  for (const h of hospitals) for (const k of aliases(h.hospitalName)) {
    const arr = byAlias.get(k) ?? []
    if (!arr.includes(h.hospitalCode)) arr.push(h.hospitalCode)
    byAlias.set(k, arr)
  }
  const cache = new Map<string, string | null>()
  const matchHosp = (rawName: string): string | null => {
    if (cache.has(rawName)) return cache.get(rawName)!
    let code: string | null = null
    const keys = aliases(rawName)
    for (const k of keys) { const arr = byAlias.get(k) ?? []; if (arr.length === 1) { code = arr[0]; break } }
    if (!code) {
      const cands = new Set<string>()
      for (const [ak, arr] of byAlias.entries()) for (const k of keys) {
        if (k.length < 4 || ak.length < 4) continue
        if (ak.includes(k) || k.includes(ak)) arr.forEach((c) => cands.add(c))
      }
      if (cands.size === 1) code = [...cands.values()][0]
    }
    cache.set(rawName, code)
    return code
  }
  const hospName = new Map(hospitals.map((h) => [h.hospitalCode, h.hospitalName]))

  // ── 행 파싱·분류 (§3-1 X열 + 보정 3종 + 행내 dedupe) ──
  const parsed: Row[] = []
  const skip: Record<string, number> = { 시리얼없음: 0, 빈X: 0, 개수불일치: 0, 추가제공: 0, 분실철회: 0, 병원미매칭: 0, 접수일없음: 0, 행내중복: 0 }
  const manualRows: string[] = []
  rows.forEach((r, i) => {
    const rowNo = i + 2
    const hospRaw = String(r[1] ?? '').trim()
    const a = excelDate(r[0])
    const kindTxt = String(r[3] ?? '').trim()
    const done = String(r[23] ?? '').trim()
    const v = excelDate(r[21])
    const outDate = v ?? excelDate(r[13]) ?? a
    const wardCol = String(r[2] ?? '').trim()
    if (kindTxt.includes('추가 제공') || kindTxt.includes('추가제공')) { skip.추가제공++; manualRows.push(`${rowNo}행 [추가 제공] ${hospRaw}`); return }
    if (kindTxt.includes('철회')) { skip.분실철회++; manualRows.push(`${rowNo}행 [분실 철회] ${hospRaw}`); return }
    if (!a) { skip.접수일없음++; manualRows.push(`${rowNo}행: 접수일자 없음 (${hospRaw})`); return }
    const f = serialTokens(r[5])
    const w = serialTokens(r[22])
    for (const b of f.bares) {
      const cand = w.toks.find((t) => t.serial.endsWith(b))
      if (cand) f.toks.push({ serial: cand.serial, ward: null, canonical: cand.canonical })
    }
    // 행 내 중복 dedupe (첫 값 유지)
    const seenF = new Set<string>()
    const olds = f.toks.filter((t) => { if (seenF.has(t.serial)) { skip.행내중복++; return false } seenF.add(t.serial); return true })
    if (olds.length === 0) { skip.시리얼없음++; return }
    if (!done) { skip.빈X++; manualRows.push(`${rowNo}행: X열 빈값 (${hospRaw}, F ${olds.length}대)`); return }
    const lost = kindTxt.includes('분실')
    const isDone = done.includes('완료') && !done.includes('미완료')
    let news = w.toks.map((t) => t.serial)
    let extraNews: string[] = []
    if (isDone && news.length > olds.length) { extraNews = news.slice(olds.length); news = news.slice(0, olds.length) }
    if (isDone && news.length > 0 && news.length < olds.length) { skip.개수불일치++; manualRows.push(`${rowNo}행: 구${olds.length}↔신${news.length} 개수 부족 (${hospRaw})`); return }
    const symptom = String(r[8] ?? '').trim() || null
    const lines: Line[] = []
    for (let k = 0; k < olds.length; k++) {
      const o = olds[k]
      const ward = o.ward ?? (wardCol && !/[\r\n,\s]/.test(wardCol) ? wardCol : null)
      if (!isDone) { lines.push({ serial: o.serial, ward, kind: 'open-only', canonical: o.canonical, symptomHint: symptom }); continue }
      const nw = news[k]
      if (!nw) lines.push({ serial: o.serial, ward, kind: lost ? 'lost' : 'repair', canonical: o.canonical, symptomHint: symptom })
      else if (nw === o.serial) lines.push({ serial: o.serial, ward, kind: 'repair', canonical: o.canonical, symptomHint: symptom })
      else lines.push({ serial: o.serial, ward, kind: 'replace', newSerial: nw, canonical: o.canonical, symptomHint: symptom })
    }
    parsed.push({ row: rowNo, hospRaw, date: a, outDate: outDate ?? a, category: lost ? 'LOST' : 'FAULT', lines, extraNews })
  })
  parsed.sort((x, y) => x.date.localeCompare(y.date) || x.row - y.row) // 전역 접수일순 — 이동 시리얼 직렬화

  // ── 얽힘 시리얼(병원 간 기간 겹침) 사전 산출 — 라인 제외 대상 ──
  const spanBy = new Map<string, Map<string, { min: string; max: string }>>()
  for (const p of parsed) {
    const c = matchHosp(p.hospRaw)
    if (!c) continue
    const add = (s: string, d: string) => {
      const m = spanBy.get(s) ?? new Map()
      const sp = m.get(c) ?? { min: d, max: d }
      if (d < sp.min) sp.min = d
      if (d > sp.max) sp.max = d
      m.set(c, sp)
      spanBy.set(s, m)
    }
    for (const l of p.lines) { add(l.serial, p.date); if (l.newSerial) add(l.newSerial, p.outDate) }
  }
  const tangled = new Set<string>()
  for (const [s, m] of spanBy.entries()) {
    if (m.size < 2) continue
    const spans = [...m.values()].sort((x, y) => x.min.localeCompare(y.min))
    for (let i = 1; i < spans.length; i++) if (spans[i].min < spans[i - 1].max) { tangled.add(s); break }
  }

  // ── 원장 상태·대상 병원 ──
  const activeRows = await prisma.hospitalDevice.findMany({
    where: { status: 'ACTIVE', hospitalCode: { not: null } },
    select: { hospitalCode: true, unit: { select: { serialNo: true } } },
  })
  const regSerials = new Map<string, Set<string>>()
  for (const a of activeRows) {
    const set = regSerials.get(a.hospitalCode!) ?? new Set<string>()
    set.add(a.unit.serialNo)
    regSerials.set(a.hospitalCode!, set)
  }
  const holdCodes = new Set<string>()
  for (const n of HOLD_NAMES) { const c = matchHosp(n); if (c) holdCodes.add(c) }
  const eligible = (c: string | null): { ok: boolean; why: string } => {
    if (!c) return { ok: false, why: '병원 미매칭' }
    if (c === MEDIIN) return { ok: false, why: '메디인 — 기적용' }
    if (holdCodes.has(c)) return { ok: false, why: '소급률 30%+ 보류' }
    if (!(regSerials.get(c)?.size ?? 0)) return { ok: false, why: '원장 미보유(중복 제외·파일 없음 등)' }
    return { ok: true, why: '' }
  }

  // ── report 요약 ──
  const allLines = parsed.flatMap((p) => p.lines)
  const cnt = (k: Kind) => allLines.filter((l) => l.kind === k).length
  console.log(`총 ${rows.length}행 → 접수 후보 ${parsed.length}행 · 라인 ${allLines.length}건 (수리반환 ${cnt('repair')} · 교체 ${cnt('replace')} · 미완료 ${cnt('open-only')} · 분실 ${cnt('lost')} · 추가발송 ${parsed.reduce((s, p) => s + p.extraNews.length, 0)})`)
  console.log(`제외: ${Object.entries(skip).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
  console.log(`얽힘 시리얼(사전 제외): ${tangled.size}개`)
  const elig = parsed.filter((p) => eligible(matchHosp(p.hospRaw)).ok)
  const eligHosp = new Set(elig.map((p) => matchHosp(p.hospRaw)))
  console.log(`apply 대상: 병원 ${eligHosp.size}곳 · 행 ${elig.length} · 라인 ${elig.reduce((s, p) => s + p.lines.length, 0)}`)
  if (MODE === 'report') { await prisma.$disconnect(); return }

  // ── apply ──
  const guard = await prisma.asReceipt.count({ where: { note: { startsWith: NOTE_TAG } } })
  if (guard > 0) { console.error(`이미 '${NOTE_TAG}' 접수 ${guard}건 존재 — 중단 (백업 복원 후 재실행)`); process.exit(2) }
  const actor = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true, name: true } })
  if (!actor) throw new Error('SUPER_ADMIN 없음')
  const actorRef = { userId: actor.id, name: actor.name }
  const openStatus = await prisma.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '접수' }, select: { id: true } })
  if (!openStatus) throw new Error("AS_STATUS '접수' 없음 — seed-as-masters.sql 확인")

  // ── fix-init (메디인 선례) — 대상 병원의 초기 REGISTER(IMPORT·당일 등록분)를 계약일(없으면 첫 AS 전날)로 소급 ──
  // 임포트 등록일(오늘)이 AS이력(과거)보다 늦으면 stateAt이 NONE이 되어 전 이벤트가 불성립하기 때문 (2026-09-05 1차 실패 원인)
  {
    const firstAsBy = new Map<string, string>()
    for (const p of parsed) {
      const c = matchHosp(p.hospRaw)
      if (!c || !eligible(c).ok) continue
      const cur = firstAsBy.get(c)
      if (!cur || p.date < cur) firstAsBy.set(c, p.date)
    }
    const dayBefore = (ymd: string) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
    let patched = 0
    let hospDone = 0
    for (const [c, firstAs] of firstAsBy.entries()) {
      const deal = await prisma.salesDeal.findFirst({
        where: { hospitalCode: c, contractDate: { not: null }, status: { name: '계약완료' } },
        orderBy: { contractDate: 'asc' },
        select: { contractDate: true },
      })
      const dealYmd = deal?.contractDate ? deal.contractDate.toISOString().slice(0, 10) : null
      const initDate = dealYmd && dealYmd < firstAs ? dealYmd : dayBefore(firstAs)
      const evs = await prisma.hospitalDeviceEvent.findMany({
        where: { hospitalCode: c, eventType: 'REGISTER', source: 'IMPORT', refType: null, occurredOn: { gt: new Date(`${initDate}T00:00:00Z`) } },
        select: { id: true },
      })
      for (const ev of evs) {
        await editEvent({ hospitalCode: c, actor: actorRef }, { eventId: ev.id, patch: { occurredOn: initDate } })
        if (++patched % 1000 === 0) console.log(`  fix-init … ${patched}건`)
      }
      if (++hospDone % 20 === 0) console.log(`  fix-init 병원 ${hospDone}곳`)
    }
    console.log(`fix-init 완료: ${hospDone}곳 · 초기 REGISTER ${patched}건 소급`)
  }

  async function backfillAsCode(tx: Prisma.TransactionClient, receiptDate: string): Promise<string> {
    const prefix = `AS-${receiptDate.slice(0, 7).replace('-', '')}-`
    const last = await tx.asReceipt.findFirst({ where: { asCode: { startsWith: prefix } }, orderBy: { asCode: 'desc' }, select: { asCode: true } })
    const seq = last ? parseInt(last.asCode.slice(prefix.length), 10) + 1 : 1
    return `${prefix}${String(seq).padStart(4, '0')}`
  }

  interface HospStat {
    code: string; name: string; receipts: number; lines: number; repair: number; replace: number; open: number; lost: number
    backfillReg: number; extraReg: number; skippedLines: number; failedLines: number; failedRows: number
  }
  const stats = new Map<string, HospStat>()
  const statOf = (c: string) => {
    const s = stats.get(c) ?? { code: c, name: hospName.get(c) ?? c, receipts: 0, lines: 0, repair: 0, replace: 0, open: 0, lost: 0, backfillReg: 0, extraReg: 0, skippedLines: 0, failedLines: 0, failedRows: 0 }
    stats.set(c, s)
    return s
  }
  const manualLines: string[] = [] // 수동 확인 목록 (얽힘·타 병원·실패)
  const notEligRows = new Map<string, number>()
  let done = 0

  for (const p of parsed) {
    const code = matchHosp(p.hospRaw)
    const e = eligible(code)
    if (!e.ok) { notEligRows.set(`${p.hospRaw} — ${e.why}`, (notEligRows.get(`${p.hospRaw} — ${e.why}`) ?? 0) + 1); continue }
    const st = statOf(code!)
    try {
      // 얽힘 라인 사전 제외
      const useLines = p.lines.filter((l) => {
        if (tangled.has(l.serial) || (l.newSerial && tangled.has(l.newSerial))) {
          st.skippedLines++
          manualLines.push(`r${p.row} ${st.name} ${l.serial}${l.newSerial ? '→' + l.newSerial : ''}: 병원 간 기간 겹침(얽힘) — 수동 확인`)
          return false
        }
        return true
      })
      if (!useLines.length) { st.failedRows++; continue }

      // 매칭 + 소급 등록(원장에 없음 → 접수일 REGISTER) / 타 병원 ACTIVE 라인은 제외+목록
      let matches = await matchSerials(prisma, code!, useLines.map((l) => l.serial))
      const finalLines: Line[] = []
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i]
        const l = useLines[i]
        if (m.state === 'ACTIVE_OTHER') {
          st.skippedLines++
          manualLines.push(`r${p.row} ${st.name} ${l.serial}: 타 병원(${m.hospitalName}) ACTIVE — 수동 확인`)
          continue
        }
        if (m.state !== 'ACTIVE_HERE') {
          try {
            await registerDevices(
              { hospitalCode: code!, actor: actorRef, occurredOn: p.date, source: 'MANUAL', memo: `${NOTE_TAG} r${p.row} 소급` },
              [{ serialInput: l.serial, wardName: l.ward, productType: undefined }]
            )
            st.backfillReg++
          } catch (err) {
            st.skippedLines++
            manualLines.push(`r${p.row} ${st.name} ${l.serial}: 소급 등록 실패 — ${err instanceof RegistryError ? err.message : String(err)}`)
            continue
          }
        }
        finalLines.push(l)
      }
      if (!finalLines.length) { st.failedRows++; continue }
      matches = await matchSerials(prisma, code!, finalLines.map((l) => l.serial))

      // 접수 생성 (레코드+라인+티켓 backfill+AS 표시)
      const receiptId = await prisma.$transaction(async (tx) => {
        const createdAt = new Date(p.date)
        const r = await tx.asReceipt.create({
          data: {
            asCode: await backfillAsCode(tx, p.date), hospitalCode: code!, category: p.category,
            receiptDate: new Date(p.date), statusId: openStatus.id, note: `${NOTE_TAG} r${p.row}`,
            createdById: actor.id, createdAt, statusChangedAt: createdAt,
          },
        })
        for (let i = 0; i < matches.length; i++) {
          await tx.asReceiptItem.create({
            data: {
              receiptId: r.id, serialNo: matches[i].serialNo, deviceId: matches[i].deviceId,
              wardName: finalLines[i].ward ?? matches[i].wardName, symptom: finalLines[i].symptomHint ?? null,
            },
          })
        }
        await createTicketForAsReceipt(tx, {
          id: r.id, asCode: r.asCode, hospitalCode: code!, hospitalName: st.name, category: p.category,
          statusName: '접수', statusId: r.statusId, description: `${NOTE_TAG} r${p.row}`, resolvedAt: null, createdAt,
        }, actor.id, 'backfill')
        await openAsFlags(tx, { asCode: r.asCode, hospitalCode: code! },
          matches.filter((m) => m.state === 'ACTIVE_HERE' && !m.asOpen).map((m) => ({ serialNo: m.serialNo, deviceId: m.deviceId! })),
          actorRef, p.date)
        return r.id
      }, { timeout: 60000 })
      st.receipts++

      // 라인 결과 확정
      const items = await prisma.asReceiptItem.findMany({ where: { receiptId }, orderBy: { id: 'asc' } })
      const itemBySerial = new Map(items.map((i) => [i.serialNo, i]))
      for (const l of finalLines) {
        st.lines++
        if (l.kind === 'open-only') { st.open++; continue }
        const item = itemBySerial.get(l.serial)
        if (!item) { st.failedLines++; manualLines.push(`r${p.row} ${st.name} ${l.serial}: 라인 조회 실패`); continue }
        try {
          const outcome = l.kind === 'repair' ? 'REPAIR_RETURN' : l.kind === 'replace' ? 'REPLACE' : 'LOST'
          await resolveAsLines(receiptId, actorRef, {
            lines: [{ itemId: item.id, outcome, newSerial: l.newSerial ?? null }],
            effectiveDate: p.outDate,
          })
          if (l.kind === 'repair') st.repair++
          else if (l.kind === 'replace') st.replace++
          else st.lost++
        } catch (err) {
          st.failedLines++
          const msg = err instanceof AsServiceError || err instanceof RegistryError ? err.message : String((err as Error).message ?? err)
          manualLines.push(`r${p.row} ${st.name} ${l.serial}${l.newSerial ? '→' + l.newSerial : ''} [${l.kind}]: ${msg.slice(0, 120)}`)
        }
      }
      // 보정③ — W 꼬리 추가 발송분 신규 등록
      for (const s of p.extraNews) {
        if (tangled.has(s)) { manualLines.push(`r${p.row} ${st.name} ${s}: 추가발송분 얽힘 — 수동`); continue }
        try {
          await registerDevices(
            { hospitalCode: code!, actor: actorRef, occurredOn: p.outDate, source: 'MANUAL', memo: `${NOTE_TAG} r${p.row} 추가발송` },
            [{ serialInput: s, productType: undefined }]
          )
          st.extraReg++
        } catch (err) {
          manualLines.push(`r${p.row} ${st.name} ${s}: 추가발송 등록 실패 — ${err instanceof RegistryError ? err.message : String(err)}`)
        }
      }
    } catch (err) {
      st.failedRows++
      const msg = err instanceof RegistryError || err instanceof AsServiceError ? err.message : String((err as Error).message ?? err)
      manualLines.push(`r${p.row} ${st.name}: 행 실패 — ${msg.slice(0, 140)}`)
    }
    if (++done % 200 === 0) console.log(`… ${done}행 처리`)
  }

  // ── 결과 저장·요약 ──
  mkdirSync(REPORT_DIR, { recursive: true })
  const statArr = [...stats.values()].sort((a, b) => b.lines - a.lines)
  const tot = (k: keyof HospStat) => statArr.reduce((s, x) => s + (x[k] as number), 0)
  const result = {
    ranAt: new Date().toISOString(), file: FILE,
    totals: {
      hospitals: statArr.length, receipts: tot('receipts'), lines: tot('lines'),
      repair: tot('repair'), replace: tot('replace'), open: tot('open'), lost: tot('lost'),
      backfillReg: tot('backfillReg'), extraReg: tot('extraReg'),
      skippedLines: tot('skippedLines'), failedLines: tot('failedLines'), failedRows: tot('failedRows'),
    },
    hospitals: statArr, manualLines, notEligibleRows: [...notEligRows.entries()].map(([k, n]) => `${k} ×${n}`),
    excludedGlobal: skip, tangledSerials: tangled.size,
  }
  writeFileSync(`${REPORT_DIR}/as-migration-result.json`, JSON.stringify(result, null, 1))
  const wbOut = XLSX.utils.book_new()
  const sh1 = XLSX.utils.aoa_to_sheet([
    ['병원코드', '병원명', '접수', '라인', '수리반환', '교체', '진행중', '분실', '소급등록', '추가발송등록', '라인스킵', '라인실패', '행실패'],
    ...statArr.map((s) => [s.code, s.name, s.receipts, s.lines, s.repair, s.replace, s.open, s.lost, s.backfillReg, s.extraReg, s.skippedLines, s.failedLines, s.failedRows]),
  ])
  XLSX.utils.book_append_sheet(wbOut, sh1, '병원별 결과')
  XLSX.utils.book_append_sheet(wbOut, XLSX.utils.aoa_to_sheet([['수동 확인 목록'], ...manualLines.map((x) => [x])]), '수동 확인')
  XLSX.utils.book_append_sheet(wbOut, XLSX.utils.aoa_to_sheet([['미대상 행(병원 — 사유 × 행수)'], ...result.notEligibleRows.map((x) => [x])]), '미대상')
  XLSX.writeFile(wbOut, `${REPORT_DIR}/_AS이력_마이그결과.xlsx`)

  console.log(`\napply 완료: 병원 ${result.totals.hospitals} · 접수 ${result.totals.receipts} · 라인 ${result.totals.lines} (수리 ${result.totals.repair} · 교체 ${result.totals.replace} · 진행중 ${result.totals.open} · 분실 ${result.totals.lost})`)
  console.log(`소급 등록 ${result.totals.backfillReg} · 추가발송 등록 ${result.totals.extraReg} · 라인 스킵 ${result.totals.skippedLines} · 라인 실패 ${result.totals.failedLines} · 행 실패 ${result.totals.failedRows}`)
  console.log(`수동 확인 ${manualLines.length}건 → ${REPORT_DIR}/_AS이력_마이그결과.xlsx`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
