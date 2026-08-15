/**
 * 티켓 자동생성 규칙 스모크 (ticket_cti_rule_design.md §10 게이트)
 *
 * 검증:
 *  - 규칙 해석 우선순위 (조건 행 > 기본 행 > 없으면 null=코드 폴백)
 *  - 비활성 규칙 무시 / Assignment Group 폴백(규칙 → CTI 기본 → 이름 폴백)
 *  - 설명 변환 (HTML 그대로 / plain → 문단 / 빈 값 null / 출처 표기 / script 제거)
 *  - CTI 삭제 가드 (규칙에 물린 CTI는 DB에서도 삭제 불가 — ON DELETE RESTRICT)
 *  - 시드된 운영 규칙 9행이 현행 하드코딩과 동일한지 (배포 직후 동작 동일 보장)
 * 테스트 데이터는 전부 삭제한다.
 *
 *   npx tsx scripts/ticket-cti-rules-smoke.mts
 */

import { PrismaClient } from '@prisma/client'
import {
  resolveDomainTicketRule,
  resolveDomainQueueId,
  buildTicketDescription,
  plainTextToHtml,
  DOMAIN_META,
} from '../lib/ticketCtiRules'

const prisma = new PrismaClient()
const TAG = '___cti_rule_smoke'

let pass = 0
let fail = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

/** 직전 실행이 중간에 죽었을 때를 대비한 사전 정리 (재실행 안전) */
async function cleanup() {
  await prisma.ticketDomainCtiRule.deleteMany({ where: { refType: '__SMOKE_REF' } })
  await prisma.ticketCti.deleteMany({ where: { name: { startsWith: TAG }, level: 3 } })
  await prisma.ticketCti.deleteMany({ where: { name: { startsWith: TAG }, level: 2 } })
  await prisma.ticketCti.deleteMany({ where: { name: { startsWith: TAG }, level: 1 } })
  await prisma.statusCode.deleteMany({ where: { name: { startsWith: TAG } } })
  await prisma.ticketQueue.deleteMany({ where: { name: { startsWith: TAG } } })
}

