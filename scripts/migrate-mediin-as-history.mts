/**
 * 메디인병원 AS이력.xlsx → 기기현황 순차 마이그레이션 (리허설/실행 공용)
 *
 *   npx tsx scripts/migrate-mediin-as-history.mts report   # 파싱·분류·행별 계획만 (쓰기 없음, 기본)
 *   npx tsx scripts/migrate-mediin-as-history.mts apply    # 서비스 함수로 순차 기록 (dev2 리허설 → 승인 후 PROD 1회)
 *   [--file <xlsx 경로>]  기본 /mnt/c/Users/USER/Documents/메디인병원_AS이력.xlsx
 *
 * 분류 규칙 (F=기존 기기 · N=교체 제공 기기, 줄 순서 쌍 매칭 — L열은 신뢰하지 않음):
 *  - F=N(수리 반환)       : [AS 접수](A 접수일) → [AS 해제](M 발송일, 없으면 K→A)
 *  - F≠N(교체)            : [AS 접수](A) → replaceDevice(M) — 사유 DEFECT(분실 행은 LOST), AS는 fold 자동 해제
 *  - N 없음·미완료        : [AS 접수]만 (진행 중 상태로 남김)
 *  - N 없음·분실          : recoverDevice(LOST)
 *  - F 미등록(원장에 없음): 수리 반환이면 소급 REGISTER 후 AS 접수/해제, 교체면 replaceDevice 소급 경로(oldWardName)
 * 규칙에 안 맞는 행은 자동 처리하지 않고 '수동 확인' 목록으로 남긴다.
 * 이벤트 memo '메디인 AS이력 r{엑셀행}' — 재실행 가드 겸 추적 태그.
 */
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { registerDevices, replaceDevice, recoverDevice, openDeviceAs, clearDeviceAs } from '../lib/deviceRegistry/write'
import { editEvent } from '../lib/deviceRegistry/admin'
import { findUnitsBySerial, RegistryError } from '../lib/deviceRegistry/core'

const prisma = new PrismaClient()
const HOSP = 'HOSP-000042'
const MEMO_TAG = '메디인 AS이력'

const args = process.argv.slice(2)
const mode = args.includes('apply') ? 'apply' : 'report'
const fileIdx = args.indexOf('--file')
const initIdx = args.indexOf('--init-date')
/** 초기 60대 REGISTER 소급 기준일 — 일반 딜(DEAL-202505-0012) 계약일. 실제 설치일 확인 시 --init-date로 교체 */
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

interface Action {
  row: number
  date: string // AS 접수일 (A)
  outDate: string // 해제/교체/회수일 (M ?? K ?? A)
  kind: 'repair' | 'replace' | 'open-only' | 'lost'
  serial: string
  newSerial?: string
  ward: string | null
  backfill: boolean // F 미등록 — 소급 필요
  reason: 'DEFECT' | 'LOST'
  note: string
}

