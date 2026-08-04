import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { canManageStock } from '@/lib/inventory'
import { buildLedger } from '@/lib/udiLedger'
import { getLedgerDocMeta, renderLedgerDocx, ledgerFileName } from '@/lib/udiLedgerDocx'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — 입출고대장 docx 다운로드 (원본 양식 F707-1 템플릿 재사용)
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await canManageStock(user))) {
    return NextResponse.json({ error: '입출고대장 출력 권한이 없습니다.' }, { status: 403 })
  }

  const sp = new URL(req.url).searchParams
  const modelName = sp.get('modelName')
  if (!modelName) return NextResponse.json({ error: '모델을 지정하세요.' }, { status: 400 })

  const raw = sp.get('inventoryIds')
  const inventoryIds = raw
    ? raw.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n))
    : undefined

  const ledger = await buildLedger({
    modelName,
    inventoryIds: inventoryIds?.length ? inventoryIds : undefined,
    from: sp.get('from'),
    to: sp.get('to'),
  })
  if (!ledger) return NextResponse.json({ error: 'UDI가 등록된 품목이 없는 모델입니다.' }, { status: 404 })

  const meta = await getLedgerDocMeta()

  let buf: Buffer
  try {
    buf = await renderLedgerDocx(ledger, meta)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `대장 생성 실패: ${msg}` }, { status: 500 })
  }

  // 품질기록 산출물이므로 문서 생성 사실을 감사 로그에 남긴다 (AuditAction에 READ가 없어 CREATE 사용)
  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'inventory:udi_ledger',
    resourceLabel: `${ledger.header.modelName} — 입출고대장 docx 생성`,
    after: {
      modelName: ledger.model.modelName,
      udiList: ledger.model.udiList,
      inventories: ledger.inventoryNames,
      inTotal: ledger.inTotal,
      outTotal: ledger.outTotal,
      currentStock: ledger.currentStock,
    },
  })

  const fileName = ledgerFileName(ledger)

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  })
}
