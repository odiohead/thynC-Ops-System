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
      '영업현황(대시보드·도입현황)·병원 영업 정보 열람과 편집. VIEWER 등급은 열람만 가능(편집은 USER 등급 이상). 단 SEERS 소속 요건은 별개 축이라 이 권한으로 풀리지 않음',
  },
  // 카탈로그 v1.2 (2026-08-06)
  'inventory.admin': {
    label: '자재 관리자',
    module: '자재관리',
    description:
      '재고 입출고 처리(inventory.manage 포함) + 품목 마스터 등록·수정·삭제·Excel 가져오기·부자재 매핑 + 자재 기초 설정(품목 분류·인벤토리·입출고 유형·제조사·창고). 전표 사후 수정·재고 담당자 풀·UDI 문서 메타는 ADMIN 등급 필요(불포함)',
  },
  'maintenance.admin': {
    label: '유지보수 관리',
    module: '유지보수',
    description:
      '유지보수 건 삭제. 조회·등록·수정·완료 처리·파일·처리 기록은 원래 USER 등급 전원 가능이라 이 권한과 무관',
  },
  'install_plan.admin': {
    label: '설치계획 관리',
    module: '설치계획',
    description:
      '설치계획(가안) 건 삭제. 조회·등록·수정·상태 변경·파일은 원래 USER 등급 전원 가능이라 이 권한과 무관',
  },
  'project.admin': {
    label: '프로젝트 관리',
    module: '프로젝트',
    description:
      '프로젝트 삭제. 조회·등록·수정·장비·파일은 원래 USER 등급 전원 가능이라 이 권한과 무관',
  },
  'site_visit.admin': {
    label: '답사 관리',
    module: '답사',
    description:
      '답사 건 삭제. 조회·등록·수정·파일은 원래 USER 등급 전원 가능이라 이 권한과 무관',
  },
  'etc_task.admin': {
    label: '기타업무 관리',
    module: '기타업무',
    description:
      '기타업무 건 삭제. 조회·등록·수정·파일은 원래 USER 등급 전원 가능이라 이 권한과 무관',
  },
  // 카탈로그 v1.3 (2026-08-21)
  'weekly.access': {
    label: '주간업무 관리 접근',
    module: '주간업무',
    description:
      '메인 대시보드 우측 상단에 주간업무 관리(/weekly) 진입 아이콘 표시 + 페이지 접근 허용 (SEERS 소속 요건과 가산 — 소속으로 이미 접근 가능한 계정에도 아이콘 노출용으로 부여 가능). 편집은 USER 등급 이상(VIEWER 조회 전용) 원칙 유지',
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
