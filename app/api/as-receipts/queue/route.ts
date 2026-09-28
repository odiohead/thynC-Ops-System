import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'
import { canEditAsReceipt } from '@/lib/asReceipt'
import { AS_QUEUE_BUCKETS, AS_DEVICE_GROUP_CODE_LIST, AS_DEVICE_GROUP_TO_CODE, asDeviceGroupOf, asReceiptTags, parseAsQueueBucket, type AsDeviceGroupCode, type AsQueueBucket } from '@/lib/asReceiptShared'
import { asDetailItemSelect, asQueueBucketWhere, asQueueOrderBy, asDeviceGroupWhere, shapeAsDetailItems } from '@/lib/asReceiptQueue'

export const dynamic = 'force-dynamic'

/**
 * AS 수리대기 큐 (2026-09-28 — as_repair_queue_design.md §5.1) — 라인 1행 = 기기 1대
 * GET ?bucket=WAITING|INCOMING &group=ECG|SPO2|ETC &hospital=코드|이름 &priority=1 &page &pageSize
 * - counts: 버킷 × 기기군 전체 건수(필터 무관 — 헤더용). 기기군 판정은 클라이언트 `asDeviceGroupOf`와 같은 규칙(서버 where는 asDeviceGroupWhere)
 * - items: 상세 라인 select 그대로(`device.unit` 정형화) + receipt 헤더 요약(tags·canEdit)
 * 권한: 조회 전원(AS업무 nav와 동일)
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const bucket = parseAsQueueBucket(sp.get('bucket'))
  const groupRaw = sp.get('group')
  const group = (AS_DEVICE_GROUP_CODE_LIST as readonly string[]).includes(groupRaw ?? '') ? (groupRaw as AsDeviceGroupCode) : null // 미지정 = 전 기기군
  const hospital = sp.get('hospital')?.trim() || null
  const priority = sp.get('priority') === '1'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '50') || 50))

  // 건수 — 버킷별 라인을 최소 select로 읽어 JS에서 기기군 접기(두 버킷 합쳐 수천 행 이내, 클라이언트 판정 함수와 동일 규칙 보장)
  const counts: Record<AsQueueBucket, Record<AsDeviceGroupCode, number>> = { WAITING: { ECG: 0, SPO2: 0, ETC: 0 }, INCOMING: { ECG: 0, SPO2: 0, ETC: 0 } }
  await Promise.all(
    AS_QUEUE_BUCKETS.map(async (b) => {
      const rows = await prisma.asReceiptItem.findMany({
        where: asQueueBucketWhere(b),
        select: { serialNo: true, deviceKind: true, device: { select: { deviceInfo: { select: { deviceName: true } } } } },
      })
      for (const r of rows) {
        const code = AS_DEVICE_GROUP_TO_CODE[asDeviceGroupOf(r.device?.deviceInfo.deviceName, r.deviceKind, r.serialNo)]
        counts[b][code]++
      }
    })
  )

  const where: Prisma.AsReceiptItemWhereInput = {
    AND: [
      asQueueBucketWhere(bucket),
      ...(group ? [asDeviceGroupWhere(group)] : []),
      ...(hospital ? [{ receipt: { OR: [{ hospitalCode: hospital }, { hospital: { hospitalName: { contains: hospital } } }] } }] : []),
      ...(priority ? [{ receipt: { priorityRepair: true } }] : []),
    ],
  }
  const [total, rows] = await Promise.all([
    prisma.asReceiptItem.count({ where }),
    prisma.asReceiptItem.findMany({
      where,
      orderBy: asQueueOrderBy(bucket),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...asDetailItemSelect,
        receipt: {
          select: {
            id: true, asCode: true, hospitalCode: true, hospital: { select: { hospitalName: true } },
            receiptDate: true, category: true, pickupMethod: true, pickupTrackingNo: true, pickedUpAt: true, receivedAt: true,
            preReplace: true, priorityRepair: true, firmwareUpdate: true, accessoryIncluded: true, combinedPack: true,
            status: { select: { id: true, name: true, color: true, ticketStatus: true } },
            createdById: true,
          },
        },
      },
    }),
  ])

  const adminPerm = isUserOrAbove(user.role) && (await hasPermission(user, 'as_receipt.admin'))
  const items = shapeAsDetailItems(rows).map((i) => {
    const { receipt, ...line } = i
    return {
      ...line,
      receipt: {
        id: receipt.id, asCode: receipt.asCode, hospitalCode: receipt.hospitalCode, hospitalName: receipt.hospital.hospitalName,
        receiptDate: receipt.receiptDate, category: receipt.category, pickupMethod: receipt.pickupMethod, pickupTrackingNo: receipt.pickupTrackingNo, pickedUpAt: receipt.pickedUpAt, receivedAt: receipt.receivedAt,
        status: receipt.status, tags: asReceiptTags(receipt),
        canEdit: canEditAsReceipt(user, { createdById: receipt.createdById, status: receipt.status }, adminPerm), // 처리방법 초안 활성 판정(draft-lines와 동일). 수리완료·폐기는 종결 무관(role만)
      },
    }
  })

  return NextResponse.json({ counts, items, total, page, pageSize })
}
