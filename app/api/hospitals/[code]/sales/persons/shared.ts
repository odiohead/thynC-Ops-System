import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkSalesAccess } from '@/lib/sales'
import type { JWTPayload } from '@/lib/auth'

/** 인적정보 공용 — 파서·가드 (영업/CRM v4 §3.2) */

export const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
export const intOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v))
  return Number.isInteger(n) && n >= 0 ? n : null
}

export function parsePersonBody(body: Record<string, unknown>) {
  return {
    name: str(body.name),
    personGroupId: intOrNull(body.personGroupId),
    specialty: str(body.specialty),
    phone: str(body.phone),
    email: str(body.email),
    memo: str(body.memo),
  }
}

export function parseAffiliationBody(body: Record<string, unknown>) {
  return {
    title: str(body.title),
    department: str(body.department),
    isPrimary: body.isPrimary === true,
    note: str(body.note),
  }
}

/** personGroupId가 PERSON_GROUP 카테고리인지 검증 */
export async function validatePersonGroup(personGroupId: number | null): Promise<string | null> {
  if (personGroupId === null) return null
  const code = await prisma.statusCode.findUnique({ where: { id: personGroupId }, select: { category: true } })
  return code?.category === 'PERSON_GROUP' ? null : '직군 값이 올바르지 않습니다.'
}

export type PersonGuard =
  | { error: NextResponse }
  | { user: JWTPayload; affId: number; affiliation: { id: number; personId: number; hospitalCode: string; isCurrent: boolean } }

/** 권한 + 소속 행이 해당 병원 것인지 확인 */
export async function guardAffiliation(request: NextRequest, code: string, rawAffId: string): Promise<PersonGuard> {
  const user = await getAuthUser(request)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const denial = await checkSalesAccess(user)
  if (denial) return { error: NextResponse.json({ error: denial.error }, { status: denial.status }) }
  const affId = parseInt(rawAffId)
  if (isNaN(affId)) return { error: NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 }) }
  const affiliation = await prisma.personAffiliation.findUnique({
    where: { id: affId },
    select: { id: true, personId: true, hospitalCode: true, isCurrent: true },
  })
  if (!affiliation || affiliation.hospitalCode !== code) {
    return { error: NextResponse.json({ error: '소속 정보를 찾을 수 없습니다.' }, { status: 404 }) }
  }
  return { user, affId, affiliation }
}
