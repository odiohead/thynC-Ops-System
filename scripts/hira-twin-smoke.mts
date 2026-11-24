/**
 * 심평원 요양기호 변경 대응 스모크 (lib/hiraTwin.ts · lib/hospitalListOrder.ts) — DEV DB 전용.
 * 가짜 심평원 레코드·병원(시군구 ZZ9999, hira_id 'TESTTWIN-…')을 만들어 판정·실행·수동 처리를 돌리고 전부 지운다.
 * 실행 중 만들어진 실제 병원(기존 미연결 레코드분)도 원래대로 되돌린다.
 *   npx tsx scripts/hira-twin-smoke.mts
 */
import { prisma } from '@/lib/prisma'
import {
  planHospitalSyncFromHira, executeHospitalSyncFromHira, resolveHiraSyncReview, latestCompleteBasisSyncAt, hiraLiveness,
} from '@/lib/hiraTwin'
import { hospitalPageIdsActiveFirst } from '@/lib/hospitalListOrder'

if (!/thync_ops_dev(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
  console.error('DEV DB(thync_ops_dev)에서만 실행합니다.')
  process.exit(1)
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name}`, detail ?? '') }
}

const SGG = 'ZZ9999'
const PREFIX = 'TESTTWIN-'
const HOUR = 3600_000
const now = Date.now()
const jobAt = new Date(now - 2 * HOUR)
const alive = new Date(now - HOUR)

async function hira(key: string, o: { opened: string; address?: string | null; phone?: string | null; lastSeenAt?: Date | null; name?: string }) {
  return prisma.hiraHospital.create({
    data: {
      hiraId: PREFIX + key, name: o.name ?? `테스트병원 ${key}`, typeCode: '21', typeName: '병원',
      sidoCode: 'ZZ0000', sidoName: '테스트', sigunguCode: SGG, sigunguName: '테스트시',
      address: o.address ?? null, phone: o.phone ?? null, openedAt: o.opened, lastSeenAt: o.lastSeenAt ?? null,
    },
  })
}
async function hospital(code: string, hiraId: string, name: string, status = '운영') {
  return prisma.hospital.create({ data: { hospitalCode: code, hiraId, hiraHospitalName: name, hospitalName: name, type: '병원', status } })
}

async function cleanup(extraHospitalCodes: string[] = []) {
  const fake = await prisma.hiraHospital.findMany({ where: { hiraId: { startsWith: PREFIX } }, select: { hiraId: true } })
  const hosp = await prisma.hospital.findMany({
    where: { OR: [{ hiraId: { in: fake.map((f) => f.hiraId) } }, { hospitalCode: { startsWith: 'TEST-TWIN-' } }, { hospitalCode: { in: extraHospitalCodes } }] },
    select: { hospitalCode: true },
  })
  const codes = hosp.map((h) => h.hospitalCode)
  await prisma.auditLog.deleteMany({ where: { resource: 'hospital', resourceId: { in: codes } } })
  await prisma.hospital.deleteMany({ where: { hospitalCode: { in: codes } } })
  await prisma.hiraHospital.updateMany({ where: { hiraId: { startsWith: PREFIX } }, data: { supersededById: null } })
  await prisma.hiraHospital.deleteMany({ where: { hiraId: { startsWith: PREFIX } } })
  await prisma.hiraSyncJob.deleteMany({ where: { jobType: 'basis', totalCount: -777 } })
}

async function main() {
  await cleanup()
  const baseline = await planHospitalSyncFromHira()
  const realCreateIds = new Set(baseline.create.map((u) => u.id))
  console.log(`기준 상태 — 실제 미연결 ${baseline.create.length + baseline.review.length + baseline.relink.length}건, syncAt=${baseline.syncAt?.toISOString() ?? 'null'}`)

  console.log('\n[1] 판정 함수')
  check('동기화 이력 없으면 unknown', hiraLiveness(new Date(), null) === 'unknown')
  check('동기화 시작 이후 수신 = alive', hiraLiveness(alive, jobAt) === 'alive')
  check('동기화 시작 이전 수신 = dead', hiraLiveness(new Date(now - 3 * HOUR), jobAt) === 'dead')
  check('수신 기록 없음 = dead', hiraLiveness(null, jobAt) === 'dead')

  // 픽스처
  const cA = await hira('A-old', { opened: '1999-01-01', address: '테스트로 1', phone: '000-0001' })
  const uA = await hira('A-new', { opened: '1999-01-01', address: '테스트로 1', phone: '000-0001', lastSeenAt: alive, name: '의료법인 테스트재단 A병원' })
  await hospital('TEST-TWIN-A', cA.hiraId, '테스트병원 A')
  const cB = await hira('B-old', { opened: '1999-01-02', address: '테스트로 2 (구)', phone: '000-0002', lastSeenAt: alive })
  const uB = await hira('B-new', { opened: '1999-01-02', address: '테스트로 2 (신)', phone: '000-0002', lastSeenAt: alive })
  await hospital('TEST-TWIN-B', cB.hiraId, '테스트병원 B')
  const cC1 = await hira('C-old1', { opened: '1999-01-03', address: '테스트로 3' })
  const cC2 = await hira('C-old2', { opened: '1999-01-03', address: '테스트로 3' })
  const uC = await hira('C-new', { opened: '1999-01-03', address: '테스트로 3', lastSeenAt: alive })
  await hospital('TEST-TWIN-C1', cC1.hiraId, '테스트병원 C1')
  await hospital('TEST-TWIN-C2', cC2.hiraId, '테스트병원 C2', '미계약')
  const uD = await hira('D-dead', { opened: '1999-01-04', address: '테스트로 4' })
  const uE = await hira('E-new', { opened: '1999-01-05', address: '테스트로 5', lastSeenAt: alive })
  const cF = await hira('F-other', { opened: '1999-01-06', address: '테스트로 6', phone: '000-0006', lastSeenAt: alive })
  const uF = await hira('F-new', { opened: '1999-01-06', address: '테스트로 66', phone: '000-0066', lastSeenAt: alive })
  await hospital('TEST-TWIN-F', cF.hiraId, '테스트병원 F')
  const cG = await hira('G-old', { opened: '1999-01-07', address: '테스트로 7' })
  const uG1 = await hira('G-new1', { opened: '1999-01-07', address: '테스트로 7', lastSeenAt: alive })
  const uG2 = await hira('G-new2', { opened: '1999-01-07', address: '테스트로 7', lastSeenAt: alive })
  await hospital('TEST-TWIN-G', cG.hiraId, '테스트병원 G')
  const uH = await hira('H-noopen', { opened: '', address: '테스트로 1', lastSeenAt: alive })
  await prisma.hiraHospital.update({ where: { id: uH.id }, data: { openedAt: null } })

  console.log('\n[2] 완전한 목록 동기화 이력이 없을 때 (폐기 키 판정 불가)')
  let plan = await planHospitalSyncFromHira()
  check('syncAt 없음(기존 basis 잡은 complete 표시 없음)', plan.syncAt === null, plan.syncAt)
  const rA0 = plan.review.find((r) => r.hiraHospitalId === uA.id)
  check('쌍둥이 있는 레코드는 자동 처리 없이 확인 필요(LIVENESS_UNKNOWN)', rA0?.reason === 'LIVENESS_UNKNOWN' && !plan.relink.some((r) => r.hiraHospitalId === uA.id), rA0)
  check('쌍둥이 없는 레코드는 종전대로 신규 등록 대상', plan.create.some((u) => u.id === uE.id))
  check('판정 불가 상태에서는 폐기 키로 건너뛰지 않음', plan.create.some((u) => u.id === uD.id) && plan.skippedDead === baseline.skippedDead)

  console.log('\n[3] 완전한 목록 동기화 이후')
  await prisma.hiraSyncJob.create({ data: { jobType: 'basis', status: 'done', startedAt: jobAt, endedAt: jobAt, totalCount: -777, params: { complete: true, failedGroups: [] } } })
  await prisma.hiraSyncJob.create({ data: { jobType: 'basis', status: 'done', startedAt: new Date(now - HOUR / 2), endedAt: new Date(), totalCount: -777, params: { complete: false, failedGroups: ['31'] } } })
  const syncAt = await latestCompleteBasisSyncAt()
  check('일부 종별이 실패한 최근 잡은 기준에서 제외', syncAt?.getTime() === jobAt.getTime(), syncAt)
  plan = await planHospitalSyncFromHira()
  const relA = plan.relink.find((r) => r.hiraHospitalId === uA.id)
  check('A: 구 키 폐기 + 새 키 수신 + 1:1 → 자동 재연결 대상', relA?.hospitalCode === 'TEST-TWIN-A' && relA.oldHiraHospitalId === cA.id, relA)
  const rB = plan.review.find((r) => r.hiraHospitalId === uB.id)
  check('B: 구 키도 살아 있음(전화 일치) → 확인 필요(TWIN_ALIVE)', rB?.reason === 'TWIN_ALIVE' && rB.candidates[0]?.hospitalCode === 'TEST-TWIN-B', rB)
  const rC = plan.review.find((r) => r.hiraHospitalId === uC.id)
  check('C: 후보 병원 2곳 → 확인 필요(MULTIPLE)', rC?.reason === 'MULTIPLE' && rC.candidates.length === 2, rC)
  check('D: 병원 없고 수신 기록도 없는 레코드 → 건너뜀', plan.skippedDead === baseline.skippedDead + 1 + (baseline.create.length + baseline.review.length) && !plan.create.some((u) => u.id === uD.id), plan.skippedDead)
  check('E: 쌍둥이 없음 → 신규 등록', plan.create.some((u) => u.id === uE.id))
  check('F: 시군구·개설일만 같고 주소·전화 다름 → 다른 병원(신규 등록)', plan.create.some((u) => u.id === uF.id))
  const gRel = plan.relink.filter((r) => r.hospitalCode === 'TEST-TWIN-G')
  const gRev = plan.review.filter((r) => r.hiraHospitalId === uG1.id || r.hiraHospitalId === uG2.id)
  check('G: 같은 병원에 새 레코드 2건 → 1건만 자동, 1건은 확인 필요', gRel.length === 1 && gRev.length === 1 && gRev[0].reason === 'MULTIPLE', { gRel, gRev })
  check('H: 개설일 없는 레코드는 쌍둥이 판정 안 함(신규 등록)', plan.create.some((u) => u.id === uH.id))

  console.log('\n[4] 실행')
  const before = await prisma.hospital.count()
  const res = await executeHospitalSyncFromHira({ actor: { name: '스모크', role: 'SYSTEM' } })
  const createdRows = await prisma.hospital.findMany({ where: { hiraId: { in: [uE.hiraId, uF.hiraId, uH.hiraId] } }, select: { hospitalCode: true, status: true, hospitalName: true } })
  check('신규 등록 3건(E·F·H) 미계약으로 생성', createdRows.length === 3 && createdRows.every((h) => h.status === '미계약' && /^HOSP-\d{6}$/.test(h.hospitalCode)), createdRows)
  check('병원 수 증가 = created', (await prisma.hospital.count()) - before === res.created, { created: res.created })
  const hA = await prisma.hospital.findUnique({ where: { hospitalCode: 'TEST-TWIN-A' }, select: { hiraId: true, hiraHospitalName: true, hospitalName: true, status: true } })
  check('A: 병원코드 유지, 심평원 연결·심평원 명칭만 새 레코드로', hA?.hiraId === uA.hiraId && hA.hiraHospitalName === '의료법인 테스트재단 A병원' && hA.hospitalName === '테스트병원 A' && hA.status === '운영', hA)
  const cA2 = await prisma.hiraHospital.findUnique({ where: { id: cA.id }, select: { supersededById: true } })
  check('A: 구 레코드에 대체 표시', cA2?.supersededById === uA.id, cA2)
  const audA = await prisma.auditLog.findFirst({ where: { resource: 'hospital', resourceId: 'TEST-TWIN-A', action: 'UPDATE' }, orderBy: { id: 'desc' } })
  check('A: 감사 로그(자동 — 요양기호 변경)', !!audA?.resourceLabel?.includes('자동 — 요양기호 변경'), audA?.resourceLabel)
  check('B·C·G2는 그대로 확인 필요로 반환', [uB.id, uC.id].every((id) => res.review.some((r) => r.hiraHospitalId === id)) && res.review.filter((r) => r.candidates.some((c) => c.hospitalCode === 'TEST-TWIN-G')).length === 1)
  const hB = await prisma.hospital.findUnique({ where: { hospitalCode: 'TEST-TWIN-B' }, select: { hiraId: true } })
  check('B: 확인 필요 건은 건드리지 않음', hB?.hiraId === cB.hiraId)
  plan = await planHospitalSyncFromHira()
  check('재실행 계획: 대체된 구 레코드·방금 처리분이 다시 나오지 않음', !plan.create.some((u) => [cA.id, uA.id, uE.id, uF.id, uH.id].includes(u.id)) && !plan.relink.some((r) => r.hospitalCode === 'TEST-TWIN-A') && plan.relink.length === 0, plan.relink)

  console.log('\n[5] 확인 필요 수동 처리')
  const bad = await resolveHiraSyncReview({ hiraHospitalId: uB.id, action: 'relink', hospitalCode: 'TEST-TWIN-A' })
  check('후보가 아닌 병원으로 연결 → 400', bad.status === 400, bad)
  const notFound = await resolveHiraSyncReview({ hiraHospitalId: uA.id, action: 'create' })
  check('확인 필요 목록에 없는 레코드 → 404', notFound.status === 404, notFound)
  const okB = await resolveHiraSyncReview({ hiraHospitalId: uB.id, action: 'relink', hospitalCode: 'TEST-TWIN-B', actor: { name: '스모크', role: 'SYSTEM' } })
  const hB2 = await prisma.hospital.findUnique({ where: { hospitalCode: 'TEST-TWIN-B' }, select: { hiraId: true } })
  const cB2 = await prisma.hiraHospital.findUnique({ where: { id: cB.id }, select: { supersededById: true } })
  check('B: [같은 병원] → 연결 교체 + 구 레코드(살아 있음) 대체 표시', okB.ok && hB2?.hiraId === uB.hiraId && cB2?.supersededById === uB.id, { okB, hB2, cB2 })
  const okC = await resolveHiraSyncReview({ hiraHospitalId: uC.id, action: 'create', actor: { name: '스모크', role: 'SYSTEM' } })
  const hC = okC.hospitalCode ? await prisma.hospital.findUnique({ where: { hospitalCode: okC.hospitalCode }, select: { hiraId: true, status: true } }) : null
  check('C: [다른 병원] → 새 미계약 병원 등록', okC.ok && hC?.hiraId === uC.hiraId && hC.status === '미계약', { okC, hC })
  plan = await planHospitalSyncFromHira()
  check('처리한 B·C는 확인 필요에서 빠지고 살아 있던 구 레코드 B도 다시 안 나옴', !plan.review.some((r) => [uB.id, uC.id, cB.id].includes(r.hiraHospitalId)) && !plan.create.some((u) => u.id === cB.id), plan.review.map((r) => r.hiraHospitalId))

  console.log('\n[6] 병원 목록 정렬 (미계약 아닌 병원 먼저)')
  for (const term of ['성심', '테스트병원', '나눔과행복']) {
    const where = { OR: [{ hospitalName: { contains: term } }, { hiraHospitalName: { contains: term } }] }
    const total = await prisma.hospital.count({ where })
    const paged: number[] = []
    for (let skip = 0; skip < total; skip += 7) paged.push(...(await hospitalPageIdsActiveFirst(where, skip, 7)))
    const rows = await prisma.hospital.findMany({ where, select: { id: true, status: true, createdAt: true } })
    const expected = [...rows].sort((a, b) =>
      Number(a.status === '미계약') - Number(b.status === '미계약') || b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
    ).map((r) => r.id)
    check(`'${term}' ${total}건 — 페이지를 이어 붙인 순서 = 기대 순서(누락·중복 없음)`, paged.length === total && paged.every((id, i) => id === expected[i]), { total, got: paged.length })
    const firstUncontracted = paged.findIndex((id) => rows.find((r) => r.id === id)?.status === '미계약')
    const lastActive = paged.reduce((acc, id, i) => (rows.find((r) => r.id === id)?.status !== '미계약' ? i : acc), -1)
    check(`'${term}' — 미계약이 아닌 병원이 전부 미계약보다 앞`, firstUncontracted === -1 || lastActive < firstUncontracted, { firstUncontracted, lastActive })
  }

  // 실행 중 실제 미연결 레코드로 만들어진 병원 되돌리기
  const realCreated = await prisma.hospital.findMany({
    where: { hiraHospital: { id: { in: Array.from(realCreateIds) } }, createdAt: { gte: new Date(now) } },
    select: { hospitalCode: true },
  })
  return realCreated.map((h) => h.hospitalCode)
}

let extra: string[] = []
try {
  extra = await main()
} catch (e) {
  fail += 1
  console.error('스모크 중단:', e)
} finally {
  await cleanup(extra)
  const left = await prisma.hiraHospital.count({ where: { hiraId: { startsWith: PREFIX } } })
  const leftH = await prisma.hospital.count({ where: { OR: [{ hospitalCode: { startsWith: 'TEST-TWIN-' } }, { sigunguCode: SGG }] } })
  console.log(`\n정리 — 가짜 심평원 레코드 ${left}건·가짜 병원 ${leftH}건 남음${extra.length ? ` (실제 병원 ${extra.join(', ')} 되돌림)` : ''}`)
  console.log(`결과: ${pass} 통과 / ${fail} 실패`)
  await prisma.$disconnect()
  process.exit(fail === 0 && left === 0 && leftH === 0 ? 0 : 1)
}
