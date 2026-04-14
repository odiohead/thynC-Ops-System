import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface RawTask {
  taskType: string
  refCode: string
  hospitalCode: string | null
  title: string
  dateForCode: Date
}

function getYYYYMM(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function loadProjects(): Promise<RawTask[]> {
  const rows = await prisma.project.findMany({
    include: { hospital: { select: { hospitalName: true, hiraHospitalName: true } } },
  })
  return rows.map(r => ({
    taskType: 'PROJECT',
    refCode: r.projectCode,
    hospitalCode: r.hospitalCode,
    title: '구축 ' + (r.projectName ?? ''),
    dateForCode: r.contractDate ?? r.createdAt,
  }))
}

async function loadSiteVisits(): Promise<RawTask[]> {
  const rows = await prisma.siteVisit.findMany({
    include: { hospital: { select: { hospitalName: true, hiraHospitalName: true } } },
  })
  return rows.map(r => ({
    taskType: 'SITE_VISIT',
    refCode: r.siteVisitCode ?? `SV-${String(r.id).padStart(5, '0')}`,
    hospitalCode: r.hospitalCode,
    title: '답사 ' + (r.hospital.hospitalName || r.hospital.hiraHospitalName || ''),
    dateForCode: r.visitDate ?? r.requestDate ?? r.createdAt,
  }))
}

async function loadInstallPlans(): Promise<RawTask[]> {
  const rows = await prisma.installPlan.findMany({
    include: { hospital: { select: { hospitalName: true, hiraHospitalName: true } } },
  })
  return rows.map(r => ({
    taskType: 'INSTALL_PLAN',
    refCode: r.planCode ?? `IP-${String(r.id).padStart(5, '0')}`,
    hospitalCode: r.hospitalCode,
    title: r.hospital
      ? '설치계획(가안) ' + (r.hospital.hospitalName || r.hospital.hiraHospitalName || '')
      : '설치계획(가안)',
    dateForCode: r.requestDate ?? r.createdAt,
  }))
}

function assignTaskCodes(tasks: RawTask[]): { taskCode: string; raw: RawTask }[] {
  // Sort by dateForCode ASC, then taskType for stable ordering
  const sorted = [...tasks].sort((a, b) => {
    const diff = a.dateForCode.getTime() - b.dateForCode.getTime()
    if (diff !== 0) return diff
    return a.taskType.localeCompare(b.taskType)
  })

  const monthSeq: Record<string, number> = {}
  return sorted.map(raw => {
    const ym = getYYYYMM(raw.dateForCode)
    monthSeq[ym] = (monthSeq[ym] ?? 0) + 1
    const taskCode = `TASK-${ym}-${String(monthSeq[ym]).padStart(5, '0')}`
    return { taskCode, raw }
  })
}

async function main() {
  const mode = process.argv[2]
  if (mode !== '--dry-run' && mode !== '--execute') {
    console.log('사용법: npx ts-node --project tsconfig.scripts.json scripts/migrate-tasks.ts --dry-run|--execute')
    process.exit(1)
  }

  const [projects, siteVisits, installPlans] = await Promise.all([
    loadProjects(),
    loadSiteVisits(),
    loadInstallPlans(),
  ])

  console.log(`[PROJECT]      총 ${projects.length}건 처리 예정`)
  console.log(`[SITE_VISIT]   총 ${siteVisits.length}건 처리 예정`)
  console.log(`[INSTALL_PLAN] 총 ${installPlans.length}건 처리 예정`)

  const allTasks = [...projects, ...siteVisits, ...installPlans]
  const coded = assignTaskCodes(allTasks)

  console.log(`전체 총 ${coded.length}건 → tasks 테이블에 INSERT 예정\n`)

  console.log('샘플 (처음 10건):')
  coded.slice(0, 10).forEach(c => {
    console.log(
      `${c.taskCode} | ${c.raw.taskType.padEnd(12)} | ${c.raw.refCode.padEnd(20)} | ${c.raw.title}`
    )
  })

  if (mode === '--dry-run') {
    console.log('\n[dry-run] 실제 INSERT는 수행하지 않았습니다.')
    await prisma.$disconnect()
    return
  }

  // --execute
  const existing = await prisma.task.count()
  if (existing > 0) {
    console.error(`\n[중단] tasks 테이블에 이미 ${existing}건의 데이터가 있습니다. 비어있을 때만 실행 가능합니다.`)
    await prisma.$disconnect()
    process.exit(1)
  }

  await prisma.$transaction(async (tx) => {
    for (const c of coded) {
      await tx.task.create({
        data: {
          taskCode: c.taskCode,
          taskType: c.raw.taskType,
          refCode: c.raw.refCode,
          hospitalCode: c.raw.hospitalCode,
          title: c.raw.title,
        },
      })
    }
  })

  // 결과 출력
  const counts = await prisma.$queryRawUnsafe<{ task_type: string; count: bigint }[]>(
    `SELECT task_type, COUNT(*) as count FROM tasks GROUP BY task_type ORDER BY task_type`
  )
  console.log('\n[완료] INSERT 결과:')
  counts.forEach(r => console.log(`  ${r.task_type}: ${r.count}건`))

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
