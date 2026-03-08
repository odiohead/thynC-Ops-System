import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const seeds = [
    { name: '미계약', order: 1 },
    { name: '계약완료', order: 2 },
    { name: '운영', order: 3 },
    { name: '해지', order: 4 },
  ]

  for (const seed of seeds) {
    await prisma.statusCode.upsert({
      where: { name: seed.name },
      update: { order: seed.order },
      create: seed,
    })
  }

  console.log('✓ 상태값 seed 완료:', seeds.map((s) => s.name).join(', '))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
