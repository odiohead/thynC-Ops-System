# thynC Operations System

thynC 구축 및 운영을 위한 내부 데이터 관리 시스템입니다.
병원 정보 관리, 대웅제약 직원·담당 병원 배정 관리, 사용자 권한 관리 기능을 제공합니다.

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
├── api/                        # API Routes
│   ├── auth/                   # 인증 (login, logout, me)
│   ├── hospitals/              # 병원 CRUD + 대웅 직원 배정
│   ├── hira-hospitals/         # HIRA 병원 데이터 조회
│   ├── daewoong-staff/         # 대웅제약 직원 CRUD
│   ├── users/                  # 시스템 사용자 관리
│   └── settings/status/        # 상태코드 관리
├── hospitals/                  # 병원 목록·상세·등록·수정
├── hira-hospitals/             # HIRA 병원 조회
├── daewoong-staff/             # 대웅제약 직원 목록·상세
├── users/                      # 사용자 관리 (ADMIN 전용)
├── settings/status/            # 상태코드 관리 (ADMIN 전용)
├── login/                      # 로그인 페이지
└── components/                 # 공통 컴포넌트 (Navigation, MainWrapper)

lib/
├── auth.ts                     # JWT 인증 유틸리티
└── prisma.ts                   # Prisma 클라이언트

prisma/
├── schema.prisma               # DB 스키마
├── seed.ts                     # 기본 데이터 시드
├── seed-admin.ts               # 관리자 계정 생성
└── seed-hira.ts                # HIRA 병원 데이터 시드
```

---

## 데이터베이스 스키마

### HiraHospital (건강보험심사평가원 병원 원본 데이터)
- HIRA에서 가져온 공공 병원 데이터 원본
- hiraId, 병원명, 종별코드, 시도/시군구, 주소, 전화번호, 의사 수 등

### Hospital (운영 병원)
- 실제 운영 관리 대상 병원
- hospitalCode (고유 코드), HiraHospital과 연결 (hiraId)
- HIRA 병원명 / 운영상 병원명 구분
- 상태 (status), 좌표 정보 포함

### DaewoongStaff (대웅제약 직원)
- 직원 ID, 이름, 이메일, 전화번호, 지점 정보, 비고

### DaewoongHospitalAssignment (대웅제약 직원-병원 배정)
- DaewoongStaff ↔ Hospital N:M 관계 테이블

### StatusCode (상태코드)
- 병원 상태값 정의 (커스터마이징 가능)

### User (시스템 사용자)
- 이메일, 비밀번호(bcrypt), 이름, 전화번호
- 역할: `ADMIN` / `USER`

---

## 주요 기능

### 인증
- JWT 기반 로그인/로그아웃 (httpOnly 쿠키)
- 미들웨어로 모든 페이지 인증 보호
- 역할 기반 접근 제어 (ADMIN / USER)

### 병원 관리
- HIRA 병원 데이터 검색 및 조회
- 운영 병원 등록·수정·삭제
- 병원별 대웅제약 담당 직원 배정·해제
- 시도/시군구/상태 필터, 페이지네이션

### 대웅제약 직원 관리
- 직원 목록 조회 및 상세 페이지
- 직원 등록·수정·삭제
- 직원별 담당 병원 목록 확인

### 설정 (ADMIN 전용)
- 병원 상태코드 관리 (추가·수정·삭제·순서)

### 사용자 관리 (ADMIN 전용)
- 시스템 사용자 등록·수정·삭제
- 계정 활성/비활성 처리

### Google Drive 연동 (선택)
- Service Account 기반 파일 업로드 (`POST /api/drive/upload`)
- 폴더 내 파일 목록 조회 (`GET /api/drive/files`)
- 연결 상태 확인 (`testDriveConnection()`)

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

# Google Drive (선택 — 연동 시 필요)
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
GOOGLE_DRIVE_FOLDER_ID=your_folder_id_here
```

> `.env.local`은 `.gitignore`에 포함되어 있어 git에 커밋되지 않습니다.

### 4. DB 마이그레이션 및 시드

```bash
npx prisma migrate deploy
npm run seed:admin    # 관리자 계정 생성
npm run seed          # 기본 데이터 생성
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

### 병원
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/hospitals` | 병원 목록 |
| POST | `/api/hospitals` | 병원 등록 |
| GET  | `/api/hospitals/[code]` | 병원 상세 |
| PUT  | `/api/hospitals/[code]` | 병원 수정 |
| DELETE | `/api/hospitals/[code]` | 병원 삭제 |
| GET  | `/api/hospitals/[code]/daewoong-staff` | 병원 담당 직원 목록 |
| POST | `/api/hospitals/[code]/daewoong-staff` | 담당 직원 배정 |
| DELETE | `/api/hospitals/[code]/daewoong-staff/[sid]` | 담당 직원 해제 |

### HIRA 병원
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/hira-hospitals` | HIRA 병원 목록 (검색/필터) |
| GET | `/api/hira-hospitals/[id]` | HIRA 병원 상세 |

### 대웅제약 직원
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/daewoong-staff` | 직원 목록 |
| POST | `/api/daewoong-staff` | 직원 등록 |
| GET  | `/api/daewoong-staff/[id]` | 직원 상세 |
| PUT  | `/api/daewoong-staff/[id]` | 직원 수정 |
| DELETE | `/api/daewoong-staff/[id]` | 직원 삭제 |

### 사용자
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/users` | 사용자 목록 |
| POST | `/api/users` | 사용자 등록 |
| PUT  | `/api/users/[id]` | 사용자 수정 |
| DELETE | `/api/users/[id]` | 사용자 삭제 |

### 설정
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/settings/status` | 상태코드 목록 |
| POST | `/api/settings/status` | 상태코드 추가 |
| PUT  | `/api/settings/status/[id]` | 상태코드 수정 |
| DELETE | `/api/settings/status/[id]` | 상태코드 삭제 |

### Google Drive
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/drive/upload` | 파일 업로드 (`fileName`, `content`, `mimeType`) |
| GET  | `/api/drive/files` | 폴더 내 파일 목록 (`?folderId=` 선택) |

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
