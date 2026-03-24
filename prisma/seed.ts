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
