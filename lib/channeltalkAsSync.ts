/**
 * 채널톡 AS접수 시트 동기화 (projects/channeltalk_as_intake_design.md — 2026-09-07)
 *
 * 'thynC VOC 현황' > 'A/S' 탭은 채널톡 ALF 태스크 전용 중계 파일.
 * 틱마다 2가지 수행:
 *  ① 접수 인입: 컷오버 이후 AI(처리상태) 공란 행 → 파싱·병원 매칭 → createAsReceipt(기존 경로: 티켓·AS표시·알림·SLA)
 *     → AI~AL 되쓰기 (등록완료/실패·AS코드·메모·시각)
 *  ② 완료 역기입: AI='등록완료' & X(완료여부) 미종결 행 → 접수가 종결(resolvedAt)이면 X에 완료/취소 기입
 *
 * 멱등성: 1차 = AI열 공란 여부. 2차 = note의 [채널톡 r{행}] 태그로 DB 기존재 검사(되쓰기 실패 자가 복구).
 * 행 삭제로 인한 행번호 변동은 전제상 없음(시트에 사람 개입 없음 — 설계 §9 D4).
 */
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { notifyTicketCreated } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'
import { parseSerialTextarea } from '@/lib/asReceiptShared'
import { createAsReceipt, AsServiceError, type LineInput } from '@/lib/asReceiptService'
import { loadHospitalMatcher } from '@/lib/hospitalNameMatcher'

export const CHANNELTALK_BOT_EMAIL = 'channeltalk-bot@seersthync.com'

// AppSetting 키 (README 데이터베이스 스키마 — AppSetting)
const KEY_SHEET_ID = 'channeltalk_as_sheet_id'
const KEY_CUTOVER = 'channeltalk_as_cutover_row' // 이 행번호 초과부터 처리 (기본 3612 — 3613행이 첫 대상)
const KEY_TAB = 'channeltalk_as_sheet_tab' // 기본 'A/S'

// 0-index 열 위치 (시트 실측 계약 — 설계 §2.1)
const C = {
  DATE: 0, HOSP: 1, WARD: 2, CATEGORY: 3, KIND: 4, SERIALS: 5, CNT_ECG: 6, CNT_SPO2: 7,
  SYMPTOM: 8, REPORTER: 9, AGENT: 10, PICKUP_DATE: 12, PRE_REPLACE: 15, DEST_TYPE: 18, DEST_INFO: 19,
  DONE: 23, // X 완료여부 — 역기입 대상
  SYS_STATE: 34, SYS_CODE: 35, SYS_MEMO: 36, SYS_AT: 37, // AI~AL 시스템 기입란
} as const

const SYS_STATE = { OK: '등록완료', FAIL: '실패', SKIP: '건너뜀' } as const

export interface ChanneltalkSyncResult {
  scanned: number
  registered: number
  failed: number
  completedBack: number
}

function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })

/** 시스템 기입란(AI~AL) 그리드 보장 — 시트가 34열(AH)까지라 최초 1회 4열 확장 + 헤더 기입 */
const gridEnsured = new Set<string>()
async function ensureSystemColumns(sheets: ReturnType<typeof sheetsClient>, sheetId: string, tab: string) {
  if (gridEnsured.has(sheetId)) return
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties' })
  const props = (meta.data.sheets ?? []).map((s) => s.properties!).find((p) => p?.title === tab)
  if (!props) throw new Error(`시트 탭 '${tab}' 없음`)
  const cols = props.gridProperties?.columnCount ?? 0
  if (cols < 38) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ appendDimension: { sheetId: props.sheetId!, dimension: 'COLUMNS', length: 38 - cols } }],
      },
    })
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tab}'!AI1:AL1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['시스템 처리상태', 'AS코드', '시스템 메모', '처리시각']] },
    })
    console.log(`[channeltalk-as] 시스템 기입란 AI~AL ${38 - cols}열 확장·헤더 기입`)
  }
  gridEnsured.add(sheetId)
}

function cell(row: unknown[], idx: number): string {
  return String(row[idx] ?? '').trim()
}

