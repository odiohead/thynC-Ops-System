import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove, JWTPayload } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkConsultationRead, extractConsultationTitle } from '@/lib/consultation'

/**
 * 상담이력 상세/수정/삭제
 * 조회는 SEERS 소속, 수정·삭제는 그 위에 본인 또는 ADMIN 이상 (MaintenanceLog 선례)
 */

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const detailSelect = {
  id: true,
  consultationCode: true,
  hospitalCode: true,
  title: true,
  content: true,
  aiSummary: true,
  sessionId: true,
  consultedById: true,
  consultedByName: true,
  consultedAt: true,
  createdAt: true,
  updatedAt: true,
  consultationType: { select: { id: true, name: true, color: true } },
  documentType: { select: { id: true, name: true } },
  hospital: { select: { hospitalCode: true, hospitalName: true } },
} as const

function canModify(user: JWTPayload, consultedById: string): boolean {
  return isAdminOrAbove(user.role) || consultedById === user.userId
}

async function loadOrDeny(request: NextRequest, params: Params['params']) {
  const user = await getAuthUser(request)
  if (!user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const denied = await checkConsultationRead(user)
  if (denied) return { res: NextResponse.json({ error: denied.error }, { status: denied.status }) }

  const id = parseInt(params.id)
  if (isNaN(id)) return { res: NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 }) }

  const consultation = await prisma.consultation.findUnique({ where: { id }, select: detailSelect })
  if (!consultation) {
    return { res: NextResponse.json({ error: '상담이력을 찾을 수 없습니다.' }, { status: 404 }) }
  }
  return { user, consultation }
}

export async function GET(request: NextRequest, { params }: Params) {
  const loaded = await loadOrDeny(request, params)
  if ('res' in loaded) return loaded.res
  return NextResponse.json({ consultation: loaded.consultation })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const loaded = await loadOrDeny(request, params)
  if ('res' in loaded) return loaded.res
  const { user, consultation } = loaded

  if (user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canModify(user, consultation.consultedById)) {
    return NextResponse.json({ error: '본인이 저장한 상담이력만 수정할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { content, consultationTypeId, documentTypeId, consultedAt } = body as {
    content?: string
    consultationTypeId?: number | string | null
    documentTypeId?: number | string | null
    consultedAt?: string
  }

  if (content !== undefined && !content.trim()) {
    return NextResponse.json({ error: '상담 내용을 입력하세요.' }, { status: 400 })
  }

  const typeId = consultationTypeId === undefined ? undefined : consultationTypeId ? Number(consultationTypeId) : null
  const docTypeId = documentTypeId === undefined ? undefined : documentTypeId ? Number(documentTypeId) : null

  const updated = await prisma.consultation.update({
    where: { id: consultation.id },
    data: {
      ...(content !== undefined
        ? {
            content: content.trim(),
            title: extractConsultationTitle(content, consultation.title),
          }
        : {}),
      ...(typeId !== undefined ? { consultationTypeId: Number.isNaN(typeId as number) ? null : typeId } : {}),
      ...(docTypeId !== undefined ? { documentTypeId: Number.isNaN(docTypeId as number) ? null : docTypeId } : {}),
      ...(consultedAt && /^\d{4}-\d{2}-\d{2}$/.test(consultedAt)
        ? { consultedAt: new Date(consultedAt) }
        : {}),
    },
    select: detailSelect,
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'consultation',
    resourceId: consultation.id,
    resourceLabel: `${consultation.consultationCode} (${consultation.hospital.hospitalName})`,
    before: { title: consultation.title, content: consultation.content, consultedAt: consultation.consultedAt },
    after: { title: updated.title, content: updated.content, consultedAt: updated.consultedAt },
  })

  return NextResponse.json({ consultation: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const loaded = await loadOrDeny(request, params)
  if ('res' in loaded) return loaded.res
  const { user, consultation } = loaded

  if (user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canModify(user, consultation.consultedById)) {
    return NextResponse.json({ error: '본인이 저장한 상담이력만 삭제할 수 있습니다.' }, { status: 403 })
  }

  await prisma.consultation.delete({ where: { id: consultation.id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'consultation',
    resourceId: consultation.id,
    resourceLabel: `${consultation.consultationCode} (${consultation.hospital.hospitalName})`,
    before: { title: consultation.title, content: consultation.content },
  })

  return NextResponse.json({ ok: true })
}
