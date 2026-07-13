import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

interface ItemImportRow {
  name: string
  modelName: string | null
  cat1: string | null // 대분류
  cat2: string | null // 중분류
  cat3: string | null // 소분류
  manufacturer: string | null
  spec: string | null
  unit: string
  isSerialManaged: boolean
  refPrice: number | null
  categoryPath: string | null // 표시용
}

const SERIAL_TRUE = new Set(['시리얼', 'y', 'yes', 'true', 'o', '예', '1', 'ㅇ'])

function parseExcel(buffer: ArrayBuffer): ItemImportRow[] {
  const workbook = XLSX.read(buffer)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  // A=품목명, B=모델명, C=대분류, D=중분류, E=소분류, F=제조사, G=규격, H=단위, I=시리얼여부, J=참고단가 (1행 헤더 skip)
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][]

  const out: ItemImportRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue
    const name = String(row[0] ?? '').trim()
    if (!name) continue

    const cat1 = String(row[2] ?? '').trim() || null
    const cat2 = String(row[3] ?? '').trim() || null
    const cat3 = String(row[4] ?? '').trim() || null
    const serialRaw = String(row[8] ?? '').trim().toLowerCase()
    const price = Number(row[9] ?? 0)

    out.push({
      name,
      modelName: String(row[1] ?? '').trim() || null,
      cat1,
      cat2,
      cat3,
      manufacturer: String(row[5] ?? '').trim() || null,
      spec: String(row[6] ?? '').trim() || null,
      unit: String(row[7] ?? '').trim() || 'EA',
      isSerialManaged: SERIAL_TRUE.has(serialRaw),
      refPrice: Number.isFinite(price) && price > 0 ? Math.floor(price) : null,
      categoryPath: [cat1, cat2, cat3].filter(Boolean).join(' > ') || null,
    })
  }
  return out
}

/** 이름 경로(대>중>소)로 분류 노드 id 해석. 가장 깊이 매칭되는 노드 반환, 대분류부터 미매칭이면 null */
function resolveCategory(
  categories: { id: number; name: string; parentId: number | null }[],
  names: (string | null)[],
): { id: number | null; matchedPath: string } {
  let parentId: number | null = null
  let resolved: number | null = null
  const matched: string[] = []
  for (const nm of names) {
    if (!nm) break
    const found = categories.find((c) => c.parentId === parentId && c.name === nm)
    if (!found) break
    resolved = found.id
    parentId = found.id
    matched.push(nm)
  }
  return { id: resolved, matchedPath: matched.join(' > ') }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const preview = request.nextUrl.searchParams.get('preview') === 'true'

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const parsed = parseExcel(buffer)
    if (parsed.length === 0) {
      return NextResponse.json({ error: '파일에 유효한 데이터가 없습니다. 컬럼 순서를 확인하세요. (품목명, 모델명, 대분류, 중분류, 소분류, 제조사, 규격, 단위, 시리얼여부, 참고단가)' }, { status: 400 })
    }

    const [categories, manufacturers, existing] = await Promise.all([
      prisma.inventoryCategory.findMany({ select: { id: true, name: true, parentId: true } }),
      prisma.statusCode.findMany({ where: { category: 'MANUFACTURER' }, select: { id: true, name: true } }),
      prisma.inventoryItem.findMany({ select: { name: true } }),
    ])
    const mfrMap = new Map(manufacturers.map((m) => [m.name, m.id]))
    const existingNames = new Set(existing.map((e) => e.name))

    const newRows = parsed.filter((r) => !existingNames.has(r.name))
    const skipped = parsed.length - newRows.length

    // 미매칭 경고 수집
    const unknownCategories = new Set<string>()
    const unknownManufacturers = new Set<string>()
    for (const r of parsed) {
      if (r.categoryPath) {
        const { matchedPath } = resolveCategory(categories, [r.cat1, r.cat2, r.cat3])
        if (matchedPath !== r.categoryPath) unknownCategories.add(r.categoryPath)
      }
      if (r.manufacturer && !mfrMap.has(r.manufacturer)) unknownManufacturers.add(r.manufacturer)
    }

    if (preview) {
      return NextResponse.json({
        rows: parsed,
        total: parsed.length,
        newCount: newRows.length,
        skipped,
        unknownCategories: Array.from(unknownCategories),
        unknownManufacturers: Array.from(unknownManufacturers),
      })
    }

    // 실제 가져오기 — 채번은 시작 순번 1회 조회 후 로컬 증가
    const last = await prisma.inventoryItem.findFirst({
      where: { itemCode: { startsWith: 'ITEM-' } },
      orderBy: { itemCode: 'desc' },
      select: { itemCode: true },
    })
    let seq = last?.itemCode ? parseInt(last.itemCode.slice(5)) : 0

    const data = newRows.map((r) => {
      seq += 1
      return {
        itemCode: `ITEM-${String(seq).padStart(4, '0')}`,
        name: r.name,
        modelName: r.modelName,
        categoryId: resolveCategory(categories, [r.cat1, r.cat2, r.cat3]).id,
        manufacturerId: r.manufacturer ? (mfrMap.get(r.manufacturer) ?? null) : null,
        spec: r.spec,
        unit: r.unit,
        isSerialManaged: r.isSerialManaged,
        refPrice: r.refPrice,
      }
    })

    if (data.length > 0) {
      await prisma.inventoryItem.createMany({ data })
    }

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'CREATE',
      resource: 'inventory_item',
      resourceLabel: `Excel 일괄 등록 ${data.length}건`,
      after: { imported: data.length, skipped },
    })

    return NextResponse.json({
      imported: data.length,
      skipped,
      unknownCategories: Array.from(unknownCategories),
      unknownManufacturers: Array.from(unknownManufacturers),
    })
  } catch (error) {
    console.error('Inventory item import error:', error)
    return NextResponse.json({ error: '파일 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
