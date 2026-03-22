import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

export interface HospitalImportRow {
  hospitalName: string
  introType: string | null
  introBeds: number | null
}

function parseExcel(buffer: ArrayBuffer): HospitalImportRow[] {
  const workbook = XLSX.read(buffer)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]

  // 헤더 없이 2차원 배열로 읽기 (1행=헤더 skip, 2행부터 데이터)
  // A=0: 병원명, B=1: 도입형태, C=2: 도입병상수
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][]

  // 병원명 기준으로 그룹화
  const grouped = new Map<string, { introTypes: Set<string>; introBeds: number }>()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const name = String(row[0] ?? '').trim()
    if (!name) continue

    const introType = String(row[1] ?? '').trim()
    const introBedsRaw = row[2] ?? 0
    const introBeds = Number(introBedsRaw) || 0

    if (!grouped.has(name)) {
      grouped.set(name, { introTypes: new Set(), introBeds: 0 })
    }

    const entry = grouped.get(name)!
    if (introType) entry.introTypes.add(introType)
    entry.introBeds += introBeds
  }

  return Array.from(grouped.entries()).map(([name, data]) => ({
    hospitalName: name,
    introType: data.introTypes.size > 0 ? Array.from(data.introTypes).join(',') : null,
    introBeds: data.introBeds > 0 ? data.introBeds : null,
  }))
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

export async function POST(request: NextRequest) {
  const preview = request.nextUrl.searchParams.get('preview') === 'true'

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const hospitals = parseExcel(buffer)

    if (hospitals.length === 0) {
      return NextResponse.json({ error: '파일에 유효한 데이터가 없습니다. 컬럼명을 확인하세요. (병원명, 도입형태, 도입병상 수)' }, { status: 400 })
    }

    if (preview) {
      // 미리보기: DB 변경 없이 파싱 결과 반환
      const currentCount = await prisma.hospital.count()
      const firstStatus = await prisma.statusCode.findFirst({ orderBy: { order: 'asc' } })
      return NextResponse.json({
        hospitals,
        currentCount,
        defaultStatus: firstStatus?.name ?? '미계약',
      })
    }

    // 실제 가져오기
    const firstStatus = await prisma.statusCode.findFirst({ orderBy: { order: 'asc' } })
    const defaultStatus = firstStatus?.name ?? '미계약'

    const insertData = hospitals.map((h, index) => ({
      hospitalCode: `HOSP-${String(index + 1).padStart(6, '0')}`,
      hiraId: null,
      hiraHospitalName: h.hospitalName,
      hospitalName: h.hospitalName,
      type: '',
      status: defaultStatus,
      introType: h.introType,
      introBeds: h.introBeds,
      sidoCode: null,
      sidoName: null,
      sigunguCode: null,
      sigunguName: null,
      eupmyeondong: null,
      postalCode: null,
      address: null,
      coordinateX: null,
      coordinateY: null,
    }))

    await prisma.$transaction([
      prisma.daewoongHospitalAssignment.deleteMany(),
      prisma.hospital.deleteMany(),
      prisma.hospital.createMany({ data: insertData }),
    ])

    return NextResponse.json({ imported: hospitals.length })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: '파일 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
