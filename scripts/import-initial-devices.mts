/**
 * 병원별 초기 기기 임포트 러너 — 드라이브 현황파일 추출본(extract JSON) 기반 (2026-09-05 사용자 확정)
 * 중복 제외 25곳(_기기중복_제외병원.xlsx)·기존 등록 병원 제외, 검토형 임포트 서비스 경유.
 * 입력: IMPORT_BASE(extract/*.json), IMPORT_OUT(_종합요약.xlsx·_기기중복_제외병원.xlsx 위치, 결과 xlsx 출력)
 *   IMPORT_BASE=<dir> IMPORT_OUT=<dir> npx tsx scripts/import-initial-devices.mts
 */
import 'dotenv/config'
import * as XLSX from 'xlsx'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { previewRows, importBatch } from '../lib/deviceRegistry/import'
import { RegistryError } from '../lib/deviceRegistry/core'
import { todayKst } from '../lib/deviceRegistryShared'

const BASE = process.env.IMPORT_BASE ?? '/tmp/claude-1000/-home-ubuntu-workspace-thynC-Ops-System/ef015821-a260-4247-a232-08bd5f516db2/scratchpad/hyunhwang'
const OUT = process.env.IMPORT_OUT ?? '/mnt/c/Users/USER/Documents/기기현황_초기임포트'
const prisma = new PrismaClient()
const nfc = (s: unknown) => String(s ?? '').normalize('NFC')

interface Rec {
  folder: string; code: string; name: string; asHist: string; fileDevices: number
  status: string; created: number; rereg: number; skipped: number
  excludedErr: number; excludedConf: number; newWards: number; note: string
}

