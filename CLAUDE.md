[200~# thynC Operations System - CLAUDE.md

> 작업 시작 전 이 파일과 `README.md`를 반드시 먼저 읽고 숙지하세요.

---

## 환경 구성 (3개)

| 명칭 | 경로 | 호스트 | DB | PM2 |
|---|---|---|---|---|
| **prod** | `/home/ubuntu/thynC-Ops-System/thynC-Ops-PROD` | AWS EC2 (13.125.238.77) | `thync_ops` | `thync-prod` |
| **dev** | `/home/ubuntu/thynC-Ops-System/...` (PROD와 같은 호스트) | AWS EC2 (13.125.238.77) | `thync_ops_dev` | `thync-dev` |
| **dev2** | `/home/ubuntu/workspace/thynC-Ops-System` | 사용자 WSL2 (별도 PC) | `thync_ops_dev` (로컬) | `thync-dev` |

작업 디렉토리(cwd)로 환경을 자동 식별:
- `/home/ubuntu/thynC-Ops-System/thynC-Ops-PROD` → **prod**
- `/home/ubuntu/thynC-Ops-System/...` (PROD 호스트의 dev) → **dev**
- `/home/ubuntu/workspace/thynC-Ops-System` → **dev2**

`dev`와 `dev2`는 같은 main 브랜치를 공유하므로, 작업 전 `git pull` 권장 (다른 환경에서 작업 중일 가능성).

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

### 7. 위키 모듈 경계 — 단방향 의존성

위키는 별도 서비스로 떼어낼 가능성을 보존하기 위해 **메인 모듈 → 위키 코드 import 금지**.

- **허용 방향**: `app/wiki/*`, `lib/wiki/*` → 메인 모듈 (`lib/auth.ts`, `lib/s3.ts`, `lib/audit.ts` 등)
- **금지 방향**: `app/hospitals/*`, `app/projects/*`, `app/site-visits/*`, `app/maintenances/*`, `app/install-plans/*`, `app/tasks/*`, `lib/mail-*` → `app/wiki/*`, `lib/wiki/*`
- 메인에서 위키 데이터가 필요하면 `fetch('/api/wiki/...')`로 호출 (쿠키 인증 자동 전달)

```typescript
// app/hospitals/[code]/page.tsx (메인 모듈)
// ❌ 금지
import { getWikiPages } from '@/lib/wiki/...'
import WikiCard from '@/app/wiki/components/...'

// ✅ 허용 — HTTP 호출
const res = await fetch(`/api/wiki/pages?refType=hospital&refCode=${code}`)
```

### 8. 위키 DB 테이블은 `wiki` 스키마에만 생성

- 새 위키 테이블은 모두 Prisma 모델에 `@@schema("wiki")` 부여
- 마이그레이션 SQL은 `CREATE TABLE wiki.xxx` 형식
- `wiki.*` 테이블이 `public.users`, `public.hospitals` 등을 FK로 참조하는 것은 OK
- **`public.*` 테이블이 `wiki.*`를 FK로 참조하는 것 금지** (의존성 방향 위반)

---

## 자주 쓰는 작업 — 약속어

### PROD → DEV 데이터 동기화

**트리거 문구** (다음 중 하나)
- "PROD 데이터 동기화해줘"
- "상용 데이터 가져와"
- "DB 데이터 PROD에서 가져와"

**환경별 동작 (cwd로 자동 분기)**

#### dev에서 실행 시 (PROD와 같은 호스트)
- `scripts/sync-prod-data-to-dev.sh` 실행
- PROD/DEV 모두 localhost에 있어 별도 dump 전송 불필요
- 스크립트가 스키마 diff 검사 → 다르면 abort
- DEV 백업 자동 생성 (`/home/ubuntu/backups/db-sync/`)

#### dev2에서 실행 시 (별도 PC, WSL2)
1. PROD `~/backups/db/` 중 **가장 최신** `thync_ops_*.dump` 자동 선택 (일일 01:00 KST 정기 백업)
2. SCP로 `/home/ubuntu/backups/db-sync/`에 전송
3. `pm2 stop thync-dev`
4. 현재 DEV 백업: `dev_before_sync_<ts>.sql.gz`
5. 36개 테이블 `TRUNCATE ... RESTART IDENTITY CASCADE` (`_prisma_migrations` 제외)
6. dump를 `/tmp/restore.dump`로 복사 (postgres 슈퍼유저가 ubuntu home 못 읽음)
7. 풀덤프인 경우 `pg_restore --list`로 TOC 추출 후 `_prisma_migrations` TABLE DATA 라인만 제거한 필터 파일 생성
8. `sudo -u postgres pg_restore --data-only --disable-triggers --single-transaction --no-owner --no-privileges [-L /tmp/restore.list] /tmp/restore.dump`
9. `/tmp/restore.dump`, `/tmp/restore.list` 정리
10. `pm2 start thync-dev` + HTTP 응답 확인
11. 주요 테이블 row 수 보고

**옵션 (양쪽 공통)**
- `"PROD에서 새로 dump 떠서 동기화"` → 정기 백업 안 쓰고 PROD 서버에서 즉시 `pg_dump -Fc --data-only` 신규 생성 후 진행
- `"특정 파일로 동기화: <파일명>"` → 자동 최신 대신 지정 파일 사용

**안전장치 (양쪽 공통)**
- DEV 백업은 **항상** 생성 (생략 옵션 없음)
- 동기화 전 PM2 정지 → DB 커넥션 정리
- 단일 트랜잭션 적재 → 실패 시 자동 롤백
- `_prisma_migrations`는 **절대 덮어쓰지 않음** → DEV 마이그레이션 히스토리 보호
- PROD DB는 **읽기(pg_dump)만** 수행, DDL/DML 절대 금지

### 위키 Phase 진행

**트리거 문구**
- "위키 Phase N 진행해줘"
- "위키 다음 단계로"

**동작**
1. `wiki_dev_schedule.md`에서 해당 Phase 작업 항목·검증·게이트 확인
2. 이전 Phase 게이트 통과 여부 확인 (안 됐으면 사용자에게 보고 후 중단)
3. 해당 Phase 작업 항목 순차 진행
4. Phase 완료 후:
   - `wiki_dev_schedule.md` 하단 체크리스트 갱신
   - `DEV_HISTORY.md` 상단에 기록
   - `README.md` 관련 섹션 갱신
   - **빌드·PM2 재시작·git push는 사용자 명시 요청 시에만**

---

## 개발 작업 절차

### 작업 시작 시
1. `CLAUDE.md` 읽기 (이 파일)
2. `README.md` 읽기 (스택·스키마·API 전체 형상)
3. `DEV_HISTORY.md`는 **상단 최근 10개 항목만** 읽기 (전체 읽기 금지 — 파일이 커서 컨텍스트 낭비. 과거 이력이 필요하면 Grep으로 키워드 검색)
4. **위키 관련 작업인 경우** `wiki_dev_schedule.md` 추가 확인 — 현재 어느 Phase에 있는지, 다음 Phase 게이트가 무엇인지 파악. Phase 0 미확정 상태에서 Phase 1 코드 작성 금지

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

### 에디터 — 모듈별 사용 분기

| 사용처 | 에디터 | 저장 형식 |
|---|---|---|
| 위키 페이지 본문 | **BlockNote** | JSON 블록 배열 (JSONB) |
| 프로젝트 `issueNote`, 답사 `notes`, 유지보수 `resolution`/`notes`, 설치계획 `note` | **Tiptap** (기존) | HTML 문자열 |

기존 Tiptap 사용처는 변경 금지. 데이터 형식 호환성과 마이그레이션 비용 때문.
"통일해서 BlockNote로 가자" 같은 유혹은 거절. 두 에디터 공존이 정답.

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
