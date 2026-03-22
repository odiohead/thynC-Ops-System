/**
 * 프로젝트 마이그레이션 스크립트
 * 사용법: npx ts-node scripts/migrate-projects.ts --dry-run
 *         npx ts-node scripts/migrate-projects.ts --execute
 */

import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

const prisma = new PrismaClient();
const EXCEL_PATH = '/home/ubuntu/project_list.xlsx';
const SKIP_HOSPITALS = ['동아대학교병원'];

// Excel serial → JS Date 변환
function excelSerialToDate(serial: number | null | undefined): Date | null {
  if (!serial || isNaN(serial)) return null;
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  // 시간이 00:00:00(UTC 기준)인 경우 날짜만 있는 것으로 간주
  // serial이 정수인 경우만 저장 (시간 정보 없음)
  if (date.getTime() === 0) return null;
  return date;
}

// 날짜 유효성 검사 (00:00:00만 있으면 null)
function toDateOrNull(serial: number | null | undefined): Date | null {
  if (!serial || isNaN(serial)) return null;
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date;
}

// 숫자 추출 (NaN이면 null)
function toIntOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === '' || val === '-') return null;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? null : n;
}

// 차수 추출: '1차' → 1
function parseOrderNumber(val: string): number {
  const match = String(val).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

// 설치업체 null 처리
function parseContractor(val: unknown): string | null {
  if (val === null || val === undefined || val === 0 || val === '0' || String(val).trim() === '') return null;
  return String(val).trim();
}

interface ExcelRow {
  hospitalName: string;
  orderStr: string;
  contractDateSerial: number | null;
  contractType: string | null;
  statusLabel: string | null;
  wardCount: number | null;
  bedCount: number | null;
  gatewayCount: number | null;
  builderName: string | null;
  builderStartSerial: number | null;
  builderEndSerial: number | null;
  contractorName: string | null;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const isExecute = process.argv.includes('--execute');

  if (!isDryRun && !isExecute) {
    console.error('사용법: npx ts-node scripts/migrate-projects.ts --dry-run');
    console.error('        npx ts-node scripts/migrate-projects.ts --execute');
    process.exit(1);
  }

  // ── Excel 로드 ──────────────────────────────────────────────
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
  const dataRows = rawRows.slice(1).filter(r => r[0]); // 헤더 제거 + 빈 행 제거

  console.log(`\n===== 프로젝트 마이그레이션 ${isDryRun ? '[DRY-RUN]' : '[EXECUTE]'} =====\n`);
  console.log(`1. 총 Excel 행 수: ${dataRows.length}개`);

  // ── Excel 파싱 ──────────────────────────────────────────────
  const rows: ExcelRow[] = dataRows.map(r => ({
    hospitalName: String(r[0] ?? '').trim(),
    orderStr: String(r[1] ?? '1차').trim(),
    contractDateSerial: (r[2] as number) ?? null,
    contractType: r[3] ? String(r[3]).trim() : null,
    statusLabel: r[4] ? String(r[4]).trim() : null,
    wardCount: toIntOrNull(r[5]),
    bedCount: toIntOrNull(r[6]),
    gatewayCount: toIntOrNull(r[7]),
    builderName: null, // 담당자는 null 처리
    builderStartSerial: (r[9] as number) ?? null,
    builderEndSerial: (r[10] as number) ?? null,
    contractorName: parseContractor(r[11]),
  }));

  // SKIP 병원 제외
  const filteredRows = rows.filter(r => !SKIP_HOSPITALS.includes(r.hospitalName));
  if (rows.length !== filteredRows.length) {
    console.log(`   → 제외 병원(${SKIP_HOSPITALS.join(', ')}): ${rows.length - filteredRows.length}건 스킵`);
  }

  // ── DB 데이터 로드 ──────────────────────────────────────────
  const hospitals = await prisma.hospital.findMany({
    select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true },
  });
  const buildStatuses = await prisma.buildStatus.findMany();
  const contractors = await prisma.contractor.findMany();

  // ── 병원 매핑 ───────────────────────────────────────────────
  function findHospital(name: string) {
    // 1) operatingName 정확 일치
    let h = hospitals.find(h => h.hospitalName === name);
    if (h) return { hospital: h, method: '정확일치(운영명)' };
    // 2) hiraName 정확 일치
    h = hospitals.find(h => h.hiraHospitalName === name);
    if (h) return { hospital: h, method: '정확일치(심평원명)' };
    // 3) contains
    h = hospitals.find(h => h.hospitalName.includes(name) || name.includes(h.hospitalName));
    if (h) return { hospital: h, method: '부분일치' };
    return null;
  }

  const matchedList: { row: ExcelRow; hospitalCode: string; dbName: string; method: string }[] = [];
  const unmatchedList: string[] = [];

  for (const row of filteredRows) {
    const result = findHospital(row.hospitalName);
    if (result) {
      matchedList.push({
        row,
        hospitalCode: result.hospital.hospitalCode,
        dbName: result.hospital.hospitalName,
        method: result.method,
      });
    } else {
      if (!unmatchedList.includes(row.hospitalName)) {
        unmatchedList.push(row.hospitalName);
      }
    }
  }

  // ── 병원 매핑 결과 출력 ─────────────────────────────────────
  console.log(`\n2. 병원명 매핑 성공 (${matchedList.length}건):`);
  matchedList.forEach(m =>
    console.log(`   [${m.method}] ${m.row.hospitalName} → ${m.hospitalCode} ${m.dbName}`)
  );

  console.log(`\n3. 병원명 매핑 실패 (${unmatchedList.length}건):`);
  if (unmatchedList.length === 0) {
    console.log('   (없음)');
  } else {
    unmatchedList.forEach(n => console.log(`   ✗ ${n}`));
  }

  // ── 진행상태 매핑 ───────────────────────────────────────────
  const uniqueStatuses = Array.from(new Set(filteredRows.map(r => r.statusLabel).filter(Boolean))) as string[];
  console.log('\n4. 진행상태 고유값 및 BuildStatus 매핑:');
  uniqueStatuses.forEach(label => {
    const found = buildStatuses.find(s => s.label === label);
    console.log(`   ${found ? '✅' : '❌'} "${label}" → ${found ? `id:${found.id} (${found.label})` : '매핑 실패'}`);
  });

  // ── 설치업체 매핑 ───────────────────────────────────────────
  const uniqueContractors = Array.from(new Set(
    filteredRows.map(r => r.contractorName).filter(Boolean)
  )) as string[];
  console.log('\n5. 설치업체 고유값 및 Contractor 매핑:');
  uniqueContractors.forEach(name => {
    const found = contractors.find(c => c.name === name);
    console.log(`   ${found ? '✅' : '❌'} "${name}" → ${found ? `id:${found.id} (${found.name})` : '매핑 실패'}`);
  });

  // ── 최종 생성 가능 수 ───────────────────────────────────────
  console.log(`\n6. 최종 생성 가능한 프로젝트 수: ${matchedList.length}개 (병원 매핑 성공 기준)`);

  if (isDryRun) {
    console.log('\n[DRY-RUN 완료] 실제 DB에 반영하려면 --execute 옵션으로 실행하세요.\n');
    await prisma.$disconnect();
    return;
  }

  // ── EXECUTE ─────────────────────────────────────────────────
  console.log('\n[EXECUTE] DB에 프로젝트 생성 시작...\n');

  // projectCode 생성용: 현재 최대 코드 조회
  const existingProjects = await prisma.project.findMany({ select: { projectCode: true } });
  let codeSeq = existingProjects.length;

  let createdCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (const m of matchedList) {
    const { row, hospitalCode } = m;
    const orderNumber = parseOrderNumber(row.orderStr);
    const contractDate = toDateOrNull(row.contractDateSerial);
    const builderStart = toDateOrNull(row.builderStartSerial);
    const builderEnd = toDateOrNull(row.builderEndSerial);

    const buildStatus = row.statusLabel
      ? buildStatuses.find(s => s.label === row.statusLabel) ?? null
      : null;
    const contractor = row.contractorName
      ? contractors.find(c => c.name === row.contractorName) ?? null
      : null;

    // 중복 체크 (같은 병원 + 차수)
    const existing = await prisma.project.findFirst({
      where: { hospitalCode, orderNumber },
    });
    if (existing) {
      console.log(`   SKIP (중복): ${row.hospitalName} ${row.orderStr} → ${existing.projectCode}`);
      skippedCount++;
      continue;
    }

    codeSeq++;
    const projectCode = `PROJ-${String(codeSeq).padStart(6, '0')}`;
    const projectName = `${m.dbName} ${row.orderStr}`;

    try {
      await prisma.project.create({
        data: {
          projectCode,
          projectName,
          hospitalCode,
          orderNumber,
          contractDate,
          contractType: row.contractType,
          wardCount: row.wardCount,
          bedCount: row.bedCount,
          gatewayCount: row.gatewayCount,
          builderNameManual: null,
          startDate: builderStart,
          endDateExpected: builderEnd,
          buildStatusId: buildStatus?.id ?? null,
          constructorId: contractor?.id ?? null,
        },
      });
      console.log(`   ✅ 생성: ${projectCode} ${projectName}`);
      createdCount++;
    } catch (err) {
      const msg = `${row.hospitalName} ${row.orderStr}: ${err}`;
      console.error(`   ❌ 오류: ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`\n===== 실행 완료 =====`);
  console.log(`생성: ${createdCount}건 / 스킵: ${skippedCount}건 / 오류: ${errors.length}건`);
  if (errors.length > 0) {
    console.log('\n[오류 목록]');
    errors.forEach(e => console.log('  -', e));
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
