# thynC Operations System - 개발 작업 이력

> 최신 작업이 상단에 위치합니다.

---

## 2026-03-30 | 병원 삭제 시 FK 제약 오류 수정

- 병원 삭제 시 HospitalMeta, HospitalDevice, DaewoongHospitalAssignment 등 하위 레코드가 남아 있어 PostgreSQL FK 제약으로 삭제가 실패하던 문제 수정
- 삭제 전 답사(SiteVisit) 연결 여부 추가 체크 (있으면 409 반환)
- 트랜잭션으로 하위 레코드(담당자 배정 → 병원 장비 → 메타) 순서대로 삭제 후 병원 삭제 처리
- 영향 파일: `app/api/hospitals/[code]/route.ts`

---

## 2026-03-30 | 프로젝트 생성 시 Google Drive 폴더 필수 조건 제거

- 파일 스토리지가 S3로 전환됨에 따라 Drive 폴더 없어도 프로젝트 생성 가능하도록 차단 로직 제거
- `app/api/projects/route.ts`: Drive 폴더 필수 체크(400 반환) 및 프로젝트 생성 후 Drive 폴더 자동 생성 로직 제거, `createDriveFolder` import 제거
- `app/projects/new/page.tsx`: `hospitalDriveOk` state, Drive 폴더 미설정 경고 UI, 병원 선택 시 Drive 폴더 유무 조회 useEffect, submit 버튼 disabled 조건 제거
- `/api/drive/*` 유틸리티 라우트 및 `lib/googleDrive.ts` 함수는 유지 (병원 목록 내보내기 등 Drive 전용 기능에 활용)
- 영향 파일: `app/api/projects/route.ts`, `app/projects/new/page.tsx`

---

## 2026-03-30 | PROD → DEV DB 데이터 동기화

- `pg_dump --clean thync_ops | psql thync_ops_dev` 방식으로 상용 DB 데이터를 개발 DB에 전체 동기화
- 동기화 후 주요 테이블 row count 및 updated_at 타임스탬프 일치 확인 (hospitals 172, projects 187 등)
- 스키마 변경 없음, 데이터만 덮어씌움

---

## 2026-03-29 15:00 | 대시보드 월별 누적 현황 엑셀 다운로드 기능 추가

- 대시보드 "월별 누적 사용 현황" 섹션 헤더 우측에 엑셀 다운로드 버튼 추가
- 이미 로드된 `monthly` state 데이터를 `xlsx` 라이브러리로 클라이언트에서 직접 변환하여 다운로드 (신규 API 없음)
- 다운로드 파일명: `월별누적현황_YYYY-MM-DD.xlsx`, 컬럼: 월 / 신규 병원 수 / 신규 병상 수 / 누적 병원 수 / 누적 병상 수 (최신 월 상단)
- 데이터 없거나 로딩 중일 때 버튼 disabled 처리
- 영향 파일: `app/page.tsx`

---

## 2026-03-29 14:30 | README.md 형상정보 최신화

- 최신 소스코드 분석 후 README에 누락된 형상정보 추가
- 기술 스택: AWS S3 (`@aws-sdk`), Recharts, Tiptap 추가
- AWS S3 연동 설정 섹션 신규 추가 (IAM 설정, 환경변수, 파일 저장 경로 규칙)
- 환경변수 예시에 S3 관련 항목(`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`) 추가
- 디렉토리 구조: `lib/s3.ts` 추가
- DB 스키마: Project 신규 필드(projectName, orderNumber, contractType, wardCount, bedCount, gatewayCount, hasSurvey, hasOrder, builderNameManual, issueNote 등), SiteVisit S3 필드 및 assigneeId, HospitalMeta 추가 필드, ProjectFile fileCategory/s3Key 반영
- 주요 기능: 대시보드 월별 차트, 프로젝트 이슈노트(리치텍스트), 답사 2인 담당자/S3 파일/리치텍스트 노트 추가
- API 엔드포인트: `/api/dashboard/monthly`, `/api/projects/[code]/files/[fileId]/download`, `/api/site-visits/file-url`, `/api/site-visits/file` (DELETE) 추가
- Google Drive 연동 설명에 S3 전환 안내 추가
- 영향 파일: `README.md`

---

## 2026-03-29 13:00 | 대시보드 월별 신규 병원/병상 막대 차트 추가

- 누적 라인 차트 하단에 월별 신규 현황 막대 차트 추가
- 신규 병원(보라색, 좌측 Y축) / 신규 병상(주황색, 우측 Y축) 이중 Y축 구성
- ComposedChart 활용, 각 막대 상단 모서리 라운드 처리
- 영향받은 파일: `app/page.tsx`

---

## 2026-03-29 12:30 | 대시보드 월별 누적 사용 현황 섹션 추가

- 구축완료("완료" 또는 "구축완료") 프로젝트의 endDateExpected 익월을 서비스 시작월로 산정하여 월별 신규/누적 병원·병상 수 집계
- 중간 월 gap 없이 첫 서비스 시작월부터 현재까지 전체 구간 표시
- recharts 라이브러리 설치 후 이중 Y축 라인 차트(누적 병원: 파란색 / 누적 병상: 초록색) 구현
- 테이블: 최신 월 상단 정렬, 신규 데이터 있는 행 강조 표시, 없는 행 연한 색 처리
- 헤더에 현재 누적 병원 수 / 누적 병상 수 요약 표시
- 영향받은 파일:
  - `app/api/dashboard/monthly/route.ts` (신규)
  - `app/page.tsx`
  - `package.json` (recharts 추가)

---

