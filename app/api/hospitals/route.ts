import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const PAGE_SIZE = 20

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { hiraId, hospitalName, status, introTypeIds, introBeds } = await request.json()

  if (!hospitalName?.trim()) {
    return NextResponse.json({ error: '병원명은 필수입니다.' }, { status: 400 })
  }
  if (!status?.trim()) {
    return NextResponse.json({ error: '상태는 필수입니다.' }, { status: 400 })
  }

  let hiraData = null
  if (hiraId) {
    hiraData = await prisma.hiraHospital.findUnique({ where: { hiraId } })
    if (!hiraData) {
      return NextResponse.json({ error: '심평원 병원 정보를 찾을 수 없습니다.' }, { status: 404 })
    }
    const existing = await prisma.hospital.findUnique({ where: { hiraId } })
    if (existing) {
      return NextResponse.json({ error: '이미 등록된 병원입니다.' }, { status: 409 })
    }
  }

  const allCodes = await prisma.hospital.findMany({
    where: { hospitalCode: { startsWith: 'HOSP-' } },
    select: { hospitalCode: true },
  })
  const maxNum = allCodes.reduce((max, h) => {
    const match = h.hospitalCode.match(/^HOSP-(\d+)$/)
    return match ? Math.max(max, parseInt(match[1])) : max
  }, 0)
  const hospitalCode = `HOSP-${String(maxNum + 1).padStart(6, '0')}`

  const hospital = await prisma.hospital.create({
    data: {
      hospitalCode,
      hiraId: hiraData?.hiraId ?? null,
      hiraHospitalName: hiraData?.name ?? hospitalName.trim(),
      hospitalName: hospitalName.trim(),
      type: hiraData?.typeName ?? '',
      sidoCode: hiraData?.sidoCode ?? null,
      sidoName: hiraData?.sidoName ?? null,
      sigunguCode: hiraData?.sigunguCode ?? null,
      sigunguName: hiraData?.sigunguName ?? null,
      eupmyeondong: hiraData?.eupmyeondong ?? null,
      postalCode: hiraData?.postalCode ?? null,
      address: hiraData?.address ?? null,
      coordinateX: hiraData?.coordinateX ?? null,
      coordinateY: hiraData?.coordinateY ?? null,
      status,
      introBeds: introBeds != null ? Number(introBeds) : null,
    },
  })

  // Create HospitalIntroType records
  if (Array.isArray(introTypeIds) && introTypeIds.length > 0) {
    await prisma.hospitalIntroType.createMany({
      data: introTypeIds.map((scId: number) => ({ hospitalId: hospital.id, statusCodeId: scId })),
    })
  }

  // S3 directory for future file storage
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `hospitals/${hospitalCode}/`,
      Body: '',
    }))
  } catch (s3Err) {
    console.error(`S3 병원 디렉토리 생성 실패 [${hospitalCode}]:`, s3Err)
  }

  return NextResponse.json({ hospital }, { status: 201 })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const search = searchParams.get('search') ?? ''
  const sido = searchParams.get('sido') ?? ''

  const where = {
    ...(search && {
      OR: [
        { hospitalName: { contains: search, mode: 'insensitive' as const } },
        { hiraHospitalName: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
    ...(sido && { sidoName: sido }),
  }

  const [hospitals, total, statusCodes] = await Promise.all([
    prisma.hospital.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        hospitalCode: true,
        hospitalName: true,
        address: true,
        status: true,
        contractDate: true,
        meta: {
          select: { driveProjectFolderId: true },
        },
      },
    }),
    prisma.hospital.count({ where }),
    prisma.statusCode.findMany({ select: { name: true, color: true } }),
  ])

  const colorMap = new Map(statusCodes.map((sc) => [sc.name, sc.color]))

  return NextResponse.json({
    hospitals: hospitals.map((h) => ({ ...h, statusColor: colorMap.get(h.status) ?? null })),
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  })
}
