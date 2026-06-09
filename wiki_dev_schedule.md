# 사내 위키(Wiki) 기능 개발 일정

> 작성 시점에 확정된 방향
> - 통합 방식: **소스 레벨 모듈 분리 + 단일 배포** (`app/wiki/*`, `app/api/wiki/*`, `lib/wiki/*`)
> - DB: 기존 `thync_ops` / `thync_ops_dev` 안에 **PostgreSQL `wiki` 스키마** 신설 (Prisma `multiSchema` preview)
> - 에디터: **BlockNote** (기존 Tiptap 3.20.4 위에 얹음)
> - 의존성 방향: wiki → main OK, **main → wiki 코드 import 금지** (필요하면 HTTP `fetch`)
> - 재사용: 인증(JWT), `lib/auth.ts`, `lib/audit.ts`, `lib/s3.ts`, `nav_menu_items`, Role/Organization
>
> 진행 원칙
> - 각 Phase는 **결정 체크포인트**가 통과되어야 다음 Phase로 진행
> - DB 마이그레이션은 `prisma migrate dev` 금지 → 수동 SQL + `migrate resolve --applied`
> - 빌드/PM2 재시작/git push/PROD 반영은 사용자 명시 요청 시에만
> - 모든 작업 완료 후 `DEV_HISTORY.md` 상단 기록, `README.md` 관련 섹션 갱신

---

## Phase 0 — 설계 확정 (코드 작성 전)

코드 작성 전, 이 단계에서 합의된 내용이 이후 모든 Phase의 입력이 됩니다.

### 결정 필요 사항

| 항목 | 옵션 | 비고 |
|---|---|---|
| **권한 모델** | (a) 역할 기반만 (SUPER_ADMIN/ADMIN/USER/VIEWER) <br> (b) + 소속(Organization) 기반 <br> (c) + 페이지별 ACL (특정 사용자/그룹 화이트리스트) | 초기엔 (a) 또는 (b) 권장. (c)는 후순위 Phase 7로 분리 |
| **페이지 트리** | (a) 평면 + 태그 <br> (b) 트리 (parent_id, 무한 깊이) <br> (c) 트리 + 카테고리(스페이스) | Notion-like면 (c), 시작은 (b)로 충분 |
| **버전 관리** | (a) 없음 (덮어쓰기) <br> (b) 스냅샷 저장 (수정 때마다 1행) <br> (c) diff 저장 | 초기 (a), 안정화 후 (b)로 확장 |
| **검색** | (a) 제목·태그만 (Phase 6) <br> (b) PostgreSQL `tsvector` 풀텍스트 <br> (c) 별도 검색엔진 (Meilisearch 등) | 초기 (a), 사용량 보고 (b) |
| **첨부 정책** | 허용 확장자, 최대 용량, S3 경로 규칙 | 예: 모든 확장자 허용, 50MB, `wiki/{pageId}/{ts}_{name}` |
| **공개 범위** | VIEWER도 읽기 허용? 비로그인 접근 차단? | 사내용이므로 로그인 필수, VIEWER 읽기 허용 권장 |
| **BlockNote 테마** | `@blocknote/mantine` (기본) / `@blocknote/shadcn` / 커스텀 | 기존 Tailwind 톤과 잘 맞는지 검토 |

### 산출물
- 이 문서 하단 **Phase 0 결정 요약** 섹션에 결정 내용 기재 (사용자 확정 후 추가)

### 게이트
- 위 7개 항목 모두 결정 → Phase 1 진행 가능

---

## Phase 1 — DB 스키마 신설 & Prisma 모델

### 작업 항목
1. PostgreSQL 스키마 신설: `CREATE SCHEMA wiki;` (DEV)
2. `prisma/schema.prisma`에 `multiSchema` preview 활성화
   ```prisma
   generator client {
     previewFeatures = ["multiSchema"]
   }
   datasource db {
     schemas = ["public", "wiki"]
   }
   ```
3. Wiki 모델 추가 (잠정 — Phase 0 결정에 따라 조정):
   - `WikiPage` (id, parentId?, title, slug, contentJson, authorId→User, isPublished, sortOrder, createdAt, updatedAt) `@@schema("wiki")`
   - `WikiAttachment` (id, pageId, fileName, s3Key, size, mimeType, uploaderId, createdAt) `@@schema("wiki")`
   - `WikiPagePermission` (선택, 권한 모델 (c) 채택 시) `@@schema("wiki")`
   - `WikiVersion` (선택, 버전 (b) 채택 시) `@@schema("wiki")`
