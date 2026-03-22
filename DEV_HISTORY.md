# thynC Operations System - 개발 작업 이력

> 최신 작업이 상단에 위치합니다.

---

## 2026-03-22 17:00 | 프로젝트 Drive 폴더 일괄 생성 스크립트 실행

- `scripts/create-project-drive-folders.mjs` 신규 생성 및 실행
- driveFolderId 없는 프로젝트 184개 전체에 병원 폴더 하위에 `PROJ-XXXXXX_병원명` 형식의 서브폴더 생성
- DB projects.drive_folder_id 전체 업데이트 완료 (성공 184개 / 실패 0개)
- 영향 파일: `scripts/create-project-drive-folders.mjs`

---

## 2026-03-22 15:30 | Project contractType 필드 추가 및 마이그레이션 dry-run 스크립트 생성

- `Project` 모델에 `contractType String? @map("contract_type")` 필드 추가
- DB 마이그레이션: shadow DB 권한 문제로 SQL 직접 실행 (`ALTER TABLE projects ADD COLUMN contract_type TEXT`) 후 `prisma migrate resolve --applied` 처리
- `scripts/migrate-projects.ts` 신규 생성: `/home/ubuntu/project_list.xlsx` 기반 프로젝트 일괄 마이그레이션 스크립트
  - `--dry-run`: 병원 매핑 결과, 진행상태/설치업체 매핑 여부, 생성 가능 수 출력
  - `--execute`: 실제 DB 프로젝트 생성 (중복 병원+차수 스킵)
  - 병원명 매핑: 운영명 정확일치 → 심평원명 정확일치 → 부분일치 순
  - `동아대학교병원` 마이그레이션 제외 처리
  - `tsconfig.scripts.json` 추가 (ts-node용 CommonJS 설정)
- dry-run 결과: 188행 중 187건 매핑 성공, 진행상태/설치업체 전체 매핑 ✅
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260322150000_add_contract_type_to_project/`, `scripts/migrate-projects.ts`, `tsconfig.scripts.json`

---

## 2026-03-22 14:00 | 프로젝트 구축상태 관리 추가 및 색상 선택 UI 개선

- `BuildStatus` 모델 신규 추가 (id, label, color, sortOrder, createdAt, updatedAt / @@map("build_statuses"))
- `Project` 모델에서 `isCompleted` 필드 제거, `buildStatusId` + `buildStatus` 관계 추가
- DB 마이그레이션: build_statuses 테이블 생성, projects.is_completed 컬럼 삭제, build_status_id FK 추가
- `GET/POST /api/settings/build-status`, `PUT/DELETE /api/settings/build-status/[id]` API 신규 생성
- `app/settings/build-status/page.tsx` 신규 생성 (순서↑↓, 상태명, 색상, 수정/삭제)
- Navigation에 '구축상태 관리' 항목 추가 (ADMIN 전용, 병원 상태코드 관리 바로 아래)
- `app/components/ColorPicker.tsx` 신규 생성: 22색 팔레트 + 직접 hex 입력 + 색상 없음 버튼
- `app/settings/status/page.tsx` — 인라인 ColorPicker 함수 제거, 공통 ColorPicker 컴포넌트 import로 교체
- `GET/POST /api/projects`, `GET/PUT /api/projects/[code]` — buildStatus include 추가, isCompleted 제거
- `ProjectFilters` — isCompleted 필터 제거
- `ProjectPagination` — isCompleted 파라미터 제거
- `app/projects/page.tsx` — 진행상태 컬럼(계약일↔병동 수 사이) 추가, StatusBadge 표시
- `app/projects/new/page.tsx` — isCompleted 체크박스 제거, buildStatusId 드롭다운 추가
- `app/projects/[code]/page.tsx` — isCompleted 체크박스 제거, buildStatusId 드롭다운 추가, buildStatuses 로드
- `app/hospitals/[code]/page.tsx` — 프로젝트 목록 '완료 여부' → '진행상태' 컬럼으로 교체 (buildStatus + StatusBadge)
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260322130000_*/`, `app/components/ColorPicker.tsx`, `app/components/Navigation.tsx`, `app/settings/build-status/page.tsx`, `app/settings/status/page.tsx`, `app/api/settings/build-status/route.ts`, `app/api/settings/build-status/[id]/route.ts`, `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`, `app/projects/page.tsx`, `app/projects/new/page.tsx`, `app/projects/[code]/page.tsx`, `app/projects/_components/ProjectFilters.tsx`, `app/projects/_components/ProjectPagination.tsx`, `app/hospitals/[code]/page.tsx`

