# 차량예약시스템 개발 스케줄

> 법인차량 예약 기능. 메인 네비게이션 '차량예약' 메뉴로 진입.
> 진행 방식은 위키와 동일: "차량예약 Phase N 진행해줘"로 Phase 단위 진행.

---

## 설계 확정 사항 (2026-06-10)

- **예약 단위**: 시간 단위 — 시작~종료 시각 30분 단위 선택, '종일'(09:00~18:00) 빠른 입력 버튼 제공
- **확정 방식**: 선착순 즉시 확정 (승인 절차 없음)
- **반납 처리·주행 기록**: 없음 — 종료 시각 경과 시 자연히 과거 예약 처리
- **Google Calendar 연동**: 1차 미포함. 필요해지면 기존 `calendarEventId` 패턴으로 추가
- **모듈 위치**: `public` 스키마 + 메인 모듈 (위키와 달리 분리 경계 불필요)
- **취소 정책**: soft delete (`status='CANCELED'`) — 이력 보존

---

## DB 스키마

### Vehicle (`vehicles`)
- `id` Int PK autoincrement
- `name` (표시 이름, 예: "카니발 1호"), `plateNumber` UNIQUE (`plate_number`)
- `model`, `seatCount`, `color` (보드 표시 색), `memo` — 모두 nullable
- `isActive` (기본 true), `sortOrder`, `createdAt`, `updatedAt`
- 매각·폐차 시 삭제 대신 비활성. 예약 이력 있는 차량 DELETE는 409

### VehicleReservation (`vehicle_reservations`)
- `id` Int PK, `vehicleId` FK→vehicles, `userId` String FK→users(uuid)
- `startAt`, `endAt` (timestamptz), `purpose`, `destination` (nullable)
- `status` String 기본 `'RESERVED'` (`RESERVED` | `CANCELED`)
- 인덱스: `(vehicle_id, start_at)`, `(user_id, start_at)`

### 더블부킹 방지 (이중)
1. 앱 레벨: `$transaction` 내 겹침 검사 (`start_at < 신규end AND end_at > 신규start AND status='RESERVED'`) → 409 + 겹치는 예약 정보 반환
2. DB 안전망: `CREATE EXTENSION IF NOT EXISTS btree_gist;` +
   ```sql
   ALTER TABLE vehicle_reservations ADD CONSTRAINT vehicle_reservations_no_overlap
     EXCLUDE USING gist (vehicle_id WITH =, tstzrange(start_at, end_at) WITH &&)
     WHERE (status = 'RESERVED');
   ```
   (Prisma 미인지 제약 — 수동 SQL 마이그레이션으로 적용, CLAUDE.md 절대 규칙 #1 패턴)

---

## API

| Method | Endpoint | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/vehicles` | 로그인 | 차량 목록 (`?activeOnly=true`) |
| POST | `/api/vehicles` | ADMIN+ | 차량 등록 |
| PUT | `/api/vehicles/[id]` | ADMIN+ | 수정 (비활성 토글 포함) |
| DELETE | `/api/vehicles/[id]` | ADMIN+ | 삭제 (예약 이력 시 409) |
| GET | `/api/vehicle-reservations` | 로그인 | 기간 조회 (`?from=&to=&vehicleId=&mine=true`) |
| POST | `/api/vehicle-reservations` | USER+ | 예약 생성 (충돌 검사) |
| PUT | `/api/vehicle-reservations/[id]` | 본인 or ADMIN+ | 변경 (충돌 재검사) |
| DELETE | `/api/vehicle-reservations/[id]` | 본인 or ADMIN+ | 취소 (status=CANCELED) |

- 모든 mutation 감사 로그: `resource='vehicle'` / `'vehicle_reservation'`
- 역할 체크는 `isAdminOrAbove()` 헬퍼 (CLAUDE.md 컨벤션)

---

## UI

### `/vehicle-reservations` — 예약 현황 보드
- 주간 보드: 행=차량(색 칩+이름+차량번호), 열=월~일
- 예약 카드: `09:00–13:00 이름 · 목적`, 본인 예약 강조
- 빈 영역 클릭 → 예약 모달 (차량·날짜 자동 채움, 30분 단위 시각, 종일 버튼, 목적, 행선지)
- 본인 카드 클릭 → 수정/취소, 타인 카드 → 상세 (ADMIN은 취소 가능)
- 주 이동 ◀▶ + 오늘, URL `?week=` 동기화 (`/projects/calendar` 패턴 재사용)
- 충돌 409 시 겹치는 예약(누가·언제) 인라인 표시
- 상단 탭: 현황 보드 | 내 예약 (다가오는 예약 리스트 + 취소)

### `/settings/vehicles` — 차량 관리 (ADMIN+)
- 기존 설정 페이지 패턴: 테이블 + 인라인 수정 + ↑↓ 순서 + 활성 토글 + 하단 추가 행

### 네비게이션
- `nav_menu_items` INSERT: `vehicle-reservations` / label '차량예약' / 최상위 / lucide `Car` 아이콘 (`NavIcons` 추가)
- 차량 관리는 설정 하위 메뉴 INSERT

---

## 권한

| 역할 | 현황 조회 | 예약/본인 취소 | 타인 예약 취소 | 차량 관리 |
|---|---|---|---|---|
| VIEWER | ✅ | ❌ | ❌ | ❌ |
| USER | ✅ | ✅ | ❌ | ❌ |
| ADMIN/SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ |

---

## Phase 계획

### Phase 1 — DB + 차량 관리
- Prisma 모델 2종 + 수동 SQL 마이그레이션 (btree_gist + EXCLUDE 포함)
- `/api/vehicles` CRUD + `/settings/vehicles` 페이지 + 설정 하위 메뉴 등록
- **게이트**: `npx tsc --noEmit` 통과, 차량 CRUD 동작 확인

### Phase 2 — 예약 API
- `/api/vehicle-reservations` CRUD + 충돌 검사(앱+DB 이중) + 감사 로그
- **게이트**: 라우트 직접 호출 테스트 통과 (정상 생성 / 충돌 409 / 권한 403 / 본인·ADMIN 취소)

### Phase 3 — 현황 보드 UI
- 주간 보드 + 예약/수정/취소 모달 + 내 예약 탭 + `nav_menu_items` '차량예약' 등록
- **게이트**: dev2 브라우저 검증 (예약 생성→보드 표시→취소 흐름)

### Phase 4 — 문서 갱신
- `README.md` (주요 기능·API·스키마·디렉토리), `DEV_HISTORY.md` 기록

### Phase 5 — PROD 반영
> **사용자 명시 요청 시에만** (CLAUDE.md 절대 규칙 #3, #5)
- push → PROD pull → PROD DB 마이그레이션(별도 허락) → nav INSERT → 빌드(힙 4GB) → pm2 restart → smoke test

---

## 진행 현황 체크리스트

- [x] Phase 0 — 설계 확정 (2026-06-10)
- [x] Phase 1 — DB + 차량 관리 (2026-06-10) — 마이그레이션 DEV 적용, 통합 테스트 12/12 통과
- [x] Phase 2 — 예약 API (2026-06-10) — 통합 테스트 18/18 통과 (충돌 409·EXCLUDE race 차단 포함)
- [x] Phase 3 — 현황 보드 UI (2026-06-10) — tsc·ESLint 통과, nav 메뉴 2건 등록. 브라우저 검증은 빌드·PM2 재시작(사용자 요청) 후 진행
- [x] Phase 4 — 문서 갱신 (2026-06-10) — README/DEV_HISTORY 반영
- [ ] Phase 5 — PROD 반영 (사용자 명시 요청 대기)
