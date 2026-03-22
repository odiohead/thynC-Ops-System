import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createDriveFolder } from '@/lib/googleDrive'

type Params = { params: { code: string } }

// POST: 기존 프로젝트에 Drive 폴더를 생성하고 연결
export async function POST(_req: NextRequest, { params }: Params) {
  const project = await prisma.project.findUnique({
    where: { projectCode: params.code },
    include: { hospital: true },
  })
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  if (project.driveFolderId) {
    return NextResponse.json({ error: '이미 Drive 폴더가 연결되어 있습니다.' }, { status: 409 })
  }

  const hospitalMeta = await prisma.hospitalMeta.findUnique({ where: { hospitalCode: project.hospitalCode } })
  if (!hospitalMeta?.driveProjectFolderId) {
    return NextResponse.json(
      { error: '병원에 Drive 프로젝트 폴더가 설정되어 있지 않습니다. 병원 상세 페이지에서 먼저 Drive 폴더를 등록해 주세요.' },
      { status: 400 }
    )
  }

  const hospitalName = project.hospital.hospitalName || project.hospital.hiraHospitalName
  const folderName = `${project.projectCode}_${hospitalName}`

  const driveFolderId = await createDriveFolder(folderName, hospitalMeta.driveProjectFolderId)

  const updated = await prisma.project.update({
    where: { projectCode: params.code },
    data: { driveFolderId },
  })

  return NextResponse.json({ driveFolderId: updated.driveFolderId })
}
