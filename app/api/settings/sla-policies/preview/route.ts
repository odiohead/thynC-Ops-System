/**
 * SLA 정책 변경 영향 미리보기 (1.1 P2 — §4.8 "저장 전 영향 미리보기")
 *
 * POST { policyId?, refTypes, queueIds, ctiIds, severities, targets[] }
 *  → { matchedOpen, wouldBreachNow, sample[] }
 *
 * 저장하지 않고 계산만 한다. "이 변경으로 열린 티켓 N건이 새로 초과가 됩니다"를 숫자로 보여주기 위한 것 —
 * 관리자가 목표 시간을 줄였을 때 무슨 일이 일어나는지 모르고 저장하는 상황을 막는다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { expandCtiSubtree, openTicketWhere, type TargetInput } from '@/lib/slaSettings'

const MIN = 60_000
const PAUSED_STATUSES = ['PENDING']

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const refTypes: string[] = Array.isArray(body.refTypes) ? body.refTypes : []
  const queueIds: number[] = Array.isArray(body.queueIds) ? body.queueIds : []
  const ctiIdsRaw: number[] = Array.isArray(body.ctiIds) ? body.ctiIds : []
  const severities: string[] = Array.isArray(body.severities) ? body.severities : []
  const targets: TargetInput[] = Array.isArray(body.targets) ? body.targets : []

  const nodes = ctiIdsRaw.length > 0 ? await prisma.ticketCti.findMany({ select: { id: true, parentId: true } }) : []
  const ctiIds = expandCtiSubtree(ctiIdsRaw, nodes)

  const tickets = await prisma.ticket.findMany({
    where: openTicketWhere({ refTypes, queueIds, ctiIds: ctiIdsRaw, severities }, ctiIds),
    select: {
      id: true, ticketCode: true, title: true, severity: true, status: true, createdAt: true,
      statusChangedAt: true, ownerId: true,
      hospital: { select: { hospitalName: true } },
      logs: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  })

  const now = Date.now()
  const sample: { ticketCode: string; title: string; metric: string; overdueMin: number }[] = []
  let wouldBreachNow = 0

  for (const t of tickets) {
    if (PAUSED_STATUSES.includes(t.status)) continue // 정지 중 티켓은 초과 판정 대상 아님
    for (const tg of targets) {
      if (tg.isActive === false) continue
      if (tg.severity && tg.severity !== t.severity) continue
      // 앵커 산출 — 엔진(lib/sla.ts)과 같은 규칙. DOMAIN_DUE는 도메인 필드라 미리보기에서 제외
      let anchor: Date | null = null
      switch (tg.metric) {
        case 'ASSIGN':
          if (t.ownerId) continue // 이미 달성
          anchor = t.createdAt
          break
        case 'FIRST_RESPONSE':
          if (t.logs.length > 0 || t.status === 'IN_PROGRESS') continue
          anchor = t.createdAt
          break
        case 'RESOLVE':
          anchor = t.createdAt
          break
        case 'UPDATE_STALE':
          anchor = t.logs[0]?.createdAt ?? t.statusChangedAt ?? t.createdAt
          break
        case 'DWELL':
          if (tg.statusScope !== t.status) continue
          anchor = t.statusChangedAt ?? t.createdAt
          break
        default:
          continue // DOMAIN_DUE 등은 미리보기 대상 아님
      }
      if (!anchor) continue
      const due = anchor.getTime() + Math.floor(tg.thresholdMin) * MIN
      if (due <= now) {
        wouldBreachNow++
        if (sample.length < 10) {
          sample.push({
            ticketCode: t.ticketCode,
            title: [t.hospital?.hospitalName, t.title].filter(Boolean).join(' — '),
            metric: tg.metric + (tg.statusScope ? `(${tg.statusScope})` : ''),
            overdueMin: Math.floor((now - due) / MIN),
          })
        }
      }
    }
  }

  sample.sort((a, b) => b.overdueMin - a.overdueMin)

  return NextResponse.json({
    matchedOpen: tickets.length,
    wouldBreachNow,
    sample,
    note: 'DOMAIN_DUE는 도메인 기한 필드에 따라 달라 미리보기 계산에서 제외됩니다.',
  })
}
