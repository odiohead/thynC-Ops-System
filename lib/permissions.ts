/**
 * 기능 권한 카탈로그 — RBAC Lite 단일 소스 (projects/rbac_design.md §5)
 *
 * - DB(app_role_permissions)에는 키 문자열만 저장하고, 라벨·모듈 그룹은 여기서만 정의한다
 *   (키 오타·라벨 불일치 원천 차단 — lib/ticket-shared.ts 패턴).
 * - 새 기능의 권한 요구는 전용 풀 테이블 신설이 아니라 이 카탈로그에 키 추가로 처리한다.
 * - 카탈로그에서 삭제된 키는 판정 시 무시된다 (DB 잔존 행은 무해).
 * - 클라이언트 안전(서버 의존성 없음) — 설정 UI가 직접 import해 체크박스를 렌더한다.
 */
export const PERMISSIONS = {
  // 자재관리 (Phase 2 파일럿)
  'inventory.manage': {
    label: '재고 입출고 처리',
    module: '자재관리',
    description:
      '입고·출고·이동 전표 등록/취소, 다품목·Excel 일괄 입출고, 시리얼 개체 태그·메모 정정, UDI 입출고대장 조회·출력. 전표 사후 수정·품목 마스터·자재 설정은 ADMIN 등급 필요(불포함)',
  },
  // Phase 3 확산 (2026-08-04)
  'vehicle.manage': {
    label: '차량 관리',
    module: '차량',
    description:
      '차량 마스터 등록·수정·삭제·활성 토글 (설정 > 차량 관리). 예약·운행일지는 원래 전 직원 가능이라 무관',
  },
  'sales.access': {
    label: '영업 정보 접근',
    module: '영업',
    description:
      '영업현황(대시보드·도입현황)·병원 영업 정보 열람과 편집. 단 SEERS 소속 요건은 별개 축이라 이 권한으로 풀리지 않음',
  },
} as const

export type PermKey = keyof typeof PERMISSIONS

export const PERM_KEYS = Object.keys(PERMISSIONS) as PermKey[]

/** 설정 UI용 — 카탈로그를 모듈별 그룹으로 변환 */
export function permissionsByModule(): {
  module: string
  perms: { key: PermKey; label: string; description: string }[]
}[] {
  const groups = new Map<string, { key: PermKey; label: string; description: string }[]>()
  for (const key of PERM_KEYS) {
    const { label, module, description } = PERMISSIONS[key]
    if (!groups.has(module)) groups.set(module, [])
    groups.get(module)!.push({ key, label, description })
  }
  return Array.from(groups.entries()).map(([module, perms]) => ({ module, perms }))
}
