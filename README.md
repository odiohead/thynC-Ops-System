# thynC Operations System

thynC 구축 및 운영을 위한 내부 데이터 관리 시스템입니다.
병원 정보 관리, 프로젝트(구축 공사) 관리, 답사 관리, 조직/사용자 권한 관리 기능을 제공합니다.

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| 프레임워크 | Next.js 14 (App Router) |
| 언어 | TypeScript |
| 스타일링 | Tailwind CSS |
| ORM | Prisma |
| 데이터베이스 | PostgreSQL |
| 인증 | JWT (httpOnly 쿠키, jose 라이브러리) |
| 파일 스토리지 | AWS S3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) |
| 차트 | Recharts |
| 리치 텍스트 에디터 | Tiptap (`@tiptap/react` + 확장) |
| 프로세스 관리 | PM2 |
| 웹서버 | Nginx |
| 런타임 | Node.js 20 |

---

## 서버 환경

| 환경 | URL | 포트 | PM2 프로세스명 |
|------|-----|------|----------------|
| DEV  | https://dev.ops.seersthync.com | 3001 | `thync-dev`  |
| PROD | https://ops.seersthync.com     | 3000 | `thync-prod` |

---

## 디렉토리 구조

```
thynC-Ops-System/
├── thynC-Ops-DEV/     # 개발 환경
└── thynC-Ops-PROD/    # 운영 환경
```

```
app/
├── api/                              # API Routes
│   ├── auth/                         # 인증 (login, logout, me)
│   ├── dashboard/                    # 대시보드 (이번 주/다음 주 공사 현황)
│   ├── hospitals/                    # 병원 CRUD + 장비 배정 + 담당자 배정 + Excel 가져오기
│   ├── hira-hospitals/               # HIRA 병원 데이터 조회
│   ├── projects/                     # 프로젝트 CRUD + 장비/파일 관리
│   ├── site-visits/                  # 답사 CRUD + 파일 업로드
│   ├── constructors/                 # 시공사 관리
│   ├── users/                        # 시스템 사용자 관리
│   ├── settings/
│   │   ├── organizations/            # 소속(조직) 관리 (SUPER_ADMIN 전용)
│   │   ├── devices/                  # 장비 정보 관리
│   │   ├── build-status/             # 공사 상태 관리
│   │   ├── status/                   # 병원 상태코드 관리
│   │   └── site-visit-status/        # 답사 상태코드 관리
│   └── drive/                        # Google Drive 연동 (파일 업로드/목록/삭제/병원목록 내보내기)
├── (대시보드)/                        # 메인 대시보드 (이번 주/다음 주 공사 현황)
├── hospitals/                        # 병원 목록·상세·등록·수정
├── hira-hospitals/                   # HIRA 병원 조회
├── projects/                         # 프로젝트 목록·상세·등록
├── site-visits/                      # 답사 목록·상세·등록
├── users/                            # 사용자 관리 (ADMIN 이상)
├── settings/
│   ├── profile/                      # 내 계정 정보
│   ├── organizations/                # 소속 관리 (SUPER_ADMIN 전용)
│   ├── devices/                      # 장비 정보 관리
│   ├── build-status/                 # 공사 상태 관리
│   ├── status/                       # 병원 상태코드 관리
│   ├── site-visit-status/            # 답사 상태코드 관리
│   └── constructors/                 # 시공사 관리
├── login/                            # 로그인 페이지
└── components/                       # 공통 컴포넌트 (Navigation, MainWrapper)

lib/
├── auth.ts                           # JWT 인증 유틸리티 + 역할 헬퍼
├── prisma.ts                         # Prisma 클라이언트
├── s3.ts                             # AWS S3 연동 유틸리티 (업로드/삭제/presigned URL)
└── googleDrive.ts                    # Google Drive 연동 유틸리티

prisma/
├── schema.prisma                     # DB 스키마
├── seed.ts                           # 기본 데이터 시드 (Organization 포함)
├── seed-admin.ts                     # 관리자 계정 생성
└── seed-hira.ts                      # HIRA 병원 데이터 시드
```