/** 접수사유(I열) — 시리얼별 줄에서 증상·병동 분해. "SERIAL / 병동 / 증상" | "SERIAL / 증상" | "SERIAL 증상" */
function parseSymptoms(text: string, serials: string[]): Map<string, { symptom: string | null; ward: string | null }> {
  const out = new Map<string, { symptom: string | null; ward: string | null }>()
  const remain: string[] = []
  for (const line0 of text.split(/[\r\n]+/)) {
    const line = line0.trim()
    if (!line) continue
    const upper = line.toUpperCase()
    const key = serials.find((s) => upper.replace(/\s+/g, '').startsWith(s))
    if (!key) { remain.push(line); continue }
    const idx = upper.indexOf(key)
    const rest = (idx >= 0 ? line.slice(idx + key.length) : line.replace(/^\S+/, '')).replace(/^[\s/·-]+/, '')
    const segs = rest.split('/').map((s) => s.trim()).filter(Boolean)
    let ward: string | null = null
    const symptomSegs: string[] = []
    for (const seg of segs) {
      if (!ward && seg.length <= 12 && /(병동|병실|중환자실|수술실|치료실|간호|층)/.test(seg)) ward = seg
      else symptomSegs.push(seg)
    }
    out.set(key, { symptom: symptomSegs.join(' / ') || null, ward })
  }
  // 시리얼 표기가 없는 사유 텍스트 — 단일 시리얼이면 그 라인 증상으로
  if (serials.length === 1 && !out.has(serials[0]) && remain.length) {
    out.set(serials[0], { symptom: remain.join(' / '), ward: null })
  }
  return out
}

async function loadSettings() {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [KEY_SHEET_ID, KEY_CUTOVER, KEY_TAB] } } })
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const sheetId = map.get(KEY_SHEET_ID)?.trim()
  const cutover = parseInt(map.get(KEY_CUTOVER) ?? '') || 3612
  const tab = map.get(KEY_TAB)?.trim() || 'A/S'
  return { sheetId, cutover, tab }
}