## 2026-03-29 | 심평원 병원정보 전체 갱신 스크립트 작성 및 실행
- 심평원 Open API(getHospBasisList)를 호출해 `hira_hospitals` 테이블을 전체 갱신하는 스크립트 작성
- `scripts/fetch-hira-hospitals.ts` 신규 생성: 15개 종별코드별로 전체 페이지 순회, xml2js로 XML 파싱, Prisma upsert(hiraId 기준), 100ms delay 적용
- `tsconfig.scripts.json` 설정으로 ts-node 실행: `npx ts-node --project tsconfig.scripts.json scripts/fetch-hira-hospitals.ts`
- `prisma/schema.prisma` 및 `prisma/migrations/20260329000002_add_hira_hospital_columns/migration.sql`: `hira_hospitals` 테이블에 homepage, 의사수 관련 12개 컬럼(mdept/dety/cmdc × gdr/intn/resdnt/sdr), midwife_cnt 추가
- ServiceKey URL 인코딩(`encodeURIComponent`) 적용 (미적용 시 401 오류 발생)
- 실행 결과: 총 79,541건 처리 (의원 37,683 / 치과의원 19,334 / 한의원 14,863 외)

---

## 2026-03-29 | 답사 비고란 리치텍스트 에디터 적용
- 답사(SiteVisit) 폼의 비고 textarea를 Tiptap 기반 리치텍스트 에디터로 교체
- `app/components/RichTextEditor.tsx` 신규 생성: `IssueNoteEditor`와 동일한 Tiptap 확장(StarterKit, Underline, Link, TextAlign, Placeholder, Typography) 및 툴바(H1~H3, B/I/U/S, 목록, 인용구, 코드, 링크, 수평선, undo/redo) 적용. `value/onChange` props 방식으로 폼 상태와 연동
- `SiteVisitForm.tsx`: `NoteEditor`(textarea) 제거, `RichTextEditor` 컴포넌트로 교체. 비고 섹션 레이아웃을 풀-width로 변경
- 영향 파일: `app/components/RichTextEditor.tsx` (신규), `app/site-visits/SiteVisitForm.tsx`

---

## 2026-03-29 | 버그수정 - 답사 S3 파일 키 저장 안 되는 문제
- **원인**: `app/site-visits/[id]/page.tsx`의 `SiteVisitData` 인터페이스와 `initialData` 객체에 `installPlanS3Key`, `floorPlanS3Key` 필드가 누락되어 있어, 편집 폼이 항상 빈 값으로 초기화됨. 저장 시 기존 S3 키가 `null`로 덮어씌워지는 문제
- **수정**: `SiteVisitData` 인터페이스에 두 필드 추가, `initialData` 구성 시 API 응답값 매핑 추가. 구 Drive 필드(`installPlanUrl`, `installPlanFileId`, `floorPlanUrl`, `floorPlanFileId`) 제거
- `SiteVisitForm.tsx`와 API(`route.ts`, `[id]/route.ts`)는 이미 정상 구현되어 있어 변경 없음
- 영향 파일: `app/site-visits/[id]/page.tsx`

---

## 2026-03-29 | S3 마이그레이션 Step 4 - 답사(SiteVisit) 파일 업로드를 Google Drive → S3로 교체
- 답사 첨부파일(설치계획서, 도면) 저장소를 Google Drive에서 AWS S3로 전환

### DB 스키마
- `SiteVisit` 모델에 `installPlanS3Key String? @map("install_plan_s3_key")`, `floorPlanS3Key String? @map("floor_plan_s3_key")` 필드 추가
- SQL 직접 실행 후 마이그레이션 파일 등록 (shadow DB 우회 패턴)
- 마이그레이션명: `20260329000001_add_s3_keys_to_site_visit`

### API 변경
- `POST /api/site-visits/upload`: Drive 업로드 제거, `uploadToS3` 호출로 교체. hospitalCode를 query parameter로 받음. S3 key 형식: `site-visits/{hospitalCode}/{fileName}`. 응답: `{ s3Key, fileName }`
- `DELETE /api/site-visits/file` (신규): `{ s3Key }` body 받아 `deleteFromS3` 호출. VIEWER 403
- `GET /api/site-visits/file-url` (신규): `?key=` 쿼리로 presigned URL 생성 후 `{ url }` 반환. 인증 필요
- `POST /api/site-visits`, `PUT /api/site-visits/[id]`: Drive 필드 제거, `installPlanS3Key` / `floorPlanS3Key` 추가

### 프론트엔드 변경 (`app/site-visits/SiteVisitForm.tsx`)
- `SiteVisitFormData`: Drive 관련 필드(`installPlanUrl`, `installPlanFileId`, `floorPlanUrl`, `floorPlanFileId`) 제거, S3 키 필드 2개 추가
- `FileField` 컴포넌트 전면 재작성: S3 기반 업로드/다운로드/삭제로 교체, `app/projects/[code]/page.tsx` 첨부파일 섹션과 동일한 UI 구조 적용
- 파일 업로드: `/api/site-visits/upload?hospitalCode=` 호출, accept 속성 추가
- 파일 다운로드: `/api/site-visits/file-url?key=` 호출 후 `window.open(url)`
- 파일 삭제: `/api/site-visits/file` 호출 후 s3Key 상태 초기화. confirm "정말 삭제하시겠습니까?" 표시
- 삭제 버튼: ADMIN / SUPER_ADMIN만 노출 (`isAdmin` 체크 통일)
- Drive 폴더 의존성 완전 제거 — 병원 Drive 폴더 여부 무관하게 항상 업로드 가능

### 영향 파일
- `prisma/schema.prisma`
- `prisma/migrations/20260329000001_add_s3_keys_to_site_visit/migration.sql` (신규)
- `app/api/site-visits/upload/route.ts`
- `app/api/site-visits/file/route.ts` (신규)
- `app/api/site-visits/file-url/route.ts` (신규)
- `app/api/site-visits/route.ts`
- `app/api/site-visits/[id]/route.ts`
- `app/site-visits/SiteVisitForm.tsx`

