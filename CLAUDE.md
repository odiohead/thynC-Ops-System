[200~# thynC Operations System - CLAUDE.md

> 작업 시작 전 이 파일과 `README.md`를 반드시 먼저 읽고 숙지하세요.

---

## ⚠️ 절대 규칙

### 1. DB 마이그레이션 — `prisma migrate dev` 절대 금지

shadow DB 권한 문제로 `migrate dev` 사용 불가. **반드시 아래 패턴만 사용하세요.**
```bash
# 1. SQL 직접 실행
psql -U thync -d thync_ops_dev -c "ALTER TABLE ..."

# 2. 마이그레이션 파일 수동 생성
mkdir -p prisma/migrations/YYYYMMDDHHMMSS_설명
# migration.sql 에 위 SQL 동일하게 작성

# 3. 적용 완료 표시
npx prisma migrate resolve --applied YYYYMMDDHHMMSS_설명

# 4. 스키마·클라이언트 갱신
# prisma/schema.prisma 수동 업데이트 후
npx prisma generate
```

### 2. 서버 실행 — PM2 외 직접 실행 금지
```bash
# ✅ 올바른 방법
npm run build && pm2 restart thync-dev   # DEV
npm run build && pm2 restart thync-prod  # PROD

# ❌ 절대 금지
npm run start / nohup / node server.js
```

### 3. git push / 빌드 — 명시적 요청 시에만 실행

개발 작업 완료 후 자동으로 git commit/push, 빌드/PM2 재시작을 수행하지 마세요.
사용자가 여러 건을 모아서 테스트 후 직접 요청합니다.

```bash
# ❌ 작업 완료 후 자동 실행 금지
git add . && git commit && git push
npm run build && pm2 restart thync-dev

# ✅ 사용자가 명시적으로 요청했을 때만 실행
```

### 4. 빌드 시 힙 메모리 4GB 설정 필수

빌드 실행 시 반드시 `NODE_OPTIONS`으로 힙 메모리를 4GB로 설정하세요.
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart thync-dev
```

### 5. PROD DB 작업 — 명시적 허락 시에만 실행

PROD DB(`thync_ops`)에 대한 DDL(ALTER, CREATE, DROP 등) 및 DML(INSERT, UPDATE, DELETE 등)은 사용자가 명시적으로 허락했을 때만 실행하세요. DEV DB 작업 후 자동으로 PROD DB에 동일 작업을 수행하지 마세요.

```bash
# ❌ DEV 작업 후 자동으로 PROD에도 실행 금지
PGPASSWORD=... psql -U thync -d thync_ops -c "ALTER TABLE ..."

# ✅ 사용자에게 PROD 반영 여부를 먼저 확인
```

### 6. PROD 소스 직접 편집 금지

`.env` 수정만 예외. 소스 코드는 반드시 DEV → git push → PROD git pull 절차를 따르세요.
```bash
# PROD 반영 절차
cd /home/ubuntu/thynC-Ops-System/thynC-Ops-PROD
git pull origin main
npm run build
pm2 restart thync-prod
```

---

## 개발 작업 절차

### 작업 시작 시
1. `CLAUDE.md` 읽기 (이 파일)
2. `README.md` 읽기 (스택·스키마·API 전체 형상)
3. `DEV_HISTORY.md` 최근 항목 확인 (현재 개발 상태 파악)

### 작업 완료 시
1. `DEV_HISTORY.md` **상단에** 작업 내역 기록
2. `README.md` 아래 항목 중 변경된 부분 업데이트:
   - **기능 추가·변경·삭제** → `주요 기능` 섹션 반영
   - **새 API 엔드포인트 추가·삭제** → `API 엔드포인트` 섹션 반영
   - **DB 모델·필드 변경** → `데이터베이스 스키마` 섹션 반영
   - **새 패키지 설치** → `기술 스택` 섹션 반영
   - **새 페이지·컴포넌트 추가** → `디렉토리 구조` 섹션 반영
3. **빌드·git push는 사용자가 명시적으로 요청할 때만 실행** (자동 실행 금지)

---

## 코딩 컨벤션

### router.refresh() — 모든 mutation 후 필수

Next.js App Router Router Cache 문제로, PUT/POST/DELETE 성공 후 반드시 적용하세요.
```typescript
// 페이지 이동이 있는 경우
router.refresh()
router.push('/target-path')

// 이동 없이 현재 페이지 유지하는 경우
router.refresh()
// 이후 로컬 상태 업데이트
```

### 역할 체크 — 헬퍼 함수 사용
```typescript
import { isAdminOrAbove, isSuperAdmin } from '@/lib/auth'

// ✅ 올바른 방법 (SUPER_ADMIN 누락 방지)
if (!isAdminOrAbove(user.role)) return 403

// ❌ 잘못된 방법
if (user.role !== 'ADMIN') return 403
```

### 네이밍
- 컴포넌트: `PascalCase`
- 파일명: `kebab-case`

---

## DEV_HISTORY.md 기록 형식
```
## YYYY-MM-DD HH:MM | 작업 제목

- 무엇을 왜 어떻게 변경했는지 요약 (소스 코드 붙여넣기 금지)
- 영향받은 파일/컴포넌트 목록
```

---

## 비상시 DB 복구 절차
```bash
# 1. pg_hba.conf 임시 trust 설정
sudo vi /etc/postgresql/*/main/pg_hba.conf
# local all postgres peer → trust 변경
sudo systemctl reload postgresql

# 2. DB 재생성 및 DEV 덤프 복원
psql -U postgres -c "DROP DATABASE IF EXISTS thync_ops;"
psql -U postgres -c "CREATE DATABASE thync_ops OWNER thync;"
pg_dump -U thync thync_ops_dev | psql -U postgres thync_ops

# 3. pg_hba.conf 원복 후 reload
```
