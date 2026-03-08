import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { createFormattedSheet, listFilesByNamePrefix } from '@/lib/googleDrive'

const STATUS_LABEL: Record<string, string> = {
  active: '운영중',
  inactive: '운영중단',
  pending: '대기중',
}

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') return null
  return payload
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req)
    if (!admin) return NextResponse.json({ error: '관리자만 사용할 수 있습니다.' }, { status: 403 })

    // 전체 병원 목록 조회
    const hospitals = await prisma.hospital.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        hospitalCode: true,
        hiraHospitalName: true,
        hospitalName: true,
        address: true,
        status: true,
      },
    })

    // 파일명 결정: 병원목록_yyyymmdd [_N]
    const today = formatDate(new Date())
    const baseName = `병원목록_${today}`
    const existing = await listFilesByNamePrefix(baseName)
    const sameDay = existing.filter((f) => f.name === baseName || f.name.startsWith(`${baseName}_`))
    const fileName = sameDay.length === 0 ? baseName : `${baseName}_${sameDay.length + 1}`

    // 헤더 + 데이터 행 구성
    const headers = ['병원코드', '심평원 병원명', '병원명', '주소', '상태']
    const rows = hospitals.map((h) => [
      h.hospitalCode,
      h.hiraHospitalName,
      h.hospitalName,
      h.address ?? '-',
      STATUS_LABEL[h.status] ?? h.status,
    ])

    const file = await createFormattedSheet({ fileName, headers, rows })

    return NextResponse.json({
      id: file.id,
      name: file.name,
      webViewLink: file.webViewLink,
      count: hospitals.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
    console.error('[drive/export/hospitals]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
