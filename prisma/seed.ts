import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 상태값 seed
  const statusSeeds = [
    { name: '미계약', order: 1, category: 'HOSPITAL' },
    { name: '계약완료', order: 2, category: 'HOSPITAL' },
    { name: '운영', order: 3, category: 'HOSPITAL' },
    { name: '해지', order: 4, category: 'HOSPITAL' },
  ]

  for (const seed of statusSeeds) {
    await prisma.statusCode.upsert({
      where: { name_category: { name: seed.name, category: seed.category } },
      update: { order: seed.order },
      create: seed,
    })
  }
  console.log('✓ 상태값 seed 완료:', statusSeeds.map((s) => s.name).join(', '))

  // 상담유형 seed
  const consultationTypeSeeds = [
    { name: '알람 관련', order: 0, category: 'CONSULTATION_TYPE' },
    { name: '디바이스 트러블슈팅', order: 1, category: 'CONSULTATION_TYPE' },
    { name: '소프트웨어 설정', order: 2, category: 'CONSULTATION_TYPE' },
    { name: '네트워크 연결', order: 3, category: 'CONSULTATION_TYPE' },
    { name: '기타', order: 4, category: 'CONSULTATION_TYPE' },
  ]

  for (const seed of consultationTypeSeeds) {
    await prisma.statusCode.upsert({
      where: { name_category: { name: seed.name, category: seed.category } },
      update: { order: seed.order },
      create: seed,
    })
  }
  console.log('✓ 상담유형 seed 완료:', consultationTypeSeeds.map((s) => s.name).join(', '))

  // 문서유형 seed
  const documentTypeSeeds = [
    { name: '정책', value: 'POLICY', order: 0, category: 'DOCUMENT_TYPE' },
    { name: '기술문서', value: 'TECH_DOC', order: 1, category: 'DOCUMENT_TYPE' },
    { name: '릴리즈노트', value: 'RELEASE_NOTE', order: 2, category: 'DOCUMENT_TYPE' },
    { name: '병원별 설정', value: 'HOSPITAL_CONFIG', order: 3, category: 'DOCUMENT_TYPE' },
    { name: '교육/매뉴얼', value: 'MANUAL', order: 4, category: 'DOCUMENT_TYPE' },
    { name: 'FAQ', value: 'FAQ', order: 5, category: 'DOCUMENT_TYPE' },
    { name: '상담이력', value: 'CONSULTATION', order: 6, category: 'DOCUMENT_TYPE' },
  ]

  for (const seed of documentTypeSeeds) {
    await prisma.statusCode.upsert({
      where: { name_category: { name: seed.name, category: seed.category } },
      update: { order: seed.order, value: seed.value },
      create: seed,
    })
  }
  console.log('✓ 문서유형 seed 완료:', documentTypeSeeds.map((s) => s.name).join(', '))

  // 장애유형 seed
  const maintenanceTypeSeeds = [
    { name: '하드웨어', order: 0, category: 'MAINTENANCE_TYPE' },
    { name: '소프트웨어', order: 1, category: 'MAINTENANCE_TYPE' },
    { name: '네트워크', order: 2, category: 'MAINTENANCE_TYPE' },
    { name: '기타', order: 3, category: 'MAINTENANCE_TYPE' },
  ]

  for (const seed of maintenanceTypeSeeds) {
    await prisma.statusCode.upsert({
      where: { name_category: { name: seed.name, category: seed.category } },
      update: { order: seed.order },
      create: seed,
    })
  }
  console.log('✓ 장애유형 seed 완료:', maintenanceTypeSeeds.map((s) => s.name).join(', '))

  // 유지보수 상태 seed
  const maintenanceStatusSeeds = [
    { name: '접수', order: 0, category: 'MAINTENANCE_STATUS', color: '#3B82F6' },
    { name: '처리중', order: 1, category: 'MAINTENANCE_STATUS', color: '#F59E0B' },
    { name: '완료', order: 2, category: 'MAINTENANCE_STATUS', color: '#10B981' },
    { name: '보류', order: 3, category: 'MAINTENANCE_STATUS', color: '#6B7280' },
  ]

  for (const seed of maintenanceStatusSeeds) {
    await prisma.statusCode.upsert({
      where: { name_category: { name: seed.name, category: seed.category } },
      update: { order: seed.order, color: seed.color },
      create: seed,
    })
  }
  console.log('✓ 유지보수 상태 seed 완료:', maintenanceStatusSeeds.map((s) => s.name).join(', '))

  // Task/유지보수 네비게이션 메뉴 seed
  const maintenanceNavSeeds = [
    { menuKey: 'tasks', label: '업무(Task) 현황', href: '/tasks', iconKey: 'clipboard-list', parentKey: null, allowedRoles: [] as string[], sortOrder: 45 },
    { menuKey: 'maintenances', label: '유지보수', href: '/maintenances', iconKey: 'wrench', parentKey: null, allowedRoles: [] as string[], sortOrder: 55 },
    { menuKey: 'settings/maintenance-type', label: '장애유형 관리', href: '/settings/maintenance-type', iconKey: null, parentKey: 'settings', allowedRoles: ['SUPER_ADMIN', 'ADMIN'], sortOrder: 140 },
    { menuKey: 'settings/maintenance-status', label: '유지보수 상태 관리', href: '/settings/maintenance-status', iconKey: null, parentKey: 'settings', allowedRoles: ['SUPER_ADMIN', 'ADMIN'], sortOrder: 150 },
  ]

  for (const nav of maintenanceNavSeeds) {
    await prisma.navMenuItem.upsert({
      where: { menuKey: nav.menuKey },
      update: { label: nav.label, href: nav.href, iconKey: nav.iconKey, parentKey: nav.parentKey, allowedRoles: nav.allowedRoles, sortOrder: nav.sortOrder },
      create: { menuKey: nav.menuKey, label: nav.label, href: nav.href, iconKey: nav.iconKey, parentKey: nav.parentKey, allowedRoles: nav.allowedRoles, allowedOrgCodes: [], isActive: true, sortOrder: nav.sortOrder },
    })
  }
  console.log('✓ 유지보수 네비게이션 메뉴 seed 완료')

  // Organization seed
  const orgSeeds = [
    { code: 'SEERS', name: '씨어스', sortOrder: 1 },
    { code: 'DAEWOONG', name: '대웅제약', sortOrder: 2 },
  ]

  for (const org of orgSeeds) {
    await prisma.organization.upsert({
      where: { code: org.code },
      update: { name: org.name, sortOrder: org.sortOrder },
      create: { code: org.code, name: org.name, sortOrder: org.sortOrder, isActive: true },
    })
  }
  console.log('✓ Organization seed 완료:', orgSeeds.map((o) => o.name).join(', '))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
