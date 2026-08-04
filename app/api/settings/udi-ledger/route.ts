import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { getLedgerDocMeta, DEFAULT_DOC_META, DOC_META_KEY, type LedgerDocMeta } from '@/lib/udiLedgerDocx'

export const dynamic = 'force-dynamic'

// GET — 입출고대장 문서 메타(문서번호·양식번호·개정이력)
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ meta: await getLedgerDocMeta(), defaults: DEFAULT_DOC_META })
}

// PUT — 문서 메타 수정 (ADMIN 이상)
export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

  if (!String(body.docNumber ?? '').trim()) {
    return NextResponse.json({ error: '문서번호를 입력하세요.' }, { status: 400 })
  }
  if (!String(body.formNumber ?? '').trim()) {
    return NextResponse.json({ error: '양식번호를 입력하세요.' }, { status: 400 })
  }

  const revisions: LedgerDocMeta['revisions'] = Array.isArray(body.revisions)
    ? body.revisions
        .map((raw: unknown) => {
          const r = (raw ?? {}) as Record<string, unknown>
          return {
            rev: String(r.rev ?? '').trim(),
            date: String(r.date ?? '').trim(),
            note: String(r.note ?? '').trim(),
          }
        })
        .filter((r: { rev: string }) => r.rev !== '')
    : []

  const meta: LedgerDocMeta = {
    docNumber: str(body.docNumber, DEFAULT_DOC_META.docNumber),
    formNumber: str(body.formNumber, DEFAULT_DOC_META.formNumber),
    revision: str(body.revision, DEFAULT_DOC_META.revision),
    effectiveFrom: str(body.effectiveFrom, DEFAULT_DOC_META.effectiveFrom),
    companyName: str(body.companyName, DEFAULT_DOC_META.companyName),
    revisions,
  }

  const before = await getLedgerDocMeta()

  await prisma.appSetting.upsert({
    where: { key: DOC_META_KEY },
    create: { key: DOC_META_KEY, value: JSON.stringify(meta) },
    update: { value: JSON.stringify(meta) },
  })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:udi_ledger_doc_meta',
    resourceLabel: `입출고대장 문서 메타 (${meta.docNumber} / ${meta.formNumber}(rev.${meta.revision}))`,
    before,
    after: meta,
  })

  return NextResponse.json({ meta })
}