---

## 2026-03-22 12:30 | 프로젝트 목록 페이지 컬럼 개편

- 프로젝트 목록 테이블 컬럼 전면 개편: 병원명 제거, 병동 수·병상 수·G/W·심전계·산소포화도·구축업체·구축 시작일·구축 종료일(예상)·프로젝트 폴더 추가
- 숫자 컬럼(병동/병상/G/W/심전계/산소포화도) 중앙 정렬, 전체 테이블 overflow-x-auto 및 컬럼별 minWidth 지정
- Prisma 쿼리에 contractor, devices(+deviceInfo.deviceModel) 포함 추가
- 심전계(MC200MT-T), 산소포화도(MP1000W) deviceModel 기준으로 수량 추출
- 프로젝트 폴더: driveFolderId 있으면 Google Drive 바로가기 링크, 없으면 '-'
- 날짜 표시 YYYY-MM-DD 형식으로 통일 (toISOString().slice(0,10))
- GET /api/projects include에 deviceInfo.deviceModel/deviceName 명시적 select 추가
- 영향 파일: `app/projects/page.tsx`, `app/api/projects/route.ts`

---

## 2026-03-22 11:30 | 병원 상태코드 색상 관리 및 StatusBadge 컴포넌트 적용

- Navigation '상태값 관리' → '병원 상태코드 관리'로 메뉴명 변경, 설정 페이지 타이틀도 동일하게 변경
- StatusCode 모델에 `color String? @map("color")` 필드 추가 (Prisma schema + 마이그레이션 + DB ALTER TABLE 직접 실행)
- `app/settings/status/page.tsx` 개선: 색상 컬럼 추가, 수정 모드에서 color type input + 팔레트 제공, 추가 폼에서도 색상 지정 가능. handleMove 시 color 값 보존
- `POST /api/settings/status` 및 `PUT /api/settings/status/[id]` API에 color 필드 저장 추가
- `app/components/StatusBadge.tsx` 신규 생성: color 있으면 해당 배경색 + 밝기 기반 텍스트 색상 자동 결정, 없으면 기본 회색 뱃지
- `app/hospitals/page.tsx`, `app/hospitals/[code]/page.tsx`: StatusCode.color 조회 후 StatusBadge 컴포넌트로 상태 표시 교체. 기존 STATUS_MAP/STATUS_STYLE 하드코딩 제거
- `GET /api/hospitals`: statusCodes 조회 후 각 병원에 statusColor 포함해 반환
- `GET /api/hospitals/[code]`: 응답 hospital 객체에 statusColor 포함
- 영향 파일: `app/components/Navigation.tsx`, `prisma/schema.prisma`, `prisma/migrations/20260322110000_add_color_to_status_code/`, `app/settings/status/page.tsx`, `app/api/settings/status/route.ts`, `app/api/settings/status/[id]/route.ts`, `app/components/StatusBadge.tsx`, `app/hospitals/page.tsx`, `app/hospitals/[code]/page.tsx`, `app/api/hospitals/route.ts`, `app/api/hospitals/[code]/route.ts`

---

## 2026-03-22 10:30 | 병원 목록 UI 개선 및 계약일 필드 추가

- Navigation 컴포넌트의 시스템명(좌측 상단, 모바일 헤더)을 `<Link href="/">`로 감싸 메인 페이지로 이동하도록 처리
- Hospital 모델에 `contractDate DateTime? @map("contract_date")` 필드 추가 (prisma schema + 마이그레이션 + DB ALTER TABLE 직접 실행)
- 병원 수정 페이지(`/hospitals/[code]/edit`) 기본정보 카드에 계약일(date input) 필드 추가, PUT API에 contractDate 처리 추가
- 병원 목록 페이지 테이블 컬럼 개선: '심평원 병원명' 제거, '계약일'·'관리폴더' 컬럼 추가. 관리폴더는 `driveProjectFolderId` 있으면 Google Drive 바로가기 링크 표시
- GET `/api/hospitals` select에 `contractDate`, `meta.driveProjectFolderId` 포함
- 영향 파일: `app/components/Navigation.tsx`, `prisma/schema.prisma`, `prisma/migrations/20260322100000_add_contract_date_to_hospitals/`, `app/api/hospitals/route.ts`, `app/api/hospitals/[code]/route.ts`, `app/hospitals/page.tsx`, `app/hospitals/[code]/edit/page.tsx`

---

