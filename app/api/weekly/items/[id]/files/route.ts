import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess } from '@/lib/weeklyAccess'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { uploadToS3 } from '@/lib/s3'
import { WEEKLY_FILE_MAX_BYTES, WEEKLY_FILES_PER_REQUEST } from '@/lib/weekly'
import { FILE_INCLUDE, toFileDto } from '../../../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 주간업무 항목 첨부파일 — 목록 / 다중 업로드 (projects/weekly_attachments_design.md §4.2)
 * 접근은 checkWeeklyAccess(조회/쓰기)로 강제. S3 키 `weekly/<itemId>/<ts>_<원본명>`.
 */

const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'sh', 'js', 'msi', 'com', 'scr', 'ps1'])

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** 파일명 정규화 — 경로 구분자·제어문자 제거, NFC (S3 키·저장 파일명 공용) */
function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .split('')
    .map((ch) => (ch === '/' || ch === '\\' || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .trim()
  return cleaned || 'file'
}

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const id = parseId(params.id)
  if (!id) return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })

  const item = await prisma.weeklyItem.findUnique({ where: { id }, select: { id: true } })
  if (!item) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })

  const files = await prisma.weeklyItemFile.findMany({
    where: { itemId: id },
    orderBy: { uploadedAt: 'asc' },
    include: FILE_INCLUDE,
  })
  return NextResponse.json({ files: files.map(toFileDto) })
}

// POST — multipart `files` N개. 파일별 실패는 건너뛰고 failed[]로 보고 (전부 실패면 400)
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const id = parseId(params.id)
  if (!id) return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })

  const item = await prisma.weeklyItem.findUnique({ where: { id }, select: { id: true, title: true } })
  if (!item) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart 요청이 아닙니다.' }, { status: 400 })
  }
  const inputs = formData.getAll('files').filter((v): v is File => v instanceof File && !!v.name)
  if (inputs.length === 0) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (inputs.length > WEEKLY_FILES_PER_REQUEST) {
    return NextResponse.json({ error: `한 번에 최대 ${WEEKLY_FILES_PER_REQUEST}개까지 업로드할 수 있습니다.` }, { status: 400 })
  }

  const saved: ReturnType<typeof toFileDto>[] = []
  const failed: { name: string; error: string }[] = []

  for (const file of inputs) {
    const name = safeFileName(file.name)
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
    if (BLOCKED_EXT.has(ext)) {
      failed.push({ name, error: '허용되지 않는 파일 형식입니다.' })
      continue
    }
    if (file.size > WEEKLY_FILE_MAX_BYTES) {
      failed.push({ name, error: `파일당 ${Math.round(WEEKLY_FILE_MAX_BYTES / 1024 / 1024)}MB를 초과했습니다.` })
      continue
    }
    if (file.size === 0) {
      failed.push({ name, error: '빈 파일입니다.' })
      continue
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const s3Key = `weekly/${id}/${Date.now()}_${name}`
      await uploadToS3(buffer, s3Key, file.type || 'application/octet-stream')
      const row = await prisma.weeklyItemFile.create({
        data: {
          itemId: id,
          fileName: name,
          s3Key,
          sizeBytes: file.size,
          contentType: file.type || null,
          uploadedById: user.userId,
        },
        include: FILE_INCLUDE,
      })
      saved.push(toFileDto(row))
      await logAudit({
        req: request,
        actor: auditActorFromJWT(user),
        action: 'CREATE',
        resource: 'weekly_item_file',
        resourceId: row.id,
        resourceLabel: `${item.title} / ${name}`,
        after: { itemId: id, fileName: name, sizeBytes: file.size, s3Key },
      })
    } catch (e) {
      console.error(`[weekly] 첨부 업로드 실패 (item ${id}, ${name}):`, e)
      failed.push({ name, error: '업로드에 실패했습니다.' })
    }
  }

  if (saved.length === 0) {
    return NextResponse.json({ error: failed.map((f) => `${f.name}: ${f.error}`).join('\n'), failed }, { status: 400 })
  }
  return NextResponse.json({ files: saved, failed }, { status: 201 })
}