---

## 2026-03-29 | 프로젝트 첨부파일 삭제 버튼 로딩 상태 및 동작 보완
- `deletingFileId` 상태 추가: 삭제 중인 파일 ID를 추적하여 해당 버튼만 비활성화 및 "삭제 중..." 텍스트 표시
- `handleDeleteFile` 수정: confirm 문구 변경("정말 삭제하시겠습니까?"), 삭제 성공 후 `router.refresh()` 추가
- 삭제 버튼: ADMIN 역할에만 노출 (기존 유지), `disabled` + `opacity` 처리로 로딩 상태 시각화
- 영향 파일: `app/projects/[code]/page.tsx`

---

## 2026-03-29 | S3 마이그레이션 Step 3 - 프로젝트 파일 업로드를 Google Drive → S3로 교체
- 프로젝트 첨부파일 저장소를 Google Drive에서 AWS S3로 전환
- 기존 driveUrl 보유 파일은 하위 호환 유지 (driveUrl로 열기 가능)

### DB 스키마
- `ProjectFile` 모델에 `s3Key String? @map("s3_key")` 필드 추가
- SQL 직접 실행 후 마이그레이션 파일 등록 (shadow DB 권한 우회 패턴)
- 마이그레이션명: `20260329000000_add_s3_key_to_project_file`

### API 변경
- `POST /api/projects/[code]/files`: Google Drive 업로드 제거, `lib/s3.ts`의 `uploadToS3` 호출로 교체. S3 key 형식: `projects/{projectCode}/{timestamp}_{fileName}`. driveFolderId 의존성 완전 제거
- `DELETE /api/projects/[code]/files/[fileId]`: DB 삭제 전 `s3Key` 존재 시 `deleteFromS3` 호출 추가
- `GET /api/projects/[code]/files/[fileId]/download` (신규): s3Key로 presigned URL 생성 후 `{ url }` 반환. s3Key 없으면 404

### 프론트엔드 변경 (`app/projects/[code]/page.tsx`)
- `ProjectFile` 인터페이스: `driveFileId` 제거, `driveUrl`을 nullable로 변경, `s3Key: string | null` 추가
- Drive 폴더 자동 생성 로직(`loadProject` 내 drive-folder API 호출) 제거
- Drive 폴더 미등록 경고 배너 제거
- 파일 업로드 버튼: `driveProjectFolderId` 체크 조건 제거 → 항상 업로드 가능
- 파일 input `accept` 속성 추가: `.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg`
- 파일명 클릭 시: s3Key 있으면 download 엔드포인트 호출 후 `window.open(url)`, 없으면 driveUrl로 fallback
- `handleAddFileClick`: driveProjectFolderId 가드 제거

### 영향 파일
- `prisma/schema.prisma`
- `prisma/migrations/20260329000000_add_s3_key_to_project_file/migration.sql` (신규)
- `app/api/projects/[code]/files/route.ts`
- `app/api/projects/[code]/files/[fileId]/route.ts`
- `app/api/projects/[code]/files/[fileId]/download/route.ts` (신규)
- `app/projects/[code]/page.tsx`

---

## 2026-03-29 | lib/s3.ts - AWS S3 유틸리티 신규 생성
- AWS S3 연동을 위한 공통 유틸리티 파일 생성
- S3Client를 모듈 상단에서 1회 초기화 후 재사용 (환경변수: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME)
- 구현 함수:
  - `uploadToS3(buffer, key, contentType)`: PutObjectCommand로 파일 업로드, 성공 시 key 반환
  - `getSignedUrl(key, expiresIn?)`: GetObjectCommand + s3-request-presigner로 presigned URL 생성 (기본 만료 1시간)
  - `deleteFromS3(key)`: DeleteObjectCommand로 파일 삭제
- 각 함수에 try-catch 에러 핸들링 포함
- 패키지: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (기존 설치됨)
- 영향 파일: `lib/s3.ts` (신규)

---

