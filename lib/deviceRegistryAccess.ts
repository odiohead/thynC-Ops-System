import { isUserOrAbove, isAdminOrAbove, type JWTPayload } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'

/**
 * 디바이스 원장 접근 권한 (서버 강제) — projects/hospital_device_registry_design.md §8.1
 *
 * 조회(read)  : 로그인 전체 — 조직 게이트 없음 (nav `{SEERS}`는 UX일 뿐)
 * 편집(write) : `isUserOrAbove` (VIEWER 읽기 전용 원칙) — 등록·회수·이동·교체·임포트·병동 추가·메모
 * 관리(admin) : `isAdminOrAbove` OR (`isUserOrAbove` AND `device.admin`) — RBAC Lite 가산 합성
 *               이벤트 정정·취소, 임포트 배치 취소·업무일자 정정, 개체 식별정보 보정, 병동 비활성·삭제
 * 마스터(회수 사유·모델 마스터 5필드)는 이 게이트가 아니라 라우트에서 `isAdminOrAbove`로 직접 판정한다.
 * checkWeeklyAccess/checkSalesAccess 선례와 같은 반환 계약 — 통과면 null, 차단이면 `{ status, error }`.
 */

export type DeviceRegistryAccessDenial = { status: number; error: string }

export async function checkDeviceRegistryAccess(
  user: JWTPayload,
  opts?: { write?: boolean; admin?: boolean }
): Promise<DeviceRegistryAccessDenial | null> {
  if (opts?.admin) {
    if (isAdminOrAbove(user.role)) return null
    if (isUserOrAbove(user.role) && (await hasPermission(user, 'device.admin'))) return null
    return {
      status: 403,
      error: '이 작업은 ADMIN 이상 또는 기기 현황 관리 권한 보유자(USER 등급 이상)만 가능합니다.',
    }
  }
  if (opts?.write && !isUserOrAbove(user.role)) {
    return { status: 403, error: '기기 현황 편집은 USER 등급 이상만 가능합니다 (VIEWER는 조회 전용).' }
  }
  return null
}

/** UI 게이트 프로브(`GET /api/devices/can-manage`)·서버 컴포넌트용 — `{ canWrite, canAdmin }` */
export async function getDeviceRegistryCapabilities(user: JWTPayload | null): Promise<{ canWrite: boolean; canAdmin: boolean }> {
  if (!user) return { canWrite: false, canAdmin: false }
  const canWrite = (await checkDeviceRegistryAccess(user, { write: true })) === null
  const canAdmin = canWrite && (await checkDeviceRegistryAccess(user, { admin: true })) === null
  return { canWrite, canAdmin }
}