---

## 데이터베이스 스키마

### User (시스템 사용자)
- 이메일, 비밀번호(bcrypt), 이름, 전화번호
- 역할: `SUPER_ADMIN` / `ADMIN` / `USER` / `VIEWER`
- 소속(Organization) 연결 (organizationId)

### Organization (소속/조직)
- 사용자 그룹 단위 (예: SEERS, DAEWOONG)
- code (고유 코드, 대문자), name, isActive, sortOrder
- 삭제 보호: `DAEWOONG` 코드는 영구 삭제 불가

### HiraHospital (건강보험심사평가원 병원 원본 데이터)
- HIRA에서 가져온 공공 병원 데이터 원본
- hiraId, 병원명, 종별코드, 시도/시군구, 주소, 전화번호, 의사 수 등

### Hospital (운영 병원)
- hospitalCode (고유 코드), HiraHospital과 연결 (hiraId)
- HIRA 병원명 / 운영상 병원명 구분
- 상태 (status), 좌표 정보 포함
- 도입형태 (`intro_type`): 구축형/구독형/사용량비례형 (복수 시 쉼표 구분)
- 도입 병상 수 (`intro_beds`)

### HospitalMeta (병원 메타 정보)
- Hospital과 1:1 관계
- Google Drive 폴더 ID (`driveProjectFolderId`), Drive 상태 파일 ID (`driveStatusFileId`), Drive 설치계획 파일 ID (`driveInstallPlanFileId`)
- 원격 접속 URL (`remoteAccessUrl`), 원격 제어 URL (`remoteControlUrl`)

### HospitalDevice (병원 장비)
- Hospital ↔ DeviceInfo N:M 관계 테이블

### Project (프로젝트)
- 구축 공사 프로젝트 단위
- `projectCode`, `projectName`, `orderNumber` (내부 순번)
- 병원 연결, 담당자(`builderUserId` 또는 `builderNameManual`), 시공사(`constructorId`)
- 계약 정보: `contractDate`, `contractType`
- 규모: `wardCount` (병동 수), `bedCount` (병상 수), `gatewayCount` (게이트웨이 수)
- 진행 플래그: `hasSurvey` (답사 완료), `hasOrder` (발주 완료)
- 공사 상태(`buildStatus`), 시작일/완료예정일, 비고(`remark`), 이슈 노트(`issueNote`, 리치 텍스트)
- Google Drive 폴더 연결 (`driveFolderId`)

### ProjectDevice (프로젝트 장비)
- Project ↔ DeviceInfo 관계 + 수량

### ProjectFile (프로젝트 파일)
- 프로젝트에 첨부된 파일
- 파일 카테고리 (`fileCategory`), Google Drive 필드 (`driveFileId`, `driveUrl`) + S3 키 (`s3Key`) 병행 지원

### SiteVisit (답사)
- 병원 답사 기록
- 담당자 `daewoongUserId` (DAEWOONG 소속 User) + 추가 담당자 `assigneeId` (2인 지원)
- 상태코드 연결, 방문일/요청일/회신일
- 파일(설치계획서·평면도) 첨부: Drive 필드 (`installPlanUrl`, `floorPlanUrl`) + S3 키 (`installPlanS3Key`, `floorPlanS3Key`) 병행 지원
- 노트(`notes`): 리치 텍스트(Tiptap)

### DaewoongHospitalAssignment (병원 담당자 배정)
- User(DAEWOONG 소속) ↔ Hospital N:M 관계 테이블

### DeviceInfo (장비 정보)
- 장비 모델명, 이름, 정렬 순서

### BuildStatus (공사 상태)
- 공사 진행 상태 정의 (레이블, 색상)

