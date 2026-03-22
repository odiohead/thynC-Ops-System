/**
 * 프로젝트 Drive 폴더 일괄 생성 스크립트
 * driveFolderId가 없는 모든 프로젝트에 대해 병원 폴더 하위에 서브폴더를 생성하고 DB에 저장합니다.
 *
 * 사용법: node scripts/create-project-drive-folders.mjs
 */

import { PrismaClient } from '@prisma/client'
import { google } from 'googleapis'

const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error('환경변수 GOOGLE_SERVICE_ACCOUNT_JSON이 없습니다.')
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
  const projects = await prisma.$queryRaw`
    SELECT
      p.id,
      p.project_code,
      p.project_name,
      p.hospital_code,
      p.drive_folder_id,
      h.hospital_name,
      hm.drive_project_folder_id
    FROM projects p
    JOIN hospitals h ON h.hospital_code = p.hospital_code
    LEFT JOIN hospital_meta hm ON hm.hospital_code = p.hospital_code
    WHERE p.drive_folder_id IS NULL
    ORDER BY p.project_code
  `

  console.log(`총 ${projects.length}개 프로젝트에 Drive 폴더를 생성합니다.\n`)

  let success = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]
    const projectCode = p.project_code
    const hospitalName = p.hospital_name
    const parentFolderId = p.drive_project_folder_id

    if (!parentFolderId) {
      console.log(`[${i + 1}/${projects.length}] SKIP (병원 Drive 폴더 없음): ${projectCode} ${p.project_name}`)
      skipped++
      continue
    }

    const folderName = `${projectCode}_${hospitalName}`

    try {
      const folderId = await createFolder(folderName, parentFolderId)

      await prisma.project.update({
        where: { projectCode },
        data: { driveFolderId: folderId },
      })

      success++
      console.log(`[${i + 1}/${projects.length}] ✓ ${folderName}`)
      await sleep(150)
    } catch (err) {
      failed++
      console.error(`[${i + 1}/${projects.length}] ✗ ${folderName} — ${err.message}`)
      await sleep(500)
    }
  }

  console.log(`\n완료: 성공 ${success}개 / 스킵 ${skipped}개 / 실패 ${failed}개`)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error('스크립트 오류:', err)
  prisma.$disconnect()
  process.exit(1)
})