## 2026-03-22 | 프로젝트 Drive 서브폴더 페이지 로딩 시 자동 생성으로 변경
- 기존 프로젝트(driveFolderId=null)에서 파일 업로드 시 Drive 서브폴더 생성 실패 문제 수정
- 서브폴더 생성 시점을 "첫 업로드 시" → "프로젝트 페이지 로딩 시"로 변경: 병원 driveProjectFolderId가 있고 project.driveFolderId가 없으면 loadProject 내에서 drive-folder API 자동 호출
- files/route.ts: 폴더 자동 생성 로직 제거, driveFolderId 없으면 명확한 400 반환
- 영향 파일: app/projects/[code]/page.tsx, app/api/projects/[code]/files/route.ts

---

## 2026-03-22 | 프로젝트 파일 업로드 Drive 폴더 기준 변경 (병원 → 프로젝트 하위)
- 프로젝트 파일 업로드 가능 여부를 project.driveFolderId 기준에서 hospital.meta.driveProjectFolderId 기준으로 변경
- 병원에 Drive 폴더가 있으면 → 첫 업로드 시 프로젝트 서브폴더 자동 생성 후 업로드 (사용자 개입 불필요)
- 병원에 Drive 폴더가 없으면 → 안내 메시지 표시 + 병원 페이지 링크, 업로드 버튼 비활성화
- 프로젝트 상세 API에 hospital.meta 포함
- "Drive 폴더 생성" 수동 버튼 제거
- 영향 파일: app/api/projects/[code]/route.ts, app/api/projects/[code]/files/route.ts, app/projects/[code]/page.tsx

---

## 2026-03-22 | 기존 프로젝트 Drive 폴더 수동 생성 버튼 추가
- 기존에 생성된 프로젝트(driveFolderId=null)는 파일 업로드 불가 문제 수정
- `POST /api/projects/[code]/drive-folder` 신규 엔드포인트 추가: 병원 HospitalMeta.driveProjectFolderId 기반으로 Drive 폴더 생성 후 project.driveFolderId 저장
- 프로젝트 상세 페이지 첨부파일 섹션: driveFolderId 없을 시 경고 메시지 옆에 [Drive 폴더 생성] 버튼 표시, 클릭 시 API 호출 후 즉시 파일 업로드 활성화
- 영향 파일: app/api/projects/[code]/drive-folder/route.ts(신규), app/projects/[code]/page.tsx

---

## 2026-03-22 | 프로젝트 Drive 폴더 자동 생성 및 파일 업로드 기능 구현
- `Project` 모델에 `driveFolderId String?` 필드 추가 (migration: 20260322030000_add_drive_folder_to_project)
- `lib/googleDrive.ts`에 `createDriveFolder()`, `uploadBufferToDrive()` 함수 추가
- `POST /api/projects`: 병원 HospitalMeta.driveProjectFolderId 존재 여부 사전 검증 (없으면 400), 프로젝트 생성 후 Drive 폴더 자동 생성(`{projectCode}_{hospitalName}`), Drive 실패 시 driveWarning 필드 반환
- `POST /api/projects/[code]/files`: multipart/form-data 파일 업로드 → Drive 업로드 → ProjectFile DB 저장 (driveFolderId 없으면 400)
- `DELETE /api/projects/[code]/files/[fileId]`: ADMIN 전용, DB 레코드만 삭제 (Drive 파일 미삭제)
- `app/projects/new/page.tsx`: 병원 선택 시 Drive 폴더 여부 자동 확인, 미등록 시 경고 배너 표시 및 등록 버튼 비활성화
- `app/projects/[code]/page.tsx`: 첨부파일 섹션 활성화 - 파일 추가 버튼으로 Drive 업로드, 업로드 진행 중 상태 표시, driveFolderId 없을 시 업로드 버튼 비활성화 및 안내 메시지, ADMIN만 파일 삭제 가능
- 영향 파일: prisma/schema.prisma, lib/googleDrive.ts, app/api/projects/route.ts, app/api/projects/[code]/files/route.ts, app/api/projects/[code]/files/[fileId]/route.ts(신규), app/projects/new/page.tsx, app/projects/[code]/page.tsx

---

