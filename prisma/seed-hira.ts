import * as XLSX from 'xlsx';
import * as path from 'path';
import * as os from 'os';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function excelDateToString(value: unknown): string | null {
  if (value == null) return null;
  const serial = Number(value);
  if (isNaN(serial) || serial <= 0) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function main() {
  const filePath = path.join(os.homedir(), 'Documents', 'hira_hospitals.xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  const dataRows = rows.slice(1).filter((row) => row[0] != null && row[0] !== '');

  const data = dataRows.map((row) => ({
    hiraId:       String(row[0]),
    name:         String(row[1]),
    typeCode:     String(row[2]),
    typeName:     String(row[3]),
    sidoCode:     String(row[4]),
    sidoName:     String(row[5]),
    sigunguCode:  String(row[6]),
    sigunguName:  String(row[7]),
    eupmyeondong: row[8]  != null ? String(row[8])  : null,
    postalCode:   row[9]  != null ? String(row[9])  : null,
    address:      row[10] != null ? String(row[10]) : null,
    phone:        row[11] != null ? String(row[11]) : null,
    openedAt:     excelDateToString(row[12]),
    totalDoctors: row[13] != null ? Number(row[13]) : null,
    coordinateX:  row[14] != null ? String(row[14]) : null,
    coordinateY:  row[15] != null ? String(row[15]) : null,
  }));

  console.log(`총 ${data.length}건 처리 시작...`);

  const result = await prisma.hiraHospital.createMany({
    data,
    skipDuplicates: true,
  });

  console.log(`완료: ${result.count}건 삽입, ${data.length - result.count}건 스킵`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
