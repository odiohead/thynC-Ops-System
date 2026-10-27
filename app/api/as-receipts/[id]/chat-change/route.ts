/**
 * 채널톡 변경 감지 처리 (as_channeltalk_intake_design.md §6) — 접수 생성 후 상담이 바뀐 diff를 사람이 [반영]/[무시]
 * POST { action: 'dismiss' } | { action: 'apply', fields: string[] }  (fields = change_diff[].field)
 * 반영: serials → 라인 전체 교체(applyItemChanges, 기존 라인 증상·병동 유지) / symptom:S·ward:S → 라인 / category·destInfo·pickupDestInfo·pickupDestDiffers·preReplace → 접수
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { applyItemChanges, AsServiceError, type LineInput } from '@/lib/asReceiptService'
import { syncAsReceiptToTicket } from '@/lib/ticket-domains/asReceipt'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import type { AsExtract, AsIntakeDiffItem } from '@/lib/channeltalk/asIntakeShared'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const body = await request.json().catch(() => ({}))
  const link = await prisma.asIntakeLink.findFirst({ where: { receiptId: id, state: 'LINKED' }, select: { id: true, chatId: true, changeDiff: true, extracted: true } })
  if (!link || !link.changeDiff) return NextResponse.json({ error: '감지된 변경이 없습니다.' }, { status: 404 })
  const diff = link.changeDiff as unknown as AsIntakeDiffItem[]
  const e = link.extracted as unknown as AsExtract

  if (body.action === 'dismiss') {
    await prisma.asIntakeLink.update({ where: { id: link.id }, data: { changeDetectedAt: null, changeDiff: Prisma.DbNull } })
    return NextResponse.json({ ok: true })
  }
  if (body.action !== 'apply' || !Array.isArray(body.fields) || !body.fields.length) return NextResponse.json({ error: '반영할 항목을 선택하세요.' }, { status: 400 })
  const fields = new Set((body.fields as unknown[]).map(String).filter((f) => diff.some((d) => d.field === f)))
  if (!fields.size) return NextResponse.json({ error: '반영할 항목이 없습니다.' }, { status: 400 })

  const rec = await prisma.asReceipt.findUnique({ where: { id }, select: { id: true, asCode: true, hospitalCode: true, receiptDate: true, items: { select: { serialNo: true, wardName: true, symptom: true, deviceKind: true, processNote: true } } } })
  if (!rec) return NextResponse.json({ error: 'AS접수를 찾을 수 없습니다.' }, { status: 404 })
  const warnings: string[] = []
  try {
    await prisma.$transaction(async (tx) => {
      const data: Prisma.AsReceiptUpdateInput = {}
      if (fields.has('category')) data.category = e.category
      if (fields.has('destInfo')) data.destInfo = e.destInfo
      if (fields.has('pickupDestInfo')) data.pickupDestInfo = e.pickupDestInfo
      if (fields.has('pickupDestDiffers')) data.pickupDestDiffers = e.pickupDestDiffers
      if (fields.has('preReplace')) data.preReplace = e.preReplace
      if (Object.keys(data).length) await tx.asReceipt.update({ where: { id }, data })
      if (fields.has('serials')) {
        // 기존 라인은 그대로(증상·병동 유지), 상담에만 있는 시리얼은 추가, 상담에서 빠진 시리얼은 제거(종결 라인은 applyItemChanges가 400)
        const chatSerials = new Set(e.lines.map((l) => l.serial))
        const lines: LineInput[] = [
          ...rec.items.filter((i) => chatSerials.has(i.serialNo)).map((i) => ({ serial: i.serialNo, symptom: i.symptom, wardName: i.wardName, deviceKind: i.deviceKind, processNote: i.processNote })),
          ...e.lines.filter((l) => !rec.items.some((i) => i.serialNo === l.serial)).map((l) => ({ serial: l.serial, symptom: l.symptom, wardName: l.ward })),
        ]
        warnings.push(...(await applyItemChanges(tx, rec, lines, { userId: user.userId, name: user.name })))
      }
      for (const f of Array.from(fields)) {
        const m = /^(symptom|ward):(.+)$/.exec(f)
        if (!m) continue
        const l = e.lines.find((x) => x.serial === m[2])
        if (!l) continue
        await tx.asReceiptItem.updateMany({ where: { receiptId: id, serialNo: m[2] }, data: m[1] === 'symptom' ? { symptom: l.symptom } : { wardName: l.ward } })
      }
      const remaining = diff.filter((d) => !fields.has(d.field))
      await tx.asIntakeLink.update({ where: { id: link.id }, data: { changeDetectedAt: remaining.length ? undefined : null, changeDiff: remaining.length ? (remaining as unknown as Prisma.InputJsonValue) : Prisma.DbNull } })
      if (fields.has('category')) await syncAsReceiptToTicket(tx, id, user.userId)
    }, { timeout: 60000, maxWait: 10000 })
  } catch (err) {
    if (err instanceof AsServiceError) return NextResponse.json({ error: err.message }, { status: err.status })
    const r = toRegistryErrorResponse(err)
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw err
  }
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt', resourceId: rec.asCode, resourceLabel: `${rec.asCode} 채널톡 변경 반영 (${Array.from(fields).join(', ')})` })
  return NextResponse.json({ ok: true, warnings })
}