### StatusCode (상태코드)
- 병원/답사 상태값 정의 (커스터마이징 가능, 색상 포함)

### Contractor (시공사)
- 시공사 코드, 이름, 연락처 등

---

## 인증 및 역할 체계

### 역할 (Role)

| 역할 | 설명 |
|------|------|
| `SUPER_ADMIN` | 전체 시스템 최고 관리자. 소속 관리, 타계정 수정 포함 모든 권한 |
| `ADMIN` | 일반 관리자. 사용자 생성, 설정 관리 등 |
| `USER` | 일반 사용자. 병원·프로젝트·답사 생성·수정 가능 |
| `VIEWER` | 읽기 전용. 모든 데이터 조회만 가능, 수정 불가 |

### 역할 헬퍼 (`lib/auth.ts`)
- `isAdminOrAbove(role)` — SUPER_ADMIN 또는 ADMIN 여부
- `isSuperAdmin(role)` — SUPER_ADMIN 여부

### JWT 인증
- `auth-token` 쿠키에 JWT 저장 (httpOnly)
- 페이로드: userId, email, name, role, isActive, organization
- 만료: 7일
- 미들웨어(`middleware.ts`)로 모든 페이지 인증 보호

---

## 주요 기능

### 대시보드
- 이번 주 / 다음 주 공사 예정 프로젝트 현황
- 공사 상태별 요약, 비고 인라인 수정
- **월별 누적 사용 현황**: 신규 병원/병상, 누적 병원/병상 추이 (Recharts 차트)
- **월별 신규 병원/병상 막대 차트** (ComposedChart)
- 캐시 미사용 (`force-dynamic`), 매 요청마다 DB 조회

### 병원 관리
- HIRA 병원 데이터 검색 및 조회 (모달 방식)
- 운영 병원 등록·수정·삭제
  - 등록: 병원명+상태만으로 즉시 등록, HIRA 연결은 선택
  - 수정: HIRA 병원 연결 변경·해제 지원
- 병원별 담당자(DAEWOONG 소속 User) 배정·해제
- 병원별 장비 관리
- 시도/시군구/상태 필터, 페이지네이션
- **Excel 일괄 가져오기** (ADMIN 이상): `병원명`, `도입형태`, `도입병상 수` 컬럼 기준 일괄 교체
  - 미리보기(preview) 모드 지원
  - 같은 병원명 여러 행 → 도입형태 병합, 도입병상 수 합산
- **병원 목록 Google Sheets 내보내기**: Drive Sheets API로 스프레드시트 직접 생성

### 프로젝트 관리
- 구축 공사 프로젝트 등록·수정·삭제
- 공사 상태(BuildStatus) 연결 및 관리
- 담당자, 시공사, 계약일/계약형태, 시작일/완료예정일, 비고 관리
- 병동 수 / 병상 수 / 게이트웨이 수, 답사·발주 완료 플래그
- 이슈 노트: 리치 텍스트 에디터(Tiptap)로 서식 있는 내용 입력 가능
- 프로젝트별 장비 관리
- 프로젝트별 파일 관리 (S3 업로드 / 파일 다운로드 / Drive 연동 병행 지원)

### 답사 관리
- 병원 방문 답사 기록 등록·수정·삭제
- 담당자(DAEWOONG 소속) + 추가 담당자 2인 연결 지원
- 방문일 / 요청일 / 회신일 관리
- 답사 상태코드 연결
- 설치계획서·평면도 파일 첨부 (AWS S3 업로드, presigned URL 다운로드)
- 노트: Tiptap 리치 텍스트 에디터

### 소속 관리 (SUPER_ADMIN 전용)
- 소속(Organization) 추가·수정·삭제
- 인라인 수정, 순서 이동
- 유저가 있는 소속 삭제 방지 (409 반환)
- DAEWOONG 소속 영구 삭제 보호

