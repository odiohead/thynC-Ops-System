/**
 * 차량예약 E2E 테스트 — 실제 HTTP 스택(미들웨어 포함, localhost:3000) 대상
 * 실행: npx tsx scripts/test-vehicle-e2e.mts (cwd: 프로젝트 루트, thync-dev 기동 상태)
 */
import { readFileSync } from 'fs'

for (const line of readFileSync('.env', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const { signToken } = await import('../lib/auth')
const { prisma } = await import('../lib/prisma')

const BASE = 'http://localhost:3000'
// DB에서 테스트용 사용자 동적 조회 (데이터 동기화로 ID가 바뀌어도 동작)
const adminUser = await prisma.user.findFirstOrThrow({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true } })
const normalUser = await prisma.user.findFirstOrThrow({ where: { role: 'USER', isActive: true } })
const ADMIN_ID = adminUser.id
const USER_ID = normalUser.id

const adminToken = await signToken({ userId: ADMIN_ID, email: adminUser.email, name: adminUser.name, role: adminUser.role as 'ADMIN', isActive: true })
const userToken = await signToken({ userId: USER_ID, email: normalUser.email, name: normalUser.name, role: 'USER', isActive: true })

function http(method: string, path: string, token: string | null, body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `auth-token=${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.error(`  ❌ ${name}`, detail ?? '') }
}

console.log('--- E2E: 실제 HTTP 스택 ---')

try {
  // 1. /api/auth/me 응답 형태 (보드의 me 파싱 전제 검증)
  const meRes = await http('GET', '/api/auth/me', adminToken)
  const me = await meRes.json()
  check('auth/me: user 객체 직접 반환 (id/name/role)', meRes.status === 200 && !!me.id && !!me.name && !!me.role, me)

  // 2. 미인증 페이지 접근 → 307
  const anonPage = await http('GET', '/vehicle-reservations', null)
  check('미인증 /vehicle-reservations → 307', anonPage.status === 307)

  // 3. 인증된 페이지 접근 → 200 + HTML
  const page = await http('GET', '/vehicle-reservations', adminToken)
  const pageHtml = await page.text()
  check('인증 /vehicle-reservations → 200 + 보드 HTML', page.status === 200 && pageHtml.includes('차량예약'))

  const settingsPage = await http('GET', '/settings/vehicles', adminToken)
  check('인증 /settings/vehicles → 200', settingsPage.status === 200)

  // 4. 차량 등록 (HTTP)
  const carRes = await http('POST', '/api/vehicles', adminToken, {
    name: 'E2E테스트카', plateNumber: 'E2E-001', color: '#10B981', seatCount: 5,
  })
  const car = (await carRes.json()).vehicle
  check('HTTP 차량 등록 201', carRes.status === 201 && car?.id > 0)

  // 5. 차량 목록에 노출
  const listRes = await http('GET', '/api/vehicles?activeOnly=true', adminToken)
  const list = await listRes.json()
  check('HTTP 차량 목록 포함', list.vehicles.some((v: any) => v.id === car.id))

  // 6. 예약 생성 (USER, HTTP — 보드 모달과 동일한 페이로드 형태)
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(9, 0, 0, 0)
  const end = new Date(start)
  end.setHours(18, 0, 0, 0)
  const rsvRes = await http('POST', '/api/vehicle-reservations', userToken, {
    vehicleId: car.id, startAt: start.toISOString(), endAt: end.toISOString(),
    purpose: 'E2E 테스트', destination: '테스트병원',
  })
  const rsv = (await rsvRes.json()).reservation
  check('HTTP 예약 생성 201 (USER)', rsvRes.status === 201 && rsv?.id > 0)

  // 7. 충돌 예약 → 409 + 안내 메시지
  const conflictRes = await http('POST', '/api/vehicle-reservations', adminToken, {
    vehicleId: car.id, startAt: start.toISOString(), endAt: end.toISOString(),
  })
  const conflict = await conflictRes.json()
  check('HTTP 충돌 예약 409 + 예약자 안내', conflictRes.status === 409 && conflict.error.includes('예약했습니다'), conflict)

  // 8. 주간 범위 조회 (보드 fetch와 동일)
  const weekFrom = new Date(start); weekFrom.setHours(0, 0, 0, 0)
  const weekTo = new Date(weekFrom); weekTo.setDate(weekTo.getDate() + 7)
  const boardRes = await http(
    'GET',
    `/api/vehicle-reservations?from=${encodeURIComponent(weekFrom.toISOString())}&to=${encodeURIComponent(weekTo.toISOString())}`,
    userToken,
  )
  const board = await boardRes.json()
  check('HTTP 주간 조회에 예약 포함 + 차량/예약자 정보', board.reservations.some((r: any) => r.id === rsv.id && r.vehicle?.name && r.user?.name))

  // 9. 내 예약 (mine=true)
  const mineRes = await http('GET', `/api/vehicle-reservations?mine=true&from=${encodeURIComponent(new Date().toISOString())}`, userToken)
  const mine = await mineRes.json()
  check('HTTP 내 예약 조회 포함', mine.reservations.some((r: any) => r.id === rsv.id))

  // 10. 예약 수정 (본인)
  const newEnd = new Date(end); newEnd.setHours(12, 0, 0, 0)
  const putRes = await http('PUT', `/api/vehicle-reservations/${rsv.id}`, userToken, { endAt: newEnd.toISOString() })
  check('HTTP 본인 예약 수정 200', putRes.status === 200)

  // 11. 예약 취소 (본인)
  const delRes = await http('DELETE', `/api/vehicle-reservations/${rsv.id}`, userToken)
  check('HTTP 본인 예약 취소 200', delRes.status === 200)

  // 12. 취소 후 보드에서 미노출
  const board2Res = await http(
    'GET',
    `/api/vehicle-reservations?from=${encodeURIComponent(weekFrom.toISOString())}&to=${encodeURIComponent(weekTo.toISOString())}`,
    userToken,
  )
  const board2 = await board2Res.json()
  check('취소된 예약 보드 미노출', !board2.reservations.some((r: any) => r.id === rsv.id))

  // 13. 차량 삭제 (예약 이력 → 비활성화)
  const carDelRes = await http('DELETE', `/api/vehicles/${car.id}`, adminToken)
  const carDel = await carDelRes.json()
  check('이력 있는 차량 삭제 → 비활성화 안내', carDel.deactivated === true)
} finally {
  await prisma.vehicleReservation.deleteMany({ where: { vehicle: { plateNumber: { startsWith: 'E2E-' } } } })
  await prisma.vehicle.deleteMany({ where: { plateNumber: { startsWith: 'E2E-' } } })
  await prisma.auditLog.deleteMany({ where: { resource: { in: ['vehicle', 'vehicle_reservation'] }, resourceLabel: { contains: 'E2E' } } })
  console.log('테스트 데이터 정리 완료')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
await prisma.$disconnect()
process.exit(fail > 0 ? 1 : 0)
