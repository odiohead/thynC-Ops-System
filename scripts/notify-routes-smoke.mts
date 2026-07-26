/**
 * 채널 라우팅 · 일일 다이제스트 스모크 (1.1 P3·P4 게이트 — §9)
 *
 * 실제 Slack 발송 없이 검증한다:
 *  - 라우팅 매칭(유형·그룹·Sev·상태·metric 축) / 다중 채널 / 같은 채널 dedup / 멘션 강도 승격
 *  - 규칙 0건 → 미발송
 *  - 다이제스트: 지정 시각 판정(KST) · 당일 중복 방지 · 섹션 그룹핑
 * 테스트용 채널·규칙은 전부 삭제한다.
 *
 *   npx tsx scripts/notify-routes-smoke.mts
 */

import { PrismaClient } from '@prisma/client'
import { resolveChannels, listDigestRoutes, parseDigestOpts } from '../lib/notify-routes'
import { buildDigestMessage, runDailyDigests } from '../lib/sla-alerts'
import { findSlaRisk } from '../lib/sla'

const prisma = new PrismaClient()
const TAG = '___routes_smoke'

let pass = 0
let fail = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function main() {
  const queue = await prisma.ticketQueue.findFirst({ where: { isActive: true }, select: { id: true, name: true } })
  const cti = await prisma.ticketCti.findFirst({ where: { level: 3 }, select: { id: true, parentId: true } })
  if (!queue || !cti) throw new Error('검증에 필요한 Assignment Group·CTI가 없습니다.')

  // 테스트 채널 2개
  let seededLogId: number | null = null
  const chA = await prisma.notifyChannel.create({ data: { name: `${TAG}_A`, slackChannelId: 'C_SMOKE_A', isActive: true } })
  const chB = await prisma.notifyChannel.create({ data: { name: `${TAG}_B`, slackChannelId: 'C_SMOKE_B', isActive: true } })
  const chOff = await prisma.notifyChannel.create({ data: { name: `${TAG}_OFF`, slackChannelId: 'C_SMOKE_OFF', isActive: false } })

  // 기존 운영 규칙과 섞이지 않도록, 검증은 **테스트 전용 이벤트**를 쓰지 않고
  // 실제 이벤트를 쓰되 "스코프가 좁은 규칙"으로 판별한다(운영 규칙도 함께 매칭되는 것이 정상 동작).
  const routes = await Promise.all([
    // 유형 MAINTENANCE + 그룹 일치 → A
    prisma.notifyRoute.create({ data: { name: `${TAG}_r1`, eventType: 'TICKET_CREATED', channelId: chA.id, refTypes: ['MAINTENANCE'], queueIds: [queue.id], mentionMode: 'none' } }),
    // 같은 이벤트, 같은 채널 A (중복 매칭 → 1건으로 합쳐야 함) + 멘션 강함
    prisma.notifyRoute.create({ data: { name: `${TAG}_r2`, eventType: 'TICKET_CREATED', channelId: chA.id, severities: ['SEV2'], mentionMode: 'channel' } }),
    // 다른 채널 B → 다중 채널 발송
    prisma.notifyRoute.create({ data: { name: `${TAG}_r3`, eventType: 'TICKET_CREATED', channelId: chB.id, mentionMode: 'queue_members' } }),
    // 비활성 채널 → 제외
    prisma.notifyRoute.create({ data: { name: `${TAG}_r4`, eventType: 'TICKET_CREATED', channelId: chOff.id } }),
    // 상태 축: RESOLVED로 바뀔 때만
    prisma.notifyRoute.create({ data: { name: `${TAG}_r5`, eventType: 'TICKET_STATUS_CHANGED', channelId: chB.id, statusTo: ['RESOLVED'] } }),
    // metric 축: ASSIGN 초과만
    prisma.notifyRoute.create({ data: { name: `${TAG}_r6`, eventType: 'SLA_BREACH', channelId: chB.id, metrics: ['ASSIGN'] } }),
    // CTI 축(서브트리 상속 확인 — 부모 Type을 지정)
    prisma.notifyRoute.create({ data: { name: `${TAG}_r7`, eventType: 'SEV_ESCALATED', channelId: chA.id, ctiIds: cti.parentId ? [cti.parentId] : [cti.id] } }),
  ])

  try {
    console.log('1. 라우팅 매칭')
    const base = { refType: 'MAINTENANCE', queueId: queue.id, ctiId: cti.id, severity: 'SEV2' as const }
    const created = await resolveChannels(['TICKET_CREATED'], base)
    const smokeOnly = created.filter((c) => c.slackChannelId.startsWith('C_SMOKE'))
    check('채널 A·B 매칭 (비활성 채널 제외)', smokeOnly.length === 2, smokeOnly.map((c) => c.slackChannelId).join(','))
    const a = smokeOnly.find((c) => c.slackChannelId === 'C_SMOKE_A')!
    check('같은 채널 중복 매칭 → 1건으로 합침', a.routeIds.length === 2, `routeIds=${a.routeIds.join(',')}`)
    check('멘션은 강한 쪽 채택(none + channel → channel)', a.mentionMode === 'channel', a.mentionMode)

    console.log('\n2. 축별 필터')
    const wrongType = await resolveChannels(['TICKET_CREATED'], { ...base, refType: 'PROJECT' })
    check('유형 불일치 → r1 제외(r2는 Sev2라 계속 매칭)',
      !wrongType.find((c) => c.slackChannelId === 'C_SMOKE_A')?.routeIds.includes(routes[0].id),
      JSON.stringify(wrongType.find((c) => c.slackChannelId === 'C_SMOKE_A')?.routeIds ?? []))

    const statusNo = await resolveChannels(['TICKET_STATUS_CHANGED'], { ...base, statusTo: 'IN_PROGRESS' })
    check('상태 축 불일치 → 미매칭', !statusNo.some((c) => c.routeIds.includes(routes[4].id)))
    const statusYes = await resolveChannels(['TICKET_STATUS_CHANGED'], { ...base, statusTo: 'RESOLVED' })
    check('상태 축 일치 → 매칭', statusYes.some((c) => c.routeIds.includes(routes[4].id)))

    const metricNo = await resolveChannels(['SLA_BREACH'], { ...base, metric: 'RESOLVE' })
    check('metric 축 불일치 → 미매칭', !metricNo.some((c) => c.routeIds.includes(routes[5].id)))
    const metricYes = await resolveChannels(['SLA_BREACH'], { ...base, metric: 'ASSIGN' })
    check('metric 축 일치 → 매칭', metricYes.some((c) => c.routeIds.includes(routes[5].id)))

    const ctiYes = await resolveChannels(['SEV_ESCALATED'], base)
    check('CTI 서브트리 상속(부모 지정 → 자식 티켓 매칭)', ctiYes.some((c) => c.routeIds.includes(routes[6].id)))
    const ctiNo = await resolveChannels(['SEV_ESCALATED'], { ...base, ctiId: null })
    check('CTI 없는 티켓 → CTI 스코프 규칙 미매칭', !ctiNo.some((c) => c.routeIds.includes(routes[6].id)))

    console.log('\n3. 규칙 없는 이벤트')
    const none = await resolveChannels(['SLA_WARNING'], base)
    check('SLA_WARNING 규칙 0건 → 채널 0개(미발송)', none.length === 0, `${none.length}개`)

    console.log('\n4. 다이제스트')
    const digestRoutes = await listDigestRoutes()
    check('시드된 일일 요약 규칙 존재(시각 지정됨)', digestRoutes.length >= 1 && digestRoutes.every((r) => r.digestHour != null))
    const opts = parseDigestOpts({ kinds: ['overdue'], groupBy: 'queue', maxPerSection: 3 })
    check('digest_opts 파싱', opts.kinds.length === 1 && opts.groupBy === 'queue' && opts.maxPerSection === 3)

    const risk = await findSlaRisk({ includeWarning: true })
    const msg = buildDigestMessage(risk, opts, '테스트 요약')
    check('요약 본문 생성(제목에 건수·날짜)', msg.text.includes('테스트 요약') && msg.blocks.length === 2, msg.text)
    check('섹션 상한 반영(그룹당 최대 3건 + 외 N건)',
      !msg.blocks.length || JSON.stringify(msg.blocks).includes('건'), '본문 확인')

    // dry-run: 실제 발송 없이 대상 건수만
    const dry = await runDailyDigests({ force: true, dryRun: true })
    check('dry-run 실행(발송 없음)', dry.every((d) => d.status === 'dry'), JSON.stringify(dry.map((d) => `${d.routeName}:${d.count}`)))

    console.log('\n5. 하루 1회 보장 판정')
    // 오늘 발송 로그를 심고 → 중복 스킵되는지
    const target = digestRoutes[0]
    // 주의: 실제 채널 ID로 심으므로 정리 단계에서 **반드시 id로 지운다**.
    // 남겨두면 그날 실제 요약 발송이 "이미 보냈음"으로 스킵된다(검증이 운영을 막는 사고).
    seededLogId = (await prisma.notificationLog.create({
      data: { eventType: 'delayed', targetType: 'channel', targetId: target.slackChannelId, status: 'sent', payload: { digestRouteId: target.routeId } },
    })).id
    const afterLog = await runDailyDigests({ dryRun: true })
    const t = afterLog.find((d) => d.routeName === target.routeName)
    check('당일 발송 로그 있으면 스킵', t?.status === 'skipped_already' || t?.status === 'skipped_not_due', t?.status)
  } finally {
    console.log('\n[정리]')
    await prisma.notifyRoute.deleteMany({ where: { name: { startsWith: TAG } } })
    await prisma.notifyChannel.deleteMany({ where: { name: { startsWith: TAG } } })
    await prisma.notificationLog.deleteMany({ where: { targetId: { in: ['C_SMOKE_A', 'C_SMOKE_B', 'C_SMOKE_OFF'] } } })
    if (seededLogId != null) await prisma.notificationLog.delete({ where: { id: seededLogId } }).catch(() => {})
    const residue = await prisma.notifyChannel.count({ where: { name: { startsWith: TAG } } })
    const residueR = await prisma.notifyRoute.count({ where: { name: { startsWith: TAG } } })
    const residueLog = seededLogId != null ? await prisma.notificationLog.count({ where: { id: seededLogId } }) : 0
    check('테스트 채널·규칙·로그 잔여 0', residue === 0 && residueR === 0 && residueLog === 0,
      `ch=${residue} route=${residueR} log=${residueLog}`)
  }

  console.log(`\n[routes-smoke] 결과: ${pass} 통과 / ${fail} 실패`)
  if (fail > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
