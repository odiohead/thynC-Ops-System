import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const hashed = await bcrypt.hash('admin1234', 10)
  const user = await prisma.user.upsert({
    where: { email: 'admin@thync.com' },
    update: {},
    create: {
      email: 'admin@thync.com',
      password: hashed,
      name: '관리자',
      phone: '',
      role: 'ADMIN',
    },
  })
  console.log('Admin user seeded:', user.email)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