async function main() {
  const wb = XLSX.read(readFileSync(FILE))
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as unknown[][]
  const rows = raw.slice(1).filter((r) => r && (r[1] != null || r[5] != null))

  // 현재 상태 + 재실행 가드
  const placed = await prisma.hospitalDevice.findMany({
    where: { hospitalCode: HOSP, status: 'ACTIVE' },
    include: { unit: { select: { serialNo: true } } },
  })
  const already = await prisma.hospitalDeviceEvent.count({ where: { hospitalCode: HOSP, memo: { startsWith: MEMO_TAG } } })
  console.log(`시작 상태: ACTIVE ${placed.length}대 · 기존 마이그 이벤트 ${already}건 · 모드 ${mode}`)
  if (already > 0) {
    console.error(`이미 '${MEMO_TAG}' 태그 이벤트가 ${already}건 있습니다 — 재실행 중단 (초기화 후 다시 실행하세요)`)
    process.exit(2)
  }

  const active = new Set(placed.map((p) => p.unit.serialNo))
  const actions: Action[] = []
  const manual: string[] = []

  interface Row { row: number; a: string | null; out: string | null; m: string | null; kindTxt: string; done: string; wardCol: string }
  const parsed: { r: Row; olds: { serial: string; ward: string | null }[]; news: string[] }[] = []
  rows.forEach((r, i) => {
    parsed.push({
      r: {
        row: i + 2,
        a: excelDate(r[0]),
        out: excelDate(r[12]) ?? excelDate(r[10]) ?? excelDate(r[0]),
        m: excelDate(r[12]), // 발송일 — 비어 있으면 '아직 미발송'(선교체 배정만) = 처리 금지, AS 접수만
        kindTxt: String(r[3] ?? '').trim(),
        done: String(r[14] ?? '').trim(),
        wardCol: String(r[2] ?? '').trim(),
      },
      olds: serialLines(r[5]),
      news: serialLines(r[13]).map((x) => x.serial),
    })
  })
  parsed.sort((x, y) => (x.r.a ?? '').localeCompare(y.r.a ?? '') || x.r.row - y.r.row)

  // 분류 (순차 시뮬레이션과 동일 규칙 — active 세트를 굴리며 backfill 판정)
  for (const { r, olds, news } of parsed) {
    if (!r.a) { manual.push(`${r.row}행: 접수일자 없음`); continue }
    if (olds.length === 0) { manual.push(`${r.row}행: F열 시리얼 없음`); continue }
    if (news.length > 0 && olds.length !== news.length) {
      manual.push(`${r.row}행: 구${olds.length}↔신${news.length} 개수 불일치`); continue
    }
    const lost = r.kindTxt.includes('분실')
    for (let k = 0; k < olds.length; k++) {
      const o = olds[k]
      const nw = news[k]
      // C열 폴백은 단일 병동일 때만 — 개행·쉼표·공백 포함(복수 병동 병기)이면 사용하지 않는다 (더러운 병동명 자동 생성 방지)
      const ward = o.ward ?? (r.wardCol && !/[\r\n,\s]/.test(r.wardCol) ? r.wardCol : null)
      const backfill = !active.has(o.serial)
      const base = { row: r.row, date: r.a, outDate: r.out ?? r.a, serial: o.serial, ward, backfill, reason: (lost ? 'LOST' : 'DEFECT') as 'LOST' | 'DEFECT' }
      // M열(발송일)이 비어 있으면 아직 미발송 — N열은 '배정된' 신기기일 뿐, 교체·수리 반환을 기록하지 않는다 (AS 접수만)
      if (!r.m) {
        actions.push({ ...base, kind: 'open-only', note: `미발송 — AS 접수만${nw && nw !== o.serial ? ` (선교체 배정 ${nw})` : ''}${backfill ? ' · 소급 등록' : ''}` })
        if (backfill) active.add(o.serial)
        continue
      }
      if (!nw) {
        if (lost) { actions.push({ ...base, kind: 'lost', note: '분실 회수' }); active.delete(o.serial) }
        else actions.push({ ...base, kind: 'open-only', note: r.done === '완료' ? '완료인데 N 없음 — AS 접수만' : '미완료 — AS 접수만' })
        continue
      }
      if (o.serial === nw) {
        actions.push({ ...base, kind: 'repair', note: backfill ? '소급 등록 + 수리 반환' : '수리 반환' })
        active.add(o.serial)
      } else {
        actions.push({ ...base, kind: 'replace', newSerial: nw, note: backfill ? '소급 교체' : '교체' })
        active.delete(o.serial)
        active.add(nw)
      }
    }
  }

  const cnt = (k: Action['kind']) => actions.filter((a) => a.kind === k).length
  console.log(`\n행 ${rows.length} → 액션 ${actions.length}건: 수리반환 ${cnt('repair')} · 교체 ${cnt('replace')} · AS접수만 ${cnt('open-only')} · 분실회수 ${cnt('lost')} · 소급 ${actions.filter((a) => a.backfill).length}`)
  console.log(`예상 최종 ACTIVE: ${active.size}대`)
  if (manual.length) { console.log(`\n⚠ 수동 확인 필요 ${manual.length}건:`); manual.forEach((m) => console.log('  -', m)) }

  if (mode === 'report') {
    console.log('\n── 행별 계획 (앞 20건) ──')
    for (const a of actions.slice(0, 20)) {
      console.log(`  ${a.row}행 ${a.date}: [${a.kind}] ${a.serial}${a.newSerial ? ' → ' + a.newSerial : ''}${a.ward ? ' @' + a.ward : ''}${a.backfill ? ' (소급)' : ''} · 해제/처리일 ${a.outDate} — ${a.note}`)
    }
    console.log(`  … 외 ${Math.max(0, actions.length - 20)}건`)
    await prisma.$disconnect()
    return
  }

  // ── apply ─────────────────────────────────────────────────
  const actor = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true, name: true } })
  if (!actor) throw new Error('SUPER_ADMIN 없음')
  // ── fix-init: 초기 REGISTER(태그 없음·첫 AS 이후 일자)를 INIT_DATE로 소급 정정 ──
  const firstAs = actions.reduce((m, a) => (a.date < m ? a.date : m), '9999-12-31')
  const initEvents = await prisma.hospitalDeviceEvent.findMany({
    where: {
      hospitalCode: HOSP, eventType: 'REGISTER',
      OR: [{ memo: null }, { NOT: { memo: { startsWith: MEMO_TAG } } }],
      occurredOn: { gt: new Date(firstAs) },
    },
    select: { id: true, occurredOn: true },
  })
  console.log(`fix-init: 초기 REGISTER ${initEvents.length}건 → ${INIT_DATE} 소급 정정 (첫 AS ${firstAs} 이전으로)`)
  for (const ev of initEvents) {
    await editEvent({ hospitalCode: HOSP, actor: { userId: actor.id, name: actor.name } }, { eventId: ev.id, patch: { occurredOn: INIT_DATE } })
  }

  const reasons = new Map(
    (await prisma.statusCode.findMany({ where: { category: 'DEVICE_RECOVERY_REASON' }, select: { id: true, value: true } }))
      .filter((r) => r.value).map((r) => [r.value!, r.id])
  )
  const ctxOf = (a: Action, on: string) => ({
    hospitalCode: HOSP,
    actor: { userId: actor.id, name: actor.name },
    occurredOn: on,
    source: 'MANUAL' as const,
    memo: `${MEMO_TAG} r${a.row}`,
  })
  const deviceIdOf = async (serial: string): Promise<number | null> => {
    const found = await findUnitsBySerial(prisma, [serial])
    return found.get(serial)?.unit.id ?? null
  }

  let ok = 0
  const errors: string[] = []
  for (const a of actions) {
    try {
      if (a.kind === 'repair') {
        if (a.backfill) {
          await registerDevices(ctxOf(a, a.date), [{ serialInput: a.serial, wardName: a.ward, productType: '일반' }])
        }
        const id = await deviceIdOf(a.serial)
        if (id == null) throw new Error('유닛 조회 실패')
        await openDeviceAs(ctxOf(a, a.date), { deviceId: id })
        await clearDeviceAs(ctxOf(a, a.outDate), { deviceId: id })
      } else if (a.kind === 'replace') {
        if (!a.backfill) {
          const id = await deviceIdOf(a.serial)
          if (id != null) await openDeviceAs(ctxOf(a, a.date), { deviceId: id }).catch(() => null) // AS 표시는 best-effort
        }
        await replaceDevice(ctxOf(a, a.outDate), {
          oldSerial: a.serial,
          newSerial: a.newSerial!,
          oldWardName: a.backfill ? a.ward : null,
          reasonCodeId: reasons.get(a.reason) ?? null,
          productType: '일반', // 소급 경로에서만 사용 — 구 배치가 있으면 무시(경고)
        })
      } else if (a.kind === 'lost') {
        const id = await deviceIdOf(a.serial)
        if (id == null) throw new Error('유닛 조회 실패(분실)')
        await recoverDevice(ctxOf(a, a.outDate), { deviceId: id, reasonCodeId: reasons.get('LOST')! })
      } else {
        if (a.backfill) {
          await registerDevices(ctxOf(a, a.date), [{ serialInput: a.serial, wardName: a.ward, productType: '일반' }])
        }
        const id = await deviceIdOf(a.serial)
        if (id == null) throw new Error('유닛 조회 실패(open-only)')
        await openDeviceAs(ctxOf(a, a.date), { deviceId: id })
      }
      ok++
    } catch (e) {
      const msg = e instanceof RegistryError ? `${e.status} ${e.message}` : String((e as Error).message ?? e)
      errors.push(`${a.row}행 [${a.kind}] ${a.serial}${a.newSerial ? '→' + a.newSerial : ''}: ${msg}`)
    }
  }

  console.log(`\napply 완료: 성공 ${ok} / 실패 ${errors.length}`)
  if (errors.length) errors.forEach((e) => console.log('  ❌', e))

  // 검증 요약
  const after = await prisma.hospitalDevice.groupBy({ by: ['status'], where: { hospitalCode: HOSP }, _count: true })
  const asOpen = await prisma.hospitalDevice.findMany({
    where: { hospitalCode: HOSP, status: 'ACTIVE', asStartedOn: { not: null } },
    include: { unit: { select: { serialNo: true } } },
  })
  const evCount = await prisma.hospitalDeviceEvent.groupBy({ by: ['eventType'], where: { memo: { startsWith: MEMO_TAG } }, _count: true })
  console.log('\n── 검증 ──')
  console.log('배치 상태:', after.map((x) => `${x.status}=${x._count}`).join(' · '))
  console.log('AS진행중:', asOpen.length, '—', asOpen.map((x) => x.unit.serialNo).join(', '))
  console.log('마이그 이벤트:', evCount.map((x) => `${x.eventType}=${x._count}`).join(' · '))
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
