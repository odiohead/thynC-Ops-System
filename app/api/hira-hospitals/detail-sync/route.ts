import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DETAIL_CL_CODES, DETAIL_ITEMS, startDetailSyncJob, type DetailItem } from '@/lib/hira-detail-sync'

export const dynamic = 'force-dynamic'

// 심평원 의료기관별상세정보서비스 — 허가병상수·진료과목·전문의수 (v2, projects/hira_detail_sync_v2_design.md)
// 병원당 항목 수만큼 호출. 일일 한도 안에서 수일에 걸쳐 자동 분할 실행 — 로직은 lib/hira-detail-sync.ts 단일 소스

// POST — 상세정보 연동 시작 (body: { typeCodes: string[], items: ('bed'|'dept'|'sdr')[] })
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const apiKey = process.env.HIRA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'HIRA_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 })
  }

  let typeCodes: string[] = []
  let items: string[] = []
  try {
    const body = await request.json()
    if (Array.isArray(body?.typeCodes)) typeCodes = body.typeCodes.map(String)
    if (Array.isArray(body?.items)) items = body.items.map(String)
  } catch {
    // body 없음 — 아래 검증에서 400
  }

  const validCodes = new Set(DETAIL_CL_CODES.map((c) => c.code))
  typeCodes = typeCodes.filter((c) => validCodes.has(c))
  if (typeCodes.length === 0) {
    return NextResponse.json({ error: '연동할 종별을 1개 이상 선택하세요.' }, { status: 400 })
  }
  const validItems = new Set<string>(DETAIL_ITEMS.map((d) => d.key))
  const selectedItems = DETAIL_ITEMS.map((d) => d.key).filter((k) => items.includes(k) && validItems.has(k)) as DetailItem[]
  if (selectedItems.length === 0) {
    return NextResponse.json({ error: '연동할 항목을 1개 이상 선택하세요.' }, { status: 400 })
  }

  // 목록/상세 연동 공통 배타 — 실행 중 잡이 있으면 거부. 상세 연동은 대기(다음날) 중인 요청도 한 번에 하나
  const running = await prisma.hiraSyncJob.findFirst({ where: { status: 'running' } })
  if (running) {
    return NextResponse.json({ error: '이미 연동이 진행 중입니다.' }, { status: 409 })
  }
  const waiting = await prisma.hiraSyncJob.findFirst({ where: { status: 'waiting', jobType: 'detail' } })
  if (waiting) {
    return NextResponse.json({ error: `분할 실행 대기 중인 상세연동 요청(#${waiting.id})이 있습니다. 완료되거나 취소한 뒤 다시 시작하세요.` }, { status: 409 })
  }

  const jobId = await startDetailSyncJob({ typeCodes, items: selectedItems }, apiKey)
  return NextResponse.json({ jobId })
}
