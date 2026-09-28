/** 채널톡 상담 원본 상세 — 상담 + 고객 + 메시지 타임라인(asc) + 매니저 이름 맵. 로그인 사용자 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const chat = await prisma.channeltalkUserChat.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, name: true, mobileNumber: true, landlineNumber: true, email: true, opsCode: true, hospitalNameRaw: true, ward: true, address: true, tags: true } },
      hospital: { select: { hospitalCode: true, hospitalName: true } },
      messages: { orderBy: { createdAtCt: 'asc' }, select: { id: true, personType: true, personId: true, plainText: true, hasFiles: true, fileMeta: true, createdAtCt: true } },
    },
  })
  if (!chat) return NextResponse.json({ error: '상담을 찾을 수 없습니다' }, { status: 404 })
  const managers = await prisma.channeltalkManager.findMany({ select: { id: true, name: true } })
  const { raw: _raw, ...rest } = chat
  void _raw
  return NextResponse.json({ chat: rest, managerNames: Object.fromEntries(managers.map((m) => [m.id, m.name ?? m.id])) })
}
