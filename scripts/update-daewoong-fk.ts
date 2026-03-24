import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function main() {
  const mappingPath = path.join(__dirname, 'daewoong-user-mapping.json')
  const mapping: Record<string, string> = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'))
  console.log(`[INFO] 매핑 항목 수: ${Object.keys(mapping).length}`)

  // daewoong_hospital_assignments: daewoong_staff_id → assigned_user_id
  for (const [staffId, userId] of Object.entries(mapping)) {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE daewoong_hospital_assignments SET assigned_user_id = $1 WHERE staff_id = $2`,
      userId, staffId
    )
    console.log(`[ASSIGN] staff=${staffId} → user=${userId} (${result}건 업데이트)`)
  }

  // site_visits: daewoong_staff_id → daewoong_user_id
  for (const [staffId, userId] of Object.entries(mapping)) {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE site_visits SET daewoong_user_id = $1 WHERE daewoong_staff_id = $2`,
      userId, staffId
    )
    console.log(`[SITE_VISIT] staff=${staffId} → user=${userId} (${result}건 업데이트)`)
  }

  console.log('\n[INFO] FK 데이터 업데이트 완료')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
