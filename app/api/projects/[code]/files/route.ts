import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createDriveFolder, uploadBufferToDrive } from '@/lib/googleDrive'

type Params = { params: { code: string } }

const VALID_CATEGORIES = [
  'INSTALL_PLAN',
  'CONTRACTOR_CONFIRM',
  'INSTALL_CONFIRM',
  'INSPECTION_CHECKLIST',
]

export async function GET(_req: NextRequest, { params }: Params) {
  const project = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  const files = await prisma.projectFile.findMany({
    where: { projectId: project.id },
    orderBy: { uploadedAt: 'asc' },
  })

  return NextResponse.json({ files })
}

export async function POST(request: NextRequest, { params }: Params) {
  const project = await prisma.project.findUnique({
    where: { projectCode: params.code },
    include: { hospital: { include: { meta: true } } },
  })
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  // 병원 Drive 폴더 여부 확인
  const hospitalDriveFolderId = project.hospital.meta?.driveProjectFolderId
  if (!hospitalDriveFolderId) {
    return NextResponse.json(
      { error: '병원에 Drive 프로젝트 폴더가 설정되지 않아 파일을 업로드할 수 없습니다.' },
      { status: 400 }
    )
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const fileCategory = formData.get('fileCategory') as string | null

  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (!fileCategory || !VALID_CATEGORIES.includes(fileCategory)) {
    return NextResponse.json(
      { error: `fileCategory는 ${VALID_CATEGORIES.join(' | ')} 중 하나여야 합니다.` },
      { status: 400 }
    )
  }

  // 프로젝트 Drive 서브폴더가 없으면 자동 생성
  let folderId = project.driveFolderId
  if (!folderId) {
    const hospitalName = project.hospital.hospitalName || project.hospital.hiraHospitalName
    const folderName = `${project.projectCode}_${hospitalName}`
    folderId = await createDriveFolder(folderName, hospitalDriveFolderId)
    await prisma.project.update({ where: { id: project.id }, data: { driveFolderId: folderId } })
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const driveFile = await uploadBufferToDrive({
    fileName: file.name,
    buffer,
    mimeType: file.type || 'application/octet-stream',
    folderId,
  })

  const projectFile = await prisma.projectFile.create({
    data: {
      projectId: project.id,
      fileCategory,
      fileName: file.name,
      driveFileId: driveFile.id,
      driveUrl: driveFile.webViewLink,
    },
  })

  return NextResponse.json({ file: projectFile }, { status: 201 })
}
