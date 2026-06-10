/**
 * 차량예약 Phase 2 통합 테스트 — 예약 API 라우트 핸들러 직접 호출
 * 실행: npx tsx scripts/test-vehicle-reservation-api.mts (cwd: 프로젝트 루트)
 */
import { readFileSync } from 'fs'

for (const line of readFileSync('.env', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const { signToken } = await import('../lib/auth')
const { prisma } = await import('../lib/prisma')
const listRoute = await import('../app/api/vehicle-reservations/route')
const idRoute = await import('../app/api/vehicle-reservations/[id]/route')
const { NextRequest } = await import('next/server')

// DB에서 테스트용 사용자 동적 조회 (데이터 동기화로 ID가 바뀌어도 동작)
const adminUser = await prisma.user.findFirstOrThrow({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true } })
const normalUser = await prisma.user.findFirstOrThrow({ where: { role: 'USER', isActive: true } })
const ADMIN_ID = adminUser.id
const USER_ID = normalUser.id

const adminToken = await signToken({ userId: ADMIN_ID, email: adminUser.email, name: adminUser.name, role: adminUser.role as 'ADMIN', isActive: true })
const userToken = await signToken({ userId: USER_ID, email: normalUser.email, name: normalUser.name, role: 'USER', isActive: true })
const viewerToken = await signToken({ userId: USER_ID, email: 'viewer@test.com', name: '뷰어', role: 'VIEWER', isActive: true })

function req(method: string, url: string, token: string | null, body?: unknown) {
  return new NextRequest(`http://localhost:3001${url}`, {
    method,
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

// 테스트 차량 2대 준비
const carA = await prisma.vehicle.create({ data: { name: '테스트카A', plateNumber: 'RSVT-001' } })
const carB = await prisma.vehicle.create({ data: { name: '테스트카B', plateNumber: 'RSVT-002' } })
const carOff = await prisma.vehicle.create({ data: { name: '테스트카C(비활성)', plateNumber: 'RSVT-003', isActive: false } })

const D = '2026-07-01'
const at = (hhmm: string) => `${D}T${hhmm}:00+09:00`

console.log('--- Phase 2: 예약 API ---')

try {
  // 1. USER 예약 생성 201
  const r1 = await listRoute.POST(req('POST', '/api/vehicle-reservations', userToken, {
    vehicleId: carA.id, startAt: at('09:00'), endAt: at('12:00'), purpose: '병원 답사', destination: '서울A병원',
  }))
  const res1 = await r1.json()
  check('USER 예약 생성 201', r1.status === 201 && res1.reservation?.id > 0, res1)
  const rsv1 = res1.reservation

  // 2. VIEWER 예약 생성 403
  const r2 = await listRoute.POST(req('POST', '/api/vehicle-reservations', viewerToken, {
    vehicleId: carA.id, startAt: at('13:00'), endAt: at('14:00'),
  }))
  check('VIEWER 예약 생성 403', r2.status === 403)

  // 3. 겹치는 시간 예약 → 409 + 충돌 정보
  const r3 = await listRoute.POST(req('POST', '/api/vehicle-reservations', adminToken, {
    vehicleId: carA.id, startAt: at('10:00'), endAt: at('13:00'),
  }))
  const res3 = await r3.json()
  check('겹치는 예약 409 + 예약자 안내', r3.status === 409 && res3.error.includes('예약했습니다') && res3.conflict?.user?.name, res3)

  // 4. 경계 접촉(12:00 종료 직후 12:00 시작) → 허용
  const r4 = await listRoute.POST(req('POST', '/api/vehicle-reservations', adminToken, {
    vehicleId: carA.id, startAt: at('12:00'), endAt: at('14:00'),
  }))
  const res4 = await r4.json()
  check('경계 접촉 예약 허용 201', r4.status === 201, res4)
  const rsv2 = res4.reservation

  // 5. 다른 차량 같은 시간 → 201
  const r5 = await listRoute.POST(req('POST', '/api/vehicle-reservations', adminToken, {
    vehicleId: carB.id, startAt: at('09:00'), endAt: at('12:00'),
  }))
  check('다른 차량 같은 시간 201', r5.status === 201)
  const rsv3 = (await r5.json()).reservation

  // 6. 시작 >= 종료 → 400
  const r6 = await listRoute.POST(req('POST', '/api/vehicle-reservations', userToken, {
    vehicleId: carA.id, startAt: at('15:00'), endAt: at('15:00'),
  }))
  check('시작=종료 400', r6.status === 400)

  // 7. 비활성 차량 → 400
  const r7 = await listRoute.POST(req('POST', '/api/vehicle-reservations', userToken, {
    vehicleId: carOff.id, startAt: at('09:00'), endAt: at('10:00'),
  }))
  check('비활성 차량 예약 400', r7.status === 400)

  // 8. GET 기간 필터
  const r8 = await listRoute.GET(req('GET', `/api/vehicle-reservations?from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}`, userToken))
  const res8 = await r8.json()
  const testIds = [rsv1.id, rsv2.id, rsv3.id]
  check('GET 기간 필터 (3건 포함)', r8.status === 200 && testIds.every((i) => res8.reservations.some((r: any) => r.id === i)), res8.reservations?.length)

  // 9. GET mine=true → USER 본인 것만
  const r9 = await listRoute.GET(req('GET', `/api/vehicle-reservations?from=${encodeURIComponent(at('00:00'))}&mine=true`, userToken))
  const res9 = await r9.json()
  check('GET mine=true 필터', res9.reservations.some((r: any) => r.id === rsv1.id) && !res9.reservations.some((r: any) => r.id === rsv2.id))

  // 10. 본인 PUT 시간 변경 (빈 시간대로) → 200
  const r10 = await idRoute.PUT(
    req('PUT', `/api/vehicle-reservations/${rsv1.id}`, userToken, { startAt: at('08:00'), endAt: at('11:30') }),
    { params: { id: String(rsv1.id) } },
  )
  check('본인 예약 시간 변경 200', r10.status === 200)

  // 11. PUT을 충돌 시간으로 → 409
  const r11 = await idRoute.PUT(
    req('PUT', `/api/vehicle-reservations/${rsv1.id}`, userToken, { startAt: at('12:30'), endAt: at('13:30') }),
    { params: { id: String(rsv1.id) } },
  )
  check('충돌 시간으로 변경 409', r11.status === 409)

  // 12. 타인 예약 USER PUT → 403
  const r12 = await idRoute.PUT(
    req('PUT', `/api/vehicle-reservations/${rsv2.id}`, userToken, { purpose: '탈취' }),
    { params: { id: String(rsv2.id) } },
  )
  check('타인 예약 USER 수정 403', r12.status === 403)

  // 13. 타인 예약 USER DELETE → 403
  const r13 = await idRoute.DELETE(req('DELETE', `/api/vehicle-reservations/${rsv2.id}`, userToken), { params: { id: String(rsv2.id) } })
  check('타인 예약 USER 취소 403', r13.status === 403)

  // 14. ADMIN 타인 예약 DELETE → 200 + CANCELED
  const r14 = await idRoute.DELETE(req('DELETE', `/api/vehicle-reservations/${rsv1.id}`, adminToken), { params: { id: String(rsv1.id) } })
  const after14 = await prisma.vehicleReservation.findUnique({ where: { id: rsv1.id } })
  check('ADMIN 타인 예약 취소 → CANCELED', r14.status === 200 && after14?.status === 'CANCELED')

  // 15. 취소된 자리에 재예약 → 201
  const r15 = await listRoute.POST(req('POST', '/api/vehicle-reservations', userToken, {
    vehicleId: carA.id, startAt: at('08:00'), endAt: at('11:30'),
  }))
  check('취소된 시간대 재예약 201', r15.status === 201)

  // 16. 취소된 예약 PUT → 400
  const r16 = await idRoute.PUT(
    req('PUT', `/api/vehicle-reservations/${rsv1.id}`, adminToken, { purpose: 'X' }),
    { params: { id: String(rsv1.id) } },
  )
  check('취소된 예약 수정 400', r16.status === 400)

  // 17. DB EXCLUDE 제약 직접 검증 (앱 검사 우회 raw INSERT → 23P01)
  let excludeBlocked = false
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO vehicle_reservations (vehicle_id, user_id, start_at, end_at, status, updated_at)
       VALUES (${carA.id}, '${ADMIN_ID}', '2026-07-01 00:00:00', '2026-07-01 23:00:00', 'RESERVED', now())`,
    )
  } catch (e: any) {
    excludeBlocked = String(e.message).includes('vehicle_reservations_no_overlap') || String(e.message).includes('23P01')
  }
  check('DB EXCLUDE 제약이 우회 INSERT 차단', excludeBlocked)

  // 18. 감사 로그 기록
  const auditCount = await prisma.auditLog.count({ where: { resource: 'vehicle_reservation', resourceLabel: { contains: '테스트카' } } })
  check('감사 로그 기록 (resource=vehicle_reservation)', auditCount >= 4, `count=${auditCount}`)
} finally {
  // 정리
  await prisma.vehicleReservation.deleteMany({ where: { vehicleId: { in: [carA.id, carB.id, carOff.id] } } })
  await prisma.vehicle.deleteMany({ where: { plateNumber: { startsWith: 'RSVT-' } } })
  await prisma.auditLog.deleteMany({ where: { resource: 'vehicle_reservation', resourceLabel: { contains: '테스트카' } } })
  console.log('테스트 데이터 정리 완료')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
await prisma.$disconnect()
process.exit(fail > 0 ? 1 : 0)
