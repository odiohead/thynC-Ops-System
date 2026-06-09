import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Ctx = { params: { id: string } }

const VALID_TYPES = new Set(['hospital', 'project'])

export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const refs = await prisma.wikiPageReference.findMany({
    where: { pageId: params.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      refType: true,
      refCode: true,
      createdAt: true,
    },
  })

  // 메인 도메인 라벨 enrich (병원명, 프로젝트명)
  const hospitalCodes = refs.filter((r) => r.refType === 'hospital').map((r) => r.refCode)
  const projectCodes = refs.filter((r) => r.refType === 'project').map((r) => r.refCode)

  const [hospitals, projects] = await Promise.all([
    hospitalCodes.length
      ? prisma.hospital.findMany({
          where: { hospitalCode: { in: hospitalCodes } },
          select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true },
        })
      : Promise.resolve([]),
    projectCodes.length
      ? prisma.project.findMany({
          where: { projectCode: { in: projectCodes } },
          select: { projectCode: true, projectName: true },
        })
      : Promise.resolve([]),
  ])

  const hospitalMap = new Map(hospitals.map((h) => [h.hospitalCode, h]))
  const projectMap = new Map(projects.map((p) => [p.projectCode, p]))

  const enriched = refs.map((r) => {
    if (r.refType === 'hospital') {
      const h = hospitalMap.get(r.refCode)
      return { ...r, label: h?.hospitalName ?? h?.hiraHospitalName ?? r.refCode }
    }
    if (r.refType === 'project') {
      const p = projectMap.get(r.refCode)
      return { ...r, label: p?.projectName ?? r.refCode }
    }
    return { ...r, label: r.refCode }
  })

  return NextResponse.json({ references: enriched })
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { refType, refCode } = body as { refType?: string; refCode?: string }

  if (!refType || !VALID_TYPES.has(refType)) {
    return NextResponse.json(
      { error: `refType은 다음 중 하나여야 합니다: ${Array.from(VALID_TYPES).join(', ')}` },
      { status: 400 },
    )
  }
  if (!refCode) return NextResponse.json({ error: 'refCode is required' }, { status: 400 })

  const page = await prisma.wikiPage.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

  // 메인 도메인 객체 존재 확인 — 잘못된 코드 차단
  if (refType === 'hospital') {
    const h = await prisma.hospital.findUnique({
      where: { hospitalCode: refCode },
      select: { hospitalCode: true },
    })
    if (!h) return NextResponse.json({ error: 'Hospital not found' }, { status: 404 })
  } else if (refType === 'project') {
    const p = await prisma.project.findUnique({
      where: { projectCode: refCode },
      select: { projectCode: true },
    })
    if (!p) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  try {
    const created = await prisma.wikiPageReference.create({
      data: {
        pageId: params.id,
        refType,
        refCode,
        createdById: authUser.userId,
      },
      select: { id: true, refType: true, refCode: true },
    })
    return NextResponse.json({ reference: created }, { status: 201 })
  } catch (e) {
    const err = e as { code?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: '이미 연결된 항목입니다.' }, { status: 409 })
    }
    throw e
  }
}