4. 마이그레이션 파일 수동 생성: `prisma/migrations/YYYYMMDDHHMMSS_add_wiki_schema/migration.sql`
   - `CREATE SCHEMA wiki;`
   - 위 테이블 `CREATE TABLE wiki.wiki_pages (...)` 등
   - 인덱스: `(parent_id, sort_order)`, `(slug)` UNIQUE, `(author_id)`, `(updated_at DESC)`
5. `npx prisma migrate resolve --applied YYYYMMDDHHMMSS_add_wiki_schema`
6. `npx prisma generate`로 클라이언트 갱신

### 검증
- `npx prisma migrate status` → "Database schema is up to date"
- `psql -d thync_ops_dev -c "\dn"` → `wiki` 스키마 존재 확인
- `psql -d thync_ops_dev -c "\dt wiki.*"` → 테이블 존재 확인
- `npx tsc --noEmit` 통과 (생성된 Prisma 타입 OK)

### 게이트
- Prisma client에서 `prisma.wikiPage` 접근 가능, 빈 `findMany()` 정상 동작 → Phase 2 진행

---

## Phase 2 — BlockNote POC (1페이지 최소 단위 CRUD)

목표: **"빈 페이지 만들고 → 글 쓰고 → 저장 → 다시 열어서 보이는지"** 끝까지 가는 최소 동작 확보.

### 작업 항목
1. 패키지 설치
   ```bash
   npm install @blocknote/core @blocknote/react @blocknote/mantine
   ```
2. 라우트 골격
   - `app/wiki/page.tsx` — 페이지 목록 (임시 평면 리스트)
   - `app/wiki/new/page.tsx` — 신규 작성
   - `app/wiki/[id]/page.tsx` — 상세/수정 (BlockNote 마운트)
3. API 라우트
   - `app/api/wiki/pages/route.ts` (GET/POST)
   - `app/api/wiki/pages/[id]/route.ts` (GET/PUT/DELETE)
4. 저장 형식: BlockNote가 내보내는 **JSON Block 배열을 `content_json` JSONB 컬럼에 저장**
5. mutation 후 `router.refresh()` 적용 (코딩 컨벤션 준수)
6. 인증: `getUserFromRequest()` 적용, 로그인 미인증 차단

### 검증
- 페이지 작성 → DB에 JSON 저장 확인 (`psql`)
- 새로고침 후 동일 내용 복원
- 클라이언트 번들 영향 측정: `npm run build` 후 `.next/analyze` 또는 빌드 출력 크기 확인
- 빌드 메모리: `NODE_OPTIONS=--max-old-space-size=4096 npm run build` 정상 통과

### 게이트
- 위 검증 OK + 사용자가 DEV에서 직접 사용해보고 OK → Phase 3 진행

---

## Phase 3 — 페이지 트리 & 사이드 네비게이션

목표: Notion-like 좌측 사이드바에서 페이지 계층 탐색.

### 작업 항목
1. 모델: `WikiPage.parent_id` 활용한 트리 조회 API
   - `GET /api/wiki/tree` — 트리 전체 (얕은 깊이) 또는 `?parentId=` 자식만
2. 사이드바 컴포넌트
   - `app/wiki/components/WikiSidebar.tsx`
   - 접기/펼치기, 자식 lazy load (페이지 많아질 대비)
3. 페이지 이동/정렬
   - `PATCH /api/wiki/pages/[id]/move` (parentId·sortOrder 변경)
   - 초기엔 ↑↓ 버튼, 추후 드래그앤드롭
4. URL 구조 결정
   - (a) `/wiki/[id]` (UUID)
   - (b) `/wiki/[slug]` (사람이 읽는 slug, 충돌 처리 필요)
   - 추천: 내부는 id 기반, slug는 부가 표시용
5. Breadcrumb 표시

### 검증
- 트리 50개 노드에서 렌더링 지연 없는지 확인
- 부모 변경 시 자식들 같이 따라옴 (rank string 또는 sortOrder 재계산)
- 순환 참조 방지 (자기 자신/하위 트리를 부모로 지정 차단)

### 게이트
- 트리 탐색·이동·정렬 모두 동작 → Phase 4 진행

---

## Phase 4 — 파일 첨부 (이미지·파일 블록)

기존 S3 인프라 재사용. `lib/s3.ts` 그대로 사용.

