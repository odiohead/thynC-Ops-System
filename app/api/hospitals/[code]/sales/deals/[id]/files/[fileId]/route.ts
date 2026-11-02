import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkSalesAccess } from '@/lib/sales'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { deleteFromS3, getSignedUrl } from '@/lib/s3'
import { SALES_DEAL_FILE_KIND_LABELS, isSalesDealFileKind } from '@/lib/salesDealFiles'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; id: string; fileId: string } }

/**
 * 딜 첨부 단건 — 다운로드(302 presigned, inline) / 삭제 (projects/sales_crm_design.md §7)
 * 파일이 해당 병원의 해당 딜 소속인지 검증한다 — 키만으로 열리는 방식은 쓰지 않음.
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
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const ids = parseIds(params)
  if (!ids) return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })

  const file = await prisma.salesDealFile.findFirst({ where: { id: ids.fileId, dealId: ids.id, deal: { hospitalCode: params.code } } })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  const url = await getSignedUrl(file.s3Key, 300, { downloadName: file.fileName, inline: true })
  return NextResponse.redirect(url, 302)
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const ids = parseIds(params)
  if (!ids) return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })

  const file = await prisma.salesDealFile.findFirst({
    where: { id: ids.fileId, dealId: ids.id, deal: { hospitalCode: params.code } },
    include: { deal: { select: { dealCode: true, hospital: { select: { hospitalName: true } } } } },
  })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  try {
    await deleteFromS3(file.s3Key)
  } catch (e) {
    console.warn(`[sales-deals] 첨부 S3 삭제 실패 (${file.s3Key}):`, e instanceof Error ? e.message : e)
  }
  await prisma.salesDealFile.delete({ where: { id: ids.fileId } })

  const kindLabel = isSalesDealFileKind(file.kind) ? SALES_DEAL_FILE_KIND_LABELS[file.kind] : file.kind
  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'sales_deal_file',
    resourceId: ids.fileId,
    resourceLabel: `${file.deal.hospital.hospitalName} ${file.deal.dealCode} / ${kindLabel} / ${file.fileName}`,
    before: { dealId: ids.id, kind: file.kind, fileName: file.fileName, sizeBytes: file.sizeBytes, s3Key: file.s3Key },
  })
  return NextResponse.json({ success: true })
}
