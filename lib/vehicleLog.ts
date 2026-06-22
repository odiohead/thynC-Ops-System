import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * 같은 차량 운행일지의 distanceKm를 endAt 순서로 재계산하고,
 * Vehicle.lastOdometer를 최신(endAt 최대) 일지의 종료 주행거리로 갱신한다.
 * 일지 생성/수정/삭제 트랜잭션 안에서 호출.
 */
export async function recalcVehicleLogs(tx: Prisma.TransactionClient, vehicleId: number) {
  const logs = await tx.vehicleLog.findMany({
    where: { vehicleId },
    orderBy: { endAt: 'asc' },
    select: { id: true, endOdometer: true, distanceKm: true },
  })

  let prevEnd: number | null = null
  for (const log of logs) {
    const dist = prevEnd == null ? null : log.endOdometer - prevEnd
    if (log.distanceKm !== dist) {
      await tx.vehicleLog.update({ where: { id: log.id }, data: { distanceKm: dist } })
    }
    prevEnd = log.endOdometer
  }

  const last = logs.length ? logs[logs.length - 1].endOdometer : null
  await tx.vehicle.update({ where: { id: vehicleId }, data: { lastOdometer: last } })
}

/**
 * 종료 주행거리가 시간 순서상 앞/뒤 운행일지와 모순되지 않는지 검사.
 * 모순이면 사용자용 한글 메시지를 반환, 정상이면 null.
 * @param excludeLogId 수정 시 자기 자신 제외
 */
export async function checkOdometerConsistency(
  vehicleId: number,
  endAt: Date,
  endOdometer: number,
  excludeLogId?: number,
): Promise<string | null> {
  const exclude = excludeLogId ? { id: { not: excludeLogId } } : {}
  const prev = await prisma.vehicleLog.findFirst({
    where: { vehicleId, endAt: { lt: endAt }, ...exclude },
    orderBy: { endAt: 'desc' },
    select: { endOdometer: true },
  })
  if (prev && endOdometer < prev.endOdometer) {
    return `최종 주행거리(${endOdometer.toLocaleString()}km)가 직전 운행 기록(${prev.endOdometer.toLocaleString()}km)보다 작습니다.`
  }
  const next = await prisma.vehicleLog.findFirst({
    where: { vehicleId, endAt: { gt: endAt }, ...exclude },
    orderBy: { endAt: 'asc' },
    select: { endOdometer: true },
  })
  if (next && endOdometer > next.endOdometer) {
    return `최종 주행거리(${endOdometer.toLocaleString()}km)가 이후 운행 기록(${next.endOdometer.toLocaleString()}km)보다 큽니다.`
  }
  return null
}
