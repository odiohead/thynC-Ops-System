import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { reportDocOf } from '@/lib/report/runner'
import { buildReportDocx } from '@/lib/report/docx'

export const dynamic = 'force-dynamic'

/** Word 다운로드 — 화면에 보인 그 스냅샷(report_runs)으로 생성 (§3-4) */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const run = await prisma.reportRun.findUnique({ where: { id: params.id } }).catch(() => null)
  if (!run) return NextResponse.json({ error: '보고서를 찾을 수 없습니다.' }, { status: 404 })
  if (run.status === 'COLLECTING' || run.status === 'ANALYZING') return NextResponse.json({ error: '보고서 생성이 끝난 뒤 다운로드할 수 있습니다.' }, { status: 409 })
  const doc = await reportDocOf(run)
  if (!doc) return NextResponse.json({ error: '수집 데이터가 없습니다.' }, { status: 409 })
  const buf = await buildReportDocx(doc)
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: run.hospitalCode }, select: { hospitalName: true } })
  const ymd = new Date(run.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '')
  const name = `${hospital?.hospitalName ?? run.hospitalCode}_운영레포트_${ymd}.docx`
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="report.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
