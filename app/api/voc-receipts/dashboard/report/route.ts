/**
 * VOC·AS 주간 대시보드 — 주간 보고 PDF 첨부 (2026-10-31)
 * GET    ?week=  해당 주 첨부(이미지·PDF presigned URL, 1시간) — 로그인 사용자
 * POST   multipart { week, file } 1페이지 PDF 업로드·교체 — USER 이상
 * DELETE ?week=  첨부 삭제 — USER 이상
 * week = 금요일 날짜(YYYY-MM-DD) 또는 YYYY-Www (대시보드 API와 동일)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { auditActorFromJWT, logAudit } from '@/lib/audit'
import { parseWeekStart } from '@/lib/vocDashboard'
import { getVocDashboardReport, saveVocDashboardReport, deleteVocDashboardReport, VOC_DASHBOARD_REPORT_MAX_BYTES } from '@/lib/vocDashboardReport'

export const dynamic = 'force-dynamic'

const WEEK_ERR = 'week는 금요일 날짜(YYYY-MM-DD) 또는 YYYY-Www 형식이어야 합니다.'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const weekStart = parseWeekStart(request.nextUrl.searchParams.get('week'))
  if (!weekStart) return NextResponse.json({ error: WEEK_ERR }, { status: 400 })
  try {
    return NextResponse.json({ report: await getVocDashboardReport(weekStart) })
  } catch (e) {
    console.error('[voc-dashboard-report GET]', e)
    return NextResponse.json({ error: '첨부 조회 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isUserOrAbove(user.role)) return NextResponse.json({ error: '업로드 권한이 없습니다.' }, { status: 403 })
  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  const weekStart = parseWeekStart(String(form.get('week') ?? ''))
  if (!weekStart) return NextResponse.json({ error: WEEK_ERR }, { status: 400 })
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'PDF 파일을 선택하세요.' }, { status: 400 })
  if (file.size > VOC_DASHBOARD_REPORT_MAX_BYTES) return NextResponse.json({ error: '파일 크기는 20MB 이하여야 합니다.' }, { status: 400 })
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (!isPdf) return NextResponse.json({ error: 'PDF 파일만 업로드할 수 있습니다.' }, { status: 400 })
  try {
    const report = await saveVocDashboardReport({ weekStart, fileName: file.name, pdf: Buffer.from(await file.arrayBuffer()), userId: user.userId })
    await logAudit({ actor: auditActorFromJWT(user), action: 'CREATE', resource: 'voc_dashboard_report', resourceId: report.id, resourceLabel: `${report.weekStart} ${report.fileName}` })
    return NextResponse.json({ report })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 사용자 입력 오류(페이지 수·형식·크기)는 400, 그 외 500
    if (/PDF|페이지|크기/.test(msg)) return NextResponse.json({ error: msg }, { status: 400 })
    console.error('[voc-dashboard-report POST]', e)
    return NextResponse.json({ error: '업로드 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isUserOrAbove(user.role)) return NextResponse.json({ error: '삭제 권한이 없습니다.' }, { status: 403 })
  const weekStart = parseWeekStart(request.nextUrl.searchParams.get('week'))
  if (!weekStart) return NextResponse.json({ error: WEEK_ERR }, { status: 400 })
  try {
    const removed = await deleteVocDashboardReport(weekStart)
    if (!removed) return NextResponse.json({ error: '첨부가 없습니다.' }, { status: 404 })
    await logAudit({ actor: auditActorFromJWT(user), action: 'DELETE', resource: 'voc_dashboard_report', resourceId: removed.id, resourceLabel: `${weekStart.toISOString().slice(0, 10)} ${removed.fileName}` })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[voc-dashboard-report DELETE]', e)
    return NextResponse.json({ error: '삭제 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
