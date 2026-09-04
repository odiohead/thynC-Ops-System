/**
 * 메디인병원 AS이력.xlsx → AS접수 도메인 레코드 + 기기현황 이벤트 (2026-09-04 개정 목적지)
 * 분류 규칙은 구 스크립트(migrate-mediin-as-history.mts)와 동일 — 실행 경로만 도메인 서비스로 교체.
 *
 *   npx tsx scripts/migrate-mediin-as-domain.mts report            # 행별 계획 (쓰기 없음, 기본)
 *   npx tsx scripts/migrate-mediin-as-domain.mts rollback-events   # 구 리허설 태그 이벤트 전량 LIFO 취소
 *   npx tsx scripts/migrate-mediin-as-domain.mts apply             # 도메인 경유 적재 (fix-init 포함 — 멱등)
 *   [--file <xlsx 경로>] [--init-date YYYY-MM-DD]
 *
 * 행 → AS접수 1건(+기기 라인 N) · 코드 AS-{접수월}-NNNN · 티켓 via 'backfill'(createdAt 소급)
 * 라인 결과: F=N 수리반환(REPAIR_RETURN) / F≠N 교체(REPLACE) / M 없음 AS접수만(진행) / 분실 LOST
 * F 미등록은 접수일자에 소급 REGISTER(태그) 후 정상 경로. 이벤트 추적은 ref AS + 소급 REGISTER memo 태그.
 * 재실행 가드: 메디인 as_receipts note 태그 존재 시 중단.
 */
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { PrismaClient, Prisma } from '@prisma/client'
import { registerDevices } from '../lib/deviceRegistry/write'
import { cancelLastEvent, editEvent } from '../lib/deviceRegistry/admin'
import { RegistryError } from '../lib/deviceRegistry/core'
import { matchSerials, openAsFlags, resolveAsLines, AsServiceError } from '../lib/asReceiptService'
import { createTicketForAsReceipt } from '../lib/ticket-domains/asReceipt'

const prisma = new PrismaClient()
const HOSP = 'HOSP-000042'
const MEMO_TAG = '메디인 AS이력'

const args = process.argv.slice(2)
const mode = args.includes('apply') ? 'apply' : args.includes('rollback-events') ? 'rollback-events' : 'report'
const fileIdx = args.indexOf('--file')
const initIdx = args.indexOf('--init-date')
const INIT_DATE = initIdx >= 0 ? args[initIdx + 1] : '2025-05-29'
const FILE = fileIdx >= 0 ? args[fileIdx + 1] : '/mnt/c/Users/USER/Documents/메디인병원_AS이력.xlsx'

function excelDate(n: unknown): string | null {
  if (typeof n !== 'number' || !isFinite(n)) return null
  return new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().slice(0, 10)
}
function serialLines(cell: unknown): { serial: string; ward: string | null }[] {
  if (cell == null) return []
  const out: { serial: string; ward: string | null }[] = []
  for (const line of String(cell).split(/[\r\n]+/)) {
    const tokens = line.toUpperCase().match(/[A-Z]\d{4,7}/g)
    if (!tokens) continue
    const wardM = line.match(/(\d+[A-Za-z가-힣]*\s*병동|중환자실)/)
    const ward = wardM ? wardM[1].replace(/\s+/g, '') : null
    for (const t of tokens) out.push({ serial: t, ward })
  }
  return out
}

interface LinePlan {
  serial: string
  ward: string | null
  backfill: boolean
  kind: 'repair' | 'replace' | 'open-only' | 'lost'
  newSerial?: string
  note: string
}
interface RowPlan {
  row: number
  date: string // 접수일 A
  outDate: string // 처리일 M ?? K ?? A
  lost: boolean
  lines: LinePlan[]
}

