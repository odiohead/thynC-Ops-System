/**
 * 병원 Drive 폴더 일괄 생성 스크립트
 * driveProjectFolderId가 없는 모든 병원에 대해 Drive 폴더를 생성하고 DB에 저장합니다.
 */
import { PrismaClient } from '@prisma/client'
import { google } from 'googleapis'

const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
const GOOGLE_HOSPITAL_FOLDER_ID = process.env.GOOGLE_HOSPITAL_FOLDER_ID

if (!GOOGLE_SERVICE_ACCOUNT_JSON || !GOOGLE_HOSPITAL_FOLDER_ID) {
  console.error('환경변수 GOOGLE_SERVICE_ACCOUNT_JSON 또는 GOOGLE_HOSPITAL_FOLDER_ID가 없습니다.')
  process.exit(1)
}

const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON)
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive'],
})
const drive = google.drive({ version: 'v3', auth })
const prisma = new PrismaClient()

async function createFolder(name, parentId) {
  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, name',
  })
  return response.data.id
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  const hospitals = await prisma.$queryRaw`
    SELECT h.hospital_code, h.hospital_name, h.hira_hospital_name
    FROM hospitals h
    LEFT JOIN hospital_meta hm ON hm.hospital_code = h.hospital_code
    WHERE hm.drive_project_folder_id IS NULL OR hm.drive_project_folder_id = ''
    ORDER BY h.hospital_code
  `

  console.log(`총 ${hospitals.length}개 병원에 Drive 폴더를 생성합니다.\n`)

  let success = 0
  let failed = 0

  for (let i = 0; i < hospitals.length; i++) {
    const h = hospitals[i]
    const hospitalName = h.hospital_name || h.hira_hospital_name
    const folderName = `${h.hospital_code}_${hospitalName}`

    try {
      const folderId = await createFolder(folderName, GOOGLE_HOSPITAL_FOLDER_ID)

      await prisma.hospitalMeta.upsert({
        where: { hospitalCode: h.hospital_code },
        update: { driveProjectFolderId: folderId },
        create: { hospitalCode: h.hospital_code, driveProjectFolderId: folderId },
      })

      success++
      console.log(`[${i + 1}/${hospitals.length}] ✓ ${folderName}`)
      await sleep(100)
    } catch (err) {
      failed++
      console.error(`[${i + 1}/${hospitals.length}] ✗ ${folderName} — ${err.message}`)
      await sleep(500)
    }
  }

  console.log(`\n완료: 성공 ${success}개 / 실패 ${failed}개`)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error('스크립트 오류:', err)
  prisma.$disconnect()
  process.exit(1)
})