### 사용자 관리
- 시스템 사용자 등록·수정·삭제 (ADMIN 이상)
- 소속 드롭다운 연결
- **SUPER_ADMIN의 타계정 수정**: 이름·연락처·역할·소속·비밀번호 일괄 수정 (현재 비밀번호 확인 없이 변경 가능)
- 계정 활성/비활성 처리

### 설정 (ADMIN 이상)
- 병원 상태코드 관리 (추가·수정·삭제·순서)
- 답사 상태코드 관리
- 공사 상태(BuildStatus) 관리
- 장비 정보(DeviceInfo) 관리
- 시공사(Contractor) 관리

### Google Drive 연동 (선택)
- Service Account 기반 파일 업로드 (`POST /api/drive/upload`)
- 폴더 내 파일 목록 조회 (`GET /api/drive/files`)
- 파일 삭제 (`POST /api/drive/delete`)
- 병원 목록 스프레드시트 내보내기 (`POST /api/drive/export/hospitals`, Sheets API)
- 연결 상태 확인 (`testDriveConnection()`)

> 프로젝트 파일·답사 파일 업로드는 AWS S3로 전환되었습니다. Google Drive는 병원 목록 내보내기 등 Drive 전용 기능에 활용됩니다.

---

## Google Drive 연동 설정

Google Drive 연동을 사용하려면 아래 절차를 따릅니다.

### 1. 서비스 계정 JSON 키 발급