/** 접수월 기반 백필 코드 — AS-{YYYYMM}-NNNN (라이브 발번은 현재 월만 쓰므로 충돌 없음) */
async function backfillAsCode(tx: Prisma.TransactionClient, receiptDate: string): Promise<string> {
  const prefix = `AS-${receiptDate.slice(0, 7).replace('-', '')}-`
  const last = await tx.asReceipt.findFirst({
    where: { asCode: { startsWith: prefix } },
    orderBy: { asCode: 'desc' },
    select: { asCode: true },
  })
  const seq = last ? parseInt(last.asCode.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(seq).padStart(4, '0')}`
}

async function main() {
  const actor = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true, name: true } })
  if (!actor) throw new Error('SUPER_ADMIN 없음')
  const actorRef = { userId: actor.id, name: actor.name }

  // ── rollback-events: 구 리허설 태그 이벤트 전량 LIFO 취소 ──
  if (mode === 'rollback-events') {
    let n = 0
    for (;;) {
      const ev = await prisma.hospitalDeviceEvent.findFirst({
        where: { hospitalCode: HOSP, memo: { startsWith: MEMO_TAG } },
        orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
        select: { id: true, eventType: true, occurredOn: true },
      })
      if (!ev) break
      await cancelLastEvent({ hospitalCode: HOSP, actor: actorRef }, { eventId: ev.id })
      n++
      if (n % 50 === 0) console.log(`  … ${n}건 취소`)
    }
    const left = await prisma.hospitalDeviceEvent.count({ where: { hospitalCode: HOSP, memo: { startsWith: MEMO_TAG } } })
    const st = await prisma.hospitalDevice.groupBy({ by: ['status'], where: { hospitalCode: HOSP }, _count: true })
    console.log(`rollback-events 완료: 취소 호출 ${n}회 · 잔여 태그 이벤트 ${left}건 · 배치 ${st.map((x) => `${x.status}=${x._count}`).join(' · ')}`)
    await prisma.$disconnect()
    return
  }

  // ── 파싱·분류 (구 스크립트와 동일 규칙) ──
  const wb = XLSX.read(readFileSync(FILE))
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as unknown[][]
  const rows = raw.slice(1).filter((r) => r && (r[1] != null || r[5] != null))

  const placed = await prisma.hospitalDevice.findMany({
    where: { hospitalCode: HOSP, status: 'ACTIVE' },
    include: { unit: { select: { serialNo: true } } },
  })
  const taggedEvents = await prisma.hospitalDeviceEvent.count({ where: { hospitalCode: HOSP, memo: { startsWith: MEMO_TAG } } })
  const existingReceipts = await prisma.asReceipt.count({ where: { hospitalCode: HOSP, note: { startsWith: MEMO_TAG } } })
  console.log(`시작 상태: ACTIVE ${placed.length}대 · 구 태그 이벤트 ${taggedEvents}건 · 기존 마이그 AS접수 ${existingReceipts}건 · 모드 ${mode}`)
  if (mode === 'apply' && existingReceipts > 0) {
    console.error('이미 마이그 AS접수가 있습니다 — 중단'); process.exit(2)
  }
  if (mode === 'apply' && taggedEvents > 0) {
    console.error('구 리허설 태그 이벤트가 남아 있습니다 — 먼저 rollback-events를 실행하세요'); process.exit(2)
  }

  const active = new Set(placed.map((p) => p.unit.serialNo))
  const manual: string[] = []
  interface Raw { row: number; a: string | null; out: string | null; m: string | null; kindTxt: string; done: string; wardCol: string }
  const parsed: { r: Raw; olds: { serial: string; ward: string | null }[]; news: string[] }[] = []
  rows.forEach((r, i) => {
    parsed.push({
      r: {
        row: i + 2,
        a: excelDate(r[0]),
        out: excelDate(r[12]) ?? excelDate(r[10]) ?? excelDate(r[0]),
        m: excelDate(r[12]),
        kindTxt: String(r[3] ?? '').trim(),
        done: String(r[14] ?? '').trim(),
        wardCol: String(r[2] ?? '').trim(),
      },
      olds: serialLines(r[5]),
      news: serialLines(r[13]).map((x) => x.serial),
    })
  })
  parsed.sort((x, y) => (x.r.a ?? '').localeCompare(y.r.a ?? '') || x.r.row - y.r.row)

  const plans: RowPlan[] = []
  for (const { r, olds, news } of parsed) {
    if (!r.a) { manual.push(`${r.row}행: 접수일자 없음`); continue }
    if (olds.length === 0) { manual.push(`${r.row}행: F열 시리얼 없음`); continue }
    if (news.length > 0 && olds.length !== news.length) { manual.push(`${r.row}행: 구${olds.length}↔신${news.length} 개수 불일치`); continue }
    const lost = r.kindTxt.includes('분실')
    const plan: RowPlan = { row: r.row, date: r.a, outDate: r.out ?? r.a, lost, lines: [] }
    for (let k = 0; k < olds.length; k++) {
      const o = olds[k]
      const nw = news[k]
      const ward = o.ward ?? (r.wardCol && !/[\r\n,\s]/.test(r.wardCol) ? r.wardCol : null)
      const backfill = !active.has(o.serial)
      if (!r.m) {
        plan.lines.push({ serial: o.serial, ward, backfill, kind: 'open-only', note: `미발송 — AS 접수만${nw && nw !== o.serial ? ` (선교체 배정 ${nw})` : ''}${backfill ? ' · 소급 등록' : ''}` })
        if (backfill) active.add(o.serial)
        continue
      }
      if (!nw) {
        if (lost) { plan.lines.push({ serial: o.serial, ward, backfill, kind: 'lost', note: '분실 회수' }); active.delete(o.serial) }
        else plan.lines.push({ serial: o.serial, ward, backfill, kind: 'open-only', note: r.done === '완료' ? '완료인데 N 없음 — AS 접수만' : '미완료 — AS 접수만' })
        continue
      }
      if (o.serial === nw) {
        plan.lines.push({ serial: o.serial, ward, backfill, kind: 'repair', note: backfill ? '소급 등록 + 수리 반환' : '수리 반환' })
        active.add(o.serial)
      } else {
        plan.lines.push({ serial: o.serial, ward, backfill, kind: 'replace', newSerial: nw, note: backfill ? '소급 교체' : '교체' })
        active.delete(o.serial)
        active.add(nw)
      }
    }
    if (plan.lines.length) plans.push(plan)
  }

  const allLines = plans.flatMap((p) => p.lines)
  const cnt = (k: LinePlan['kind']) => allLines.filter((l) => l.kind === k).length
  console.log(`\n행 ${rows.length} → 접수 ${plans.length}건 · 라인 ${allLines.length}건: 수리반환 ${cnt('repair')} · 교체 ${cnt('replace')} · AS접수만 ${cnt('open-only')} · 분실 ${cnt('lost')} · 소급 ${allLines.filter((l) => l.backfill).length}`)
  console.log(`예상 최종 ACTIVE: ${active.size}대 · 예상 진행 중 접수(open-only 보유): ${plans.filter((p) => p.lines.some((l) => l.kind === 'open-only')).length}건`)
  if (manual.length) { console.log(`\n⚠ 수동 확인(접수 미생성) ${manual.length}건:`); manual.forEach((m) => console.log('  -', m)) }

  if (mode === 'report') {
    console.log('\n── 행별 계획 (앞 12건) ──')
    for (const p of plans.slice(0, 12)) {
      console.log(`  ${p.row}행 ${p.date} ${p.lost ? '[분실]' : '[고장]'} 처리일 ${p.outDate}`)
      for (const l of p.lines) console.log(`     - [${l.kind}] ${l.serial}${l.newSerial ? ' → ' + l.newSerial : ''}${l.ward ? ' @' + l.ward : ''}${l.backfill ? ' (소급)' : ''} — ${l.note}`)
    }
    console.log(`  … 외 ${Math.max(0, plans.length - 12)}건`)
    await prisma.$disconnect()
    return
  }

  // ── apply ──
  // fix-init (멱등 — 이미 정정돼 있으면 0건): 태그 없는 초기 REGISTER 중 첫 AS 이후 일자만 INIT_DATE로
  const firstAs = plans.reduce((m, p) => (p.date < m ? p.date : m), '9999-12-31')
  const initEvents = await prisma.hospitalDeviceEvent.findMany({
    where: {
      hospitalCode: HOSP, eventType: 'REGISTER',
      OR: [{ memo: null }, { NOT: { memo: { startsWith: MEMO_TAG } } }],
      refType: null, // 도메인 마이그 이벤트(ref AS) 제외
      occurredOn: { gt: new Date(firstAs) },
    },
    select: { id: true },
  })
  console.log(`fix-init: 초기 REGISTER ${initEvents.length}건 → ${INIT_DATE} 소급 정정`)
  for (const ev of initEvents) {
    await editEvent({ hospitalCode: HOSP, actor: actorRef }, { eventId: ev.id, patch: { occurredOn: INIT_DATE } })
  }

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: HOSP }, select: { hospitalName: true } })
  const openStatus = await prisma.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '접수' }, select: { id: true } })
  if (!hospital || !openStatus) throw new Error('병원/상태 마스터 없음')

  let okRows = 0
  let okLines = 0
  const errors: string[] = []
  const warnAgg: string[] = []

  for (const p of plans) {
    try {
      // 1) 소급 등록 (미등록 라인 — 접수일자, 태그 memo)
      for (const l of p.lines) {
        if (!l.backfill) continue
        await registerDevices(
          { hospitalCode: HOSP, actor: actorRef, occurredOn: p.date, source: 'MANUAL', memo: `${MEMO_TAG} r${p.row} 소급` },
          [{ serialInput: l.serial, wardName: l.ward, productType: '일반' }]
        )
      }
      // 2) 접수 생성 (레코드+라인+티켓 backfill+AS 표시) — 단일 트랜잭션
      const matches = await matchSerials(prisma, HOSP, p.lines.map((l) => l.serial))
      const receiptId = await prisma.$transaction(async (tx) => {
        const createdAt = new Date(p.date)
        const r = await tx.asReceipt.create({
          data: {
            asCode: await backfillAsCode(tx, p.date),
            hospitalCode: HOSP,
            category: p.lost ? 'LOST' : 'FAULT',
            receiptDate: new Date(p.date),
            statusId: openStatus.id,
            note: `${MEMO_TAG} r${p.row}`,
            createdById: actor.id,
            createdAt,
            statusChangedAt: createdAt,
          },
        })
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i]
          const l = p.lines[i]
          await tx.asReceiptItem.create({
            data: {
              receiptId: r.id, serialNo: m.serialNo, deviceId: m.deviceId,
              wardName: l.ward ?? m.wardName, processNote: l.note,
              deviceKind: m.deviceId ? null : '기타',
            },
          })
        }
        await createTicketForAsReceipt(tx, {
          id: r.id, asCode: r.asCode, hospitalCode: HOSP, hospitalName: hospital.hospitalName,
          category: r.category, statusName: '접수', statusId: r.statusId,
          description: `${MEMO_TAG} r${p.row} — 라인 ${p.lines.length}건`, resolvedAt: null, createdAt,
        }, actor.id, 'backfill')
        const w = await openAsFlags(tx, { asCode: r.asCode, hospitalCode: HOSP },
          matches.filter((m) => m.state === 'ACTIVE_HERE').map((m) => ({ serialNo: m.serialNo, deviceId: m.deviceId! })),
          actorRef, p.date)
        w.forEach((x) => warnAgg.push(`r${p.row}: ${x}`))
        return r.id
      }, { timeout: 60000 })

      // 3) 라인 결과 확정 (open-only 제외)
      const items = await prisma.asReceiptItem.findMany({ where: { receiptId }, orderBy: { id: 'asc' } })
      const itemBySerial = new Map(items.map((i) => [i.serialNo, i]))
      for (const l of p.lines) {
        if (l.kind === 'open-only') { okLines++; continue }
        const item = itemBySerial.get(l.serial)
        if (!item) throw new Error(`${l.serial} 라인 조회 실패`)
        const outcome = l.kind === 'repair' ? 'REPAIR_RETURN' : l.kind === 'replace' ? 'REPLACE' : 'LOST'
        const res = await resolveAsLines(receiptId, actorRef, {
          lines: [{ itemId: item.id, outcome, newSerial: l.newSerial ?? null }],
          effectiveDate: p.outDate,
        })
        res.warnings.forEach((x) => warnAgg.push(`r${p.row}: ${x}`))
        okLines++
      }
      okRows++
    } catch (e) {
      const msg = e instanceof RegistryError || e instanceof AsServiceError ? `${(e as RegistryError).status} ${e.message}` : String((e as Error).message ?? e)
      errors.push(`${p.row}행: ${msg}`)
    }
  }

  console.log(`\napply 완료: 접수 성공 ${okRows}/${plans.length} · 라인 처리 ${okLines} · 실패 ${errors.length}`)
  if (errors.length) errors.forEach((e) => console.log('  ❌', e))
  if (warnAgg.length) { console.log(`\n경고 ${warnAgg.length}건 (앞 10):`); warnAgg.slice(0, 10).forEach((w) => console.log('  ⚠', w)) }

  // 검증
  const after = await prisma.hospitalDevice.groupBy({ by: ['status'], where: { hospitalCode: HOSP }, _count: true })
  const asOpen = await prisma.hospitalDevice.findMany({
    where: { hospitalCode: HOSP, status: 'ACTIVE', asStartedOn: { not: null } },
    include: { unit: { select: { serialNo: true } } },
  })
  const evByType = await prisma.hospitalDeviceEvent.groupBy({ by: ['eventType'], where: { hospitalCode: HOSP, refType: 'AS' }, _count: true })
  const rec = await prisma.asReceipt.groupBy({ by: ['statusId'], where: { hospitalCode: HOSP, note: { startsWith: MEMO_TAG } }, _count: true })
  const statusNames = new Map((await prisma.statusCode.findMany({ where: { category: 'AS_STATUS' } })).map((s) => [s.id, s.name]))
  const tk = await prisma.ticket.groupBy({ by: ['status'], where: { refType: 'AS', asReceipt: { hospitalCode: HOSP, note: { startsWith: MEMO_TAG } } }, _count: true })
  console.log('\n── 검증 ──')
  console.log('배치 상태:', after.map((x) => `${x.status}=${x._count}`).join(' · '))
  console.log(`AS진행중: ${asOpen.length} — ${asOpen.map((x) => x.unit.serialNo).join(', ')}`)
  console.log('ref AS 이벤트:', evByType.map((x) => `${x.eventType}=${x._count}`).join(' · '))
  console.log('AS접수 상태:', rec.map((x) => `${statusNames.get(x.statusId ?? -1) ?? x.statusId}=${x._count}`).join(' · '))
  console.log('티켓 상태:', tk.map((x) => `${x.status}=${x._count}`).join(' · '))
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
