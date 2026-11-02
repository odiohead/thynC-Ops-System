import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { uploadToS3 } from '@/lib/s3'
import {
  STOCK_OUT_FILE_BLOCKED_EXT,
  STOCK_OUT_FILE_MAX_BYTES,
  STOCK_OUT_FILES_PER_REQUEST,
  safeStockOutFileName,
  toStockOutFileDto,
} from '@/lib/stockOutFiles'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 출고요청 첨부파일 — 목록 / 다중 업로드 (projects/stock_out_v2_design.md §15)
 * 조회: 로그인 사용자. 업로드: VIEWER 제외(요청자·자재담당·엔지니어 누구나 — 출고 근거 엑셀 등). S3 키 `stock-out/<requestId>/<ts>_<원본명>`.
 */

const FILE_INCLUDE = { uploadedBy: { select: { name: true } } } as const

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = parseId(params.id)
  if (!id) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const req = await prisma.stockOutRequest.findUnique({ where: { id }, select: { id: true } })
  if (!req) return NextResponse.json({ error: '출고요청을 찾을 수 없습니다.' }, { status: 404 })

  const files = await prisma.stockOutRequestFile.findMany({ where: { requestId: id }, orderBy: { uploadedAt: 'asc' }, include: FILE_INCLUDE })
  return NextResponse.json({ files: files.map(toStockOutFileDto) })
}

// POST — multipart `files` N개. 파일별 실패는 건너뛰고 failed[]로 보고 (전부 실패면 400)
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseId(params.id)
  if (!id) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const req = await prisma.stockOutRequest.findUnique({ where: { id }, select: { id: true, sorCode: true } })
  if (!req) return NextResponse.json({ error: '출고요청을 찾을 수 없습니다.' }, { status: 404 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart 요청이 아닙니다.' }, { status: 400 })
  }
  const inputs = formData.getAll('files').filter((v): v is File => v instanceof File && !!v.name)
  if (inputs.length === 0) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (inputs.length > STOCK_OUT_FILES_PER_REQUEST) {
    return NextResponse.json({ error: `한 번에 최대 ${STOCK_OUT_FILES_PER_REQUEST}개까지 업로드할 수 있습니다.` }, { status: 400 })
  }

  const saved: ReturnType<typeof toStockOutFileDto>[] = []
  const failed: { name: string; error: string }[] = []

  for (const file of inputs) {
    const name = safeStockOutFileName(file.name)
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
    if (STOCK_OUT_FILE_BLOCKED_EXT.has(ext)) { failed.push({ name, error: '허용되지 않는 파일 형식입니다.' }); continue }
    if (file.size > STOCK_OUT_FILE_MAX_BYTES) { failed.push({ name, error: `파일당 ${Math.round(STOCK_OUT_FILE_MAX_BYTES / 1024 / 1024)}MB를 초과했습니다.` }); continue }
    if (file.size === 0) { failed.push({ name, error: '빈 파일입니다.' }); continue }
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const s3Key = `stock-out/${id}/${Date.now()}_${name}`
      await uploadToS3(buffer, s3Key, file.type || 'application/octet-stream')
      const row = await prisma.stockOutRequestFile.create({
        data: { requestId: id, fileName: name, s3Key, sizeBytes: file.size, contentType: file.type || null, uploadedById: user.userId },
        include: FILE_INCLUDE,
      })
      saved.push(toStockOutFileDto(row))
      await logAudit({
        req: request,
        actor: auditActorFromJWT(user),
        action: 'CREATE',
        resource: 'stock_out_request_file',
        resourceId: row.id,
        resourceLabel: `${req.sorCode} / ${name}`,
        after: { requestId: id, fileName: name, sizeBytes: file.size, s3Key },
      })
    } catch (e) {
      console.error(`[stock-out] 첨부 업로드 실패 (request ${id}, ${name}):`, e)
      failed.push({ name, error: '업로드에 실패했습니다.' })
    }
  }

  if (saved.length === 0) {
    return NextResponse.json({ error: failed.map((f) => `${f.name}: ${f.error}`).join('\n'), failed }, { status: 400 })
  }
  return NextResponse.json({ files: saved, failed }, { status: 201 })
}
