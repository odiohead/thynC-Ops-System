import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import SalesConceptTabs from '../_components/SalesConceptTabs'
import SalesDashboardMap, {
  type MapDashboardData,
  type DealHospitalRow,
  type RegionTypeTotalRow,
} from './_components/SalesDashboardMap'

export const dynamic = 'force-dynamic'

/**
 * 영업 대시보드(지도) — 지역별 도입현황
 * 계약완료 딜 기준. 한반도 지도 위 7개 권역 막대(병원수·병상수) + 지역별 수치 표 + 드릴다운.
 * 병상수 = 대웅 디바이스 수량 합(KPI '도입 병상'과 동일 기준) · 도입률 = 지역 허가병상(심평원) 대비 병상 침투율.
 * 종별 필터·막대 모드(도입 수치/전체 대비)는 클라이언트 즉시 재계산 — 서버는 병원 단위 flat 데이터와
 * 권역×종별 전체 집계(전체 병원수·허가병상)를 내려준다.
 * 권한: (ADMIN 이상 또는 sales.access 권한) + SEERS (영업 섹션 공통 게이트)
 */

/** 시도명 → 7개 권역 매핑 (2026-08-14 사용자 확정) */
const SIDO_TO_REGION: Record<string, string> = {
  서울: 'capital', 경기: 'capital', 인천: 'capital',
  강원: 'gangwon',
  대전: 'chungcheong', 세종시: 'chungcheong', 세종: 'chungcheong', 충남: 'chungcheong', 충북: 'chungcheong',
  대구: 'daegu', 경북: 'daegu',
  부산: 'busan', 울산: 'busan', 경남: 'busan',
  광주: 'honam', 전남: 'honam', 전북: 'honam',
  제주: 'jeju',
}

/** 종별 위계 순 (대시보드 A와 동일) */
const TYPE_ORDER = ['상급종합', '종합병원', '병원', '요양병원', '정신병원', '치과병원', '한방병원', '의원', '치과의원', '한의원']

export default async function SalesDashboardMapPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  const allowed = await canAccessSales(user)
  if (!allowed) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          영업 현황은 ADMIN 이상 또는 영업 접근 권한 보유자 + 씨어스(SEERS) 소속만 열람할 수 있습니다.
        </div>
      </div>
    )
  }

  const completed = await prisma.salesDeal.findMany({
    where: { status: { name: '계약완료' } },
    select: {
      hospitalCode: true,
      daewoongDeviceCount: true,
      contractDate: true,
      hospital: { select: { hospitalName: true, type: true, sidoName: true } },
    },
  })

  // 권역×종별 전체 집계 — 전체 병원수 + 허가병상(심평원 병원상세정보연동 결과, 미연동 NULL 제외)
  const totalRows = await prisma.$queryRaw<Array<{ sido: string | null; type: string; hosp: bigint; beds: bigint }>>`
    SELECT h.sido_name AS sido, h.type AS type, COUNT(*) AS hosp, COALESCE(SUM(hh.perm_sbd_cnt), 0) AS beds
    FROM hospitals h
    LEFT JOIN hira_hospitals hh ON hh.hira_id = h.hira_id
    GROUP BY h.sido_name, h.type`

  // 병원 단위 집계 (딜 다건 → 1행, 종별 필터·드릴다운의 클라이언트 단일 소스)
  const hospAgg = new Map<string, DealHospitalRow>()
  for (const d of completed) {
    const dev = d.daewoongDeviceCount ?? 0
    const contract = d.contractDate ? d.contractDate.toISOString().slice(0, 10) : null
    const h = hospAgg.get(d.hospitalCode)
    if (h) {
      h.deals += 1
      h.devices += dev
      if (contract && (!h.lastContract || contract > h.lastContract)) h.lastContract = contract
    } else {
      hospAgg.set(d.hospitalCode, {
        region: (d.hospital.sidoName && SIDO_TO_REGION[d.hospital.sidoName]) || 'etc',
        code: d.hospitalCode,
        name: d.hospital.hospitalName,
        type: d.hospital.type,
        sido: d.hospital.sidoName,
        deals: 1,
        devices: dev,
        lastContract: contract,
      })
    }
  }
  const hospitals = Array.from(hospAgg.values()).sort((a, b) => b.devices - a.devices)

  // 종별 칩 — 딜 보유 병원에 존재하는 종별만, 위계 순 (미정의 종별은 뒤에)
  const dealTypes = new Set(hospitals.map((h) => h.type))
  const types = [
    ...TYPE_ORDER.filter((t) => dealTypes.has(t)),
    ...Array.from(dealTypes).filter((t) => !TYPE_ORDER.includes(t)).sort(),
  ]

  // 시도 → 권역 합산. 분모 세계는 칩과 동일한 **딜 보유 종별로 제한** — '전체'(무선택)가
  // 치과의원·보건소 등 비영업 종별 7.9만곳으로 부풀거나 '모든 칩 선택'과 분모가 달라지는 것 방지.
  // 권역 미매핑 시도는 분모에서 제외 (지도·도입률 대상 아님)
  const totalAgg = new Map<string, RegionTypeTotalRow>()
  for (const r of totalRows) {
    if (!dealTypes.has(r.type)) continue
    const region = r.sido ? SIDO_TO_REGION[r.sido] : undefined
    if (!region) continue
    const key = `${region}|${r.type}`
    const cur = totalAgg.get(key)
    if (cur) {
      cur.hospitals += Number(r.hosp)
      cur.permBeds += Number(r.beds)
    } else {
      totalAgg.set(key, { region, type: r.type, hospitals: Number(r.hosp), permBeds: Number(r.beds) })
    }
  }

  const data: MapDashboardData = {
    hospitals,
    totals: Array.from(totalAgg.values()),
    types,
  }

  return (
    <div>
      <SalesConceptTabs />
      <SalesDashboardMap data={data} />
    </div>
  )
}
