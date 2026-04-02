import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const TYPE_ORDER = [
  '상급종합',
  '종합병원',
  '병원',
  '요양병원',
  '정신병원',
  '한방병원',
  '치과병원',
  '의원',
  '보건소',
  '보건지소',
  '보건진료소',
  '보건의료원',
  '기타',
]

const REVIEWING_STATUSES = ['가견적요청', '답사요청']
const CONTRACTED_STATUSES = ['계약완료', '운영']

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // hospitals.type 컬럼에 hira_hospitals.type_name 동일값이 저장되어 있으므로 조인 불필요
  const hospitals = await prisma.hospital.findMany({
    select: { type: true, hiraId: true, status: true },
  })

  const map = new Map<string, { total: number; reviewing: number; contracted: number }>()

  for (const h of hospitals) {
    const key = h.hiraId ? (h.type || '기타') : '기타'

    if (!map.has(key)) {
      map.set(key, { total: 0, reviewing: 0, contracted: 0 })
    }
    const entry = map.get(key)!
    entry.total++
    if (REVIEWING_STATUSES.includes(h.status)) entry.reviewing++
    if (CONTRACTED_STATUSES.includes(h.status)) entry.contracted++
  }

  // 정렬: TYPE_ORDER 기준, 없는 종별은 생략
  const rows = TYPE_ORDER
    .filter((t) => map.has(t) && map.get(t)!.total > 0)
    .map((t) => ({ clCdNm: t, ...map.get(t)! }))

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      reviewing: acc.reviewing + r.reviewing,
      contracted: acc.contracted + r.contracted,
    }),
    { total: 0, reviewing: 0, contracted: 0 }
  )

  return NextResponse.json({ rows, totals })
}