## 2026-03-29 | README.md 전면 업데이트
- 현재 소스 전체 파악 후 README.md를 최신 개발 현황에 맞게 전면 수정
- 주요 변경 사항:
  - 프로젝트 설명: DaewoongStaff 관련 문구 제거, 프로젝트/답사 관리 포함하도록 수정
  - 디렉토리 구조: 현재 실제 구조 반영 (projects, site-visits, settings/* 등 추가)
  - DB 스키마: DaewoongStaff 제거, Organization/Project/SiteVisit/DeviceInfo/BuildStatus/Contractor 등 추가
  - 역할 체계: ADMIN/USER 2단계 → SUPER_ADMIN/ADMIN/USER/VIEWER 4단계로 업데이트
  - 주요 기능: 대시보드, 프로젝트 관리, 답사 관리, 소속 관리, SUPER_ADMIN 타계정 수정 기능 추가
  - API 엔드포인트: daewoong-staff API 제거, projects/site-visits/constructors/settings/* 전체 추가
- 영향 파일: `README.md`

---

## 2026-03-26 | 계정 관리 - SUPER_ADMIN 타계정 수정 기능 추가

- SUPER_ADMIN이 다른 계정의 이름/연락처/역할/소속/비밀번호를 수정할 수 있도록 기능 추가
- 계정 목록에서 타계정 행에 "수정" 버튼 추가 (SUPER_ADMIN에게만 표시)
- 수정 모달: 이름, 연락처, 역할(VIEWER/USER/ADMIN/SUPER_ADMIN), 소속, 비밀번호 변경 폼
- SUPER_ADMIN이 타인 비밀번호 변경 시 현재 비밀번호 확인 과정 생략 (관리자 권한)
- 영향 파일: `app/users/page.tsx`, `app/api/users/[id]/route.ts`

---

## 2026-03-24 | 버그수정 - 대시보드 buildStatus 캐시 불일치 문제
- **원인**: Next.js 14 App Router에서 동적 API를 사용하지 않는 GET Route Handler는 빌드 타임에 정적으로 캐시됨. `app/api/dashboard/route.ts`가 정적 캐시로 서빙되어, DB에서 buildStatus 변경 후에도 대시보드가 빌드 당시 값을 표시하는 문제
- **수정**: `app/api/dashboard/route.ts` 상단에 `export const dynamic = 'force-dynamic'` 추가 → 매 요청마다 DB를 새로 조회
- **영향 파일**: `app/api/dashboard/route.ts`

---

## 2026-03-24 14:00 | PROD v1.0.0 배포 (DEV DB 전체 복제)
- PROD .env 구성: DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_APP_NAME PROD 값으로 설정
- PROD git pull (main) 및 npm install 완료
- thync_ops DB 신규 생성 (pg_hba.conf trust 임시 설정 후 원복)
- DEV(thync_ops_dev) → PROD(thync_ops) pg_dump | psql 방식으로 전체 복제
- 복제 결과: users 4, hospitals 172, projects 184, organizations 2, site_visits 1
- Prisma 마이그레이션 21개 모두 적용 상태 확인, prisma generate 완료
- npm run build 및 pm2 restart thync-prod 완료, 포트 3000 정상 기동

---

## 2026-03-24 | SUPER_ADMIN 계정 설정 및 DAEWOONG 삭제 보호
- joon.lee@seerstech.com 계정 role을 ADMIN → SUPER_ADMIN으로 DB 직접 변경
- 조직 삭제 API(`/api/settings/organizations/[id]`)에 DAEWOONG 코드 기반 영구 삭제 보호 추가 (code === 'DAEWOONG'이면 409 반환)
- 영향 파일: `app/api/settings/organizations/[id]/route.ts`, DB users 테이블

---

## 2026-03-24 | 페이지/컴포넌트 - Organization/User 기반으로 전면 교체

### 변경 배경
- DaewoongStaff 관련 페이지 폐기 및 User/Organization 기반으로 전면 교체
- SUPER_ADMIN 역할 UI 반영 (네비게이션, 역할 배지, 소속 관리 메뉴 등)

### Navigation.tsx
- SUPER_ADMIN 역할 타입 추가, 역할 레이블 추가('최고관리자')
- 대웅제약 관리 메뉴 전체 제거
- 소속 관리 메뉴 추가 (SUPER_ADMIN만, 설정 하위 최상단)
- isAdminOrAbove 헬퍼 적용 (심평원 병원목록, 답사 상태 관리 등)

### 삭제
- `app/daewoong-staff/` 디렉토리 전체 삭제
- `scripts/migrate-daewoong-to-user.ts`, `update-daewoong-fk.ts`, `daewoong-user-mapping.json` 삭제 (마이그레이션 완료)

### 신규 페이지
- `app/settings/organizations/page.tsx`: 소속 관리 (SUPER_ADMIN 전용, 인라인 수정, 순서이동, 추가/삭제)

### 수정된 페이지/컴포넌트
- `app/users/page.tsx`: 소속 컬럼 추가, 계정 생성 폼에 소속 드롭다운 추가, SUPER_ADMIN 배지 추가
- `app/settings/profile/page.tsx`: 계정 정보에 소속 항목 추가 (읽기 전용), SUPER_ADMIN 역할 레이블 추가
- `app/hospitals/[code]/_components/DaewoongStaffTab.tsx`: User(DAEWOONG 소속) 기반으로 전면 교체, daewoong-staff 링크 제거
- `app/hospitals/[code]/page.tsx`: isAdmin에 SUPER_ADMIN 포함
- `app/site-visits/page.tsx`: daewoongStaff → daewoongUser 필드명 교체

### prisma/schema.prisma
- DaewoongStaff 모델 제거 (테이블은 유지)

### prisma/seed.ts
- Organization seed 추가 (SEERS, DAEWOONG upsert by code)

---

## 2026-03-24 | API - Organization 추가, DaewoongStaff → User 교체, 권한 헬퍼 적용

### 변경 배경
- DaewoongStaff 기반 API를 User 기반으로 전면 교체
- Organization 관리 API 신규 추가 (SUPER_ADMIN 전용)
- SUPER_ADMIN 역할이 ADMIN 권한을 포함하도록 공통 헬퍼 적용

### lib/auth.ts
- `isAdminOrAbove(role)`: SUPER_ADMIN 또는 ADMIN 체크 헬퍼 추가
- `isSuperAdmin(role)`: SUPER_ADMIN 전용 체크 헬퍼 추가

### 신규 API
- `app/api/settings/organizations/route.ts`: GET(목록+유저수), POST(SUPER_ADMIN 전용)
- `app/api/settings/organizations/[id]/route.ts`: PUT, DELETE(SUPER_ADMIN 전용, 유저 있으면 409)

### 삭제된 API
- `app/api/daewoong-staff/` 디렉토리 전체 삭제

### 수정된 API
- `app/api/hospitals/[code]/daewoong-staff/route.ts`: GET은 기존 assignments 유지, POST는 userId + DAEWOONG 조직 검증
- `app/api/site-visits/route.ts`, `app/api/site-visits/[id]/route.ts`: body 필드 daewoongStaffId → daewoongUserId
- `app/api/users/route.ts`: organization include 추가, ?organization= 필터, POST에 organizationId 추가
- `app/api/users/[id]/route.ts`: PUT에 organizationId 처리, 전체 role 체크 isAdminOrAbove 적용
- `app/api/auth/login/route.ts`: JWT payload에 organization 포함
- `app/api/auth/me/route.ts`: 응답에 organization 포함

### 권한 체크 일괄 교체 (role === 'ADMIN' → isAdminOrAbove)
- `app/api/settings/site-visit-status/route.ts`, `[id]/route.ts`
- `app/api/hospitals/[code]/route.ts`
- `app/api/projects/[code]/files/[fileId]/route.ts`
- `app/api/constructors/route.ts`, `[code]/route.ts`
- `app/api/drive/export/hospitals/route.ts`

### 클라이언트
- `app/site-visits/SiteVisitForm.tsx`: /api/daewoong-staff → /api/users?organization=DAEWOONG, daewoongStaffId → daewoongUserId
- `app/site-visits/[id]/page.tsx`: daewoongStaffId → daewoongUserId

---

## 2026-03-24 | DaewoongStaff → User 마이그레이션 및 FK 교체

### 변경 배경
- 대웅 직원 정보를 별도 DaewoongStaff 테이블이 아닌 User 테이블로 통합 관리
- 조직(Organization) 구분(SEERS/DAEWOONG)으로 대웅 직원 식별

### DB 마이그레이션 (SQL + migrate resolve 패턴)
- `daewoong_hospital_assignments.staff_id` → `assigned_user_id` (FK: users.id)
- `site_visits.daewoong_staff_id` → `daewoong_user_id` (FK: users.id)
- 마이그레이션 스크립트: `scripts/migrate-daewoong-to-user.ts`, `scripts/update-daewoong-fk.ts`

### Prisma 스키마 변경
- `DaewoongHospitalAssignment`: `staffId/staff` → `assignedUserId/assignedUser`
- `SiteVisit`: `daewoongStaffId/daewoongStaff` → `daewoongUserId/daewoongUser`
- User 모델에 역방향 관계 (`hospitalAssignments`, `daewoongSiteVisits`, `assignedSiteVisits`) 추가
- Named relation 사용: `"SiteVisitDaewoongUser"`, `"SiteVisitAssignee"`

### API 라우트 수정
- `app/api/daewoong-staff/route.ts`: `_count.assignments` include 제거
- `app/api/daewoong-staff/[id]/route.ts`: `staffId` → `assignedUserId`
- `app/api/hospitals/[code]/daewoong-staff/route.ts`: `staff` → `assignedUser`, `staffId` → `assignedUserId`
- `app/api/hospitals/[code]/daewoong-staff/[sid]/route.ts`: `staffId` → `assignedUserId`
- `app/api/site-visits/route.ts`: include `daewoongStaff` → `daewoongUser`, data `daewoongStaffId` → `daewoongUserId`
- `app/api/site-visits/[id]/route.ts`: 동일 변경

---

## 2026-03-24 | DB 스키마 변경 - Organization 추가, Role 4단계 확장

### DB 변경 (SQL 직접 실행 + migrate resolve 패턴)
- `Role` enum에 `SUPER_ADMIN` 추가 (기존: ADMIN/USER/VIEWER → 4단계: SUPER_ADMIN/ADMIN/USER/VIEWER)
- `organizations` 테이블 신규 생성: id, name, code(unique), is_active, sort_order, created_at
- 기본 데이터 삽입: 씨어스(SEERS), 대웅제약(DAEWOONG)
- `users` 테이블에 `organization_id` FK 컬럼 추가 (organizations 참조, nullable)

### 마이그레이션 파일
- `prisma/migrations/20260324000000_add_super_admin_role/migration.sql`
- `prisma/migrations/20260324000001_add_organizations/migration.sql`
- `prisma/migrations/20260324000002_add_organization_to_user/migration.sql`

### 수정된 파일
- `prisma/schema.prisma` - Role enum 확장, Organization 모델 추가, User 모델에 organization 관계 추가
- `lib/auth.ts` - JWTPayload에 SUPER_ADMIN role 추가, organization 필드 추가

---

## 2026-03-24 | 버그 수정: 수정 저장 후 목록에 이전 데이터 표시 문제 해결

### 문제 원인
Next.js App Router의 클라이언트 Router Cache로 인해, API 성공 후 `router.push()`로 이동하거나 현재 페이지를 유지할 때 이전 데이터가 표시되는 문제. 서버의 `revalidatePath`만으로는 클라이언트 Router Cache가 무효화되지 않음.

### 해결 방법
모든 PUT/POST/DELETE API 호출 성공 후 `router.refresh()`를 추가:
- **이동이 있는 경우**: `router.refresh()` → `router.push()` 순서로 호출
- **이동이 없는 경우**: API 성공 후 `router.refresh()` 호출 후 로컬 상태 업데이트

### 수정된 파일
- `app/projects/new/page.tsx` - POST 성공 후 push 전 refresh 추가
- `app/projects/[code]/page.tsx` - PUT 저장 및 DELETE 시 refresh 추가
- `app/hospitals/register/page.tsx` - POST 성공 후 push 전 refresh 추가
- `app/hospitals/[code]/edit/page.tsx` - push 이후 중복 refresh 제거 (패턴 정리)
- `app/hospitals/[code]/_components/DeleteButton.tsx` - DELETE 후 push 전 refresh 추가
- `app/site-visits/SiteVisitForm.tsx` - PUT/POST/DELETE 성공 후 push 전 refresh 추가
- `app/daewoong-staff/[id]/page.tsx` - PUT/DELETE/병원배정/해제 시 refresh 추가
- `app/daewoong-staff/page.tsx` - POST 성공 후 refresh 추가
- `app/users/page.tsx` - useRouter 추가, 모든 mutation(PATCH/DELETE/POST/PUT) 후 refresh 추가
- `app/settings/devices/page.tsx` - useRouter 추가, 모든 mutation 후 refresh 추가
- `app/settings/build-status/page.tsx` - useRouter 추가, 모든 mutation 후 refresh 추가
- `app/page.tsx` - useRouter 추가, 비고 PUT 저장 후 refresh 추가

---

## 2026-03-23 | 답사(Site Visit) 관리 기능 추가

### DB 스키마
- `StatusCode` 모델에 `category` 필드 추가 (`HOSPITAL` / `SITE_VISIT` 구분), 기존 데이터는 `HOSPITAL`로 마이그레이션
- `StatusCode` unique 제약: `name` 단독 → `(name, category)` 복합 unique로 변경
- `SiteVisit` 모델 신규 추가: hospitalCode, daewoongStaffId, assigneeId, requestDate, visitDate, replyDate, statusId, installPlanUrl, installPlanFileId, floorPlanUrl, floorPlanFileId, notes
- `Hospital`, `DaewoongStaff`, `User`, `StatusCode`에 `siteVisits` relation 추가
- 마이그레이션: SQL 직접 실행 + `prisma migrate resolve --applied 20260323120000_add_site_visit`

### API
- `GET/POST /api/settings/site-visit-status`: 답사 상태코드 목록/등록 (POST는 ADMIN 전용)
- `PUT/DELETE /api/settings/site-visit-status/[id]`: 수정/삭제 (ADMIN 전용, 사용 중이면 삭제 차단)
- `GET/POST /api/site-visits`: 답사 목록 조회(페이지네이션)/등록
- `GET/PUT/DELETE /api/site-visits/[id]`: 답사 단건 조회/수정/삭제 (DELETE는 ADMIN 전용)
- `POST /api/site-visits/upload`: 병원 Drive 폴더에 파일 업로드 (multipart/form-data)
- `DELETE /api/drive/delete`: Drive 파일 삭제 API 신규 추가
- 기존 `/api/settings/status`: category='HOSPITAL' 필터 추가로 기존 동작 유지

### 페이지
- `app/settings/site-visit-status/page.tsx`: 답사 상태 관리 (ADMIN 전용, 병원 상태코드 관리와 동일 구조)
- `app/site-visits/page.tsx`: 답사 현황 목록 (병원명/대웅담당자/담당자/상태/요청일/답사날짜/설치계획서/회신날짜)
- `app/site-visits/new/page.tsx`: 답사 등록 폼
- `app/site-visits/[id]/page.tsx`: 답사 상세/수정 폼 (ADMIN만 삭제 버튼 노출)
- `app/site-visits/SiteVisitForm.tsx`: 등록/수정 공용 폼 컴포넌트 (Drive 파일 업로드/삭제 포함)

### Navigation
- '답사 현황' 메뉴 추가 (프로젝트 관리 아래, 모든 역할 접근 가능)
- 설정 하위에 '답사 상태 관리' 항목 추가 (ADMIN 전용)

### 기타
- `lib/googleDrive.ts`: `deleteDriveFile` 함수 추가
- `prisma/seed.ts`: StatusCode upsert를 복합 unique 키(`name_category`)로 수정

- 영향받은 파일: `prisma/schema.prisma`, `prisma/seed.ts`, `lib/googleDrive.ts`, `app/components/Navigation.tsx`, `app/api/settings/status/route.ts`, `app/api/settings/status/[id]/route.ts`, `app/api/settings/site-visit-status/route.ts`, `app/api/settings/site-visit-status/[id]/route.ts`, `app/api/site-visits/route.ts`, `app/api/site-visits/[id]/route.ts`, `app/api/site-visits/upload/route.ts`, `app/api/drive/delete/route.ts`, `app/settings/site-visit-status/page.tsx`, `app/site-visits/page.tsx`, `app/site-visits/new/page.tsx`, `app/site-visits/[id]/page.tsx`, `app/site-visits/SiteVisitForm.tsx`

---

## 2026-03-23 | 전체 로직 점검 및 버그/보안 수정

### 버그 수정
- 프로젝트 상세 저장 후 목록으로 돌아가면 반영 안 되는 문제: `PUT /api/projects/[code]` 저장 성공 시 `revalidatePath('/projects')` 호출하여 클라이언트 Router Cache 무효화 (VIEWER 경로 포함)

### 보안 수정 (인증 누락)
- `POST /api/hospitals/[code]/daewoong-staff`: 인증 체크 없음 → `getAuthUser` + VIEWER 403 추가
- `DELETE /api/hospitals/[code]/daewoong-staff/[sid]`: 인증 체크 없음 → `getAuthUser` + VIEWER 403 추가

### 로직 강화
- `DELETE /api/hospitals/[code]`: VIEWER 403 → ADMIN 전용으로 강화, 연결된 프로젝트 존재 시 409 에러 반환 (DB 오류 방지 사전 체크)

### 코드 일관성
- `GET|PUT /api/hospitals/[code]/devices`: `cookies()` + `verifyToken()` 직접 호출 방식 → 전체 통일된 `getAuthUser(request)` 패턴으로 교체, PUT에 VIEWER 403 추가

- 영향받은 파일: `app/api/projects/[code]/route.ts`, `app/api/hospitals/[code]/daewoong-staff/route.ts`, `app/api/hospitals/[code]/daewoong-staff/[sid]/route.ts`, `app/api/hospitals/[code]/route.ts`, `app/api/hospitals/[code]/devices/route.ts`

---

## 2026-03-23 | 비고 필드 추가 및 대시보드 UI 개편

- DB: projects 테이블에 remark TEXT 컬럼 추가 (SQL 직접 실행 + prisma migrate resolve --applied)
- Schema: Project 모델에 `remark String? @map("remark")` 필드 추가
- API PUT /api/projects/[code]: remark 필드 저장 처리 (VIEWER 경로 포함)
- API GET /api/dashboard: remark, builderUserId, builderNameManual, builder { name } select에 추가
- 프로젝트 상세 페이지: 구축 정보 카드 마지막에 비고 input 추가, 저장 시 함께 전송
- 대시보드 페이지: 서버→클라이언트 컴포넌트 전환, /api/dashboard fetch 사용
  - 컬럼 통일: 병원명 | 진행상태 | 구축 시작일 | 구축 종료일(예상) | 담당자 | 비고 | (수정 버튼)
  - 담당자: builderUser.name → builderNameManual 순으로 폴백
  - 비고 인라인 수정: '수정' 버튼 → input 전환 → '저장' 버튼으로 PUT 호출, 저장 후 텍스트 복귀
  - 이번주/차주 헤더 요약 텍스트(진행상태별 건수, 신규구축 건수) 유지
- 영향받은 파일: `prisma/schema.prisma`, `app/api/projects/[code]/route.ts`, `app/api/dashboard/route.ts`, `app/projects/[code]/page.tsx`, `app/page.tsx`

---

## 2026-03-22 | ADMIN 프로필 수정 버그 수정 및 계정 삭제 기능 추가

- API PUT /api/users/[id]: `isSelf`/`isAdmin` boolean으로 권한 체크 리팩토링, 빈 updateData 400 에러 처리 추가
- API DELETE /api/users/[id]: 신규 추가 - ADMIN 전용, 자기 자신 삭제 불가
- /users 페이지: ADMIN에게 계정 삭제 버튼 표시 (자기 자신 제외), `deletingId` 상태로 로딩 처리
- /settings/profile 페이지: `/api/auth/me` 에러 응답 시 `me.id` undefined 접근 방지 (id 유무로 가드 추가)
- 영향받은 파일: `app/api/users/[id]/route.ts`, `app/users/page.tsx`, `app/settings/profile/page.tsx`

---

## 2026-03-22 22:00 | 권한 3단계(ADMIN/USER/VIEWER) 개편 및 내 프로필 페이지 추가

### DB / Prisma
- `Role` enum에 `VIEWER` 추가: `ALTER TYPE "Role" ADD VALUE 'VIEWER'` 직접 실행 후 `prisma migrate resolve --applied`
- `prisma/schema.prisma` Role enum 업데이트, `npx prisma generate` 재실행

### lib/auth.ts
- `JWTPayload.role` 타입에 `'VIEWER'` 추가
- `getAuthUser(req)` 헬퍼 함수 추가 (쿠키에서 토큰 파싱 → JWTPayload 반환)

### API 라우트 — VIEWER 403 처리
- `POST /api/hospitals`, `PUT/DELETE /api/hospitals/[code]`: VIEWER 차단
- `POST /api/daewoong-staff`, `PUT/DELETE /api/daewoong-staff/[id]`: VIEWER 차단
- `POST /api/projects`: VIEWER 차단
- `PUT /api/projects/[code]`: VIEWER는 issueNote 필드만 허용 (나머지 필드 차단)
- `DELETE /api/projects/[code]`: VIEWER 차단
- `POST /api/settings/build-status`, `PUT/DELETE /api/settings/build-status/[id]`: VIEWER 차단
- `POST /api/settings/status`, `PUT/DELETE /api/settings/status/[id]`: VIEWER 차단
- `POST /api/settings/devices`, `PUT/DELETE /api/settings/devices/[id]`: VIEWER 차단

### users API 개편
- `GET /api/users`: ADMIN 전용 → 모든 로그인 사용자 허용 (USER/VIEWER도 목록 조회 가능)
- `POST /api/users`: ADMIN 전용 유지
- `PATCH /api/users/[id]`: ADMIN 전용 유지 (isActive 토글)
- `PUT /api/users/[id]` 신규 추가: 본인 또는 ADMIN만 허용, name/phone/비밀번호 변경
  - 비밀번호 변경: currentPassword bcrypt.compare 검증 후 새 비밀번호 해싱 저장
  - 역할(role) 변경: ADMIN만 가능

### Navigation.tsx
- `userRole` 타입에 `'VIEWER'` 추가
- 심평원 병원목록: ADMIN만 노출
- 대웅제약 관리: ADMIN, USER만 노출
- 설정 서브메뉴: 내 프로필(모든 역할) + 나머지(ADMIN, USER)
- 계정 관리: 모든 역할 노출
- 하단 역할 표시: '관리자' / '일반' / '뷰어'

### app/users/page.tsx
- `User.role` 타입 VIEWER 추가, 역할 배지 VIEWER(파란색) 추가
- 계정 생성 버튼: ADMIN만 노출
- 활성화/비활성화 버튼: ADMIN만 노출 (컬럼 자체 숨김)
- 현재 로그인 유저 행에 '(나)' 표시 및 하이라이트

### app/settings/profile/page.tsx (신규)
- 모든 역할 접근 가능, 설정 메뉴 최상단
- 계정 정보 카드: 이메일/역할 읽기 전용 표시
- 기본 정보 카드: 이름/전화번호 수정, `PUT /api/users/[id]` 호출
- 비밀번호 변경 카드: 현재 비밀번호 확인 → 새 비밀번호 변경
- 성공/실패 인라인 메시지 표시

- 영향 파일: `prisma/schema.prisma`, `lib/auth.ts`, `app/api/users/route.ts`, `app/api/users/[id]/route.ts`, `app/api/hospitals/route.ts`, `app/api/hospitals/[code]/route.ts`, `app/api/daewoong-staff/route.ts`, `app/api/daewoong-staff/[id]/route.ts`, `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`, `app/api/settings/build-status/route.ts`, `app/api/settings/build-status/[id]/route.ts`, `app/api/settings/status/route.ts`, `app/api/settings/status/[id]/route.ts`, `app/api/settings/devices/route.ts`, `app/api/settings/devices/[id]/route.ts`, `app/components/Navigation.tsx`, `app/users/page.tsx`, `app/settings/profile/page.tsx`

---

## 2026-03-22 21:20 | 이슈 노트 에디터 뷰어/수정 모드 분리

- `IssueNoteEditor.tsx` 수정: 기본값을 뷰어 모드(editable: false)로 변경
  - 뷰어 모드: 콘텐츠 읽기 전용 표시, 우측 상단 "수정" 버튼
  - 수정 모드: "수정" 버튼 클릭 시 에디터 활성화 + 툴바 표시, "완료" 버튼 클릭 시 즉시 저장 후 뷰어 모드 복귀
  - "완료" 클릭 시 debounce 대기 없이 즉시 플러시 저장
  - 내용 없을 때 뷰어 모드에서 "등록된 이슈 노트가 없습니다." 안내 표시
  - 뷰어/수정 모드 모두 에디터 항상 마운트 유지 (editable 토글 방식)
- 영향 파일: `app/components/IssueNoteEditor.tsx`

---

## 2026-03-22 21:00 | 이슈 노트 Tiptap 리치 텍스트 에디터 교체

- `app/components/IssueNoteEditor.tsx` 신규 생성 (Tiptap 기반 클라이언트 컴포넌트)
  - 패키지: @tiptap/react, @tiptap/pm, @tiptap/starter-kit, extension-link, extension-underline, extension-text-align, extension-placeholder, extension-typography (전체 v3.20.4)
  - 툴바 버튼: H1/H2/H3 | Bold/Italic/Underline/Strike | BulletList/OrderedList | Blockquote/Code/CodeBlock | Link | HorizontalRule | Undo/Redo
  - debounce 자동저장: 타이핑 멈춘 후 2초 뒤 PUT /api/projects/[code] 호출 (issueNote만 전달)
  - 저장 상태 툴바 우측 표시: "저장 중..." / "저장됨 HH:MM" / "저장 실패"(빨간 텍스트)
  - 링크 삽입/해제: window.prompt로 URL 입력, 활성 시 해제
  - Placeholder: "이슈 및 특이사항을 기록하세요..."
  - 에디터 내부 타이포그래피: h1~h3 크기 차이, 목록 들여쓰기, blockquote 좌측 border, code/pre 스타일 인라인 CSS
  - USER 권한도 이슈노트 편집 가능 (에디터 자체 저장이므로 권한 분기 불필요)
- `app/projects/[code]/page.tsx` 수정: 이슈 노트 `<textarea>` → `<IssueNoteEditor>` 컴포넌트로 교체, issueNote state 제거, handleSave에서 issueNote 제외
- `PUT /api/projects/[code]` API: 이미 partial update 방식(`!== undefined` 패턴)이므로 별도 수정 없음
- 영향 파일: `app/components/IssueNoteEditor.tsx`, `app/projects/[code]/page.tsx`

---

## 2026-03-22 19:30 | 메인 페이지 대시보드 추가

- `GET /api/dashboard` 신규 생성: 이번주/차주 구축현황 반환
  - 이번주: buildStatus null이거나 "완료"가 아닌 프로젝트 + 이번주 startDate 범위 프로젝트 OR 조합, 중복 제거
  - 차주: startDate가 차주 월~일 범위 내 프로젝트
  - 날짜 범위 Asia/Seoul 기준 계산, endDateExpected asc(null 마지막) 정렬
- `app/page.tsx` 대시보드 UI 구현
  - "이번주 thynC 구축 현황" 카드: 번호·병원명·진행상태(StatusBadge)·예상종료일·비고 테이블, 헤더에 buildStatus별 건수 요약
  - "차주 thynC 구축 예정" 카드: 번호·병원명·시작일·예상종료일·비고 테이블, 헤더에 N건 신규구축 요약
  - 병원명 클릭 시 `/projects/[code]`로 이동, 예상종료일 없으면 "미정" 표시
  - 데이터 없을 때 안내 메시지 표시
- 영향 파일: `app/page.tsx`, `app/api/dashboard/route.ts`

---

## 2026-03-22 18:30 | 프로젝트 contractType UI 반영 및 목록 필터/정렬 기능 추가

- `Project` 상세 페이지 계약 정보 카드에 "도입형태" 필드 추가 (계약일 아래, 텍스트 input)
- `PUT /api/projects/[code]` — contractType 필드 저장 처리 추가
- 프로젝트 목록 테이블에 "도입형태" 컬럼 추가 (계약일과 진행상태 사이)
- `GET /api/projects` — search, buildStatusId, contractorId, builderId, orderBy, order 쿼리 파라미터 처리 추가. 기본 정렬: contractDate desc
- `ProjectFilters` 컴포넌트 전면 개편: 진행상태·구축업체·담당자 셀렉트 필터 추가, 정렬기준·정렬방향 셀렉트 추가 (2행 레이아웃)
- `ProjectPagination` 컴포넌트 — 새 URL 파라미터(buildStatusId, contractorId, builderId, orderBy, order) 보존 처리
- `projects/page.tsx` — 새 searchParams 수신 후 Prisma where/orderBy 적용, 컴포넌트에 props 전달
- 영향 파일: `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`, `app/projects/page.tsx`, `app/projects/[code]/page.tsx`, `app/projects/_components/ProjectFilters.tsx`, `app/projects/_components/ProjectPagination.tsx`

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
