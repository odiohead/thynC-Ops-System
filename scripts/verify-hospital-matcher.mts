/**
 * 병원명 매처 회귀 검증 (2026-10-08) — DB 불필요, 고정 픽스처
 *   npx tsx --tsconfig tsconfig.json scripts/verify-hospital-matcher.mts
 * 사례 출처: 2026-09-11 동아병원 충돌, 09-16 지역 접두, 10-08 확장 풀(한림대성심) + 전체 풀 확장 시 측정된 오매칭(화순성심→성심)·동명 충돌
 */
import assert from 'node:assert/strict'
import { buildHospitalMatcher, type HospitalMatcherEntry } from '../lib/hospitalNameMatcher'

const core: HospitalMatcherEntry[] = [
  { hospitalCode: 'C-DONGA-U', hospitalName: '동아대학교병원' },
  { hospitalCode: 'C-DONGA', hospitalName: '동아병원' },
  { hospitalCode: 'C-CHA-GUNSAN', hospitalName: '군산 차병원' },
  { hospitalCode: 'C-HWASUN', hospitalName: '화순성심병원' },
  { hospitalCode: 'C-DONGTAN', hospitalName: '한림대학교동탄성심병원' },
  { hospitalCode: 'C-CHUNCHEON', hospitalName: '춘천성심병원' },
  { hospitalCode: 'C-WOORI', hospitalName: '우리병원' },
  { hospitalCode: 'C-HANAM', hospitalName: '하남S병원' },
  { hospitalCode: 'C-BARO', hospitalName: '의료법인백천의료재단 바로본병원' },
]
const extended: HospitalMatcherEntry[] = [
  { hospitalCode: 'X-HALLYM', hospitalName: '한림대학교성심병원', tier: 'extended' },
  { hospitalCode: 'X-SEONGSIM', hospitalName: '성심병원', tier: 'extended' }, // 전체 풀 확장 시 '화순성심병원'을 가로채던 동명 병원
  { hospitalCode: 'X-WOORI2', hospitalName: '우리병원', tier: 'extended' }, // core '우리병원'과 동명 — core 결과를 바꾸지 못해야 함(가로채기 금지)
  { hospitalCode: 'X-GANGNAM', hospitalName: '강남베드로병원', tier: 'extended' },
]

let n = 0
const eq = (m: ReturnType<typeof buildHospitalMatcher>, input: string, expected: string | null, why: string) => {
  n++
  const got = m.match(input)
  assert.equal(got, expected, `[${n}] "${input}" → ${got} (기대 ${expected}) — ${why}`)
}

// ── 1. 현행(core만) 동작 보존
const base = buildHospitalMatcher(core)
eq(base, '동아대학교병원', 'C-DONGA-U', '정식명 일치')
eq(base, '동아병원', 'C-DONGA', '정식명 유일 일치가 별칭 축약보다 우선')
eq(base, '광주 동아병원', 'C-DONGA', '지역 접두 + 정식명 접미')
eq(base, '일산차병원', null, "3자 범용 접미 '차병원'은 지역 접두 추정 제외")
eq(base, '화순성심병원', 'C-HWASUN', '정식명')
eq(base, '하남s병원', 'C-HANAM', '영문 대소문자')
eq(base, '바로본병원', 'C-BARO', '법인 접두 제거 후 부분 포함')
eq(base, '한림대학교성심병원', null, 'core만으로는 비공식 설치 병원 매칭 불가(현상 재현)')
eq(base, '성심병원', null, '여러 성심병원 부분 포함 — 모호')

// ── 2. 확장 풀: 정식명·별칭 유일 일치만 허용
const m = buildHospitalMatcher([...core, ...extended])
eq(m, '한림대학교성심병원', 'X-HALLYM', '확장 병원 정식명 일치')
eq(m, '한림대학교 성심병원', 'X-HALLYM', '띄어쓰기 흔들림 — 정규화 정식명 일치')
eq(m, '한림성심병원', 'X-HALLYM', "별칭(학교 축약 — 현행 규칙은 '대학교'를 통째로 제거) 유일 일치")
eq(m, '한림대 성심병원', null, "'한림대' 축약은 현행 별칭 규칙에 없음(core에서도 동일) — 확장 풀 변경 범위 밖, 현상 고정")
eq(m, '한림대학교성심병원/7병동', null, '부분 포함은 확장 병원 불참 — 느슨한 표기 차단')
eq(m, '안양 한림대학교성심병원', null, '지역 접두 추정도 확장 병원 불참')
eq(m, '한림대학교동탄성심병원', 'C-DONGTAN', '기존 core 결과 불변')
eq(m, '화순성심병원', 'C-HWASUN', "확장 '성심병원'이 가로채지 못함(정식명 유일 일치 우선)")
eq(m, '성심병원', 'X-SEONGSIM', '정식명이 정확히 일치하면 확장 병원도 확정')
eq(m, '우리병원', 'C-WOORI', 'core·extended 동명 — 정식명·별칭은 모호하지만 부분 포함 단계는 core만 참여하므로 core 결과 유지(확장 병원은 core 결과를 바꾸지 못함)')
eq(m, '강남베드로', null, '확장 병원은 부분 포함으로 못 들어옴')
eq(m, '강남베드로병원', 'X-GANGNAM', '정식명 일치')
assert.equal(m.tierOf('X-HALLYM'), 'extended'); assert.equal(m.tierOf('C-DONGA'), 'core')

// ── 3. 회귀: core 전 사례는 확장 풀 추가 후에도 동일
for (const h of core) assert.equal(m.match(h.hospitalName), h.hospitalCode, `core 정식명 회귀: ${h.hospitalName}`)

console.log(`verify-hospital-matcher: ${n}건 통과`)