### 작업 항목
1. S3 키 패턴: `wiki/{pageId}/{timestamp}_{fileName}` (Phase 0 결정 따름)
2. 업로드 API
   - `POST /api/wiki/upload` — multipart, 페이지 id 필수, presigned URL 발급 후 클라 직접 업로드 또는 서버 경유 (기존 답사/프로젝트 파일 패턴 따라감)
3. 다운로드 API
   - `GET /api/wiki/files/[id]/download` — presigned URL 발급
4. BlockNote 이미지/파일 블록 핸들러 연결 (`uploadFile` prop)
5. `WikiAttachment` 메타 테이블 저장
6. 페이지 삭제 시 첨부 파일 S3 정리 (best-effort, 실패해도 DB 삭제는 진행)

### 검증
- 이미지 붙여넣기 → S3 업로드 → 본문에 표시 → 새로고침 후 유지
- 큰 파일 (~20MB) 업로드 처리
- 권한 없는 사용자가 presigned URL을 직접 호출 못 하도록 차단 (인증 미들웨어 적용)

### 게이트
- 첨부 정상 동작 → Phase 5 진행

---

## Phase 5 — 권한 & 메인 메뉴 노출

### 작업 항목
1. API 권한 가드 (Phase 0 결정에 따름)
   - 역할 기반: `isAdminOrAbove` / 일반 USER 쓰기 / VIEWER 읽기만
   - 소속 기반 추가 시: `user.organization.code` 체크
2. 페이지 수준 권한 (옵션 (c) 채택 시): `WikiPagePermission` 적용 미들웨어
3. **메인 네비게이션 메뉴 추가**:
   - DB 직접 INSERT 또는 `/settings/nav-menus` UI 사용
   ```sql
   INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, allowed_roles, allowed_org_codes, is_active, sort_order)
   VALUES ('wiki', '사내 위키', '/wiki', 'book', NULL, '{}', '{}', true, 15);
   ```
   - `sort_order=15`로 hira-hospitals(10)와 hospitals(20) 사이
   - `allowed_roles='{}'` (전체 노출) — Phase 0 결정에 따라 조정
4. `NavIcons` 컴포넌트에 위키 아이콘 매핑 추가
5. 미인증/권한 없는 접근 시 적절한 응답 (401/403)

### 검증
- VIEWER 계정으로 로그인 → 메뉴 보이지만 작성 버튼 비활성
- USER 계정 → 작성·수정 가능
- 메뉴 활성/비활성 토글 정상 반영

### 게이트
- 사용자가 운영 시나리오로 권한 동작 확인 → Phase 6 진행

---

## Phase 6 — 감사 로그 & 메인 시스템 연동

### 작업 항목
1. 감사 로그 적용 (`lib/audit.ts`)
   - 페이지 CREATE/UPDATE/DELETE
   - `resource='wiki_page'`, `resourceLabel=페이지 제목`
   - `before/after`는 본문 JSON 통째 저장하면 무거우므로 메타(title, parentId, isPublished)만 기록 권장
2. 병원·프로젝트 연결 (mention/link)
   - BlockNote 커스텀 inline content: `@hospital:HOSP-001` → 병원 상세 링크 자동 렌더
   - `@project:PRJ-001`, `@task:TASK-...` 동일 패턴
   - 자동완성 모달 (병원·프로젝트 검색)
3. 메인 → 위키 역참조 (선택, 단방향 의존 유지)
   - 병원 상세 페이지에서 "관련 위키 문서" 섹션 표시
   - **`fetch('/api/wiki/pages?refType=hospital&refCode=HOSP-001')` 호출**, `lib/wiki/*` 직접 import 금지
   - 별도 인덱싱 테이블 `WikiPageReference (pageId, refType, refCode)` 신설 가능 (페이지 저장 시 mention 파싱 → 인덱스 갱신)

### 검증
- 페이지 mutation 시 `audit_logs`에 1행씩 기록 확인
- 병원 mention 클릭 시 병원 상세 페이지 정상 이동
- 병원 상세에서 위키 fetch가 위키 모듈 직접 import 없이 동작 (코드 검사)

### 게이트
- 감사 로그·mention 정상 → Phase 7 진행 (선택)

---

## Phase 7 — 부가 기능 (선택, 사용 빈도 보고 결정)

