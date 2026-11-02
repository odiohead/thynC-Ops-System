import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { deleteFromS3, getSignedUrl } from '@/lib/s3'
import { canEditStockOutRequest } from '@/lib/stockOut'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string; fileId: string } }

/**
 * 출고요청 첨부 단건 — 다운로드(302 presigned) / 삭제 (projects/stock_out_v2_design.md §15)
 * 삭제: 업로더 본인 또는 출고요청 수정 권한자(canEditStockOutRequest — ADMIN 이상 / stock_out.admin / 요청자(종결 전)).
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
  const ids = parseIds(params)
  if (!ids) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const file = await prisma.stockOutRequestFile.findFirst({ where: { id: ids.fileId, requestId: ids.id } })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  // 엑셀 등은 inline 의미가 없어 attachment로 — 브라우저가 원본 파일명으로 저장
  const url = await getSignedUrl(file.s3Key, 300, { downloadName: file.fileName, inline: false })
  return NextResponse.redirect(url, 302)
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ids = parseIds(params)
  if (!ids) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const file = await prisma.stockOutRequestFile.findFirst({
    where: { id: ids.fileId, requestId: ids.id },
    include: { request: { select: { sorCode: true, createdById: true, status: { select: { ticketStatus: true } } } } },
  })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  const own = file.uploadedById === user.userId
  if (!own && !canEditStockOutRequest(user, file.request, await hasPermission(user, 'stock_out.admin'))) {
    return NextResponse.json({ error: '첨부 삭제 권한이 없습니다. 본인이 올린 파일 또는 수정 권한이 있는 출고요청만 삭제할 수 있습니다.' }, { status: 403 })
  }

  try {
    await deleteFromS3(file.s3Key)
  } catch (e) {
    console.warn(`[stock-out] 첨부 S3 삭제 실패 (${file.s3Key}):`, e instanceof Error ? e.message : e)
  }
  await prisma.stockOutRequestFile.delete({ where: { id: ids.fileId } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'stock_out_request_file',
    resourceId: ids.fileId,
    resourceLabel: `${file.request.sorCode} / ${file.fileName}`,
    before: { requestId: ids.id, fileName: file.fileName, sizeBytes: file.sizeBytes, s3Key: file.s3Key },
  })
  return NextResponse.json({ success: true })
}
