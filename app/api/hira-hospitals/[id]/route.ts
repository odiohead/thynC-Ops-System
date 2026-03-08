import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const hiraHospital = await prisma.hiraHospital.findUnique({ where: { id } })
  if (!hiraHospital) return NextResponse.json({ error: '심평원 병원을 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ hiraHospital })
}
