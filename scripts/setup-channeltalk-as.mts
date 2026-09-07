/**
 * 채널톡 AS 폴링 셋업 (일회용) — 봇 계정 + AppSetting + (dev) 테스트 시트 생성
 * 실행: node --env-file=.env --import tsx scripts/tmp-setup-channeltalk.mts [dev|prod]
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { google } from 'googleapis'

const prisma = new PrismaClient()
const MODE = process.argv[2] ?? 'dev'

async function ensureBot() {
  const email = 'channeltalk-bot@seersthync.com'
  const exist = await prisma.user.findUnique({ where: { email } })
  if (exist) { console.log('봇 계정 이미 존재:', exist.id, exist.name, 'active=', exist.isActive); return exist }
  const seers = await prisma.organization.findUnique({ where: { code: 'SEERS' } })
  const u = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(randomBytes(32).toString('hex'), 10), // 무작위 — 로그인 불가
      name: '채널톡 접수봇',
      phone: '-',
      role: 'USER',
      isActive: false, // 로그인 차단 — 폴링 전용 계정
      organizationId: seers?.id ?? null,
      slackNotifyEnabled: false,
    },
  })
  console.log('봇 계정 생성:', u.id, u.name)
  return u
}

async function setSettings(entries: Record<string, string>) {
  for (const [key, value] of Object.entries(entries)) {
    await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    console.log('AppSetting', key, '=', value)
  }
}

async function makeTestSheet(): Promise<string> {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const drive = google.drive({ version: 'v3', auth })
  const REAL = '1rpXzu1ry-JZtGTNp959HbYgDZw0SncTZdyI6c20G1R4'
  const src = await sheets.spreadsheets.values.get({ spreadsheetId: REAL, range: "'A/S'!A1:AH1" })
  const row3613 = await sheets.spreadsheets.values.get({ spreadsheetId: REAL, range: "'A/S'!A3613:AH3613" })
  const created = await drive.files.create({
    requestBody: {
      name: '[TEST] 채널톡 AS 폴링 dev2',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID!],
    },
    supportsAllDrives: true,
    fields: 'id',
  })
  const id = created.data.id!
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: 0, title: 'A/S' }, fields: 'title' } }] },
  })
  const header = src.data.values![0]
  const sample = row3613.data.values![0]
  // 행2 = 실샘플(3613 복사) / 행3 = 병원 매칭 실패 케이스 / 행4 = 시리얼 누락 케이스
  const bad1 = [...sample]; bad1[1] = '존재하지않는병원'; bad1[5] = 'P000001'
  const bad2 = [...sample]; bad2[5] = ''
  await sheets.spreadsheets.values.update({
    spreadsheetId: id, range: "'A/S'!A1", valueInputOption: 'RAW',
    requestBody: { values: [header, sample, bad1, bad2] },
  })
  console.log('테스트 시트 생성:', id)
  return id
}

const bot = await ensureBot()
if (MODE === 'dev') {
  const testId = await makeTestSheet()
  await setSettings({
    channeltalk_as_sheet_id: testId,
    channeltalk_as_cutover_row: '1',
    channeltalk_as_interval: 'off', // dev2는 수동 실행으로 테스트
  })
} else {
  await setSettings({
    channeltalk_as_sheet_id: '1rpXzu1ry-JZtGTNp959HbYgDZw0SncTZdyI6c20G1R4',
    channeltalk_as_cutover_row: '3612',
    channeltalk_as_interval: '1m',
  })
}
await prisma.$disconnect()
console.log('완료 (mode=' + MODE + ', bot=' + bot.id + ')')
