/**
 * migrate-hira-to-hospitals.ts
 * HIRA 병원 데이터를 Hospital 테이블로 일괄 마이그레이션
 *
 * 사용법:
 *   npx ts-node --project tsconfig.scripts.json scripts/migrate-hira-to-hospitals.ts --dry-run
 *   npx ts-node --project tsconfig.scripts.json scripts/migrate-hira-to-hospitals.ts --execute
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const EXCLUDE_TYPE_NAMES = ['한의원', '치과의원']
const BATCH_SIZE = 500

// hospitalCode 채번: HOSP-NNNNNN 형식
function buildHospitalCode(seq: number): string {
  return `HOSP-${String(seq).padStart(6, '0')}`
}

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const isExecute = args.includes('--execute')

  if (!isDryRun && !isExecute) {
    console.error('사용법: --dry-run 또는 --execute 플래그를 지정하세요.')
    process.exit(1)
  }

  // 1. StatusCode '미계약' 확인
  const uncontractedStatus = await prisma.statusCode.findFirst({
    where: { name: '미계약', category: 'HOSPITAL' },
  })
  if (!uncontractedStatus) {
    console.error(
      "[ERROR] StatusCode '미계약'(HOSPITAL)이 존재하지 않습니다. 설정 > 병원 상태코드에서 먼저 추가하세요."
    )
    process.exit(1)
  }

  // 2. 이미 매핑된 hiraId 목록
  const mappedHiraIds = await prisma.hospital.findMany({
    where: { hiraId: { not: null } },
    select: { hiraId: true },
  })
  const mappedSet = new Set(mappedHiraIds.map((h) => h.hiraId as string))

  // 3. 전체 HiraHospital 조회
  const allHira = await prisma.hiraHospital.findMany({
    select: {
      hiraId: true,
      name: true,
      typeCode: true,
      typeName: true,
      sidoCode: true,
      sidoName: true,
      sigunguCode: true,
      sigunguName: true,
      eupmyeondong: true,
      postalCode: true,
      address: true,
      phone: true,
      coordinateX: true,
      coordinateY: true,
    },
  })

  const totalAll = allHira.length
  const excluded = allHira.filter((h) => EXCLUDE_TYPE_NAMES.includes(h.typeName))
  const afterExclude = allHira.filter((h) => !EXCLUDE_TYPE_NAMES.includes(h.typeName))
  const targets = afterExclude.filter((h) => !mappedSet.has(h.hiraId))

  const excludedCount = excluded.length
  const alreadyMappedCount = afterExclude.length - targets.length

  // 4. 채번 시작점: 기존 최댓값 파악
  const lastHospital = await prisma.hospital.findFirst({
    orderBy: { hospitalCode: 'desc' },
    select: { hospitalCode: true },
  })
  let nextSeq = 1
  if (lastHospital) {
    const match = lastHospital.hospitalCode.match(/(\d+)$/)
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1
    }
  }

  if (isDryRun) {
    console.log('=== HIRA → Hospital 마이그레이션 (DRY RUN) ===')
    console.log(`전체 HiraHospital:              ${totalAll.toLocaleString()}건`)
    console.log(`제외 (한의원/치과의원):           ${excludedCount.toLocaleString()}건`)
    console.log(`이미 매핑된 병원 (중복 제외):        ${alreadyMappedCount.toLocaleString()}건`)
    console.log('─────────────────────────────────────────')
    console.log(`신규 삽입 대상:                 ${targets.length.toLocaleString()}건`)
    console.log('')

    console.log('[샘플 10건]')
    targets.slice(0, 10).forEach((h, i) => {
      console.log(
        `${i + 1}. ${h.hiraId} | ${h.name} | ${h.typeName} | ${h.sidoName} ${h.sigunguName}`
      )
    })

    console.log('')
    console.log(`StatusCode '미계약' 확인: OK (name: '${uncontractedStatus.name}')`)
    console.log(`hospitalCode 채번 시작점: ${buildHospitalCode(nextSeq)}`)
    console.log('')
    console.log('=== DRY RUN 완료. --execute 플래그로 실제 실행하세요. ===')
    return
  }

  // --execute
  console.log('=== HIRA → Hospital 마이그레이션 (EXECUTE) ===')
  console.log(`신규 삽입 대상: ${targets.length.toLocaleString()}건`)
  console.log(`채번 시작: ${buildHospitalCode(nextSeq)}`)
  console.log('')

  // 배치 데이터 구성
  const records = targets.map((h, i) => ({
    hospitalCode: buildHospitalCode(nextSeq + i),
    hiraId: h.hiraId,
    hiraHospitalName: h.name,
    hospitalName: h.name,
    type: h.typeName,
    sidoCode: h.sidoCode ?? null,
    sidoName: h.sidoName ?? null,
    sigunguCode: h.sigunguCode ?? null,
    sigunguName: h.sigunguName ?? null,
    eupmyeondong: h.eupmyeondong ?? null,
    postalCode: h.postalCode ?? null,
    address: h.address ?? null,
    coordinateX: h.coordinateX ?? null,
    coordinateY: h.coordinateY ?? null,
    status: uncontractedStatus.name,
    introType: null,
    introBeds: null,
    contractDate: null,
  }))

  const totalBatches = Math.ceil(records.length / BATCH_SIZE)
  let totalInserted = 0

  for (let i = 0; i < totalBatches; i++) {
    const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
    try {
      const result = await prisma.hospital.createMany({
        data: batch,
        skipDuplicates: true,
      })
      totalInserted += result.count
      console.log(
        `[${i + 1}/${totalBatches}] ${result.count}건 삽입 완료 (누적: ${totalInserted.toLocaleString()} / ${records.length.toLocaleString()})`
      )
    } catch (err) {
      console.error(`[${i + 1}/${totalBatches}] 배치 오류:`, err)
      // 다음 배치 계속
    }
  }

  console.log('')
  console.log(`=== 완료: 총 ${totalInserted.toLocaleString()}건 삽입 ===`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
