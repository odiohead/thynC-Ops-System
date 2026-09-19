import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess } from '@/lib/weeklyAccess'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { deleteFromS3, getSignedUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string; fileId: string } }

/**
 * 주간업무 항목 첨부파일 단건 — 다운로드(302 presigned) / 삭제 (projects/weekly_attachments_design.md §4.2)
 * 파일이 해당 항목 소속인지 검증한다 — 키만으로 열리는 file-url?key= 방식은 쓰지 않음 (§7-F).
 */

function parseIds(p: Params['params']): { id: number; fileId: number } | null {
  const id = Number(p.id)
  const fileId = Number(p.fileId)
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(fileId) || fileId <= 0) return null
  return { id, fileId }
}

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const ids = parseIds(params)
  if (!ids) return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })

  const file = await prisma.weeklyItemFile.findFirst({ where: { id: ids.fileId, itemId: ids.id } })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  const url = await getSignedUrl(file.s3Key, 300, { downloadName: file.fileName, inline: true })
  return NextResponse.redirect(url, 302)
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const ids = parseIds(params)
  if (!ids) return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })

  const file = await prisma.weeklyItemFile.findFirst({
    where: { id: ids.fileId, itemId: ids.id },
    include: { item: { select: { title: true } } },
  })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  try {
    await deleteFromS3(file.s3Key)
  } catch (e) {
    console.warn(`[weekly] 첨부 S3 삭제 실패 (${file.s3Key}):`, e instanceof Error ? e.message : e)
  }
  await prisma.weeklyItemFile.delete({ where: { id: ids.fileId } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'weekly_item_file',
    resourceId: ids.fileId,
    resourceLabel: `${file.item.title} / ${file.fileName}`,
    before: { itemId: ids.id, fileName: file.fileName, sizeBytes: file.sizeBytes, s3Key: file.s3Key },
  })
  return NextResponse.json({ success: true })
}
