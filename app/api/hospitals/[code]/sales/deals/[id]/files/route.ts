import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkSalesAccess } from '@/lib/sales'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { uploadToS3 } from '@/lib/s3'
import {
  SALES_DEAL_FILE_BLOCKED_EXT,
  SALES_DEAL_FILE_KIND_LABELS,
  SALES_DEAL_FILE_MAX_BYTES,
  SALES_DEAL_FILES_PER_REQUEST,
  isSalesDealFileKind,
  safeDealFileName,
  toSalesDealFileDto,
} from '@/lib/salesDealFiles'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; id: string } }

/**
 * 딜 첨부(견적서·계약서) — 목록 / 다중 업로드 (projects/sales_crm_design.md §7)
 * 접근은 checkSalesAccess(조회/쓰기)로 강제. 딜이 해당 병원 소속인지 검증. S3 키 `sales-deals/<dealId>/<kind>/<ts>_<원본명>`.
 */

async function loadDeal(code: string, rawId: string) {
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) return null
  const deal = await prisma.salesDeal.findUnique({ where: { id }, select: { id: true, dealCode: true, hospitalCode: true, hospital: { select: { hospitalName: true } } } })
  if (!deal || deal.hospitalCode !== code) return null
  return deal
}

const FILE_INCLUDE = { uploadedBy: { select: { name: true } } } as const

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const deal = await loadDeal(params.code, params.id)
  if (!deal) return NextResponse.json({ error: '딜을 찾을 수 없습니다.' }, { status: 404 })

  const kind = request.nextUrl.searchParams.get('kind')
  const files = await prisma.salesDealFile.findMany({
    where: { dealId: deal.id, ...(isSalesDealFileKind(kind) ? { kind } : {}) },
    orderBy: { uploadedAt: 'asc' },
    include: FILE_INCLUDE,
  })
  return NextResponse.json({ files: files.map(toSalesDealFileDto) })
}

// POST — multipart `kind`(QUOTE|CONTRACT) + `files` N개. 파일별 실패는 건너뛰고 failed[]로 보고 (전부 실패면 400)
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const deal = await loadDeal(params.code, params.id)
  if (!deal) return NextResponse.json({ error: '딜을 찾을 수 없습니다.' }, { status: 404 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart 요청이 아닙니다.' }, { status: 400 })
  }
  const kind = formData.get('kind')
  if (!isSalesDealFileKind(kind)) return NextResponse.json({ error: '첨부 종류(견적서/계약서)가 올바르지 않습니다.' }, { status: 400 })

  const inputs = formData.getAll('files').filter((v): v is File => v instanceof File && !!v.name)
  if (inputs.length === 0) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (inputs.length > SALES_DEAL_FILES_PER_REQUEST) {
    return NextResponse.json({ error: `한 번에 최대 ${SALES_DEAL_FILES_PER_REQUEST}개까지 업로드할 수 있습니다.` }, { status: 400 })
  }

  const saved: ReturnType<typeof toSalesDealFileDto>[] = []
  const failed: { name: string; error: string }[] = []

  for (const file of inputs) {
    const name = safeDealFileName(file.name)
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
    if (SALES_DEAL_FILE_BLOCKED_EXT.has(ext)) {
      failed.push({ name, error: '허용되지 않는 파일 형식입니다.' })
      continue
    }
    if (file.size > SALES_DEAL_FILE_MAX_BYTES) {
      failed.push({ name, error: `파일당 ${Math.round(SALES_DEAL_FILE_MAX_BYTES / 1024 / 1024)}MB를 초과했습니다.` })
      continue
    }
    if (file.size === 0) {
      failed.push({ name, error: '빈 파일입니다.' })
      continue
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const s3Key = `sales-deals/${deal.id}/${kind.toLowerCase()}/${Date.now()}_${name}`
      await uploadToS3(buffer, s3Key, file.type || 'application/octet-stream')
      const row = await prisma.salesDealFile.create({
        data: {
          dealId: deal.id,
          kind,
          fileName: name,
          s3Key,
          sizeBytes: file.size,
          contentType: file.type || null,
          uploadedById: user.userId,
        },
        include: FILE_INCLUDE,
      })
      saved.push(toSalesDealFileDto(row))
      await logAudit({
        req: request,
        actor: auditActorFromJWT(user),
        action: 'CREATE',
        resource: 'sales_deal_file',
        resourceId: row.id,
        resourceLabel: `${deal.hospital.hospitalName} ${deal.dealCode} / ${SALES_DEAL_FILE_KIND_LABELS[kind]} / ${name}`,
        after: { dealId: deal.id, kind, fileName: name, sizeBytes: file.size, s3Key },
      })
    } catch (e) {
      console.error(`[sales-deals] 첨부 업로드 실패 (deal ${deal.id}, ${name}):`, e)
      failed.push({ name, error: '업로드에 실패했습니다.' })
    }
  }

  if (saved.length === 0) {
    return NextResponse.json({ error: failed.map((f) => `${f.name}: ${f.error}`).join('\n'), failed }, { status: 400 })
  }
  return NextResponse.json({ files: saved, failed }, { status: 201 })
}
