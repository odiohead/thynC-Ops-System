import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: { code: string };
}

// GET: DeviceInfo 전체 기준으로 병원별 기기 수량 조회
export async function GET(request: NextRequest, { params }: RouteContext) {
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

  const [allDevices, hospitalDevices] = await Promise.all([
    prisma.deviceInfo.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.hospitalDevice.findMany({ where: { hospitalCode: params.code } }),
  ]);

  const quantityMap = new Map(hospitalDevices.map((d) => [d.deviceInfoId, d.quantity]));

  const result = allDevices.map((d) => ({
    deviceInfoId: d.id,
    deviceModel: d.deviceModel,
    deviceName: d.deviceName,
    quantity: quantityMap.get(d.id) ?? 0,
  }));

  return NextResponse.json(result);
}

// PUT: 기기 수량 일괄 upsert (quantity=0이면 레코드 삭제)
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

  const body = await request.json() as { deviceInfoId: number; quantity: number }[];

  if (!Array.isArray(body)) {
    return NextResponse.json({ error: '배열 형태의 body가 필요합니다.' }, { status: 400 });
  }

  await prisma.$transaction(
    body.map((item) => {
      if (item.quantity === 0) {
        return prisma.hospitalDevice.deleteMany({
          where: { hospitalCode: params.code, deviceInfoId: item.deviceInfoId },
        });
      }
      return prisma.hospitalDevice.upsert({
        where: {
          hospitalCode_deviceInfoId: {
            hospitalCode: params.code,
            deviceInfoId: item.deviceInfoId,
          },
        },
        update: { quantity: item.quantity },
        create: {
          hospitalCode: params.code,
          deviceInfoId: item.deviceInfoId,
          quantity: item.quantity,
        },
      });
    })
  );

  return NextResponse.json({ success: true });
}
