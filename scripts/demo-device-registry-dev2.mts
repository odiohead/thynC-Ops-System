/**
 * 디바이스 원장 — dev2 형상 검토용 데모 데이터 (DEV 전용, PROD 실행 금지)
 *
 *   npx tsx scripts/demo-device-registry-dev2.mts seed      # 문산중앙병원(HOSP-000046)에 가짜 시리얼(A990xxx/P990xxx/B990xxx) 데모 이력 생성
 *   npx tsx scripts/demo-device-registry-dev2.mts cleanup   # 위 데모 데이터 전부 삭제(이벤트·배치 행·유닛·배치·병동)
 *
 * 3층 구조(B-20): 시리얼 정체성은 device_units(공개 device id), 병원 배치는 hospital_devices(device_id UNIQUE). cleanup은 유닛까지 지운다.
 *
 * 데모 시나리오(설계 §6 화면 상태를 모두 볼 수 있게):
 *   1) go-live 임포트(붙여넣기, 2026-06-10): ECG 8 · SpO2 8 · GW 2 → 6병동/7병동/ICU — P990107·P990108은 평가용(EVAL), 나머지 판매용(폼 기본)
 *      상품유형(B-22): 문산중앙병원 계약완료 딜은 '일반'만(12+18+30=60) → 기본값 일반. 매트릭스 확인용으로 A990107·A990108만 '라이트'로 명시 등록(계약 딜에 없는 유형 → 경고만)
 *   2) 병동 이동 A990103 6병동→7병동 (2026-07-02)
 *   3) 분실 회수 P990105 (2026-07-20)
 *   4) AS 교체 A990104 → A990201 (불량, 2026-08-12, 유지보수 MNT-202608-0011 연결)
 *   5) 오늘 신규 등록 A990301 @ ICU
 *   6) 타 병원(HOSP-000059)에도 ECG 2대 등록 → 커버리지 표에 2병원 표시
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}

const reg = await import('../lib/deviceRegistry')
const prisma = new PrismaClient()

const H = 'HOSP-000046' // 문산중앙병원 (계약완료 딜 60대)
const H2 = 'HOSP-000059' // 빌리브세웅병원 (150대)
const ACTOR = { userId: '268ad824-6100-4778-9af6-ba5bc84a8679', name: '관리자' } // admin@thync.com
const DEMO_WARDS = ['6병동', '7병동', 'ICU']
const PREFIX = ['A990', 'P990', 'B990']

const mode = process.argv[2]

async function cleanup() {
  const units = await prisma.deviceUnit.findMany({
    where: { OR: PREFIX.map((p) => ({ serialNo: { startsWith: p } })) },
    select: { id: true, serialNo: true },
  })
  const ids = units.map((d) => d.id)
  const batchIds = (await prisma.hospitalDeviceEvent.findMany({ where: { deviceId: { in: ids }, importBatchId: { not: null } }, select: { importBatchId: true }, distinct: ['importBatchId'] }))
    .map((e) => e.importBatchId!)
  await prisma.$transaction(async (tx) => {
    await tx.hospitalDevice.updateMany({ where: { replacedById: { in: ids } }, data: { replacedById: null } })
    await tx.hospitalDeviceEvent.deleteMany({ where: { OR: [{ deviceId: { in: ids } }, { relatedDeviceId: { in: ids } }] } })
    await tx.hospitalDevice.deleteMany({ where: { deviceId: { in: ids } } })
    await tx.deviceUnit.deleteMany({ where: { id: { in: ids } } })
    if (batchIds.length) await tx.hospitalDeviceImportBatch.deleteMany({ where: { id: { in: batchIds } } })
    const wards = await tx.hospitalWard.findMany({ where: { hospitalCode: { in: [H, H2] }, name: { in: DEMO_WARDS } }, select: { id: true } })
    const wardIds = wards.map((w) => w.id)
    const stillUsed = await tx.hospitalDevice.count({ where: { wardId: { in: wardIds } } })
    const stillUsedEv = await tx.hospitalDeviceEvent.count({ where: { OR: [{ fromWardId: { in: wardIds } }, { toWardId: { in: wardIds } }] } })
    if (stillUsed === 0 && stillUsedEv === 0) await tx.hospitalWard.deleteMany({ where: { id: { in: wardIds } } })
    else console.log(`  (병동 유지 — 데모 외 참조 ${stillUsed + stillUsedEv}건)`)
  })
  console.log(`cleanup: 유닛 ${ids.length}건(배치 행 포함) · 배치 ${batchIds.length}건 삭제`)
}

async function seed() {
  const existing = await prisma.deviceUnit.count({ where: { OR: PREFIX.map((p) => ({ serialNo: { startsWith: p } })) } })
  if (existing) { console.log(`이미 데모 데이터 ${existing}건 존재 — 먼저 cleanup 하세요`); return }
  const mnt = await prisma.maintenance.findFirst({ where: { hospitalCode: H }, orderBy: { id: 'desc' }, select: { maintenanceCode: true } })
  const ctx = (occurredOn: string, extra: Partial<Parameters<typeof reg.registerDevices>[0]> = {}) => ({ hospitalCode: H, actor: ACTOR, occurredOn, ...extra })

  // 1) go-live 임포트 (붙여넣기 형식)
  const sale = await prisma.statusCode.findFirstOrThrow({ where: { category: 'DEVICE_USAGE_TYPE', value: 'SALE' } })
  const rows: { row: number; serialInput: string; wardInput?: string; usageTypeInput?: string; productTypeInput?: string }[] = []
  let r = 1
  // A990107·A990108은 상품유형 '라이트' 명시 — 요약 스트립 '└ 일반 | 라이트' 매트릭스·목록 배지·필터 확인용(병원 딜은 일반만 → 나머지는 기본값 일반)
  for (let i = 1; i <= 8; i++) rows.push({ row: r++, serialInput: `A9901${String(i).padStart(2, '0')}`, wardInput: i <= 4 ? '6병동' : '7병동', ...(i >= 7 ? { productTypeInput: '라이트' } : {}) })
  // P990107·P990108은 평가용(EVAL) — 요약 스트립 '(평가용 2 별도)'·커버리지 '평가용' 열·목록 용도 배지 확인용
  for (let i = 1; i <= 8; i++) rows.push({ row: r++, serialInput: `P9901${String(i).padStart(2, '0')}`, wardInput: i <= 4 ? '6병동' : '7병동', ...(i >= 7 ? { usageTypeInput: '평가용' } : {}) })
  rows.push({ row: r++, serialInput: 'GW6420-B990101', wardInput: '6병동' })
  rows.push({ row: r++, serialInput: 'B990102', wardInput: 'ICU' })
  const imp = await reg.importBatch(ctx('2026-06-10', { memo: 'go-live 1차(데모)' }), {
    rows, sourceKind: 'PASTE', mode: 'REGISTER', fileName: null, defaults: { wardMode: 'column', usageTypeId: sale.id },
  })
  console.log(`1) 임포트 배치 #${imp.batch.id}: 등록 ${imp.batch.registeredCount} · 병동 ${imp.result.newWards.map((w) => w.name).join(',')} · 용도 판매용 기본, P990107·P990108 평가용 · 상품유형 기본 ${imp.preview.summary.productTypeContext.default ?? '미지정'}, A990107·A990108 라이트`)

  const dev = async (serialNo: string) => (await prisma.deviceUnit.findUniqueOrThrow({ where: { serialNo } })).id // 공개 device id = 유닛 id
  // 2) 병동 이동
  await reg.moveDeviceWard(ctx('2026-07-02', { memo: '병동 재배치(데모)' }), { deviceId: await dev('A990103'), toWardName: '7병동' })
  console.log('2) 병동 이동 A990103 6병동→7병동')
  // 3) 분실 회수
  const lost = await prisma.statusCode.findFirstOrThrow({ where: { category: 'DEVICE_RECOVERY_REASON', value: 'LOST' } })
  await reg.recoverDevice(ctx('2026-07-20', { memo: '병동 분실 신고(데모)' }), { deviceId: await dev('P990105'), reasonCodeId: lost.id })
  console.log('3) 분실 회수 P990105')
  // 4) AS 교체 (유지보수 연결)
  const rep = await reg.replaceDevice(
    ctx('2026-08-12', { memo: 'AS 교체(데모)', ref: mnt ? { type: 'MAINTENANCE', code: mnt.maintenanceCode } : null }),
    { oldSerial: 'A990104', newSerial: 'A990201' },
  )
  console.log(`4) 교체 A990104 → A990201 (이벤트 ${rep.eventIds.length}건${mnt ? ', ref ' + mnt.maintenanceCode : ''})`)
  // 5) 오늘 신규 등록
  await reg.registerDevices(ctx(reg.todayKst ? reg.todayKst() : new Date().toISOString().slice(0, 10), { memo: '추가 도입(데모)' }), [{ serialInput: 'A990301', wardName: 'ICU' }])
  console.log('5) 신규 등록 A990301 @ ICU')
  // 6) 타 병원
  await reg.registerDevices({ hospitalCode: H2, actor: ACTOR, occurredOn: '2026-05-01', memo: 'go-live(데모)' }, [
    { serialInput: 'A990901', wardName: '6병동' }, { serialInput: 'A990902', wardName: '6병동' },
  ])
  console.log('6) 타 병원 HOSP-000059 ECG 2대 등록')
  const summary = (await reg.getHospitalDeviceSummary(H))!
  const units = await prisma.deviceUnit.count({ where: { OR: PREFIX.map((p) => ({ serialNo: { startsWith: p } })) } })
  const placements = await prisma.hospitalDevice.count({ where: { unit: { OR: PREFIX.map((p) => ({ serialNo: { startsWith: p } })) } } })
  console.log(
    `데모 유닛 ${units}건 / 배치 행 ${placements}건 · 평가용 ${summary.evalTotal} ·`,
    '요약:',
    summary.models
      .filter((m: { active: number }) => m.active > 0)
      .map((m: { deviceModel: string; active: number; activeEval: number; activeForCompare: number; expected: number | null; diff: number | null }) => `${m.deviceModel} 배치 ${m.active}(대조 ${m.activeForCompare}·평가 ${m.activeEval})/계약 ${m.expected ?? '—'} (차이 ${m.diff ?? '—'})`)
      .join(' · ')
  )
  const ecg = summary.models.find((m) => m.onpremDeviceType === 1)
  console.log(
    `상품유형(B-22): 딜 ${summary.productTypeContext.types.join('/') || '없음'}(기본 ${summary.productTypeContext.default ?? '미지정'}) · 매트릭스 ${summary.productTypeMixed ? 'ON' : 'OFF'} ·`,
    'ECG:',
    Object.entries(ecg?.byProductType ?? {}).map(([k, c]) => `${k} 배치 ${c!.activeForCompare}/계약 ${c!.expected ?? '—'} (차이 ${c!.diff ?? '—'})`).join(' · '),
    `· 교체 전체 ${summary.replacements.total} (일반 ${summary.replacements.byType['일반']} · 라이트 ${summary.replacements.byType['라이트']} · 미지정 ${summary.replacements.byType['미지정']}) · 최근 30일 ${summary.replacements.last30d.total}`
  )
}

try {
  if (mode === 'seed') await seed()
  else if (mode === 'cleanup') await cleanup()
  else console.log('usage: npx tsx scripts/demo-device-registry-dev2.mts seed|cleanup')
} finally {
  await prisma.$disconnect()
}
