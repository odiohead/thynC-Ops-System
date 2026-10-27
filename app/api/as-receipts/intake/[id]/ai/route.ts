/**
 * 등록대기 [Claude 도움요청] — 상담 원문을 Claude로 구조화 추출해 빈 필드만 채운다 (L2, as_channeltalk_intake_design.md §4.5). 자동 등록 없음
 * body { current?: AsExtract } — 화면에서 사람이 이미 고친 값(있으면 그 빈 필드만 채움). 응답: 병합된 extracted + ai 원본
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { aiExtractAsFromMessages } from '@/lib/ai/asExtract'
import { loadHospitalMatcher } from '@/lib/hospitalNameMatcher'
import type { AsExtract } from '@/lib/channeltalk/asIntakeShared'

export const maxDuration = 120

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const link = await prisma.asIntakeLink.findUnique({ where: { id }, select: { chatId: true, state: true, extracted: true, chat: { select: { messages: { orderBy: { createdAtCt: 'asc' }, select: { personType: true, plainText: true, createdAtCt: true } } } } } })
  if (!link) return NextResponse.json({ error: '등록대기 항목을 찾을 수 없습니다.' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const base = (body.current ?? link.extracted ?? {}) as Partial<AsExtract>
  let ai
  try { ai = await aiExtractAsFromMessages(link.chat.messages) } catch (e) { return NextResponse.json({ error: `AI 추출 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 }) }

  // 빈 필드만 채움 — 사람 입력·L1 값 보존
  const merged: Partial<AsExtract> = { ...base }
  if (!merged.hospitalNameRaw && ai.hospitalName) merged.hospitalNameRaw = ai.hospitalName
  if (!merged.hospitalCode && ai.hospitalName) { const m = await loadHospitalMatcher(); const code = m.match(ai.hospitalName); if (code) { merged.hospitalCode = code; merged.hospitalMatchSource = 'name' } }
  if ((!merged.wards || !merged.wards.length) && ai.wards.length) merged.wards = ai.wards
  if (!merged.category && ai.category) merged.category = ai.category
  const lines = [...(merged.lines ?? [])]
  for (const l of ai.lines) {
    const cur = lines.find((x) => x.serial === l.serial)
    if (!cur) lines.push({ serial: l.serial, ward: l.ward, symptom: l.symptom })
    else { if (!cur.ward && l.ward) cur.ward = l.ward; if (!cur.symptom && l.symptom) cur.symptom = l.symptom }
  }
  merged.lines = lines
  if (!merged.destInfo && ai.destInfo) merged.destInfo = ai.destInfo
  if (!merged.pickupDestInfo && (ai.pickupDestInfo ?? ai.destInfo)) merged.pickupDestInfo = ai.pickupDestInfo ?? ai.destInfo
  if (ai.pickupDestDiffers) merged.pickupDestDiffers = true
  if (ai.preReplace) merged.preReplace = true
  if (!merged.reporterName && ai.reporterName) merged.reporterName = ai.reporterName

  await prisma.asIntakeLink.update({ where: { id }, data: { extracted: merged as unknown as Prisma.InputJsonValue, extractLayer: 'L2', aiRequestedAt: new Date(), aiRequestedById: user.userId } })
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_intake_link', resourceId: String(id), resourceLabel: `Claude 도움요청 — 채널톡 상담 ${link.chatId}` })
  return NextResponse.json({ extracted: merged, ai })
}
