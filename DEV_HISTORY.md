# thynC Operations System - 개발 작업 이력

> 최신 작업이 상단에 위치합니다.

---

## 2026-03-15 | 기기 관리 페이지 구현 (/settings/devices)
- API 추가
  - `GET /api/settings/devices`: 전체 목록 (sortOrder 기준 정렬, usageCount 포함)
  - `POST /api/settings/devices`: 기기 등록 (모델 코드 중복 검사)
  - `PUT /api/settings/devices/[id]`: 기기 수정
  - `DELETE /api/settings/devices/[id]`: 삭제 (ProjectDevice 참조 중이면 isActive=false 처리, 응답에 deactivated 플래그 포함)
- 페이지 구현: `/settings/devices` — 상태값 관리 페이지와 동일한 레이아웃/패턴 적용
  - 테이블: 순서(↑↓), 모델 코드, 기기명, 등록일, 활성 여부, 수정/삭제
  - 인라인 수정, 추가 행 UI
  - 비활성 기기는 투명도 처리, 삭제 시 참조 중이면 amber 안내 메시지 표시
- Navigation.tsx: 설정 하위에 '기기 관리' 항목 추가 (ADMIN 전용)
- 영향받은 파일: `app/api/settings/devices/route.ts` (신규), `app/api/settings/devices/[id]/route.ts` (신규), `app/settings/devices/page.tsx` (신규), `app/components/Navigation.tsx`

---

## 2026-03-15 | 프로젝트 관련 신규 테이블 4개 추가 (DeviceInfo, Project, ProjectDevice, ProjectFile)
- `DeviceInfo`: 기기 정보 (모델 코드, 이름, 활성여부, 정렬순서)
- `Project`: 구축 프로젝트 (병원 연결, 차수, 계약일, 병동/병상/게이트웨이 수, 담당자, 일정, 완료여부, 이슈노트)
  - `builderUserId`는 User.id 타입 맞춰 String? (uuid)으로 설정
- `ProjectDevice`: 프로젝트별 기기 수량 (Project ↔ DeviceInfo N:M, unique 제약)
- `ProjectFile`: 프로젝트 첨부파일 (카테고리: INSTALL_PLAN | CONTRACTOR_CONFIRM | INSTALL_CONFIRM | INSPECTION_CHECKLIST, Google Drive 연동)
- 기존 Hospital, User 모델에 `projects` relation 필드 추가 (데이터 변경 없음)
- shadow DB 권한 문제로 SQL 직접 실행 후 `prisma migrate resolve --applied` 처리
- 영향받은 파일: `prisma/schema.prisma`, `prisma/migrations/20260315100000_add_project_tables/migration.sql` (신규)

---

## 2026-03-15 | 병원 데이터 Excel 일괄 가져오기 기능 추가
- `POST /api/hospitals/import` API 추가
  - `?preview=true`: 파일 파싱 후 DB 변경 없이 결과 미리보기 반환
  - 기본 실행: 기존 병원 + 대웅 직원 배정 전체 삭제 후 Excel 데이터 일괄 insert
  - 같은 병원명 여러 행 → 도입형태 병합(쉼표), 도입병상 수 합산
  - 컬럼명: 병원명, 도입형태, 도입병상 수 (또는 도입병상수)
- `ImportButton` 컴포넌트 신규 생성 (3단계: 파일선택 → 미리보기/경고 → 완료)
- 병원 목록 페이지 헤더에 'Excel 가져오기' 버튼 추가 (ADMIN 전용)
- 영향받은 파일: `app/api/hospitals/import/route.ts` (신규), `app/hospitals/_components/ImportButton.tsx` (신규), `app/hospitals/page.tsx`

---

## 2026-03-15 | 심평원 병원 검색 모달 전환 및 검색 버그 수정
- 중첩 `<form>` 구조로 인한 검색 불가 버그 수정 → 모달 방식으로 전환
- 공통 `HiraSearchModal` 컴포넌트 신규 생성 (등록/수정 페이지 공용)
- 카드명 '심평원 병원 연결' → '심평원 정보 조회'로 변경
- 등록 페이지: '병원 검색' 버튼 클릭 시 모달 오픈, 기본 폼 단독으로 등록 가능
- 수정 페이지: '병원 변경/연결' 버튼으로 모달 오픈, '되돌리기' 버튼으로 변경 취소 가능
- 영향받은 파일: `app/hospitals/_components/HiraSearchModal.tsx` (신규), `app/hospitals/register/page.tsx`, `app/hospitals/[code]/edit/page.tsx`

---

## 2026-03-15 | 병원 등록/수정 UI 개선 및 심평원 연결 재설계
- **등록 페이지**: 심평원 검색 섹션 기본 접힘(collapsed) 처리, '병원 검색 ▼' 버튼으로 토글. 병원명+상태만으로 즉시 등록 가능
- **수정 페이지**: 심평원 병원 연결 섹션 추가 — '변경' 버튼으로 재검색, '연결 해제' 버튼으로 링크 제거. 저장 전 변경 예정 상태 미리보기 표시
- **PUT API**: `changeHira`, `hiraId` 파라미터 추가 — hiraId 있으면 HIRA 데이터 전체 갱신, null이면 연결 해제(HIRA 관련 필드 초기화)
- 영향받은 파일: `app/hospitals/register/page.tsx`, `app/hospitals/[code]/edit/page.tsx`, `app/api/hospitals/[code]/route.ts`

---

## 2026-03-15 | Hospital 테이블 컬럼 2개 추가 (도입형태, 도입 병상 수)
- `intro_type` (TEXT, nullable): 도입형태 - 구축형/구독형/사용량비례형, 복수값은 쉼표(,)로 구분
- `intro_beds` (INTEGER, nullable): 도입 병상 수
- 마이그레이션 수동 적용 (shadow DB 권한 문제로 migrate dev 대신 SQL 직접 실행)
- 영향받은 파일: `prisma/schema.prisma`, `prisma/migrations/20260315000000_.../migration.sql` (신규)

---

## 2026-03-15 | 병원 상세 페이지 - 'thynC 도입현황' 카드 추가
- 병원 상세 페이지 하단에 'thynC 도입현황' 카드 영역 추가
- 현재는 빈 상태(placeholder)로 구성, 향후 데이터 필드 추가 예정
- 영향받은 파일: `app/hospitals/[code]/page.tsx`

---

## 2026-03-15 | 개발 작업 이력 관리 체계 수립
- CLAUDE.md에 DEV_HISTORY.md 기록 규칙 추가
- 향후 모든 개발 작업 완료 시 본 파일에 작업 내역을 요약 기록하도록 지침 설정
- 영향받은 파일: `CLAUDE.md`, `DEV_HISTORY.md` (신규 생성)
