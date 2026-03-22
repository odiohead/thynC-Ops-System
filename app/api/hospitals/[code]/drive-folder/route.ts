import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { google } from 'googleapis';

function getDriveClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 설정되지 않았습니다.');
  }
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

interface RouteContext {
  params: { code: string };
}

// POST: Drive 폴더 신규 생성 후 HospitalMeta에 저장
export async function POST(request: NextRequest, { params }: RouteContext) {
  const cookieStore = cookies();
  const token = cookieStore.get('auth-token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const hospital = await prisma.hospital.findUnique({
    where: { hospitalCode: params.code },
  });
  if (!hospital) {
    return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 });
  }

  const hospitalFolderId = process.env.GOOGLE_HOSPITAL_FOLDER_ID;
  if (!hospitalFolderId) {
    return NextResponse.json({ error: 'GOOGLE_HOSPITAL_FOLDER_ID 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }

  const folderName = `${hospital.hospitalCode}_${hospital.hospitalName || hospital.hiraHospitalName}`;

  try {
    const drive = getDriveClient();
    const response = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [hospitalFolderId],
      },
      fields: 'id, name',
    });

    const folderId = response.data.id!;

    await prisma.hospitalMeta.upsert({
      where: { hospitalCode: params.code },
      update: { driveProjectFolderId: folderId },
      create: { hospitalCode: params.code, driveProjectFolderId: folderId },
    });

    return NextResponse.json({
      folderId,
      folderName: response.data.name ?? folderName,
      driveUrl: `https://drive.google.com/drive/folders/${folderId}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT: folderId만 업데이트 (Drive API 호출 없음)
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const cookieStore = cookies();
  const token = cookieStore.get('auth-token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const hospital = await prisma.hospital.findUnique({
    where: { hospitalCode: params.code },
  });
  if (!hospital) {
    return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 });
  }

  const body = await request.json();
  const { folderId } = body as { folderId: string };

  if (!folderId) {
    return NextResponse.json({ error: 'folderId는 필수입니다.' }, { status: 400 });
  }

  await prisma.hospitalMeta.upsert({
    where: { hospitalCode: params.code },
    update: { driveProjectFolderId: folderId },
    create: { hospitalCode: params.code, driveProjectFolderId: folderId },
  });

  return NextResponse.json({ folderId });
}
