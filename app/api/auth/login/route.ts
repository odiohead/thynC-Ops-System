import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 })
  }

  if (!user.isActive) {
    return NextResponse.json({ error: '비활성화된 계정입니다.' }, { status: 403 })
  }

  const token = await signToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
  })

  const res = NextResponse.json({ ok: true })
  res.cookies.set('auth-token', token, {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    sameSite: 'lax',
  })
  return res
}
