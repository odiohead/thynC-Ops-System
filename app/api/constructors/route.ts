import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// CON-000001 형식 코드 생성
async function generateConstructorCode(): Promise<string> {
  const last = await prisma.contractor.findFirst({
    orderBy: { id: 'desc' },
    select: { code: true },
  })
  let nextSeq = 1
  if (last) {
    const match = last.code.match(/^CON-(\d{6})$/)
    if (match) nextSeq = parseInt(match[1]) + 1
  }
  return `CON-${String(nextSeq).padStart(6, '0')}`
}

// GET: 전체 목록 (페이지네이션 없음)
export async function GET() {
  const constructors = await prisma.contractor.findMany({
    orderBy: { id: 'asc' },
  })
  return NextResponse.json({ constructors })
}

// POST: 등록 (ADMIN 전용)
export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }

  const { name, bizRegNumber, managerName, managerPhone, managerEmail } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: '업체명은 필수입니다.' }, { status: 400 })
  }

  const code = await generateConstructorCode()
  const constructor = await prisma.contractor.create({
    data: {
      code,
      name: name.trim(),
      bizRegNumber: bizRegNumber?.trim() || null,
      managerName: managerName?.trim() || null,
      managerPhone: managerPhone?.trim() || null,
      managerEmail: managerEmail?.trim() || null,
    },
  })

  return NextResponse.json({ constructor }, { status: 201 })
}
