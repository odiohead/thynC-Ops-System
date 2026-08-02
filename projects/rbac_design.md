# 기능 역할(Role) 권한 체계 설계안 — RBAC Lite

> **상태: 설계 검토 대기 — 미착수**
> 작성 2026-08-03. 사용자 승인 후 Phase 1부터 구현 (CLAUDE.md 설계 게이트).

---

## 1. 배경 — 현재 권한 체계의 문제

현재 "권한"은 4개 축에 흩어져 있고, 새 기능이 생길 때마다 전용 풀 테이블이나 개인 플래그가 하나씩 늘어나는 구조다.

| 축 | 실체 | 현재 구현 |
|---|---|---|
| `User.role` | **등급(grade)** — 상하 서열이지 직무가 아님 | `SUPER_ADMIN`/`ADMIN`/`USER`/`VIEWER`, `isAdminOrAbove` 등 헬퍼가 98개 파일에서 호출 |
| 소속(Organization) | 회사 경계 게이트 | 영업·상담이력·AI 어시스턴트 = SEERS 전용 (`lib/sales.ts`, `lib/ai/access.ts`) |
| 지정 풀 | 사실상의 기능 역할 | `inventory_managers`(재고 처리 권한), `field_engineers` 4종(배정 후보) |
| 개인 플래그 | 단발성 예외 | `users.vehicle_reservation_blocked` 등 |

문제 요약:
- 기능 권한을 줄 방법이 "등급 승격" 또는 "전용 풀 테이블 신설" 둘뿐 — 전자는 과잉 부여, 후자는 테이블·설정 페이지·API가 기능마다 복제됨
- `canManageStock`(ADMIN **또는** 재고담당 풀)처럼 이미 RBAC 흉내를 내는 코드가 존재 — 체계 없이 반복 중
- 메뉴 노출은 `nav_menu_items.allowed_roles/allowed_org_codes`로 DB 제어 중이나 등급·소속 단위뿐, 기능 권한 단위 노출 제어 불가

## 2. 목표 / 비목표

### 목표
1. **역할(Role)을 DB에서 정의**하고, 역할에 **권한(permission) 키 묶음**을 할당하고, 사용자에게 역할을 N:M 부여
2. 코드에는 `hasPermission(user, 'inventory.manage')` 단일 헬퍼로 판정
3. 메뉴 노출을 권한 단위로도 제어 가능하게 확장
4. **가산 전용(additive-only)**: 역할은 권한을 *더해줄 뿐* 기존 접근을 *빼앗지 않는다* → 기존 사용자 경험 회귀 리스크 구조적으로 0

### 비목표 (이번에 안 하는 것 — 명시적 범위 제외)
- ❌ 등급 4단계(`User.role`) 변경·폐지 — 그대로 유지. 98개 파일의 기존 등급 체크 일괄 수정 없음
- ❌ AWS IAM 수준의 policy document / resource ARN / condition / deny 규칙 — 과잉
- ❌ SEERS 소속 게이트 변경 — 회사 경계는 별개 축으로 유지
- ❌ `field_engineers` 풀 변경 — 이건 권한이 아니라 **배정 후보 목록(데이터)**. 역할 통합은 선택적 후속 과제
- ❌ JWT 페이로드 변경 — 권한은 DB 조회(+캐시), 토큰에 넣지 않음 (7일 토큰이라 변경 반영 지연 문제)
- ❌ 권한으로 접근을 **제한**하는 용도 (예: ADMIN인데 특정 메뉴 차단) — 가산 전용 원칙 위반, 필요해지면 별도 설계

## 3. 용어 정리

| 용어 | 의미 | 비고 |
|---|---|---|
| **등급 (Grade)** | 기존 `User.role` — SUPER_ADMIN/ADMIN/USER/VIEWER | DB 컬럼·코드 식별자 유지, **UI 라벨만 추후 '등급'으로 정리** (Assignment Group 라벨 변경 선례와 동일 방식, 선택 후속) |
| **역할 (Role)** | 신설 — 직무 단위 권한 묶음 (예: 재고담당, 티켓운영) | DB `app_roles`. 코드 식별자는 `appRole`로 통일해 기존 `role`(등급)과 충돌 방지 |
| **권한 (Permission)** | 기능 단위 키 (예: `inventory.manage`) | **코드 카탈로그가 단일 소스** (`lib/permissions.ts`) — DB에는 키 문자열만 저장 |

## 4. 데이터 모델 (public 스키마, 3테이블)