## 2026-03-22 | 공사업체 관리 추가 및 프로젝트 계약정보 기기수량 통합
- `Contractor`(공사업체) 신규 테이블 추가: code(CON-000001 형식), name, bizRegNumber, managerName, managerPhone, managerEmail (주의: Prisma 모델명 `Constructor`는 JS 예약어 충돌로 `Contractor`로 명명, 테이블명은 `constructors`)
- `Project` 모델에 `constructorId Int?` 및 `contractor Contractor?` 관계 필드 추가
- shadow DB 권한 문제로 SQL 직접 실행 후 `prisma migrate resolve --applied` 처리
- `GET/POST /api/constructors`: 전체 목록 조회 / 등록(ADMIN), CON-000001 형식 코드 자동생성
- `GET/PUT/DELETE /api/constructors/[code]`: 상세/수정/삭제(ADMIN), 연결 프로젝트 있으면 삭제 차단
- `/settings/constructors` 관리 페이지 신규 생성: 인라인 등록/수정/삭제, 기기 관리 페이지와 동일한 구조
- `Navigation.tsx`: 설정 하위에 '공사업체 관리' 추가 (ADMIN 전용)
- `POST/PUT /api/projects`, `PUT /api/projects/[code]`: constructorId 필드 처리 추가, include에 contractor 추가
- 프로젝트 등록(/projects/new): 공사업체 드롭다운 추가, 기기 수량을 '계약 정보' 카드 내 섹션으로 통합
- 프로젝트 상세(/projects/[code]): 별도 '기기 수량' 카드 제거 → '계약 정보' 카드 안 '기기별 도입 수량' 섹션으로 통합, '구축 정보' 카드에 공사업체 드롭다운 추가
- 영향받은 파일: `prisma/schema.prisma`, `prisma/migrations/20260322020000_.../migration.sql` (신규), `app/api/constructors/route.ts` (신규), `app/api/constructors/[code]/route.ts` (신규), `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`, `app/settings/constructors/page.tsx` (신규), `app/components/Navigation.tsx`, `app/projects/new/page.tsx`, `app/projects/[code]/page.tsx`

---

## 2026-03-22 | 병원 상세 thynC 현황 섹션 UI 구조 개편
- 카드 타이틀 'thynC 도입현황' → 'thynC 현황', 섹션명 '도입 기기 현황' → '도입 현황'
- '도입 병상 수'를 dl 그리드에서 제거하여 '도입 현황' 섹션으로 통합
- `HospitalDevicesSection` 컴포넌트 재설계: 도입 병상 수 + 웨어러블 디바이스 도입 수량(그룹 레이블) + 기기별 수량 입력을 단일 테이블 구조로 통합, 같은 들여쓰기 레벨로 표시
- `PUT /api/hospitals/[code]/devices` body 구조 변경: 배열 → `{ introBeds?, devices[] }` — introBeds 포함 시 Hospital 테이블도 트랜잭션으로 함께 업데이트
- 영향받은 파일: `app/hospitals/[code]/_components/HospitalDevicesSection.tsx`, `app/hospitals/[code]/page.tsx`, `app/api/hospitals/[code]/devices/route.ts`

---

## 2026-03-22 | 병원 상세 페이지 도입 기기 현황 기능 추가
- `HospitalDevice` 신규 테이블 추가: hospitalCode(FK), deviceInfoId(FK), quantity, updatedAt + @@unique([hospitalCode, deviceInfoId])
- Hospital, DeviceInfo 모델에 hospitalDevices 관계 필드 추가
- shadow DB 권한 문제로 SQL 직접 실행 후 `prisma migrate resolve --applied` 처리
- `GET /api/hospitals/[code]/devices`: DeviceInfo 전체 기준으로 병원별 수량 조회 (없으면 0 반환, sortOrder 정렬)
- `PUT /api/hospitals/[code]/devices`: 배열 body로 일괄 upsert, quantity=0이면 레코드 삭제 (트랜잭션 처리)
- `HospitalDevicesSection` 클라이언트 컴포넌트 신규 생성: 기기별 수량 입력 테이블, 일괄 [저장] 버튼, 로딩 스피너, 성공/에러 인라인 메시지
- 병원 상세 페이지: DeviceInfo + HospitalDevice 데이터 서버에서 fetch 후 props 전달, thynC 도입현황 카드 하단에 도입 기기 현황 섹션 추가
- 영향받은 파일: `prisma/schema.prisma`, `prisma/migrations/20260322010000_add_hospital_device/migration.sql` (신규), `app/api/hospitals/[code]/devices/route.ts` (신규), `app/hospitals/[code]/_components/HospitalDevicesSection.tsx` (신규), `app/hospitals/[code]/page.tsx`

---