1. [Google Cloud Console](https://console.cloud.google.com/) → IAM 및 관리자 → 서비스 계정
2. 서비스 계정 생성 후 **키 추가 → JSON** 다운로드
3. Google Drive API 활성화 (API 및 서비스 → 라이브러리)
4. 공유할 Drive 폴더에 서비스 계정 이메일을 **편집자**로 초대

### 2. JSON 키를 한 줄 문자열로 변환

```bash
cat your-service-account.json | tr -d '\n'
```

### 3. `.env.local`에 값 설정

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...전체_JSON_한줄로..."}
GOOGLE_DRIVE_FOLDER_ID=1r0QdwBtm5LPdBi1QvpUO9InUt7kSENm5
```

> 키 파일 원본(`.json`)과 `.env.local`은 절대 git에 커밋하지 마세요.

---

## AWS S3 연동 설정

프로젝트 파일 및 답사 파일은 AWS S3에 저장됩니다.

### 1. IAM 사용자 및 버킷 준비

1. AWS Console → IAM → 사용자 생성 후 `AmazonS3FullAccess` (또는 해당 버킷 전용 정책) 부여
2. 액세스 키 생성
3. S3 버킷 생성 (예: `seers-thync-ops`, 리전: `ap-northeast-2`)

### 2. `.env`에 값 설정

```env
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
S3_BUCKET_NAME=seers-thync-ops
```

### 파일 저장 경로 규칙

| 구분 | S3 키 패턴 |
|------|-----------|
| 프로젝트 파일 | `projects/{projectCode}/{timestamp}_{fileName}` |
| 답사 설치계획서 | `site-visits/{hospitalCode}/install-plan_{fileName}` |
| 답사 평면도 | `site-visits/{hospitalCode}/floor-plan_{fileName}` |

> `.env` 파일은 절대 git에 커밋하지 마세요.

---

## 로컬 개발 환경 설정

### 사전 요구사항
- Node.js 20+
- PostgreSQL

### 1. 저장소 클론

```bash
git clone https://github.com/odiohead/thynC-Ops-System.git
cd thynC-Ops-System/thynC-Ops-DEV
```

### 2. 패키지 설치

```bash
npm install
```

### 3. 환경변수 설정

`.env.example`을 복사해서 `.env.local`을 생성하고 실제 값을 채웁니다.

```bash
cp .env.example .env.local
```

```env
# 데이터베이스
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/<dbname>"

# 인증
JWT_SECRET="your-secret-key"

# 앱 이름
NEXT_PUBLIC_APP_NAME="thynC Operations System"

# AWS S3 (파일 업로드 — 필수)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
S3_BUCKET_NAME=seers-thync-ops

# Google Drive (선택 — 병원 목록 내보내기 등 Drive 연동 시 필요)
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
GOOGLE_DRIVE_FOLDER_ID=your_folder_id_here
```

> `.env.local`은 `.gitignore`에 포함되어 있어 git에 커밋되지 않습니다.

### 4. DB 마이그레이션 및 시드

```bash
npx prisma migrate deploy
npm run seed:admin    # 관리자 계정 생성
npm run seed          # 기본 데이터 생성 (Organization 포함)
```

### 5. 개발 서버 실행

```bash
npm run dev
```

---

## 기본 관리자 계정

| 항목 | 값 |
|------|----|
| 이메일 | admin@thync.com |
| 비밀번호 | admin1234 |

> 운영 환경에서는 반드시 비밀번호를 변경하세요.

---

## API 엔드포인트

### 인증
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/logout` | 로그아웃 |
| GET  | `/api/auth/me` | 현재 사용자 정보 |

### 대시보드
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/dashboard` | 이번 주/다음 주 공사 현황 |
| GET | `/api/dashboard/monthly` | 월별 누적 병원/병상 통계 |

### 병원
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/hospitals` | 병원 목록 |
| POST | `/api/hospitals` | 병원 등록 |
| GET  | `/api/hospitals/[code]` | 병원 상세 |
| PUT  | `/api/hospitals/[code]` | 병원 수정 |
| DELETE | `/api/hospitals/[code]` | 병원 삭제 |
| POST | `/api/hospitals/import` | Excel 일괄 가져오기 (`?preview=true` 미리보기) |
| GET  | `/api/hospitals/[code]/devices` | 병원 장비 목록 |
| POST | `/api/hospitals/[code]/devices` | 병원 장비 추가 |
| GET  | `/api/hospitals/[code]/daewoong-staff` | 병원 담당자 목록 |
| POST | `/api/hospitals/[code]/daewoong-staff` | 담당자 배정 |
| DELETE | `/api/hospitals/[code]/daewoong-staff/[sid]` | 담당자 해제 |
| POST | `/api/hospitals/[code]/drive-folder` | Drive 폴더 연결 |

### HIRA 병원
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/hira-hospitals` | HIRA 병원 목록 (검색/필터) |
| GET | `/api/hira-hospitals/[id]` | HIRA 병원 상세 |

### 프로젝트
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/projects` | 프로젝트 목록 |
| POST | `/api/projects` | 프로젝트 등록 |
| GET  | `/api/projects/[code]` | 프로젝트 상세 |
| PUT  | `/api/projects/[code]` | 프로젝트 수정 |
| DELETE | `/api/projects/[code]` | 프로젝트 삭제 |
| GET  | `/api/projects/[code]/devices` | 프로젝트 장비 목록 |
| POST | `/api/projects/[code]/devices` | 프로젝트 장비 추가 |
| GET  | `/api/projects/[code]/files` | 프로젝트 파일 목록 |
| POST | `/api/projects/[code]/files` | 프로젝트 파일 추가 |
| GET  | `/api/projects/[code]/files/[fileId]/download` | 프로젝트 파일 다운로드 (S3 presigned URL) |
| PUT  | `/api/projects/[code]/files/[fileId]` | 프로젝트 파일 수정 |
| DELETE | `/api/projects/[code]/files/[fileId]` | 프로젝트 파일 삭제 |
| POST | `/api/projects/[code]/drive-folder` | Drive 폴더 연결 |

### 답사
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/site-visits` | 답사 목록 |
| POST | `/api/site-visits` | 답사 등록 |
| GET  | `/api/site-visits/[id]` | 답사 상세 |
| PUT  | `/api/site-visits/[id]` | 답사 수정 |
| DELETE | `/api/site-visits/[id]` | 답사 삭제 |
| POST | `/api/site-visits/upload` | 답사 파일 업로드 (S3) |
| GET  | `/api/site-visits/file-url` | 답사 파일 presigned URL 발급 (`?key=`) |
| DELETE | `/api/site-visits/file` | 답사 S3 파일 삭제 |

### 시공사
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/constructors` | 시공사 목록 |
| POST | `/api/constructors` | 시공사 등록 |
| GET  | `/api/constructors/[code]` | 시공사 상세 |
| PUT  | `/api/constructors/[code]` | 시공사 수정 |
| DELETE | `/api/constructors/[code]` | 시공사 삭제 |

### 사용자
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/users` | 사용자 목록 (`?organization=` 필터 가능) |
| POST | `/api/users` | 사용자 등록 |
| GET  | `/api/users/[id]` | 사용자 상세 |
| PUT  | `/api/users/[id]` | 사용자 수정 (SUPER_ADMIN은 타계정 수정 가능) |
| DELETE | `/api/users/[id]` | 사용자 삭제 |

### 설정
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/settings/organizations` | 소속 목록 (유저 수 포함) |
| POST | `/api/settings/organizations` | 소속 추가 (SUPER_ADMIN 전용) |
| PUT  | `/api/settings/organizations/[id]` | 소속 수정 (SUPER_ADMIN 전용) |
| DELETE | `/api/settings/organizations/[id]` | 소속 삭제 (SUPER_ADMIN 전용) |
| GET  | `/api/settings/devices` | 장비 정보 목록 |
| POST | `/api/settings/devices` | 장비 정보 추가 |
| PUT  | `/api/settings/devices/[id]` | 장비 정보 수정 |
| DELETE | `/api/settings/devices/[id]` | 장비 정보 삭제 |
| GET  | `/api/settings/build-status` | 공사 상태 목록 |
| POST | `/api/settings/build-status` | 공사 상태 추가 |
| PUT  | `/api/settings/build-status/[id]` | 공사 상태 수정 |
| DELETE | `/api/settings/build-status/[id]` | 공사 상태 삭제 |
| GET  | `/api/settings/status` | 병원 상태코드 목록 |
| POST | `/api/settings/status` | 병원 상태코드 추가 |
| PUT  | `/api/settings/status/[id]` | 병원 상태코드 수정 |
| DELETE | `/api/settings/status/[id]` | 병원 상태코드 삭제 |
| GET  | `/api/settings/site-visit-status` | 답사 상태코드 목록 |
| POST | `/api/settings/site-visit-status` | 답사 상태코드 추가 |
| PUT  | `/api/settings/site-visit-status/[id]` | 답사 상태코드 수정 |
| DELETE | `/api/settings/site-visit-status/[id]` | 답사 상태코드 삭제 |

### Google Drive
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/drive/upload` | 파일 업로드 (`fileName`, `content`, `mimeType`) |
| GET  | `/api/drive/files` | 폴더 내 파일 목록 (`?folderId=` 선택) |
| POST | `/api/drive/delete` | 파일 삭제 |
| POST | `/api/drive/export/hospitals` | 병원 목록 스프레드시트 내보내기 (Sheets API) |

---

## 배포

### DEV 서버 반영

```bash
npm run build
pm2 restart thync-dev
```

### PROD 서버 반영

```bash
cd /home/ubuntu/thynC-Ops-System/thynC-Ops-PROD
git pull origin main
npm run build
pm2 restart thync-prod
```

> `npm run start`, `nohup`, `node` 등으로 직접 서버를 실행하지 마세요. 반드시 PM2를 사용합니다.

---

## Git 워크플로우

```
개발 (DEV) → git push → PROD에서 git pull → 빌드 → PM2 재시작
```

1. DEV 환경에서 개발 및 테스트
2. `git push origin main`
3. PROD 서버에서 `git pull` 후 빌드 및 재시작