export async function runChanneltalkAsSync(): Promise<ChanneltalkSyncResult> {
  const result: ChanneltalkSyncResult = { scanned: 0, registered: 0, failed: 0, completedBack: 0 }
  const { sheetId, cutover, tab } = await loadSettings()
  if (!sheetId) {
    console.warn('[channeltalk-as] channeltalk_as_sheet_id 미설정 — 스킵')
    return result
  }
  const bot = await prisma.user.findUnique({ where: { email: CHANNELTALK_BOT_EMAIL }, select: { id: true, name: true, email: true, role: true } })
  if (!bot) {
    console.error(`[channeltalk-as] 봇 계정(${CHANNELTALK_BOT_EMAIL}) 없음 — 스킵`)
    return result
  }

  const sheets = sheetsClient()
  await ensureSystemColumns(sheets, sheetId, tab)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tab}'!A${cutover + 1}:AL`,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values ?? []
  result.scanned = rows.length
  if (!rows.length) return result

  const writes: { range: string; values: string[][] }[] = []
  const rangeOf = (rowNo: number, colA1: string, values: string[]) =>
    writes.push({ range: `'${tab}'!${colA1}${rowNo}`, values: [values] })

  // ── ① 접수 인입 ──────────────────────────────────────────────
  const pendingRows = rows
    .map((r, i) => ({ r, rowNo: cutover + 1 + i }))
    .filter(({ r }) => cell(r, C.SYS_STATE) === '' && r.some((v) => String(v ?? '').trim() !== ''))

  let matcher: Awaited<ReturnType<typeof loadHospitalMatcher>> | null = null
  for (const { r, rowNo } of pendingRows) {
    const tag = `[채널톡 r${rowNo}]`
    try {
      // DB측 2차 가드 — 이전 틱에서 등록됐지만 되쓰기 실패한 행
      const dup = await prisma.asReceipt.findFirst({ where: { note: { contains: tag } }, select: { asCode: true } })
      if (dup) {
        rangeOf(rowNo, 'AI', [SYS_STATE.OK, dup.asCode, '(재기입 — 이전 틱 등록분)', nowKst()])
        continue
      }

      const dateRaw = cell(r, C.DATE)
      const hospRaw = cell(r, C.HOSP)
      const serialsRaw = cell(r, C.SERIALS)
      if (!dateRaw || !hospRaw || !serialsRaw) {
        result.failed++
        rangeOf(rowNo, 'AI', [SYS_STATE.FAIL, '', `필수값 누락 (접수일:${dateRaw ? '○' : '✕'} 병원:${hospRaw ? '○' : '✕'} 시리얼:${serialsRaw ? '○' : '✕'})`, nowKst()])
        continue
      }
      const receiptDate = new Date(dateRaw)
      if (isNaN(receiptDate.getTime())) {
        result.failed++
        rangeOf(rowNo, 'AI', [SYS_STATE.FAIL, '', `접수일 해석 불가: ${dateRaw}`, nowKst()])
        continue
      }

      matcher ??= await loadHospitalMatcher()
      const hospitalCode = matcher.match(hospRaw)
      if (!hospitalCode) {
        const cands = matcher.candidates(hospRaw).slice(0, 4).map((c) => matcher!.nameOf(c) ?? c)
        result.failed++
        rangeOf(rowNo, 'AI', [SYS_STATE.FAIL, '', `병원 매칭 실패: "${hospRaw}"${cands.length ? ` 후보: ${cands.join(', ')}` : ''}`, nowKst()])
        continue
      }

      const serials = parseSerialTextarea(serialsRaw)
      if (!serials.length) {
        result.failed++
        rangeOf(rowNo, 'AI', [SYS_STATE.FAIL, '', '시리얼 파싱 결과 없음', nowKst()])
        continue
      }
      const symptomMap = parseSymptoms(cell(r, C.SYMPTOM), serials)
      const wardFallback = cell(r, C.WARD).split(/[\r\n,]+/)[0]?.trim() || null
      const lines: LineInput[] = serials.map((serial) => {
        const s = symptomMap.get(serial)
        return { serial, symptom: s?.symptom ?? null, wardName: s?.ward ?? wardFallback }
      })

      // 수량 대조(G+H vs 시리얼 수) — 경고만
      const warnParts: string[] = []
      const cntEcg = parseInt(cell(r, C.CNT_ECG)) || 0
      const cntSpo2 = parseInt(cell(r, C.CNT_SPO2)) || 0
      if (cntEcg + cntSpo2 > 0 && cntEcg + cntSpo2 !== serials.length) {
        warnParts.push(`수량 불일치: 기재 ${cntEcg + cntSpo2}대 vs 시리얼 ${serials.length}건`)
      }

      const noteParts = [tag]
      if (cell(r, C.AGENT)) noteParts.push(`접수담당: ${cell(r, C.AGENT)}`)

      // 발송지(S/T열) — 도메인 필드 매핑: '병원'→HOSPITAL, 그 외 기재값→OTHER (T열 정보와 함께)
      const destRaw = cell(r, C.DEST_TYPE)
      const destInfo = cell(r, C.DEST_INFO) || null
      const destType = destRaw.includes('병원') ? 'HOSPITAL' : destRaw || destInfo ? 'OTHER' : null

      const created = await createAsReceipt(
        {
          hospitalCode,
          category: cell(r, C.CATEGORY).includes('분실') ? 'LOST' : 'FAULT',
          receiptDate,
          reporterName: cell(r, C.REPORTER) || null,
          preReplace: cell(r, C.PRE_REPLACE).includes('선교체'),
          destType,
          destInfo,
          note: noteParts.join('\n'),
          lines,
        },
        { userId: bot.id, name: bot.name }
      )
      result.registered++
      warnParts.push(...created.warnings)

      syncTicketClocksSafe(created.ticketId)
      notifyTicketCreated({ ticketId: created.ticketId, actorName: bot.name, actorId: bot.id }).catch(() => {})
      logAudit({
        actor: { id: bot.id, email: bot.email, name: bot.name, role: bot.role },
        action: 'CREATE',
        resource: 'as_receipt',
        resourceId: created.asCode,
        resourceLabel: `${created.asCode} ${created.hospitalName} (채널톡 r${rowNo})`,
      }).catch(() => {})

      rangeOf(rowNo, 'AI', [SYS_STATE.OK, created.asCode, warnParts.join(' | ').slice(0, 500), nowKst()])
      console.log(`[channeltalk-as] r${rowNo} → ${created.asCode} (${created.hospitalName}, 라인 ${lines.length})`)
    } catch (e) {
      result.failed++
      const msg = e instanceof AsServiceError ? e.message : e instanceof Error ? e.message : String(e)
      rangeOf(rowNo, 'AI', [SYS_STATE.FAIL, '', msg.slice(0, 300), nowKst()])
      console.error(`[channeltalk-as] r${rowNo} 등록 실패:`, msg)
    }
  }

  // ── ② 완료 역기입 ────────────────────────────────────────────
  const doneRows = rows
    .map((r, i) => ({ r, rowNo: cutover + 1 + i }))
    .filter(({ r }) => cell(r, C.SYS_STATE) === SYS_STATE.OK && !['완료', '취소'].includes(cell(r, C.DONE)) && cell(r, C.SYS_CODE))
  if (doneRows.length) {
    const codes = doneRows.map(({ r }) => cell(r, C.SYS_CODE))
    const receipts = await prisma.asReceipt.findMany({
      where: { asCode: { in: codes }, resolvedAt: { not: null } },
      select: { asCode: true, status: { select: { name: true } } },
    })
    const byCode = new Map(receipts.map((x) => [x.asCode, x]))
    for (const { r, rowNo } of doneRows) {
      const rec = byCode.get(cell(r, C.SYS_CODE))
      if (!rec) continue
      const label = rec.status?.name === '취소' ? '취소' : '완료'
      rangeOf(rowNo, 'X', [label])
      rangeOf(rowNo, 'AL', [nowKst()])
      result.completedBack++
      console.log(`[channeltalk-as] r${rowNo} 완료 역기입: ${cell(r, C.SYS_CODE)} → ${label}`)
    }
  }

  if (writes.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'RAW', data: writes },
    })
  }
  return result
}