### 후보
- **검색**: 제목·태그 → PostgreSQL `tsvector` 풀텍스트
- **버전 히스토리**: `WikiVersion` 테이블에 스냅샷 저장, 차이 비교 UI
- **즐겨찾기**: `WikiFavorite (userId, pageId)`
- **최근 본 페이지**: 사용자별 히스토리
- **태그**: `WikiTag`, `WikiPageTag` N:M
- **댓글**: `WikiComment` (페이지 단위)
- **드래그앤드롭 트리 이동** (Phase 3에서 ↑↓ 버튼만 했다면 여기서 D&D)

### 진행 방식
- 실제 사용 빈도 보고 1~2개씩 선별
- 각 기능은 별도 Phase로 다시 쪼개서 진행

---

## Phase 8 — PROD 반영

> **사용자 명시 요청 시에만 진행** (CLAUDE.md 절대 규칙 #3, #5)

### 절차
1. DEV에서 모든 검증 완료 + 사용자 OK
2. `DEV_HISTORY.md` / `README.md` 갱신 커밋
3. `git push origin main`
4. PROD 호스트에서:
   ```bash
   cd /home/ubuntu/thynC-Ops-System/thynC-Ops-PROD
   git pull origin main
   ```
5. **PROD DB 스키마/마이그레이션 적용 — 별도 명시 허락 필수**
   ```bash
   PGPASSWORD=... psql -U thync -d thync_ops -f prisma/migrations/YYYYMMDDHHMMSS_add_wiki_schema/migration.sql
   npx prisma migrate resolve --applied YYYYMMDDHHMMSS_add_wiki_schema
   ```
6. nav_menu_items PROD에도 INSERT (별도 허락 필수)
7. 빌드 & 재시작
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm run build
   pm2 restart thync-prod
   ```
8. PROD HTTP 응답 + 위키 페이지 작성·조회 smoke test

### 게이트
- smoke test 통과 → 종료

---

## Phase 0 결정 요약 — 확정 (2026-06-09)

- **권한 모델**: (a) 역할 기반만 (SUPER_ADMIN/ADMIN/USER/VIEWER). 페이지별 ACL은 Phase 7 후순위
- **페이지 트리 형태**: (b) 트리 — `parent_id` self-reference, 무한 깊이. "스페이스" 카테고리는 트리 최상위 노드로 표현
- **버전 관리**: (a) 없음 (덮어쓰기). 필요해지면 Phase 7에서 `WikiVersion` 스냅샷 추가
- **검색**: (a) 제목·태그만. 풀텍스트(tsvector)는 Phase 7로 연기
- **첨부 정책**: 전체 확장자 허용 / 최대 50MB / S3 키 패턴 `wiki/{pageId}/{ts}_{fileName}`
- **공개 범위**: 로그인 필수 (미들웨어로 강제) / VIEWER 읽기 허용 / USER 이상 쓰기 / SUPER_ADMIN 관리
- **BlockNote 테마**: ~~`@blocknote/mantine`~~ → **`@blocknote/ariakit`** (Phase 2 진입 시 변경). 사유: ① mantine 최신(9.3.1)이 React 19 peer dep 강제 → React 18 프로젝트와 충돌, ② shadcn 변형은 Tailwind 4.x 요구 → 본 프로젝트 Tailwind 3.4.1과 충돌. Ariakit은 헤드리스라 Tailwind 3 + React 18 환경과 무충돌

---

## 진행 현황 체크리스트

- [x] Phase 0 — 설계 확정 (2026-06-09)
- [x] Phase 1 — DB 스키마 신설 (2026-06-09)
- [x] Phase 2 — BlockNote POC (2026-06-09) — 빌드/PM2 검증은 사용자 명시 요청 대기
- [x] Phase 3 — 페이지 트리 & 사이드 네비 (2026-06-09)
- [x] Phase 4 — 파일 첨부 (2026-06-09)
- [x] Phase 5 — 권한 & 메인 메뉴 (2026-06-09)
- [x] Phase 6 — 감사 로그 & 메인 시스템 연동 (2026-06-09) — 인라인 mention(BlockNote 스키마 커스터마이징)은 비용/가치 판단으로 Phase 7로 이연, 명시적 참조(WikiPageReference) 방식으로 진행
- [x] Phase 7 — 부가 기능 (2026-06-10) — 태그/즐겨찾기/최근 본/검색/버전 히스토리/댓글/페이지 블록/인라인 mention. (DnD 트리는 ↑↓ 버튼 유지로 이연)
- [x] Phase 8 — PROD 반영 (2026-06-10) — 마이그레이션 3건 적용, nav 메뉴 등록, 빌드·재시작·smoke test 완료. 위키 본문 데이터(DEV 51페이지)는 미이관
