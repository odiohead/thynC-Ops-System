import { prisma } from '@/lib/prisma'
import { isSuperAdmin } from '@/lib/auth'
import { PERMISSIONS, type PermKey } from '@/lib/permissions'

/**
 * RBAC Lite 판정 헬퍼 (projects/rbac_design.md §6)
 *
 * 역할은 가산 전용(additive-only) — 권한을 더해줄 뿐 기존 접근을 빼앗지 않는다.
 * 등급(User.role)과의 합성은 호출부 책임:
 *   - 가산:      isAdminOrAbove(grade) OR  hasPermission(user, 'inventory.manage')
 *   - 자격 요건: isAdminOrAbove(grade) AND hasPermission(user, 'inventory.manage')
 */

const CACHE_TTL_MS = 60_000

// PM2 단일 프로세스 전제 (현행과 동일) — 역할·멤버 변경 API 성공 시 전체 무효화
const cache = new Map<string, { perms: Set<string>; expiresAt: number }>()

/** 역할·권한·멤버 변경 시 호출 — 전체 캐시 무효화 (사내 규모라 충분) */
export function invalidatePermissionCache(): void {
  cache.clear()
}

/**
 * 사용자의 유효 권한 키 집합 (활성 역할의 권한 합집합). 60초 인메모리 캐시.
 * 카탈로그(lib/permissions.ts)에 없는 키는 무시. 조회 실패 시 빈 집합(fail-closed).
 */
export async function getUserPermissions(userId: string): Promise<Set<string>> {
  const now = Date.now()
  const hit = cache.get(userId)
  if (hit && hit.expiresAt > now) return hit.perms

  try {
    const rows = await prisma.appUserRole.findMany({
      where: { userId, role: { isActive: true } },
      select: { role: { select: { permissions: { select: { permKey: true } } } } },
    })
    const perms = new Set<string>()
    for (const row of rows) {
      for (const p of row.role.permissions) {
        if (p.permKey in PERMISSIONS) perms.add(p.permKey)
      }
    }
    cache.set(userId, { perms, expiresAt: now + CACHE_TTL_MS })
    return perms
  } catch {
    return new Set()
  }
}

/** 권한 보유 판정. SUPER_ADMIN은 무조건 true (전권 등급 — 역할 부여 불필요) */
export async function hasPermission(
  user: { userId: string; role: string },
  perm: PermKey
): Promise<boolean> {
  if (isSuperAdmin(user.role)) return true
  const perms = await getUserPermissions(user.userId)
  return perms.has(perm)
}
