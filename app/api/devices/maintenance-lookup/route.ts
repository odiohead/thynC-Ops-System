import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { suggestOccurredOnFromMaintenance, toYmd } from '@/lib/deviceRegistryShared'
import { authOr401, badRequest, readErrorResponse } from '../_read'

export const dynamic = 'force-dynamic'

const MNT_CODE_RE = /^MNT-\d{6}-\d{4}$/i
const LIMIT = 20

const SELECT = {
  id: true,
  maintenanceCode: true,
  title: true,
  hospitalCode: true,
  reportedAt: true,
  resolvedAt: true,
  createdAt: true,
  hospital: { select: { hospitalName: true } },
  status: { select: { name: true } },
  visits: { select: { startDate: true, endDate: true }, orderBy: { startDate: 'asc' as const } },
} satisfies Prisma.MaintenanceSelect

type Row = Prisma.MaintenanceGetPayload<{ select: typeof SELECT }>

function toItem(m: Row, hospital: string | null) {
  const suggestion = suggestOccurredOnFromMaintenance({ visits: m.visits, resolvedAt: m.resolvedAt, reportedAt: m.reportedAt })
  return {
    id: m.id,
    maintenanceCode: m.maintenanceCode,
    title: m.title,
    hospitalCode: m.hospitalCode,
    hospitalName: m.hospital.hospitalName,
    statusName: m.status?.name ?? null,
    reportedAt: toYmd(m.reportedAt),
    resolvedAt: toYmd(m.resolvedAt),
    visits: m.visits.map((v) => ({ startDate: toYmd(v.startDate), endDate: toYmd(v.endDate) })),
    /** 폼의 병원과 다른 병원으로 기록된 건 — '다른 병원으로 기록된 건' 경고(§6.1 폼) */
    hospitalMismatch: !!hospital && m.hospitalCode !== hospital,
    /** §5c 규칙: max(visits.endDate ≤ 오늘) → startDate → resolvedAt → reportedAt → null (미래 제외) */
    suggestedOccurredOn: suggestion?.date ?? null,
    basis: suggestion?.basis ?? null,
  }
}

/**
 * 유지보수 코드 자동완성 (§7.1) — `?hospital=&q=`
 * - 이 병원의 유지보수를 코드·제목 부분 일치로 ≤20건(최근순). `q`가 비면 이 병원 최근 20건
 * - `q`가 `MNT-YYYYMM-NNNN` 정확 형식이면 병원 필터를 무시하고 그 1건 반환(타 병원이면 `hospitalMismatch:true`)
 * - 각 항목에 `suggestedOccurredOn`/`basis`(`suggestOccurredOnFromMaintenance`)
 * 응답 `{ data: [...], exact: boolean }`. 로그인 전체
 */
export async function GET(req: NextRequest) {
  const auth = await authOr401(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const hospital = sp.get('hospital')?.trim() || null
  const q = sp.get('q')?.trim() ?? ''

  try {
    if (MNT_CODE_RE.test(q)) {
      const m = await prisma.maintenance.findUnique({ where: { maintenanceCode: q.toUpperCase() }, select: SELECT })
      return NextResponse.json({ data: m ? [toItem(m, hospital)] : [], exact: true })
    }
    if (!hospital) return badRequest('병원을 지정하거나 유지보수 코드(MNT-YYYYMM-NNNN)를 정확히 입력하세요.')

    const rows = await prisma.maintenance.findMany({
      where: {
        hospitalCode: hospital,
        ...(q
          ? { OR: [{ maintenanceCode: { contains: q, mode: 'insensitive' as const } }, { title: { contains: q, mode: 'insensitive' as const } }] }
          : {}),
      },
      select: SELECT,
      orderBy: [{ createdAt: 'desc' }],
      take: LIMIT,
    })
    return NextResponse.json({ data: rows.map((m) => toItem(m, hospital)), exact: false })
  } catch (e) {
    return readErrorResponse(e, 'maintenance-lookup')
  }
}
