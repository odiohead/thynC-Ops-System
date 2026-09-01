import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { code: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const [hospital, statusCodes] = await Promise.all([
    prisma.hospital.findUnique({
      where: { hospitalCode: params.code },
      include: {
        meta: true,
        introTypes: { include: { statusCode: true }, orderBy: { statusCode: { order: 'asc' } } },
      },
    }),
    prisma.statusCode.findMany({ where: { category: 'HOSPITAL' }, orderBy: { order: 'asc' } }),
  ])

  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const statusColor = statusCodes.find((sc) => sc.name === hospital.status)?.color ?? null

  return NextResponse.json({ hospital: { ...hospital, statusColor }, statusCodes })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { hospitalName, status, introType, introBeds, contractDate, changeHira, hiraId, introTypeIds } = await request.json()

  let hiraUpdateData: Record<string, unknown> = {}

  if (changeHira) {
    if (hiraId) {
      const hira = await prisma.hiraHospital.findUnique({ where: { hiraId } })
      if (!hira) return NextResponse.json({ error: '심평원 병원을 찾을 수 없습니다.' }, { status: 404 })

      const duplicate = await prisma.hospital.findFirst({
        where: { hiraId, NOT: { hospitalCode: params.code } },
      })
      if (duplicate) return NextResponse.json({ error: '이미 다른 병원에 연결된 심평원 병원입니다.' }, { status: 409 })

      hiraUpdateData = {
        hiraId: hira.hiraId,
        hiraHospitalName: hira.name,
        type: hira.typeName,
        sidoCode: hira.sidoCode,
        sidoName: hira.sidoName,
        sigunguCode: hira.sigunguCode,
        sigunguName: hira.sigunguName,
        eupmyeondong: hira.eupmyeondong,
        postalCode: hira.postalCode,
        address: hira.address,
        coordinateX: hira.coordinateX,
        coordinateY: hira.coordinateY,
      }
    } else {
      // 연결 해제
      hiraUpdateData = {
        hiraId: null,
        type: '',
        sidoCode: null,
        sidoName: null,
        sigunguCode: null,
        sigunguName: null,
        eupmyeondong: null,
        postalCode: null,
        address: null,
        coordinateX: null,
        coordinateY: null,
      }
    }
  }

  const existingHospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code } })
  if (!existingHospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const [hospital] = await prisma.$transaction(async (tx) => {
    const updated = await tx.hospital.update({
      where: { hospitalCode: params.code },
      data: {
        hospitalName,
        status,
        introType: introType ?? null,
        introBeds: introBeds !== undefined && introBeds !== '' ? Number(introBeds) : null,
        contractDate: contractDate ? new Date(contractDate) : null,
        ...hiraUpdateData,
      },
      include: {
        meta: true,
        introTypes: { include: { statusCode: true }, orderBy: { statusCode: { order: 'asc' } } },
      },
    })

    if (Array.isArray(introTypeIds)) {
      await tx.hospitalIntroType.deleteMany({ where: { hospitalId: existingHospital.id } })
      if (introTypeIds.length > 0) {
        await tx.hospitalIntroType.createMany({
          data: introTypeIds.map((scId: number) => ({ hospitalId: existingHospital.id, statusCodeId: scId })),
        })
      }
    }

    return [updated]
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'hospital',
    resourceId: params.code,
    resourceLabel: hospital.hospitalName,
    before: existingHospital,
    after: hospital,
  })

  revalidatePath('/hospitals')
  revalidatePath(`/hospitals/${params.code}`, 'page')
  return NextResponse.json({ hospital })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [projectCount, siteVisitCount, deviceCount, deviceEventCount, wardCount, importBatchWithEventsCount] = await Promise.all([
    prisma.project.count({ where: { hospitalCode: params.code } }),
    prisma.siteVisit.count({ where: { hospitalCode: params.code } }),
    // 디바이스 원장 선검사 (hospital_device_registry_design.md §9.6) — FK RESTRICT 위반 대신 409로 안내
    prisma.hospitalDevice.count({ where: { OR: [{ hospitalCode: params.code }, { lastHospitalCode: params.code }] } }),
    prisma.hospitalDeviceEvent.count({ where: { hospitalCode: params.code } }),
    prisma.hospitalWard.count({ where: { hospitalCode: params.code } }),
    prisma.hospitalDeviceImportBatch.count({ where: { hospitalCode: params.code, events: { some: {} } } }),
  ])
  if (projectCount > 0) {
    return NextResponse.json({ error: '연결된 프로젝트가 있어 삭제할 수 없습니다.' }, { status: 409 })
  }
  if (siteVisitCount > 0) {
    return NextResponse.json({ error: '연결된 답사 기록이 있어 삭제할 수 없습니다.' }, { status: 409 })
  }
  if (deviceCount > 0 || deviceEventCount > 0 || wardCount > 0 || importBatchWithEventsCount > 0) {
    const detail = [`등록 ${deviceCount}대`, `이력 ${deviceEventCount}건`, `병동 ${wardCount}개`]
    if (importBatchWithEventsCount > 0) detail.push(`임포트 배치 ${importBatchWithEventsCount}건`)
    return NextResponse.json(
      {
        error: `연결된 디바이스 원장(${detail.join('·')})이 있어 삭제할 수 없습니다. 업무 일괄 이전으로 다른 병원에 옮기거나 디바이스 원장에서 정리한 뒤 다시 시도하세요.`,
      },
      { status: 409 },
    )
  }

  const existing = await prisma.hospital.findUnique({ where: { hospitalCode: params.code } })
  if (!existing) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  await prisma.$transaction([
    prisma.daewoongHospitalAssignment.deleteMany({ where: { hospitalCode: params.code } }),
    // 이벤트 0건인 임포트 배치만 정리 (이벤트가 남은 배치는 위 선검사에서 409) — 원장 기기·이력·병동은 RESTRICT, 여기서 지우지 않음
    prisma.hospitalDeviceImportBatch.deleteMany({ where: { hospitalCode: params.code, events: { none: {} } } }),
    prisma.hospitalMeta.deleteMany({ where: { hospitalCode: params.code } }),
    prisma.hospital.delete({ where: { hospitalCode: params.code } }),
  ])

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'hospital',
    resourceId: params.code,
    resourceLabel: existing.hospitalName,
    before: existing,
  })

  return NextResponse.json({ success: true })
}