async function main() {
  await cleanup()
  // ── 준비: 테스트 전용 CTI 3단 + 그룹 + 조건 코드 ─────────────
  const queueA = await prisma.ticketQueue.create({ data: { name: `${TAG}_QA`, isActive: true } })
  const queueB = await prisma.ticketQueue.create({ data: { name: `${TAG}_QB`, isActive: true } })
  const cat = await prisma.ticketCti.create({ data: { name: `${TAG}_CAT`, level: 1 } })
  const typ = await prisma.ticketCti.create({ data: { name: `${TAG}_TYP`, level: 2, parentId: cat.id } })
  const itemDefault = await prisma.ticketCti.create({
    data: { name: `${TAG}_DEFAULT`, level: 3, parentId: typ.id, defaultQueueId: queueB.id },
  })
  const itemCond = await prisma.ticketCti.create({ data: { name: `${TAG}_COND`, level: 3, parentId: typ.id } })
  const code = await prisma.statusCode.create({ data: { name: `${TAG}_TYPE`, category: `${TAG}_CAT` } })
  const otherCode = await prisma.statusCode.create({ data: { name: `${TAG}_TYPE2`, category: `${TAG}_CAT` } })

  // 실제 운영 refType과 섞이지 않도록 테스트 전용 refType을 쓴다
  const REF = '__SMOKE_REF' as never // ref_type은 VARCHAR(20)

  console.log('\n▶ 규칙 해석 우선순위')
  {
    // 규칙 0건 → null (코드 폴백)
    const none = await resolveDomainTicketRule(prisma, REF)
    check('규칙 0건이면 null (코드 폴백)', none === null)

    // 기본 행만
    const base = await prisma.ticketDomainCtiRule.create({
      data: { refType: REF, matchStatusCodeId: null, ctiId: itemDefault.id, queueId: queueA.id, fillDescription: true },
    })
    const r1 = await resolveDomainTicketRule(prisma, REF)
    check('기본 행 적중', r1?.ctiId === itemDefault.id && r1?.matched === false)
    check('규칙 지정 그룹이 최우선', r1?.queueId === queueA.id)

    const r2 = await resolveDomainTicketRule(prisma, REF, { statusCodeId: code.id })
    check('조건 행이 없으면 기본 행으로 폴백', r2?.ctiId === itemDefault.id && r2?.matched === false)

    // 조건 행 추가
    await prisma.ticketDomainCtiRule.create({
      data: { refType: REF, matchStatusCodeId: code.id, ctiId: itemCond.id, fillDescription: true },
    })
    const r3 = await resolveDomainTicketRule(prisma, REF, { statusCodeId: code.id })
    check('조건 행이 기본 행을 이긴다', r3?.ctiId === itemCond.id && r3?.matched === true)

    const r4 = await resolveDomainTicketRule(prisma, REF, { statusCodeId: otherCode.id })
    check('다른 조건값은 기본 행 사용', r4?.ctiId === itemDefault.id)

    // 조건 행에 그룹 미지정 → CTI 기본 그룹 없음 → null (호출부 이름 폴백)
    check('조건 행 그룹 미지정 + CTI 기본 그룹 없음 → null', r3?.queueId === null)

    // CTI 기본 그룹 승계
    await prisma.ticketDomainCtiRule.update({ where: { id: base.id }, data: { queueId: null } })
    const r5 = await resolveDomainTicketRule(prisma, REF)
    check('규칙 그룹 미지정 시 CTI 기본 그룹 승계', r5?.queueId === queueB.id)

    // 이름 폴백
    const fb = await resolveDomainQueueId(prisma, null, queueA.name)
    check('규칙 없음 → 이름으로 그룹 폴백', fb === queueA.id)
    const fbMiss = await resolveDomainQueueId(prisma, null, `${TAG}_NOPE`)
    check('폴백 그룹도 없으면 null', fbMiss === null)

    // 비활성 규칙은 무시
    await prisma.ticketDomainCtiRule.update({ where: { id: base.id }, data: { isActive: false } })
    const r6 = await resolveDomainTicketRule(prisma, REF, { statusCodeId: otherCode.id })
    check('비활성 규칙은 무시된다', r6 === null)
    await prisma.ticketDomainCtiRule.update({ where: { id: base.id }, data: { isActive: true, queueId: queueA.id } })

    // 설명 자동입력 토글은 업무 단위 — 조건 행이 적중해도 기본 행 값을 따른다
    await prisma.ticketDomainCtiRule.update({ where: { id: base.id }, data: { fillDescription: false } })
    const r7 = await resolveDomainTicketRule(prisma, REF, { statusCodeId: code.id })
    check('설명 토글은 업무 단위(기본 행 값)로 결정', r7?.fillDescription === false)
    await prisma.ticketDomainCtiRule.update({ where: { id: base.id }, data: { fillDescription: true } })
  }

  console.log('\n▶ 설명 변환')
  {
    const html = buildTicketDescription({ refType: 'SITE_VISIT', source: '<p>현장 3층</p>', refCode: 'VISIT-1' })
    check('HTML 소스는 그대로 보존', !!html && html.includes('<p>현장 3층</p>'))
    check('출처 한 줄이 상단에 붙는다', !!html && html.startsWith('<p><em>※ 답사 VISIT-1 노트에서 자동 입력</em></p>'))

    const plain = buildTicketDescription({ refType: 'MAINTENANCE', source: '증상 A\n증상 B\n\n추가', refCode: 'MNT-1' })
    check('plain text는 문단으로 변환', !!plain && plain.includes('<p>증상 A<br>증상 B</p>') && plain.includes('<p>추가</p>'))
    check('plain 출처 표기(증상)', !!plain && plain.includes('※ 유지보수 MNT-1 증상에서 자동 입력'))

    check('빈 문자열 → null', buildTicketDescription({ refType: 'ETC', source: '', refCode: 'E-1' }) === null)
    check('null 소스 → null', buildTicketDescription({ refType: 'ETC', source: null, refCode: 'E-1' }) === null)
    check(
      '빈 HTML(<p></p>) → null',
      buildTicketDescription({ refType: 'ETC', source: '<p></p>', refCode: 'E-1' }) === null
    )
    check(
      '공백만 있는 plain → null',
      buildTicketDescription({ refType: 'PROJECT', source: '   \n  ', refCode: 'P-1' }) === null
    )

    const evil = buildTicketDescription({
      refType: 'INSTALL_PLAN',
      source: '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>',
      refCode: 'IP-1',
    })
    check('script 제거', !!evil && !evil.includes('<script'))
    check('인라인 이벤트 핸들러 제거', !!evil && !evil.includes('onerror'))

    check('plain HTML 이스케이프', plainTextToHtml('<b>x</b>') === '<p>&lt;b&gt;x&lt;/b&gt;</p>')

    const refCodeless = buildTicketDescription({ refType: 'ETC', source: '내용', refCode: null })
    check('refCode 없어도 출처 표기 생성', !!refCodeless && refCodeless.includes('※ 기타업무 비고에서 자동 입력'))
  }

  console.log('\n▶ CTI 삭제 가드 (DB 제약)')
  {
    let blocked = false
    try {
      await prisma.ticketCti.delete({ where: { id: itemDefault.id } })
    } catch {
      blocked = true
    }
    check('규칙에 물린 CTI는 DB에서 삭제 거부(RESTRICT)', blocked)
  }

  console.log('\n▶ 운영 시드 규칙 (배포 직후 동작 동일)')
  {
    const expect: Record<string, { cti: string; queue: string }> = {
      SITE_VISIT: { cti: '답사요청', queue: '설치·답사' },
      INSTALL_PLAN: { cti: '설치계획(가안)요청', queue: '설치·답사' },
      PROJECT: { cti: '구축', queue: '설치·답사' },
      ETC: { cti: '일반', queue: '내부운영' },
      MAINTENANCE: { cti: '기타', queue: '유지보수' },
      VOC: { cti: '일반', queue: 'CS' }, // cs_ticket_workflow_design.md P2 — seed-cs-masters.sql
    }
    for (const [refType, exp] of Object.entries(expect)) {
      const rule = await resolveDomainTicketRule(prisma, refType as keyof typeof DOMAIN_META)
      if (!rule) {
        check(`${DOMAIN_META[refType as keyof typeof DOMAIN_META].label} 기본 규칙 존재`, false, '규칙 없음 (시드 미적용)')
        continue
      }
      const cti = await prisma.ticketCti.findUnique({ where: { id: rule.ctiId }, select: { name: true } })
      const q = rule.queueId ? await prisma.ticketQueue.findUnique({ where: { id: rule.queueId }, select: { name: true } }) : null
      check(
        `${DOMAIN_META[refType as keyof typeof DOMAIN_META].label}: ${exp.cti} / ${exp.queue}`,
        cti?.name === exp.cti && q?.name === exp.queue,
        `실제 ${cti?.name} / ${q?.name}`
      )
    }

    // 유지보수 장애유형별 규칙 — 이름이 아니라 ID로 물려 있는지
    const maintTypes = await prisma.statusCode.findMany({
      where: { category: 'MAINTENANCE_TYPE' },
      select: { id: true, name: true },
    })
    for (const t of maintTypes) {
      const rule = await resolveDomainTicketRule(prisma, 'MAINTENANCE', { statusCodeId: t.id })
      const cti = rule ? await prisma.ticketCti.findUnique({ where: { id: rule.ctiId }, select: { name: true } }) : null
      check(`유지보수 장애유형 '${t.name}' → CTI '${t.name}'`, rule?.matched === true && cti?.name === t.name, `실제 ${cti?.name}`)
    }
  }

  // ── 정리 ─────────────────────────────────────────────────────
  await prisma.ticketDomainCtiRule.deleteMany({ where: { refType: REF } })
  await prisma.ticketCti.deleteMany({ where: { id: { in: [itemDefault.id, itemCond.id] } } })
  await prisma.ticketCti.delete({ where: { id: typ.id } })
  await prisma.ticketCti.delete({ where: { id: cat.id } })
  await prisma.statusCode.deleteMany({ where: { id: { in: [code.id, otherCode.id] } } })
  await prisma.ticketQueue.deleteMany({ where: { id: { in: [queueA.id, queueB.id] } } })

  const leftovers = await prisma.ticketDomainCtiRule.count({ where: { refType: REF } })
  check('테스트 데이터 정리 완료', leftovers === 0)

  console.log(`\n결과: ${pass}건 통과 / ${fail}건 실패`)
  if (fail > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
