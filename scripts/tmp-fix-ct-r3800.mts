// 1회성 보정 (2026-09-19): 채널톡 시트 3800행(예수병원) — 행 삭제로 번호가 밀려 AS-202609-0304(서울산보람)로 오기입된 건을 수동 등록분 AS-202609-0305로 정정
//  - 시트 AI3800:AL3800 → 등록완료 / AS-202609-0305 / 보정 메모 / 시각 · L3800(수거 송장, 0304 값이 잘못 들어감) → 비움(0305는 수거 송장 없음)
//  - DB AS-202609-0305 비고에 '[채널톡 r3800] 수동 등록 연결' 태그 추가 (역기입 대상 연결)
//  실행: PROD 디렉토리에서 `set -a; . ./.env; set +a; npx tsx scripts/tmp-fix-ct-r3800.mts [--apply]` — 기본은 dry-run
import { google } from 'googleapis'
import { prisma } from '../lib/prisma'

const APPLY = process.argv.includes('--apply')
const ROW = 3800
const WRONG = 'AS-202609-0304'
const RIGHT = 'AS-202609-0305'
const TAG = `[채널톡 r${ROW}]`

const settings = await prisma.appSetting.findMany({ where: { key: { in: ['channeltalk_as_sheet_id', 'channeltalk_as_sheet_tab'] } } })
const m = new Map(settings.map((r) => [r.key, r.value]))
const sheetId = m.get('channeltalk_as_sheet_id')!.trim()
const tab = m.get('channeltalk_as_sheet_tab')?.trim() || 'A/S'
const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const sheets = google.sheets({ version: 'v4', auth })

const cur = (await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${tab}'!A${ROW}:AL${ROW}`, valueRenderOption: 'FORMATTED_VALUE' })).data.values?.[0] ?? []
const c = (i: number) => String(cur[i] ?? '').trim()
console.log(`r${ROW} 현재: B=${c(1)} | F=${c(5).replace(/\n/g, ',')} | L=${c(11)} | AI=${c(34)} | AJ=${c(35)} | AK=${c(36)}`)

// 안전 가드 — 예상한 상태가 아니면 중단
if (!c(1).includes('예수병원')) throw new Error('3800행 병원이 예수병원이 아님 — 행이 또 이동했을 수 있음. 중단')
if (c(35) !== WRONG) throw new Error(`3800행 AJ가 ${WRONG}가 아님(${c(35)}) — 중단`)
const right = await prisma.asReceipt.findUnique({ where: { asCode: RIGHT }, select: { id: true, hospitalCode: true, note: true, pickupTrackingNo: true, hospital: { select: { hospitalName: true } }, items: { select: { serialNo: true } } } })
if (!right) throw new Error(`${RIGHT} 없음`)
const rowSerials = c(5).split(/[\r\n,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
const same = rowSerials.every((s) => right.items.some((i) => i.serialNo === s))
console.log(`${RIGHT}: ${right.hospital.hospitalName} / 시리얼 ${right.items.map((i) => i.serialNo).join(',')} / 수거송장 ${right.pickupTrackingNo ?? '-'} / 행 시리얼 일치 ${same}`)
if (!same) throw new Error('행 시리얼이 0305 라인과 불일치 — 중단')

const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })
const plan = [
  { range: `'${tab}'!AI${ROW}:AL${ROW}`, values: [['등록완료', RIGHT, `(수동 등록 연결 — 행 이동 오기입 보정 ${now.slice(0, 10)})`, now]] },
  { range: `'${tab}'!L${ROW}`, values: [[right.pickupTrackingNo ?? '']] },
]
console.log('시트 기입 계획:', JSON.stringify(plan))
console.log(`DB 계획: ${RIGHT} 비고에 '${TAG} 수동 등록 연결' 추가 (이미 있음: ${(right.note ?? '').includes(TAG)})`)

if (!APPLY) { console.log('dry-run — --apply 로 실행'); await prisma.$disconnect(); process.exit(0) }

await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: 'RAW', data: plan } })
if (!(right.note ?? '').includes(TAG)) {
  const note = right.note?.trim() ? `${right.note.trimEnd()}\n${TAG} 수동 등록 연결` : `${TAG} 수동 등록 연결`
  await prisma.asReceipt.update({ where: { id: right.id }, data: { note } })
}
const after = (await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${tab}'!A${ROW}:AL${ROW}`, valueRenderOption: 'FORMATTED_VALUE' })).data.values?.[0] ?? []
const a = (i: number) => String(after[i] ?? '').trim()
console.log(`r${ROW} 보정 후: B=${a(1)} | L=${a(11)} | AI=${a(34)} | AJ=${a(35)} | AK=${a(36)} | AL=${a(37)}`)
console.log('DB note:', (await prisma.asReceipt.findUnique({ where: { asCode: RIGHT }, select: { note: true } }))!.note)
await prisma.$disconnect()
