/**
 * CS 워크플로 코드 발번 — VOC접수 (VOC-YYYYMM-NNNN)
 * KST 기준 월별 시퀀스 (유지보수 MNT-/설치계획 IP- 발번 패턴과 동일).
 * 동시 생성 시 UNIQUE 충돌(P2002)은 호출부에서 재시도한다.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

/** KST 기준 YYYYMM */
function ymKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7).replace('-', '')
}

/** VOC접수 — VOC-YYYYMM-NNNN */
export async function nextVocCode(client: DbClient = prisma): Promise<string> {
  const prefix = `VOC-${ymKst()}-`
  const last = await client.vocReceipt.findFirst({
    where: { vocCode: { startsWith: prefix } },
    orderBy: { vocCode: 'desc' },
    select: { vocCode: true },
  })
  const seq = last ? parseInt(last.vocCode.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(seq).padStart(4, '0')}`
}
