/**
 * 차량예약 Phase 1 통합 테스트 — 라우트 핸들러 직접 호출
 * 실행: npx tsx /tmp/test-vehicle-api.mts (cwd: 프로젝트 루트)
 */
import { readFileSync } from 'fs'

// .env 수동 로드 (lib/auth가 import 시점에 JWT_SECRET을 읽으므로 동적 import 전에 설정)
for (const line of readFileSync('.env', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const { signToken } = await import('../lib/auth')
const { prisma } = await import('../lib/prisma')
const vehiclesRoute = await import('../app/api/vehicles/route')
const vehicleIdRoute = await import('../app/api/vehicles/[id]/route')

// DB에서 테스트용 사용자 동적 조회 (데이터 동기화로 ID가 바뀌어도 동작)
const adminUser = await prisma.user.findFirstOrThrow({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true } })
const normalUser = await prisma.user.findFirstOrThrow({ where: { role: 'USER', isActive: true } })
const ADMIN_ID = adminUser.id
const USER_ID = normalUser.id

const adminToken = await signToken({ userId: ADMIN_ID, email: adminUser.email, name: adminUser.name, role: adminUser.role as 'ADMIN', isActive: true })
const userToken = await signToken({ userId: USER_ID, email: normalUser.email, name: normalUser.name, role: 'USER', isActive: true })
const viewerToken = await signToken({ userId: USER_ID, email: 'viewer@test.com', name: '뷰어', role: 'VIEWER', isActive: true })

const { NextRequest } = await import('next/server')

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

console.log('--- Phase 1: 차량 CRUD ---')

// 1. 생성 (ADMIN) → 201
const createRes = await vehiclesRoute.POST(req('POST', '/api/vehicles', adminToken, {
  name: '테스트차량 A', plateNumber: 'TEST-001', model: '카니발', seatCount: 9, color: '#3B82F6',
}))
const created = await createRes.json()
check('ADMIN 차량 생성 201', createRes.status === 201 && created.vehicle?.id > 0, created)
const vid = created.vehicle.id

// 2. 생성 (USER) → 403
const forbiddenRes = await vehiclesRoute.POST(req('POST', '/api/vehicles', userToken, { name: 'X', plateNumber: 'TEST-X' }))
check('USER 차량 생성 403', forbiddenRes.status === 403)

// 3. 생성 (VIEWER) → 403
const viewerRes = await vehiclesRoute.POST(req('POST', '/api/vehicles', viewerToken, { name: 'X', plateNumber: 'TEST-Y' }))
check('VIEWER 차량 생성 403', viewerRes.status === 403)

// 4. 차량번호 중복 → 409
const dupRes = await vehiclesRoute.POST(req('POST', '/api/vehicles', adminToken, { name: '중복', plateNumber: 'TEST-001' }))
check('차량번호 중복 409', dupRes.status === 409)

// 5. 필수값 누락 → 400
const badRes = await vehiclesRoute.POST(req('POST', '/api/vehicles', adminToken, { name: '   ' }))
check('이름 누락 400', badRes.status === 400)

// 6. 목록 조회 (생성분 포함)
const listRes = await vehiclesRoute.GET(req('GET', '/api/vehicles', adminToken))
const list = await listRes.json()
check('목록 조회 200 + 생성분 포함', listRes.status === 200 && list.vehicles.some((v: any) => v.id === vid))

// 7. 수정 (ADMIN) → 200
const putRes = await vehicleIdRoute.PUT(
  req('PUT', `/api/vehicles/${vid}`, adminToken, { name: '테스트차량 A-수정', plateNumber: 'TEST-001', seatCount: 11, isActive: true }),
  { params: { id: String(vid) } },
)
const updated = await putRes.json()
check('ADMIN 수정 200 + 반영', putRes.status === 200 && updated.vehicle.name === '테스트차량 A-수정' && updated.vehicle.seatCount === 11)

// 8. 수정 (USER) → 403
const putForbidden = await vehicleIdRoute.PUT(
  req('PUT', `/api/vehicles/${vid}`, userToken, { name: 'X', plateNumber: 'TEST-001' }),
  { params: { id: String(vid) } },
)
check('USER 수정 403', putForbidden.status === 403)

// 9. activeOnly 필터: 비활성 차량 생성 후 미포함 확인
const inactiveRes = await vehiclesRoute.POST(req('POST', '/api/vehicles', adminToken, { name: '비활성차량', plateNumber: 'TEST-002', isActive: false }))
const inactive = await inactiveRes.json()
const activeListRes = await vehiclesRoute.GET(req('GET', '/api/vehicles?activeOnly=true', adminToken))
const activeList = await activeListRes.json()
check('activeOnly 필터 동작', !activeList.vehicles.some((v: any) => v.id === inactive.vehicle.id))

// 10. 예약 이력 있는 차량 삭제 → 비활성화 처리
await prisma.vehicleReservation.create({
  data: {
    vehicleId: vid, userId: ADMIN_ID,
    startAt: new Date('2026-06-15T09:00:00'), endAt: new Date('2026-06-15T12:00:00'),
    purpose: '테스트 예약',
  },
})
const delWithResRes = await vehicleIdRoute.DELETE(req('DELETE', `/api/vehicles/${vid}`, adminToken), { params: { id: String(vid) } })
const delWithRes = await delWithResRes.json()
const afterDel = await prisma.vehicle.findUnique({ where: { id: vid } })
check('예약 이력 차량 삭제 → 비활성화', delWithRes.deactivated === true && afterDel?.isActive === false)

// 11. 예약 없는 차량 삭제 → 완전 삭제
const delRes = await vehicleIdRoute.DELETE(req('DELETE', `/api/vehicles/${inactive.vehicle.id}`, adminToken), { params: { id: String(inactive.vehicle.id) } })
const delGone = await prisma.vehicle.findUnique({ where: { id: inactive.vehicle.id } })
check('예약 없는 차량 삭제 → 완전 삭제', delRes.status === 200 && delGone === null)

// 12. 감사 로그 기록 확인
const auditCount = await prisma.auditLog.count({
  where: { resource: 'vehicle', resourceLabel: { contains: 'TEST-001' } },
})
check('감사 로그 기록 (resource=vehicle)', auditCount >= 3, `count=${auditCount}`)

// --- 정리 ---
await prisma.vehicleReservation.deleteMany({ where: { vehicle: { plateNumber: { startsWith: 'TEST-' } } } })
await prisma.vehicle.deleteMany({ where: { plateNumber: { startsWith: 'TEST-' } } })
await prisma.auditLog.deleteMany({ where: { resource: 'vehicle', resourceLabel: { contains: 'TEST-00' } } })
console.log('테스트 데이터 정리 완료')

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
await prisma.$disconnect()
process.exit(fail > 0 ? 1 : 0)