```prisma
// 역할 정의
model AppRole {
  id          Int      @id @default(autoincrement())
  code        String   @unique @db.VarChar(50)   // 예: INVENTORY_MANAGER (대문자 스네이크)
  name        String   @db.VarChar(100)          // 예: 재고담당
  description String?  @db.VarChar(300)
  isActive    Boolean  @default(true) @map("is_active")
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  permissions AppRolePermission[]
  users       AppUserRole[]
  @@map("app_roles")
  @@schema("public")
}

// 역할 ↔ 권한 키
model AppRolePermission {
  id      Int     @id @default(autoincrement())
  roleId  Int     @map("role_id")
  permKey String  @map("perm_key") @db.VarChar(100)  // lib/permissions.ts 카탈로그의 키
  role    AppRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  @@unique([roleId, permKey])
  @@map("app_role_permissions")
  @@schema("public")
}

// 사용자 ↔ 역할
model AppUserRole {
  id        Int      @id @default(autoincrement())
  userId    String   @map("user_id")
  roleId    Int      @map("role_id")
  createdAt DateTime @default(now()) @map("created_at")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      AppRole  @relation(fields: [roleId], references: [id], onDelete: Cascade)
  @@unique([userId, roleId])
  @@map("app_user_roles")
  @@schema("public")
}
```

- 마이그레이션은 CLAUDE.md 규칙대로 SQL 직접 실행 + 수동 마이그레이션 파일 + `migrate resolve`
- DB에 저장 안 된 권한 키(카탈로그에서 삭제된 키)는 판정 시 무시 — 카탈로그가 단일 소스

## 5. 권한 카탈로그 — `lib/permissions.ts` (신설, 단일 소스)

티켓의 `lib/ticket-shared.ts` 패턴을 따른다. 라벨·모듈 그룹을 코드에 정의하고, 설정 UI는 이 카탈로그를 읽어 체크박스를 렌더한다 (DB에 권한 마스터 테이블 없음 — 키 오타·라벨 불일치 원천 차단).

```ts
export const PERMISSIONS = {
  // 자재관리 (Phase 2 파일럿)
  'inventory.manage':      { label: '재고 입출고 처리',        module: '자재관리' },
  // 이후 모듈 편입 시 여기에 추가 (Phase 3에서 모듈별 순차)
} as const

export type PermKey = keyof typeof PERMISSIONS
```

**v1 카탈로그는 의도적으로 최소** — 파일럿(자재관리) 1키로 시작. "권한 키를 미리 수십 개 정의"는 하지 않는다(빈 체계 방지). 모듈이 편입될 때 그 모듈의 키를 추가하는 방식.

## 6. 판정 헬퍼 — `lib/appRoles.ts` (신설)

```ts
/** 사용자의 유효 권한 키 집합 (활성 역할의 권한 합집합). 60초 인메모리 캐시 */
export async function getUserPermissions(userId: string): Promise<Set<string>>

/** 권한 보유 판정. SUPER_ADMIN은 무조건 true (AdministratorAccess 상당) */
export async function hasPermission(
  user: { userId: string; role: string },
  perm: PermKey
): Promise<boolean>
```

판정 규칙:
1. `SUPER_ADMIN` → 항상 true (전권 등급, 역할 부여 불필요)
2. 그 외 → 활성(`isActive`) 역할들의 권한 합집합에 `perm` 포함 여부
3. **등급과의 합성은 호출부 책임** — 헬퍼는 역할 권한만 판정한다. 예:
   - `canManageStock` = `isAdminOrAbove(grade)` **OR** `hasPermission('inventory.manage')` (가산)
   - `canEditTxMeta` = `isAdminOrAbove(grade)` **AND** `hasPermission('inventory.manage')` (자격 요건)

캐시: 모듈 스코프 `Map<userId, {perms, expiresAt}>` TTL 60초. 역할·멤버 변경 API 성공 시 전체 캐시 무효화(사내 규모라 충분, PM2 단일 프로세스 전제 — 현행과 동일). 실서비스 영향 없는 순수 조회라 실패 시 빈 집합 반환(fail-closed).

## 7. 설정 UI — `/settings/roles` (SUPER_ADMIN 전용)

소속 관리·메뉴 관리와 같은 등급 정책(권한 부여 행위 자체가 민감). 한 페이지 3구역:

1. **역할 목록** — 이름·코드·설명·활성·순서 CRUD (StatusCodeManager 조작감 준용). 멤버나 권한이 남아 있는 역할 삭제 시 확인 후 Cascade
2. **권한 할당** — 역할 선택 시 카탈로그를 모듈별 그룹 체크박스로 렌더 → 체크/해제 즉시 저장
3. **멤버 할당** — 역할 선택 시 부여된 사용자 목록 + 추가(활성 사용자 검색)/제거

API: `/api/settings/app-roles` (CRUD) + `/api/settings/app-roles/[id]/permissions` (PUT) + `/api/settings/app-roles/[id]/members` (POST/DELETE). 전부 SUPER_ADMIN 게이트 + `logAudit` 기록 (권한 변경은 감사 대상).

부가 노출: 계정관리(`/users`) 상세에 해당 사용자의 보유 역할 배지 표시 (읽기 전용, 편집은 역할 관리에서).

