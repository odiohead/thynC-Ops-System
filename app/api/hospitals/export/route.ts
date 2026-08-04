import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '')

/**
 * 병원 목록 Excel export — 목록 화면과 동일한 필터(search/sido/status/type)를 그대로 받아
 * 페이지네이션 없이 조건에 맞는 전체를 내보낸다. 목록 페이지와 같은 정렬(등록 최신순).
 *
 * `countOnly=1`이면 파일을 만들지 않고 대상 건수만 JSON으로 반환한다
 * (다운로드 전 선택 UI에서 규모를 미리 보여주기 위함 — 병원 테이블에 HIRA 전수가 있어 무필터는 8만건대).
 *
 * 병원종(type)·상태(status)는 **최소 1개 이상 필수** — 무필터 전량 내보내기를 서버에서 차단한다.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim() ?? ''
  const sido = searchParams.get('sido') ?? ''
  const statusFilter = searchParams.getAll('status').filter(Boolean)
  const typeFilter = searchParams.getAll('type').filter(Boolean)
  const countOnly = searchParams.get('countOnly') === '1'

  if (statusFilter.length === 0 && typeFilter.length === 0) {
    return NextResponse.json({ error: '병원종 또는 상태를 1개 이상 선택해야 합니다.' }, { status: 400 })
  }

  // 목록 페이지(app/hospitals/page.tsx)의 where와 동일 조건
  const where = {
    ...(search && {
      OR: [
        { hospitalName: { contains: search, mode: 'insensitive' as const } },
        { hiraHospitalName: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
    ...(sido && { sidoName: sido }),
    ...(statusFilter.length > 0 && { status: { in: statusFilter } }),
    ...(typeFilter.length > 0 && { type: { in: typeFilter } }),
  }

  if (countOnly) {
    return NextResponse.json({ count: await prisma.hospital.count({ where }) })
  }

  const hospitals = await prisma.hospital.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      hospitalCode: true,
      hospitalName: true,
      hiraHospitalName: true,
      type: true,
      status: true,
      sidoName: true,
      sigunguName: true,
      address: true,
      introBeds: true,
      contractDate: true,
      createdAt: true,
      introTypes: { select: { statusCode: { select: { name: true } } } },
    },
  })

  const rows = hospitals.map((h) => ({
    병원코드: h.hospitalCode,
    병원명: h.hospitalName,
    'HIRA 병원명': h.hiraHospitalName,
    종별: h.type,
    상태: h.status,
    시도: h.sidoName ?? '',
    시군구: h.sigunguName ?? '',
    주소: h.address ?? '',
    도입형태: h.introTypes.map((t) => t.statusCode.name).join(', '),
    '도입 병상수': h.introBeds ?? '',
    계약일: ymd(h.contractDate),
    등록일: ymd(h.createdAt),
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 }, { wch: 26 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
    { wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 11 }, { wch: 12 }, { wch: 12 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '병원목록')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '')
  const filename = encodeURIComponent(`병원목록_${stamp}.xlsx`)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  })
}
