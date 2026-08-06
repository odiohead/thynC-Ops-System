/**
 * RBAC 카탈로그 v1.2 스모크 — inventory.admin 상위집합 + 모듈 삭제 권한 가산 판정
 * 임시 역할 SMOKE_V12를 만들어 USER 등급 사용자에게 부여 → 판정 → 전부 삭제(원상복구)
 *
 *   npx tsx scripts/rbac-v12-smoke.mts
 */
import { prisma } from '../lib/prisma'
import { hasPermission, invalidatePermissionCache } from '../lib/appRoles'
import { canManageStock, canAdminInventory } from '../lib/inventory'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}`) }
}

async function main() {
  // 재고 담당자 풀·기존 역할에 없는 USER 등급 활성 사용자 선택
  const candidates = await prisma.user.findMany({
    where: { role: 'USER', isActive: true },
    select: { id: true, name: true, role: true },
  })
  const pools = new Set((await prisma.inventoryManager.findMany({ select: { userId: true } })).map((m) => m.userId))
  const roled = new Set((await prisma.appUserRole.findMany({ select: { userId: true } })).map((r) => r.userId))
  const testUser = candidates.find((u) => !pools.has(u.id) && !roled.has(u.id))
  if (!testUser) throw new Error('테스트 대상 USER 없음')
  console.log(`대상: ${testUser.name} (USER 등급, 풀·역할 없음)`)

  const u = { userId: testUser.id, role: testUser.role }

  console.log('\n[1] 역할 부여 전 — 전부 false여야 함')
  check('canManageStock=false', !(await canManageStock(u)))
  check('canAdminInventory=false', !(await canAdminInventory(u)))
  check('maintenance.admin=false', !(await hasPermission(u, 'maintenance.admin')))

  // 임시 역할: inventory.admin + maintenance.admin + project.admin
  const role = await prisma.appRole.create({ data: { code: 'SMOKE_V12', name: '스모크v12', isActive: true } })
  await prisma.appRolePermission.createMany({
    data: ['inventory.admin', 'maintenance.admin', 'project.admin'].map((permKey) => ({ roleId: role.id, permKey })),
  })
  await prisma.appUserRole.create({ data: { userId: testUser.id, roleId: role.id } })
  invalidatePermissionCache()

  try {
    console.log('\n[2] 역할 부여 후 (USER 등급 + 권한)')
    check('canAdminInventory=true (inventory.admin)', await canAdminInventory(u))
    check('canManageStock=true (admin 상위집합 — manage 키 없이도)', await canManageStock(u))
    check('maintenance.admin=true', await hasPermission(u, 'maintenance.admin'))
    check('project.admin=true', await hasPermission(u, 'project.admin'))
    check('install_plan.admin=false (미부여 키)', !(await hasPermission(u, 'install_plan.admin')))

    console.log('\n[3] VIEWER 등급 + 같은 권한 — canAdminInventory 게이트에서 차단')
    const v = { userId: testUser.id, role: 'VIEWER' }
    check('canAdminInventory=false (VIEWER 읽기 전용 원칙)', !(await canAdminInventory(v)))

    console.log('\n[4] 역할 비활성화 → 판정 false')
    await prisma.appRole.update({ where: { id: role.id }, data: { isActive: false } })
    invalidatePermissionCache()
    check('비활성 역할 → canAdminInventory=false', !(await canAdminInventory(u)))
  } finally {
    await prisma.appRole.delete({ where: { id: role.id } }) // Cascade: permissions·userRoles 동반 삭제
    invalidatePermissionCache()
  }

  const remain = await prisma.appRole.findFirst({ where: { code: 'SMOKE_V12' } })
  check('\n[5] 원상복구: SMOKE_V12 잔존 없음', !remain)

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  if (fail > 0) process.exit(1)
}

main().finally(() => prisma.$disconnect())
