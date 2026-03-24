import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function main() {
  // 1. 대웅제약 organization id 조회
  const daewoongOrg = await prisma.organization.findUnique({ where: { code: 'DAEWOONG' } })
  if (!daewoongOrg) throw new Error('대웅제약 organization 레코드가 없습니다.')
  console.log(`[INFO] 대웅제약 organization id: ${daewoongOrg.id}`)

  // 2. daewoong_staff 전체 조회
  const staffList = await prisma.daewoongStaff.findMany()
  console.log(`[INFO] DaewoongStaff 총 ${staffList.length}건`)

  const mapping: Record<string, string> = {} // staffId → userId
  let created = 0
  let updated = 0
  let failed = 0

  const hashedPassword = await bcrypt.hash('daewoong1234', 10)

  // 3. 각 DaewoongStaff → User 변환
  for (const staff of staffList) {
    try {
      const email = staff.email && staff.email.trim()
        ? staff.email.trim()
        : `daewoong-${staff.id}@daewoong.com`

      const existing = await prisma.user.findUnique({ where: { email } })

      if (existing) {
        // 이미 존재하면 organizationId만 업데이트
        await prisma.user.update({
          where: { id: existing.id },
          data: { organizationId: daewoongOrg.id },
        })
        mapping[staff.id] = existing.id
        updated++
        console.log(`[UPDATE] ${staff.name} (${email}) → User ${existing.id}`)
      } else {
        // 신규 User 생성
        const newUser = await prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            name: staff.name,
            phone: staff.phoneNumber ?? '',
            role: 'USER',
            organizationId: daewoongOrg.id,
            isActive: true,
          },
        })
        mapping[staff.id] = newUser.id
        created++
        console.log(`[CREATE] ${staff.name} (${email}) → User ${newUser.id}`)
      }
    } catch (err) {
      failed++
      console.error(`[FAIL] staff id=${staff.id} name=${staff.name}:`, err)
    }
  }

  // 4. 결과 출력
  console.log('\n========== 마이그레이션 결과 ==========')
  console.log(`신규 생성: ${created}건`)
  console.log(`기존 업데이트: ${updated}건`)
  console.log(`실패: ${failed}건`)
  console.log('\n[매핑 테이블]')
  console.log('DaewoongStaff ID → User ID')
  for (const [staffId, userId] of Object.entries(mapping)) {
    console.log(`  ${staffId} → ${userId}`)
  }

  // 5. 매핑 파일 저장
  const outputPath = path.join(__dirname, 'daewoong-user-mapping.json')
  fs.writeFileSync(outputPath, JSON.stringify(mapping, null, 2), 'utf-8')
  console.log(`\n[INFO] 매핑 파일 저장: ${outputPath}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