async function main() {
  const wb0 = XLSX.read(readFileSync(`${OUT}/_종합요약.xlsx`))
  const summary = (XLSX.utils.sheet_to_json(wb0.Sheets['병원별 요약'], { header: 1 }) as unknown[][]).slice(1)
  const dupSet = new Set(
    (XLSX.utils.sheet_to_json(XLSX.read(readFileSync(`${OUT}/_기기중복_제외병원.xlsx`)).Sheets['기기중복 제외 병원'], { header: 1 }) as unknown[][])
      .slice(1).map((r) => nfc(r[0]))
  )
  // 폴더 → extract JSON 경로
  const extractByFolder = new Map<string, string>()
  for (const f of readdirSync(`${BASE}/extract`)) {
    const j = JSON.parse(readFileSync(`${BASE}/extract/${f}`, 'utf8'))
    extractByFolder.set(nfc(j.folder), `${BASE}/extract/${f}`)
  }
  const actor = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true, name: true } })
  if (!actor) throw new Error('SUPER_ADMIN 없음')

  const recs: Rec[] = []
  let done = 0
  for (const r of summary) {
    const folder = nfc(r[0])
    const code = String(r[1] ?? '')
    const rec: Rec = {
      folder, code, name: String(r[2] ?? ''), asHist: String(r[3] ?? ''), fileDevices: Number(r[6] ?? 0),
      status: '', created: 0, rereg: 0, skipped: 0, excludedErr: 0, excludedConf: 0, newWards: 0, note: '',
    }
    recs.push(rec)
    if (rec.fileDevices === 0) { rec.status = '기기 목록 미기입 — 제외'; continue }
    if (dupSet.has(folder)) { rec.status = '교차 중복 — 제외(사용자 결정)'; continue }
    if (!code || code === '미매칭') { rec.status = '병원코드 미매칭 — 제외'; continue }
    const existing = await prisma.hospitalDevice.count({ where: { hospitalCode: code } })
    if (existing > 0) { rec.status = `기존 등록 존재(${existing}대) — 건너뜀`; continue }

    try {
      const ex = JSON.parse(readFileSync(extractByFolder.get(folder)!, 'utf8'))
      const rows = (ex.devices as { model: string; serial: string; ward: string | null; wardSource?: string | null; note?: string | null }[])
        .map((d, i) => ({
          row: i + 2,
          serialInput: d.serial,
          wardInput: d.ward,
          modelInput: d.model,
          memo: [d.note, d.wardSource === 'block' ? '병동=블록주석 추정' : null].filter(Boolean).join(' · ') || null,
        }))
      const today = todayKst()
      const preview = await previewRows(code, rows, { wardMode: 'column', mode: 'REGISTER', occurredOn: today, excludeRows: [] })
      const errRows = preview.rows.filter((p) => p.status === 'error')
      const confRows = preview.rows.filter((p) => p.status === 'conflict')
      rec.excludedErr = errRows.length
      rec.excludedConf = confRows.length
      const exclude = [...errRows, ...confRows].map((p) => p.row)
      const executable = preview.rows.filter((p) => !exclude.includes(p.row) && p.executable).length
      if (executable === 0) {
        rec.status = '실행 가능 행 0 — 보류'
        rec.note = [...new Set([...errRows, ...confRows].flatMap((p) => p.messages))].slice(0, 3).join(' / ')
        continue
      }
      const result = await importBatch(
        { hospitalCode: code, actor: { userId: actor.id, name: actor.name }, memo: '드라이브 현황파일 초기 임포트', occurredOn: today },
        {
          rows, excludeRows: exclude, sourceKind: 'EXCEL', mode: 'REGISTER',
          fileName: nfc(ex.chosenFile ?? '현황'),
          defaults: { wardMode: 'column' },
        }
      )
      rec.created = result.result.created.length
      rec.rereg = result.result.reregistered.length
      rec.skipped = result.result.skipped.length
      rec.newWards = result.result.newWards.length
      rec.status = '임포트 완료'
      const notes: string[] = []
      if (errRows.length) notes.push(`오류행 제외 ${errRows.length}: ${[...new Set(errRows.flatMap((p) => p.messages))].slice(0, 2).join('/')}`)
      if (confRows.length) notes.push(`충돌행 제외 ${confRows.length}: ${confRows.map((p) => p.serialNo).slice(0, 3).join(',')}`)
      if (result.warnings.length) notes.push(result.warnings.slice(0, 2).join('/'))
      rec.note = notes.join(' · ').slice(0, 200)
    } catch (e) {
      rec.status = '실패'
      rec.note = (e instanceof RegistryError ? `${e.status} ${e.message}` : String((e as Error).message ?? e)).slice(0, 200)
    }
    done++
    if (done % 20 === 0) console.log(`… ${done}곳 임포트 처리`)
  }

  writeFileSync(`${BASE}/import-results.json`, JSON.stringify(recs, null, 1))
  // 작업 리스트 xlsx
  const rows: unknown[][] = [['폴더명', '병원코드', '병원명', 'AS이력', '파일 기기수', '상태', '등록', '재등록', '건너뜀', '오류행 제외', '충돌행 제외', '신규 병동', '비고']]
  for (const rec of recs) rows.push([rec.folder, rec.code, rec.name, rec.asHist, rec.fileDevices, rec.status, rec.created, rec.rereg, rec.skipped, rec.excludedErr, rec.excludedConf, rec.newWards, rec.note])
  const wb = XLSX.utils.book_new()
  const sh = XLSX.utils.aoa_to_sheet(rows)
  sh['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 22 }, { wch: 6 }, { wch: 9 }, { wch: 26 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 60 }]
  XLSX.utils.book_append_sheet(wb, sh, '작업 결과')
  XLSX.writeFile(wb, `${OUT}/_작업완료병원.xlsx`)

  const okRecs = recs.filter((x) => x.status === '임포트 완료')
  console.log(`\n임포트 완료 ${okRecs.length}곳 · 등록 ${okRecs.reduce((s, x) => s + x.created, 0)}대 · 재등록 ${okRecs.reduce((s, x) => s + x.rereg, 0)} · 신규 병동 ${okRecs.reduce((s, x) => s + x.newWards, 0)}`)
  for (const st of ['실패', '실행 가능 행 0 — 보류']) {
    const list = recs.filter((x) => x.status === st)
    if (list.length) { console.log(`${st}: ${list.length}곳`); list.forEach((x) => console.log(`  - ${x.folder}: ${x.note}`)) }
  }
  console.log('건너뜀(기존 등록):', recs.filter((x) => x.status.startsWith('기존 등록')).map((x) => x.folder).join(', '))
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
