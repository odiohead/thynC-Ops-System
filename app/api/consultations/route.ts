import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkAiAccess } from '@/lib/ai/access'
import {
  checkConsultationRead,
  nextConsultationCode,
  extractConsultationTitle,
  todayKst,
} from '@/lib/consultation'

/**
 * 상담이력 목록/생성
 * - GET  : 조회 권한(SEERS 소속) — hospitalCode·기간·상담자·검색어 필터 + 페이지네이션
 * - POST : AI 어시스턴트 '상담이력 저장'이 유일한 생성 경로 (checkAiAccess)
 *
 * 설계: consultation_history_design.md
 */

export const dynamic = 'force-dynamic'

const listSelect = {
  id: true,
  consultationCode: true,
  hospitalCode: true,
  title: true,
  content: true,
  consultedByName: true,
  consultedAt: true,
  createdAt: true,
  sessionId: true,
  consultationType: { select: { id: true, name: true, color: true } },
  documentType: { select: { id: true, name: true } },
  consultedBy: { select: { id: true, name: true } },
  hospital: { select: { hospitalCode: true, hospitalName: true } },
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = await checkConsultationRead(user)
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  const sp = new URL(request.url).searchParams
  const hospitalCode = sp.get('hospitalCode') || undefined
  const consultedById = sp.get('consultedById') || undefined
  const from = sp.get('from') || undefined
  const to = sp.get('to') || undefined
  const q = sp.get('q')?.trim() || undefined
  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '20') || 20))

  const where: Prisma.ConsultationWhereInput = {
    ...(hospitalCode ? { hospitalCode } : {}),
    ...(consultedById ? { consultedById } : {}),
    ...(from || to
      ? {
          consultedAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { content: { contains: q, mode: 'insensitive' } },
            { consultationCode: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [consultations, total] = await Promise.all([
    prisma.consultation.findMany({
      where,
      select: listSelect,
      orderBy: [{ consultedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.consultation.count({ where }),
  ])

  return NextResponse.json({ consultations, total, page, pageSize })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // 생성은 어시스턴트 사용 권한과 동일 (SEERS + USER 이상)
  const denied = await checkAiAccess(user)
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  const body = await request.json().catch(() => ({}))
  const {
    hospitalCode,
    content,
    aiSummary,
    consultationTypeId,
    documentTypeId,
    sessionId,
    consultedAt,
  } = body as {
    hospitalCode?: string
    content?: string
    aiSummary?: string
    consultationTypeId?: number | string | null
    documentTypeId?: number | string | null
    sessionId?: string | null
    consultedAt?: string
  }

  if (!hospitalCode) {
    return NextResponse.json({ error: '병원을 지정하세요.' }, { status: 400 })
  }
  if (!content || !content.trim()) {
    return NextResponse.json({ error: '상담 내용을 입력하세요.' }, { status: 400 })
  }

  const hospital = await prisma.hospital.findUnique({
    where: { hospitalCode },
    select: { hospitalCode: true, hospitalName: true },
  })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const typeId = consultationTypeId ? Number(consultationTypeId) : null
  const docTypeId = documentTypeId ? Number(documentTypeId) : null
  const title = extractConsultationTitle(content, `${hospital.hospitalName} 상담`)
  const day = consultedAt && /^\d{4}-\d{2}-\d{2}$/.test(consultedAt) ? consultedAt : todayKst()

  // 코드 UNIQUE 충돌(동시 저장)은 재발번으로 재시도 (InventoryTransaction 선례)
  let created: { id: number; consultationCode: string } | null = null
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const consultationCode = await nextConsultationCode()
    try {
      created = await prisma.consultation.create({
        data: {
          consultationCode,
          hospitalCode: hospital.hospitalCode,
          consultationTypeId: typeId && !Number.isNaN(typeId) ? typeId : null,
          documentTypeId: docTypeId && !Number.isNaN(docTypeId) ? docTypeId : null,
          title,
          content: content.trim(),
          aiSummary: aiSummary?.trim() || null,
          sessionId: sessionId || null,
          consultedById: user.userId,
          consultedByName: user.name,
          consultedAt: new Date(day),
        },
        select: { id: true, consultationCode: true },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
  if (!created) {
    return NextResponse.json({ error: '상담이력 코드 발번에 실패했습니다. 다시 시도하세요.' }, { status: 409 })
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'consultation',
    resourceId: created.id,
    resourceLabel: `${created.consultationCode} (${hospital.hospitalName})`,
    after: { hospitalCode: hospital.hospitalCode, title, consultedAt: day },
  })

  return NextResponse.json(
    { id: created.id, consultationCode: created.consultationCode },
    { status: 201 },
  )
}
