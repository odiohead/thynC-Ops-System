/**
 * 스캔 파서 회귀 검증 (2026-11-04, projects/mobile_pwa_design.md §6.2) — DB 불필요, 고정 픽스처
 *   npx tsx --tsconfig tsconfig.json scripts/verify-scan-parse.mts
 * ⚠️ 현재 픽스처는 형식 가정 기반. M2-0 라벨 실측(/m/scan-test)으로 수집한 실제 원문을 '실측' 섹션에 추가할 것
 */
import assert from 'node:assert/strict'
import { parseScan, visibleRaw } from '../lib/scanParse'

const GS = '\x1D'
let n = 0
function check(input: string, exp: { kind: string; serials: string[]; gtin?: string; lot?: string; expiry?: string; prodDate?: string }, why: string) {
  n++
  const r = parseScan(input)
  const label = `[${n}] ${visibleRaw(input)} — ${why}`
  assert.equal(r.kind, exp.kind, `${label}: kind ${r.kind}`)
  assert.deepEqual(r.serialCandidates, exp.serials, `${label}: serials ${JSON.stringify(r.serialCandidates)}`)
  assert.equal(r.gtin, exp.gtin, `${label}: gtin ${r.gtin}`)
  assert.equal(r.lot, exp.lot, `${label}: lot ${r.lot}`)
  assert.equal(r.expiry, exp.expiry, `${label}: expiry ${r.expiry}`)
  assert.equal(r.prodDate, exp.prodDate, `${label}: prodDate ${r.prodDate}`)
}

// ── 1. GS1 원소열 (카메라 zxing Plain 모드 — GS 구분)
check(`01088000964013141125070110L2507A${GS}21A129506`, { kind: 'GS1', serials: ['A129506'], gtin: '08800096401314', prodDate: '250701', lot: 'L2507A' }, '심전계 UDI: GTIN·제조일·LOT(GS 종료)·시리얼')
check(`${GS}0108800096401536172812311025-0815${GS}21P016048`, { kind: 'GS1', serials: ['P016048'], gtin: '08800096401536', expiry: '281231', lot: '25-0815' }, '선행 FNC1(GS) + 유효기한 + LOT + 시리얼')
check(`]d201088000964015362125P0160`, { kind: 'GS1', serials: ['25P0160'], gtin: '08800096401536' }, '심볼 식별자 ]d2 제거 + 시리얼 끝까지')
check(`0108800096401536`, { kind: 'GS1', serials: [], gtin: '08800096401536' }, 'GTIN만 (박스 라벨) — 시리얼 후보 없음')
check(`01088000964015362111${GS}10LOT9`, { kind: 'GS1', serials: ['11'], gtin: '08800096401536', lot: 'LOT9' }, '시리얼 먼저·LOT 뒤 순서')

// ── 2. GS1 괄호 표기 (리더·사람 입력)
check('(01)08800096401314(11)250701(10)L2507A(21)A129506', { kind: 'GS1', serials: ['A129506'], gtin: '08800096401314', prodDate: '250701', lot: 'L2507A' }, '괄호 표기 전 항목')
check('(01)08800096401536(21) p016048 ', { kind: 'GS1', serials: ['P016048'], gtin: '08800096401536' }, '괄호 표기 시리얼 공백·소문자 정규화')
check('(21)GW2404-B005437', { kind: 'GS1', serials: ['GW2404-B005437', 'B005437'], }, 'GS1 시리얼에도 합성형 규칙 적용')

// ── 3. 게이트웨이 합성형 (WMS 저장 형식 우선)
check('GW2404-B005437', { kind: 'GW_COMPOSITE', serials: ['GW2404-B005437', 'B005437'] }, '합성형 원문 1순위')
check('gw5a13-b01956', { kind: 'GW_COMPOSITE', serials: ['GW5A13-B01956', 'B01956'] }, '소문자 + 5자리 B시리얼(DEV 실데이터 GW5A13-B01956)')

// ── 4. 기기 바코드형 (접미 시리얼 우선)
check('MC200-A129506', { kind: 'DEVICE_BARCODE', serials: ['A129506', 'MC200-A129506'] }, '바코드형 → 접미')
check('MP100W1-P016048', { kind: 'DEVICE_BARCODE', serials: ['P016048', 'MP100W1-P016048'] }, '바코드형 → 접미 (P)')

// ── 5. 일반 시리얼
check('A129506', { kind: 'PLAIN', serials: ['A129506'] }, '웨어러블 시리얼')
check(' dni28500498\r\n', { kind: 'PLAIN', serials: ['DNI28500498'] }, '네트워크 장비 — 공백·개행·소문자')
check('17916', { kind: 'PLAIN', serials: ['17916'] }, '숫자 시리얼 (라우터) — GS1로 오인 금지')
check('0123456789', { kind: 'PLAIN', serials: ['0123456789'] }, "'01'로 시작하지만 14자리 GTIN 아님 → 일반")
check('8800096401536', { kind: 'PLAIN', serials: ['8800096401536'] }, 'EAN-13 단독 — 일반 값')
check('', { kind: 'EMPTY', serials: [] }, '빈 입력')

console.log(`scanParse 픽스처 ${n}건 통과`)
