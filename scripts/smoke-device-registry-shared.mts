/**
 * 디바이스 원장 공용 순수 함수 스모크 — lib/deviceRegistryShared.ts (§5c · 부록 B)
 * DB 미사용. 실패가 1건이라도 있으면 exit 1.
 *
 *   npx tsx scripts/smoke-device-registry-shared.mts
 */
import {
  DEVICE_EVENT_TYPES,
  DEVICE_TRANSITIONS,
  canTransition,
  transitionOutcome,
  transitionMessage,
  resolveTransitionFrom,
  refLink,
  normalizeSerial,
  guessDeviceClassByPrefix,
  matchesSerialPattern,
  parseSerialLines,
  normalizeWardName,
  detectOnpremHeader,
  suggestOccurredOnFromMaintenance,
  isYmd,
  isFutureYmd,
  toYmd,
  todayKst,
  type TransitionFrom,
  type TransitionOutcome,
} from '../lib/deviceRegistryShared'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`) }
}
function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, { actual, expected })
}

console.log('[1] normalizeSerial (부록 B 정규화)')
eq('GW 합성 → 키 + raw', normalizeSerial('GW4C11-B008381'), { serialNo: 'B008381', serialRaw: 'GW4C11-B008381', kind: 'GW_COMPOSITE' })
eq('GW 합성 소문자·공백', normalizeSerial('  gw4c11-b008381 '), { serialNo: 'B008381', serialRaw: 'GW4C11-B008381', kind: 'GW_COMPOSITE' })
eq('소문자 → 대문자, raw null', normalizeSerial('a126861'), { serialNo: 'A126861', serialRaw: null, kind: 'PLAIN' })
eq('내부 공백 제거', normalizeSerial('A12 6861'), { serialNo: 'A126861', serialRaw: null, kind: 'PLAIN' })
eq('바코드형 → 접미 키', normalizeSerial('XXX0000-A000000'), { serialNo: 'A000000', serialRaw: 'XXX0000-A000000', kind: 'BARCODE' })
eq('바코드형 P', normalizeSerial('abc-p018363'), { serialNo: 'P018363', serialRaw: 'ABC-P018363', kind: 'BARCODE' })
eq('바코드형 아님(접미 B) → 원문', normalizeSerial('ABC-B008381'), { serialNo: 'ABC-B008381', serialRaw: null, kind: 'PLAIN' })
eq('참BP 원문 유지', normalizeSerial('h2-bpm-ab12'), { serialNo: 'H2-BPM-AB12', serialRaw: null, kind: 'PLAIN' })
eq('빈 입력', normalizeSerial('   '), { serialNo: '', serialRaw: null, kind: 'PLAIN' })
eq('null 입력', normalizeSerial(null), { serialNo: '', serialRaw: null, kind: 'PLAIN' })

console.log('\n[2] guessDeviceClassByPrefix')
eq('A → ECG 1', guessDeviceClassByPrefix('A126861').onpremDeviceType, 1)
eq('P → SpO2 3', guessDeviceClassByPrefix('P018363').onpremDeviceType, 3)
eq('B → GATEWAY', guessDeviceClassByPrefix('B008381'), { deviceClass: 'GATEWAY', hintModel: 'MGW1010' })
eq('GW → GATEWAY', guessDeviceClassByPrefix('GW4C11').deviceClass, 'GATEWAY')
eq('C → TEMP 2 (MT100D 힌트)', guessDeviceClassByPrefix('C000001'), { onpremDeviceType: 2, deviceClass: 'WEARABLE', hintModel: 'MT100D' })
eq('E → BP 6', guessDeviceClassByPrefix('E000001').onpremDeviceType, 6)
eq('H2-BPM- → 참BP 11', guessDeviceClassByPrefix('H2-BPM-AB12'), { onpremDeviceType: 11, deviceClass: 'THIRD_PARTY', hintModel: 'H2-ABPM' })
eq('F → 링BP 10', guessDeviceClassByPrefix('F123456-12345').onpremDeviceType, 10)
eq('G → 링BP 10', guessDeviceClassByPrefix('G000000-00000').onpremDeviceType, 10)
eq('K → 링BP 10', guessDeviceClassByPrefix('K000000-00000').onpremDeviceType, 10)
eq('소문자 관대', guessDeviceClassByPrefix('a126861').onpremDeviceType, 1)
eq('미지 접두 → {}', guessDeviceClassByPrefix('Z999999'), {})
eq('빈 값 → {}', guessDeviceClassByPrefix(''), {})

console.log('\n[3] matchesSerialPattern')
eq('ECG 6자리 일치', matchesSerialPattern('A126861', '^A[0-9]{6}$'), true)
eq('5자리 오타 불일치', matchesSerialPattern('A12016', '^A[0-9]{6}$'), false)
eq('패턴 없음 → null', matchesSerialPattern('A126861', null), null)
eq('잘못된 정규식 → null', matchesSerialPattern('A126861', '^A[0-9'), null)

console.log('\n[4] parseSerialLines (부록 B-2)')
const pasted = [
  'A126861',
  'A126862\t6병동',
  'A126863, A126864 A126865',
  '# 주석 줄',
  '',
  'gw4c11-b008381\t6병동\t신관 GW',
  'A126870  7병동',
  'A126871 # 인라인 주석',
  'A126872,A126873\t8병동',
].join('\n')
const rows = parseSerialLines(pasted)
eq('행 수', rows.length, 10)
eq('1행 단일', rows[0], { row: 1, serialInput: 'A126861' })
eq('2행 탭 열 모드', rows[1], { row: 2, serialInput: 'A126862', wardInput: '6병동' })
eq('3행 토큰 전부 시리얼(같은 row)', rows.slice(2, 5), [
  { row: 3, serialInput: 'A126863' },
  { row: 3, serialInput: 'A126864' },
  { row: 3, serialInput: 'A126865' },
])
eq('6행 주석·빈 줄 건너뛰고 번호 보존 + 메모', rows[5], { row: 6, serialInput: 'gw4c11-b008381', wardInput: '6병동', memo: '신관 GW' })
eq('7행 2칸 공백 = 열 모드', rows[6], { row: 7, serialInput: 'A126870', wardInput: '7병동' })
eq('8행 인라인 주석 제거', rows[7], { row: 8, serialInput: 'A126871' })
eq('9행 열 모드 첫 열 다중 시리얼', rows.slice(8, 10), [
  { row: 9, serialInput: 'A126872', wardInput: '8병동' },
  { row: 9, serialInput: 'A126873', wardInput: '8병동' },
])
eq('CRLF 처리', parseSerialLines('A1\r\nA2\r\n').map((r) => r.row), [1, 2])
eq('빈 입력', parseSerialLines(''), [])
eq('max 초과 시 max+1건까지만', parseSerialLines('A1\nA2\nA3\nA4\nA5', 3).length, 4)

console.log('\n[5] normalizeWardName (§5.2 name_norm)')
eq("'6 병동' == '6병동'", normalizeWardName('6 병동'), normalizeWardName('6병동'))
eq("'icu' == 'ICU'", normalizeWardName('icu'), 'ICU')
eq('전각 숫자 → 반각', normalizeWardName('６병동'), '6병동')
eq('전각 영문 → 반각·대문자', normalizeWardName('ｉｃｕ'), 'ICU')
eq('전각 공백 제거', normalizeWardName('6　병동'), '6병동')
eq('앞뒤 공백·탭', normalizeWardName('\t 101 병동 \n'), '101병동')
eq('빈 값', normalizeWardName(null), '')

console.log('\n[6] 전이표 (§4.2) — 24셀 (2026-09-04 갱신: B-24 AS_OPEN/AS_CLEAR 열 추가 — ACTIVE_SAME만 ok)')
const expected: Record<TransitionFrom, Record<(typeof DEVICE_EVENT_TYPES)[number], TransitionOutcome>> = {
  NONE: { REGISTER: 'ok', MOVE_WARD: 'not_found', RECOVER: 'not_found', CORRECT: 'not_found', AS_OPEN: 'not_found', AS_CLEAR: 'not_found' },
  ACTIVE_SAME: { REGISTER: 'skip', MOVE_WARD: 'ok', RECOVER: 'ok', CORRECT: 'ok', AS_OPEN: 'ok', AS_CLEAR: 'ok' },
  ACTIVE_OTHER: { REGISTER: 'conflict', MOVE_WARD: 'conflict', RECOVER: 'conflict', CORRECT: 'ok', AS_OPEN: 'conflict', AS_CLEAR: 'conflict' },
  RECOVERED: { REGISTER: 'ok', MOVE_WARD: 'invalid', RECOVER: 'invalid', CORRECT: 'ok', AS_OPEN: 'invalid', AS_CLEAR: 'invalid' },
}
for (const from of Object.keys(expected) as TransitionFrom[]) {
  for (const ev of DEVICE_EVENT_TYPES) {
    eq(`${from} × ${ev}`, DEVICE_TRANSITIONS[from][ev], expected[from][ev])
  }
}
eq('resolveTransitionFrom(null)', resolveTransitionFrom(null), 'NONE')
eq('resolveTransitionFrom(ACTIVE) 기본 = SAME', resolveTransitionFrom('ACTIVE'), 'ACTIVE_SAME')
eq('resolveTransitionFrom(ACTIVE, false) = OTHER', resolveTransitionFrom('ACTIVE', false), 'ACTIVE_OTHER')
eq('resolveTransitionFrom(RECOVERED)', resolveTransitionFrom('RECOVERED'), 'RECOVERED')
check('canTransition(null, REGISTER)', canTransition(null, 'REGISTER'))
check('!canTransition(null, MOVE_WARD)', !canTransition(null, 'MOVE_WARD'))
check('!canTransition(ACTIVE, REGISTER) — skip', !canTransition('ACTIVE', 'REGISTER'))
check('canTransition(ACTIVE, MOVE_WARD)', canTransition('ACTIVE', 'MOVE_WARD'))
check('canTransition(ACTIVE, RECOVER)', canTransition('ACTIVE', 'RECOVER'))
check('!canTransition(ACTIVE 타 병원, MOVE_WARD)', !canTransition('ACTIVE', 'MOVE_WARD', { sameHospital: false }))
check('canTransition(ACTIVE 타 병원, CORRECT)', canTransition('ACTIVE', 'CORRECT', { sameHospital: false }))
check('canTransition(RECOVERED, REGISTER)', canTransition('RECOVERED', 'REGISTER'))
check('!canTransition(RECOVERED, RECOVER)', !canTransition('RECOVERED', 'RECOVER'))
eq('transitionOutcome(ACTIVE 타 병원, REGISTER) = conflict', transitionOutcome('ACTIVE', 'REGISTER', { sameHospital: false }), 'conflict')
eq('transitionOutcome(RECOVERED, MOVE_WARD) = invalid', transitionOutcome('RECOVERED', 'MOVE_WARD'), 'invalid')
check('transitionMessage ok → null', transitionMessage('NONE', 'REGISTER') === null)
check('transitionMessage skip 문구', transitionMessage('ACTIVE_SAME', 'REGISTER') === '이미 이 병원에 배치 중인 시리얼입니다')
check('transitionMessage 이미 회수', transitionMessage('RECOVERED', 'RECOVER') === '이미 회수된 기기입니다')
check('transitionMessage 404 문구', (transitionMessage('NONE', 'RECOVER') ?? '').includes('등록되지 않은')) // 2026-09-02 '기기 현황' 개명 문구

console.log('\n[7] refLink')
eq('MAINTENANCE', refLink('MAINTENANCE', 'MNT-202605-0047'), '/maintenances?search=MNT-202605-0047')
eq('VOC', refLink('VOC', 'VOC-202608-0001'), '/voc?q=VOC-202608-0001')
eq('INVENTORY_TX', refLink('INVENTORY_TX', 'TX-202608-0012'), '/inventory/transactions?code=TX-202608-0012')
eq('ONPREM_SYNC → null', refLink('ONPREM_SYNC', 'BSHOSP-20260901'), null)
eq('코드 없음 → null', refLink('MAINTENANCE', null), null)
eq('미지 타입 → null', refLink('UNKNOWN', 'X'), null)

console.log('\n[8] detectOnpremHeader (부록 B-3)')
const onpremJsonHeader = ['organizationCode', 'deviceCode', 'serialNumber', 'macAddress', 'wardCode', 'deviceType', 'dateTime']
eq('온프렘 export 헤더 전체', detectOnpremHeader(onpremJsonHeader), {
  organizationCode: 0, deviceCode: 1, serial: 2, macAddress: 3, wardCode: 4, deviceType: 5,
})
eq('snake_case + deviceType만', detectOnpremHeader(['serial_number', 'device_type']), { serial: 0, deviceType: 1 })
eq('한글 별칭', detectOnpremHeader(['기관코드', '시리얼번호', '병동코드', '닉네임', 'MAC']), {
  organizationCode: 0, serial: 1, wardCode: 2, deviceCode: 3, macAddress: 4,
})
eq('대소문자·공백 관대', detectOnpremHeader(['Serial Number', 'Ward Code']), { serial: 0, wardCode: 1 })
eq('시리얼만 → null(초안 모드 아님)', detectOnpremHeader(['시리얼', '모델', '병동', '메모']), null)
eq('wardCode/deviceType 없음 → null', detectOnpremHeader(['serialNumber', 'macAddress']), null)
eq('시리얼 없음 → null', detectOnpremHeader(['wardCode', 'deviceType']), null)
eq('빈 헤더 → null', detectOnpremHeader([]), null)

console.log('\n[9] suggestOccurredOnFromMaintenance (§5c · D7)')
const today = '2026-08-20'
eq('종료된 방문 최대 endDate', suggestOccurredOnFromMaintenance({
  visits: [{ startDate: '2026-08-01', endDate: '2026-08-02' }, { startDate: '2026-08-10', endDate: '2026-08-12' }],
  resolvedAt: '2026-08-15', reportedAt: '2026-07-30',
}, today), { date: '2026-08-12', basis: 'visit_end' })
eq('진행 중 방문(종료 미래) → startDate', suggestOccurredOnFromMaintenance({
  visits: [{ startDate: '2026-08-19', endDate: '2026-08-25' }],
}, today), { date: '2026-08-19', basis: 'visit_start' })
eq('전부 미래 방문 → resolvedAt', suggestOccurredOnFromMaintenance({
  visits: [{ startDate: '2026-08-25', endDate: '2026-08-26' }], resolvedAt: '2026-08-18', reportedAt: '2026-08-01',
}, today), { date: '2026-08-18', basis: 'resolved_at' })
eq('방문·해결 없음 → reportedAt', suggestOccurredOnFromMaintenance({ visits: [], reportedAt: '2026-08-01' }, today), { date: '2026-08-01', basis: 'reported_at' })
eq('아무 근거 없음 → null', suggestOccurredOnFromMaintenance({ visits: [] }, today), null)
eq('미래 resolvedAt 건너뜀 → reportedAt', suggestOccurredOnFromMaintenance({ resolvedAt: '2026-09-01', reportedAt: '2026-08-01' }, today), { date: '2026-08-01', basis: 'reported_at' })
eq('Date 입력(@db.Date UTC 자정)', suggestOccurredOnFromMaintenance({
  visits: [{ startDate: new Date('2026-08-10T00:00:00.000Z'), endDate: new Date('2026-08-12T00:00:00.000Z') }],
}, today), { date: '2026-08-12', basis: 'visit_end' })
eq('오늘 종료 방문은 포함(≤)', suggestOccurredOnFromMaintenance({ visits: [{ startDate: '2026-08-18', endDate: today }] }, today), { date: today, basis: 'visit_end' })

console.log('\n[10] 날짜 헬퍼')
check('isYmd 정상', isYmd('2026-08-20'))
check('!isYmd 존재하지 않는 날짜', !isYmd('2026-02-30'))
check('!isYmd 형식 불일치', !isYmd('2026/08/20'))
check('!isYmd 비문자열', !isYmd(20260820))
check('isFutureYmd 미래', isFutureYmd('2026-08-21', '2026-08-20'))
check('!isFutureYmd 오늘', !isFutureYmd('2026-08-20', '2026-08-20'))
eq('toYmd ISO 문자열', toYmd('2026-08-20T15:00:00.000Z'), '2026-08-20')
eq('toYmd Date', toYmd(new Date('2026-08-20T00:00:00.000Z')), '2026-08-20')
eq('toYmd null', toYmd(null), null)
eq('toYmd 형식 불일치', toYmd('abc'), null)
check('todayKst 형식', /^\d{4}-\d{2}-\d{2}$/.test(todayKst()))

console.log(`\n결과: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