nav 반영: 설정 하위 '역할 관리' 메뉴 1행 추가 — `nav_menu_items` (dev·PROD DB) + 시드 파일 동반 갱신.

## 8. 메뉴 노출 연동

`nav_menu_items`에 `allowed_permissions String[] @default([])` 컬럼 추가.

- 판정(기존 로직에 AND 추가): `allowedRoles` 비면 통과 / `allowedOrgCodes` 비면 통과 / **`allowedPermissions` 비면 통과, 있으면 사용자가 그중 1개 이상 보유(또는 SUPER_ADMIN)**
- 권한 목록 전달: `/api/auth/me` 응답에 `permissions: string[]` 추가 (DB 실시간 — Navigation·클라이언트 UI 게이트 공용). 기존 응답 필드는 불변
- 메뉴 관리 UI에 권한 선택 필드 추가 (카탈로그 키 멀티 선택)
- **메뉴 노출은 UX일 뿐, 보안은 API 체크** — 원칙 명시. 메뉴만 열고 API 게이트 없는 상태 금지

## 9. 단계별 계획

### Phase 1 — 기반 구축 (기존 기능 무영향, 리스크 0)
- 3테이블 마이그레이션 + `lib/permissions.ts` + `lib/appRoles.ts`
- 설정 UI `/settings/roles` + API 4종 + 감사 로그 + nav 메뉴 행
- **어떤 기존 기능에도 연결하지 않음** — 역할을 만들고 부여해도 시스템 동작 불변
- 검증: 역할 CRUD·권한·멤버 왕복, 감사 로그 기록, tsc 0오류

### Phase 2 — 파일럿: 자재관리 편입 + 메뉴 연동
- `canManageStock` / `canEditTxMeta` 내부에서 `inventory_managers` 풀 조회를 "풀 **OR** `hasPermission('inventory.manage')`"로 확장 — 기존 풀 등록자는 아무 변화 없음(가산)
- `nav_menu_items.allowed_permissions` 컬럼 + 판정 + `/api/auth/me` 확장 + 메뉴 관리 UI
- 검증: 풀 미등록·역할 보유 사용자가 재고 처리 가능 / 풀 등록자 기존 동작 불변 / 역할 회수 시 60초 내 차단
- 게이트: 파일럿 검증 통과 후에만 Phase 3

### Phase 3 — 확산 (모듈별 순차, 각각 소규모)
- 신규 기능의 권한 요구는 **전용 풀 신설 금지 → 권한 키 추가**로 처리 (컨벤션 등재)
- 기존 모듈 편입은 건별 승인: 후보 — 티켓 담당 지정, 차량 관리, 영업 열람 확대 등. 각 편입은 "카탈로그 키 추가 + 호출부 1~2곳 OR 합성" 수준
- CLAUDE.md 코딩 컨벤션에 "기능 권한은 lib/permissions.ts 카탈로그 + hasPermission 단일 소스, 전용 풀 테이블 신설 금지" 규칙 추가

### 선택적 후속 (별도 승인 전까지 착수 금지)
- `inventory_managers` 풀 데이터 → 역할 멤버십 이관 후 풀 폐기 (Phase 2 안정 후)
- `field_engineers` 배정 후보 풀을 "역할 보유자 목록 = 배정 후보 드롭다운"으로 통합
- 계정관리 UI 라벨 '역할' → '등급' 정리 (라벨만, 선례: Assignment Group)
- `vehicle_reservation_blocked` 등 개인 플래그의 권한 체계 정리

## 10. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 기존 접근 회귀 | **가산 전용 원칙** — 모든 편입이 기존 체크에 OR 추가라 접근이 줄어드는 경로가 없음 |
| 권한 키·라벨 불일치 | 카탈로그 단일 소스 — DB에는 키 문자열만, UI는 카탈로그에서 렌더 |
| 역할 회수 지연 | 캐시 TTL 60초 + 변경 시 무효화. 사내 도구 기준 허용 |
| 빈 체계(만들고 안 씀) | v1 카탈로그 최소(1키) + Phase 2 파일럿을 같은 승인 단위로 묶음 |
| 두 체계 혼재 장기화 | Phase 3 컨벤션 등재로 신규는 강제 일원화, 기존은 건별 이관 |

## 11. 확정된 설계 결정 (검토 포인트)

1. 등급은 유지하고 역할을 **위에 얹는다** (빅뱅 전환 없음)
2. 권한 카탈로그는 **코드가 단일 소스** (DB 권한 마스터 테이블 없음)
3. 권한은 JWT에 넣지 않고 **DB 조회 + 60초 캐시**
4. 역할 정의·부여는 **SUPER_ADMIN 전용**
5. `field_engineers`(배정 후보)는 권한이 아니므로 **범위 제외**
6. 파일럿은 **자재관리** (이미 풀 OR 등급 구조라 편입 형태가 가장 자연스러움)
