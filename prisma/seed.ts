import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const seeds = [
    { name: '미계약', order: 1, category: 'HOSPITAL' },
    { name: '계약완료', order: 2, category: 'HOSPITAL' },
    { name: '운영', order: 3, category: 'HOSPITAL' },
    { name: '해지', order: 4, category: 'HOSPITAL' },
  ]

  for (const seed of seeds) {
    await prisma.statusCode.upsert({
      where: { name_category: { name: seed.name, category: seed.category } },
      update: { order: seed.order },
      create: seed,
    })
  }

  console.log('✓ 상태값 seed 완료:', seeds.map((s) => s.name).join(', '))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
