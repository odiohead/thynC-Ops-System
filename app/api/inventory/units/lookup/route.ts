import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { parseScan } from '@/lib/scanParse'

export const dynamic = 'force-dynamic'

/**
 * GET /api/inventory/units/lookup?code=<스캔 원문>  — 시리얼 조회 (읽기 전용, 로그인 사용자 전원)
 * projects/mobile_pwa_design.md §6.3 — 모바일 "스캔 먼저" 출고·이동과 시리얼 조회 화면용.
 *
 * 출고·이동 API는 itemId·warehouseId를 먼저 받아야 하므로, 스캔한 시리얼이 어느 품목·위치에 있는지
 * 알아내는 단계가 필요하다. 같은 물리 기기가 인벤토리 간 이관으로 여러 품목에 개체를 가질 수 있어(DEV 326건)
 * 결과는 배열이며 화면이 상태로 좁힌다. GS1 GTIN이 있으면 udi_di 일치 품목도 돌려준다(입고 품목 후보).
 * 클라이언트는 이후 전표 요청에 스캔 원문이 아니라 여기서 받은 개체의 serialNo(저장값)를 쓴다.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const code = new URL(req.url).searchParams.get('code') ?? ''
  if (code.length > 500) return NextResponse.json({ error: '스캔 값이 너무 깁니다.' }, { status: 400 })
  const parsed = parseScan(code)

  const candidates = parsed.serialCandidates.slice(0, 4)
  const units = candidates.length === 0 ? [] : await prisma.inventoryUnit.findMany({
    // 저장 시리얼은 입력 그대로라 대소문자 무시 일치 (2만 행 — 순차 스캔 허용, 설계 §6.3)
    where: { OR: candidates.map((c) => ({ serialNo: { equals: c, mode: 'insensitive' as const } })) },
    select: {
      id: true, serialNo: true, lotNo: true, status: true, updatedAt: true, tags: true,
      item: { select: { id: true, itemCode: true, name: true, modelName: true, unit: true, isSerialManaged: true, isLotManaged: true, udiDi: true, isActive: true } },
      inventory: { select: { id: true, name: true, linkHospital: true } },
      warehouse: { select: { id: true, name: true } },
      hospital: { select: { hospitalCode: true, hospitalName: true } },
    },
    orderBy: [{ status: 'asc' }, { id: 'asc' }],
    take: 20,
  })

  // 후보 우선순위 반영 — 1순위 후보로 찾은 개체를 앞으로
  const rank = (s: string) => {
    const i = candidates.findIndex((c) => c.toUpperCase() === s.toUpperCase())
    return i === -1 ? 99 : i
  }
  units.sort((a, b) => rank(a.serialNo) - rank(b.serialNo))

  const gtinItems = parsed.gtin
    ? await prisma.inventoryItem.findMany({
        where: { udiDi: parsed.gtin, isActive: true },
        select: { id: true, itemCode: true, name: true, modelName: true, isSerialManaged: true, isLotManaged: true, inventory: { select: { id: true, name: true } } },
        orderBy: [{ inventoryId: 'asc' }, { id: 'asc' }],
      })
    : []

  return NextResponse.json({ parsed, units, gtinItems })
}
