/**
 * 재입차 무료권 차단 판정 스모크 — 입차 달력일 기준 고정 검증 (2026-08-07 수정분)
 * 실측 케이스(47서1581): 어제 입차건 무료권이 사이트 영업일 지연으로 오늘 새 입차를 차단하던 오판 재현·수정 확인.
 * 외부 호출 없음 — 판정 함수 단위 검증.
 *
 *   npx tsx scripts/parking-free-block-smoke.mts
 */
process.env.PARKING_ACCOUNTS = JSON.stringify([
  { label: '901', userId: '901', pw: 'x' },
  { label: '902', userId: '902', pw: 'x' },
  { label: '903', userId: '903', pw: 'x', paid: true },
  { label: '904', userId: '904', pw: 'x' },
])

async function main() {
  const { earlierFreeRows } = await import('../lib/parking')
  const row = (entryAt: string, accountNo: string, free = true) => ({
    carNo: '47서1581', entryAt, discountName: free ? '무료 1시간할인' : '유료 24시간 할인',
    price: free ? 0 : 15000, minutes: free ? 60 : 1440, accountNo, regTime: '', free,
  })
  // 어제(0806) 입차건 무료 4건(901·902·903·909) — 909는 타 입주사
  const yesterdayRows = [row('20260806082801', '901'), row('20260806082801', '902'), row('20260806082801', '903'), row('20260806082801', '909')]
  const todayEntry = '20260807081757'

  let pass = 0, fail = 0
  const check = (name: string, cond: boolean) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ FAIL: ${name}`)) }

  // [1] 1581 실측 케이스: 어제 무료권만 있는 상태에서 오늘 새 입차 → 차단 없어야 함 (종전엔 3건 걸려 차단)
  check('전날 입차건 무료권은 오늘 입차를 차단하지 않음', earlierFreeRows(yesterdayRows, todayEntry).length === 0)

  // [2] 같은 날(0807) 이전 입차건 무료권 → 차단 (우리 계정만)
  const sameDay = [...yesterdayRows, row('20260807070000', '901'), row('20260807070000', '909')]
  const blocked = earlierFreeRows(sameDay, todayEntry)
  check('같은 입차일 이전 입차건 무료권은 차단 (우리 계정 1건)', blocked.length === 1 && blocked[0].accountNo === '901')

  // [3] 현재 입차건 자신의 무료권은 차단 사유 아님
  check('현재 입차건 자신의 등록분은 제외', earlierFreeRows([row(todayEntry, '901')], todayEntry).length === 0)

  // [4] 유료권 이력은 무관
  check('유료권 이력은 차단 사유 아님', earlierFreeRows([row('20260807070000', '903', false)], todayEntry).length === 0)

  // [5] 입차시각 미상 → fail-open (차단 안 함)
  check('입차시각 미상이면 차단하지 않음(fail-open)', earlierFreeRows(sameDay, '').length === 0)

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  if (fail > 0) process.exit(1)
}
main()