## 2026-03-22 | HospitalMeta 테이블 추가 및 Drive 폴더 연동 기능 구현
- `HospitalMeta` 신규 테이블 추가: hospitalCode(FK), driveProjectFolderId, driveStatusFileId, driveInstallPlanFileId, remoteAccessUrl, remoteControlUrl
- prisma/schema.prisma에 HospitalMeta 모델 및 Hospital 모델에 meta 관계 필드 추가
- shadow DB 권한 문제로 SQL 직접 실행 후 `prisma migrate resolve --applied` 처리
- .env에 `GOOGLE_SHARED_DRIVE_ID`, `GOOGLE_HOSPITAL_FOLDER_ID` 환경변수 추가 (placeholder)
- `POST /api/hospitals/[code]/drive-folder`: Google Drive의 GOOGLE_HOSPITAL_FOLDER_ID 하위에 폴더 생성 후 HospitalMeta에 저장 (supportsAllDrives: true, upsert)
- `PUT /api/hospitals/[code]/drive-folder`: folderId 직접 지정으로 HospitalMeta 업데이트 (Drive API 호출 없음)
- `DriveFolderRow` 클라이언트 컴포넌트 신규 생성: 폴더 미등록/등록 상태 분기, 생성 중 로딩 스피너, Drive URL 또는 ID 직접 입력 모두 허용, 인라인 에러 표시, 페이지 새로고침 없이 즉시 반영
- 병원 상세 페이지: HospitalMeta include 추가, thynC 도입현황 카드에 DriveFolderRow 삽입
- 영향받은 파일: `prisma/schema.prisma`, `prisma/migrations/20260322000000_add_hospital_meta/migration.sql` (신규), `.env`, `app/api/hospitals/[code]/drive-folder/route.ts` (신규), `app/hospitals/[code]/_components/DriveFolderRow.tsx` (신규), `app/hospitals/[code]/page.tsx`

---

## 2026-03-15 | 프로젝트 관리 UI 전체 구현
- **Navigation**: '프로젝트 관리' 메뉴 추가 (병원 목록과 대웅제약 관리 사이, ADMIN/USER 공통)
- **프로젝트 목록 페이지** (`/projects`): 병원명/프로젝트명 검색, 완료 여부 필터, 페이지네이션, ADMIN 전용 등록 버튼
- **프로젝트 등록 페이지** (`/projects/new`): 병원 검색 모달, 계약 정보, 구축 정보, 기기 수량 입력, 이슈노트. `useSearchParams` Suspense 래핑 처리. `?hospitalCode=` 쿼리로 병원 사전 선택 지원
- **프로젝트 상세/수정 페이지** (`/projects/[code]`): 전 필드 인라인 편집, 기기 수량 저장, 첨부파일 4카테고리 표시('파일 추가' 클릭 시 "추후 지원 예정" 알림), 이슈노트, ADMIN 전용 삭제
- **병원 상세 페이지** (`/hospitals/[code]`): '구축 프로젝트' 섹션 추가 — 차수 오름차순 목록, ADMIN 전용 프로젝트 등록 버튼(`/projects/new?hospitalCode=...` 연결)
- 공통 컴포넌트: `ProjectFilters`, `ProjectPagination`, `HospitalSelectModal`
- 영향받은 파일: `Navigation.tsx`, `hospitals/[code]/page.tsx`, `projects/page.tsx`, `projects/new/page.tsx`, `projects/[code]/page.tsx`, `projects/_components/` 3개 (모두 신규)

---

## 2026-03-15 | 프로젝트 API Routes 구현
- `GET/POST /api/projects`: 목록(필터/페이지네이션) 및 등록
  - 등록 시 projectCode(PRJ-YYYYMM-NNNN), orderNumber(병원 내 차수), projectName("{병원명} N차") 자동 생성
- `GET/PUT/DELETE /api/projects/[code]`: 상세 조회, 수정, 삭제
  - 삭제 시 projectDevices, projectFiles 연관 데이터 먼저 삭제 처리
- `GET/POST /api/projects/[code]/devices`: 기기 목록 조회 및 upsert 등록
- `GET/POST /api/projects/[code]/files`: 파일 메타데이터 목록 조회 및 등록 (Drive 연동 없이 DB만 저장)
- `DELETE /api/projects/[code]/files/[fileId]`: 파일 레코드 삭제
- 영향받은 파일: `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`, `app/api/projects/[code]/devices/route.ts`, `app/api/projects/[code]/files/route.ts`, `app/api/projects/[code]/files/[fileId]/route.ts` (모두 신규)

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
