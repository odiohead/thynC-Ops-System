# thynC Operations System - 개발 작업 이력

> 최신 작업이 상단에 위치합니다.

---

## 2026-06-10 | 차량예약시스템 Phase 5 — PROD 반영 완료

- **커밋 `7be07a3`** (16파일, +2,463줄) push → PROD pull (fast-forward)
- **PROD DB(`thync_ops`) 마이그레이션** (사용자 명시 요청 "prod에 반영해줘"):
  - `20260610113000_add_vehicle_reservation` psql `--single-transaction` 적용 — `btree_gist` 확장 + `vehicles`/`vehicle_reservations` + EXCLUDE 제약 (PG 16.14 trusted extension이라 thync 권한으로 정상 생성)
  - `migrate resolve --applied` → 마이그레이션 55건 정합 (dev2와 동일)
  - `nav_menu_items`에 `vehicle-reservations`(차량예약, sort 58) + `settings/vehicles`(차량 관리, ADMIN+, sort 160) INSERT
- **빌드·재시작**: `prisma generate` + 힙 4GB 빌드 (차량 라우트 4종 등록 확인) + `pm2 restart thync-prod` → online, Ready in 1.2s
- **smoke test**: `/login` 200, 차량예약·차량 관리·API 및 기존 라우트(wiki/hospitals/projects) 모두 미인증 307 정상, 에러 로그 없음
- **참고**: 신규 npm 패키지 없음(`package.json` 무변경). PROD 차량 데이터는 빈 상태 — 설정 > 차량 관리에서 등록 후 사용

---

## 2026-06-10 | dev2 DB 재구축 — PG16 단일화 + PROD 데이터 전체 동기화

- **발단**: dev2 네비게이션에서 위키 메뉴 실종 → 조사 결과 dev2(WSL2)에 PG14·PG16 클러스터가 둘 다 port 5432로 공존, 재부팅 시 먼저 뜨는 쪽이 5432를 차지하는 구조였음
  - 4/23 셋업 때 두 버전이 함께 설치됨. 4월엔 PG16이 사용되다 5/19 재부팅에 PG14로 뒤바뀜(당시 빈 DB에 PROD 동기화로 채워 아무도 인지 못함) → 이후 위키 개발 포함 모든 데이터는 PG14에 축적 → **6/10 17:35 재부팅에 다시 PG16(4월 복사본)으로 뒤바뀌며 "위키 실종"으로 표면화**
- **조치** (사용자 결정: PROD와 버전 통일 + 데이터는 PROD 기준, dev 기존 데이터 폐기):
  1. 현 PG16 DB 안전 백업 (`dev2_pg16_stale_backup_*.dump`)
  2. PROD(PG **16.14**)에서 신규 풀덤프 생성(`pg_dump` 읽기 전용) 후 SCP — 정기백업(01:00)은 위키 PROD 반영 이전 시점이라 사용하지 않음
  3. PG16(5432)의 `thync_ops_dev` DROP/CREATE → 풀덤프 복원 (`--no-owner --role=thync`)
  4. 차량예약 마이그레이션 재적용 + `migrate resolve` → 마이그레이션 55건(PROD 54 + 차량 1) 정합
  5. 차량예약 nav 메뉴 2건 재INSERT (위키 메뉴는 PROD 데이터에 포함되어 자동 복원)
  6. PG14 `start.conf=manual` 전환 — 재부팅 포트 경쟁 원천 차단, 데이터는 콜드 백업으로 디스크 보존
- **검증**: 복원 후 마이그레이션 55건·wiki 테이블 9종·병원 79,737건·사용자 36명·위키/차량 메뉴 확인. E2E 14/14 재통과
- **부수 개선**: 테스트 스크립트 3종의 하드코딩 사용자 ID를 DB 동적 조회로 변경 (동기화로 ID 바뀌어도 동작)
- **참고**: dev2의 위키 51페이지(Notion 임포트분)는 사용자 결정으로 미이관 (PG14 콜드 백업에는 남아 있음). dev2 로그인 계정은 PROD와 동일해짐

---

## 2026-06-10 | 차량예약시스템 Phase 1~3 — 차량 관리 + 예약 API + 주간 현황 보드

- **목적**: 법인차량 예약 기능 신설. 설계(`vehicle_dev_schedule.md` Phase 0, 2026-06-10 확정: 시간 단위 30분 / 선착순 즉시 확정 / 반납 기록 없음 / 캘린더 연동 보류) 기반 Phase 1~3 한 batch.
- **DB 마이그레이션** (`20260610113000_add_vehicle_reservation`, DEV 적용 + resolve 완료):
  - `vehicles` (차량 마스터: name / plate_number UNIQUE / model / seat_count / color / memo / is_active / sort_order)
  - `vehicle_reservations` (vehicle_id FK, user_id FK→users, start_at/end_at, purpose, destination, status RESERVED|CANCELED)
  - `btree_gist` 확장 + **EXCLUDE 제약** `vehicle_reservations_no_overlap`: 같은 차량의 RESERVED 예약 간 `tsrange(start_at, end_at)` 겹침을 DB가 차단 (동시 요청 race 안전망)
  - 인덱스 `(vehicle_id, start_at)`, `(user_id, start_at)`
- **차량 API** (`/api/vehicles`, `/api/vehicles/[id]`): GET 목록(`?activeOnly`) / POST·PUT·DELETE는 `isAdminOrAbove`. 차량번호 중복 409. 예약 이력 있는 차량 DELETE → 비활성화 처리(기기 관리와 동일 패턴)
- **예약 API** (`/api/vehicle-reservations`, `[id]`):
  - GET: 기간(`from`/`to` 겹침)·차량·`mine=true` 필터, RESERVED만 반환, 차량·예약자 정보 포함
  - POST: USER 이상. `$transaction` 안에서 겹침 검사 → 409 + "이미 ○○님이 …~… 예약" 메시지 + conflict 정보. EXCLUDE 제약 위반(race)도 409 처리
  - PUT: 본인 or ADMIN+. 시간·차량 변경 시 충돌 재검사(자기 자신 제외). 취소된 예약 수정 400
  - DELETE: 본인 or ADMIN+. soft 취소(status=CANCELED) → 취소된 시간대 재예약 가능
  - 감사 로그: `resource='vehicle'` / `'vehicle_reservation'` CREATE/UPDATE/DELETE 전부 기록
- **차량 관리 페이지** (`/settings/vehicles`): 설정 페이지 표준 패턴 (테이블 + 인라인 수정 + ↑↓ 순서 + 활성 토글 + 추가 행), 보드 색상은 ColorPicker 재사용
- **차량예약 페이지** (`/vehicle-reservations`):
  - 주간 보드: 행=차량(색 칩), 열=월~일, 예약 카드(시간/예약자/목적), 내 예약 파란 강조, 다일 예약 ←/→ 분할 표시
  - 빈 셀 클릭 → 차량·날짜 채워진 예약 모달, 카드 클릭 → 상세(본인/ADMIN은 수정·취소)
  - 주 이동 ◀▶/오늘, URL `?week=` 동기화(history.replaceState), 오늘·주말 컬럼 하이라이트
  - 내 예약 탭: 다가오는 예약 목록(건수 뱃지) + 상세 진입
  - 모달: 30분 단위 시각 select(종료 24:00 지원, 자정 종료 예약은 전날 24:00으로 표현), 종일(09:00~18:00) 버튼, 다일 예약 지원
  - VIEWER는 조회만(예약 버튼·셀 클릭·취소 비노출)
- **네비게이션**: `NavIcons`에 `CarIcon` 추가(`icon_key='car'`), `nav_menu_items`에 `vehicle-reservations`(차량예약, sort 58 — 유지보수와 AI 사이) + `settings/vehicles`(차량 관리, ADMIN+, sort 160) INSERT (DEV 적용 완료, idempotent)
- **검증**: `npx tsc --noEmit` + ESLint 통과. 라우트 핸들러 직접 호출 통합 테스트 **30건 전부 통과**
  - Phase 1 (12건): CRUD/권한 403/중복 409/activeOnly/이력 차량 비활성화/감사로그
  - Phase 2 (18건): 생성/충돌 409/경계 접촉 허용/타차량 동시간/비활성 차량 400/기간·mine 필터/본인·타인 수정·취소 권한/취소 후 재예약/EXCLUDE 제약 우회 INSERT 차단(23P01)/감사로그
  - 테스트 스크립트: `scripts/test-vehicle-api.mts`, `scripts/test-vehicle-reservation-api.mts` (재검증용 보존, 테스트 데이터 자동 정리)
- **영향 파일**: `prisma/schema.prisma`, `prisma/migrations/20260610113000_add_vehicle_reservation/` (신규), `app/api/vehicles/route.ts` + `[id]/route.ts` (신규), `app/api/vehicle-reservations/route.ts` + `[id]/route.ts` (신규), `app/settings/vehicles/page.tsx` (신규), `app/vehicle-reservations/page.tsx` + `ReservationModal.tsx` (신규), `app/components/NavIcons.tsx`, `README.md`, `vehicle_dev_schedule.md`
- **버그 수정 (빌드 후 사용자 리포트)**: 보드 빈 셀 클릭 시 예약 모달이 안 열리는 문제 — `/api/auth/me`가 user 객체를 직접 반환하는데 페이지가 `data.user`로 파싱해 `me`가 항상 null → 예약 권한 없음으로 오판. Navigation 등 기존 패턴(`data?.role` 직접 읽기)에 맞춰 수정
- **E2E 검증** (`scripts/test-vehicle-e2e.mts`, 실제 HTTP 스택 localhost:3000 대상): 14/14 통과 — auth/me 형태, 미인증 307/인증 200, 차량 등록→예약→충돌 409→주간/내 예약 조회→수정→취소→보드 미노출→이력 차량 비활성화 전 플로우
- **빌드·재시작**: dev2에서 힙 4GB 빌드 + `pm2 resurrect`(데몬 초기화 상태였음) 후 재시작. dev2의 thync-dev는 포트 **3000** (3001은 EC2 dev)
- **미실행**: git push (사용자 명시 요청 대기), PROD 반영(Phase 5)

---

## 2026-06-10 | 사내 위키(Wiki) — 페이지 이동(트리 간)·복제·드래그앤드롭

- **목적**: Phase 3/7에서 이연됐던 페이지 단위 이동·복제 UX 완성. ① 트리 간 이동 모달, ② 페이지 복제, ③ DnD 트리 이동 3종 한 batch.
- **move API 확장** (`/api/wiki/pages/[id]/move`):
  - 신규 `{parentId, position}` 모드 — 새 부모의 자식 중 position 인덱스에 삽입, 형제 전체 sortOrder 0..n 재부여 (`$transaction`)
  - 기존 3개 모드(direction/parentId/sortOrder) 그대로 유지, 순환 참조 차단 로직 공유
- **duplicate API 신규** (`POST /api/wiki/pages/[id]/duplicate`, body `{includeChildren?}`):
  - 복사: 본문(contentJson/plainText)·발행 상태·태그·참조(병원/프로젝트). 미복사: 댓글·버전·즐겨찾기·열람로그·첨부(본문 이미지 URL은 원본 첨부를 가리킴)
  - 사본은 같은 부모 최하단 배치, 최상위 사본만 제목에 " (사본)" suffix, 하위는 sortOrder 보존 재귀 복제
  - 작성자/수정자 = 복제 실행자, 감사로그 CREATE (`duplicatedFrom`/`copiedCount` 메타)
- **MovePageModal** (`app/wiki/components/MovePageModal.tsx`, 신규): `/api/wiki/tree` 기반 트리에서 새 부모 선택, "최상위(루트)" 옵션, 자기 자신/후손·현재 위치 비활성화
- **WikiPageView**: "📂 이동"·"⧉ 복제" 버튼 추가. 복제는 3택 모달(취소/이 페이지만/하위 포함). 서버 page.tsx에서 `parentId` prop 전달 추가
- **사이드바 DnD** (`@dnd-kit/core` 신규 설치, WikiSidebar 개편):
  - 행 hover 시 드래그 핸들(⠿) 노출 — 핸들로만 드래그 시작 (PointerSensor distance 5px, 링크 클릭과 충돌 없음)
  - 드롭 존 3종: 행 위(하위로 nest, ring 하이라이트) / 행 사이 틈(해당 위치 삽입, 파란 라인) / 하단 존(최상위로)
  - 자기 자신/후손으로의 드롭은 클라이언트에서 차단 (서버 가드와 이중)
  - 행별 📂 버튼으로 모달 이동도 가능 (DnD 불편한 깊은 트리 대비)
- **검증**: `npx tsc --noEmit` 통과. 라우트 핸들러 직접 호출 통합 테스트 14건 전부 통과 (position 이동/같은 부모 재정렬/순환 차단 400/하위 포함 복제 copied=2·태그 복사·suffix/단일 복제/VIEWER 403), 테스트 데이터 정리 확인
- **영향 파일**: `app/api/wiki/pages/[id]/move/route.ts`, `app/api/wiki/pages/[id]/duplicate/route.ts` (신규), `app/wiki/components/MovePageModal.tsx` (신규), `app/wiki/components/WikiSidebar.tsx`, `app/wiki/[id]/WikiPageView.tsx`, `app/wiki/[id]/page.tsx`, `package.json` (`@dnd-kit/core`), `README.md`, `wiki_dev_schedule.md`
- **PROD 반영 완료** (2026-06-10, 커밋 `dea435f`): dev2 검증 후 push → PROD pull + `@dnd-kit` 설치 + 빌드 + 재시작, smoke test 정상. DB 변경 없음

---

## 2026-06-10 | 사내 위키(Wiki) Phase 8 — PROD 반영 완료

- **사전 검토**: 위키 도입이 기존 운영시스템에 영향 없는지 전수 검증 (메인 모듈 코드 변경 최소·의존성 방향 위반 0건·마이그레이션 public 무손상·공유 패키지 버전 변동 없음·tsc/런타임 쿼리/smoke test 통과)
- **dev2 → main push**: 커밋 `061d52b` — Phase 1~7 전체 (50개 파일, +5,732줄)
- **PROD 반영 절차** (사용자 명시 요청):
  1. PROD `git pull` → HEAD `061d52b`
  2. `npm install` — `@blocknote/{core,react,ariakit,server-util}` 0.51.4 설치
  3. PROD DB(`thync_ops`) 마이그레이션 3건 psql `--single-transaction` 적용 + `migrate resolve --applied` → 54건 정합, `wiki.*` 테이블 9종 생성
  4. `nav_menu_items`에 wiki 행 INSERT (idempotent, sort_order=15)
  5. `prisma generate` + 힙 4GB 빌드 → `/wiki/*` 라우트 등록 확인
  6. `pm2 restart thync-prod` → online, Ready in 1.1s
- **smoke test**: `/login` 200, 메인 라우트(hospitals/projects/tasks) 및 위키 라우트(/wiki, search, favorites, recent, API) 모두 미인증 307 정상
- **미이관 항목**: DEV의 위키 본문 51페이지(Notion 임포트분)는 PROD로 이관하지 않음 — PROD 위키는 빈 상태로 시작. 이관 필요 시 별도 결정
- **참고**: PROD DB 작업·빌드·재시작 모두 사용자 명시 요청("prod에 반영해줘")에 따라 수행

---

## 2026-06-10 | 사내 위키(Wiki) Phase 7 — 태그/즐겨찾기/최근/검색/버전/댓글/페이지 블록/mention

- **목적**: 위키 사용성을 Notion 수준에 근접시키기 위한 부가 기능 일괄 도입. 한 batch로 9개 기능 + 6개 신규 DB 모델.
- **DB 마이그레이션** (`20260610075023_add_wiki_phase7`):
  - `wiki.wiki_pages` 에 `plain_text TEXT NOT NULL DEFAULT ''` 추가 (검색용)
  - 신규 테이블 6종 (모두 `@@schema("wiki")`): `wiki_tags` / `wiki_page_tags` / `wiki_favorites` / `wiki_view_logs` / `wiki_versions` / `wiki_comments`
  - 인덱스: 태그 page/tag, favorite (user,createdAt desc), view_log (user,viewed_at desc) + (page_id), version (page_id, saved_at desc), comment (page_id, created_at) + (author_id)
  - FK 방향 wiki → public 유지 (절대 규칙 #8 준수)
- **plain_text 백필 스크립트** (`scripts/backfill-plain-text.mts`): 51개 페이지에 BlockNote JSON → 텍스트 추출 후 컬럼 채움. `lib/wiki/blockText.ts`의 재귀 워커로 `content.text`, inline content `label/title`, page block `title` props 모두 수집
- **태그**:
  - API: `/api/wiki/tags` (GET 목록·검색, POST 생성) / `/api/wiki/tags/[id]` (PUT, DELETE) / `/api/wiki/pages/[id]/tags` (GET, POST `{tagId|name}` 신규 자동 생성, DELETE `?tagId=`)
  - UI: `app/wiki/[id]/TagPicker.tsx` (인라인 chip + 자동완성 dropdown + Enter로 새 태그 추가)
- **즐겨찾기**:
  - API: `/api/wiki/favorites` (GET 내 즐겨찾기 목록), `/api/wiki/pages/[id]/favorite` (GET/POST/DELETE)
  - UI: `app/wiki/[id]/FavoriteButton.tsx` (☆/★ 토글), `app/wiki/favorites/page.tsx` (전용 페이지)
- **최근 본 페이지**:
  - 자동 로깅: 페이지 상세 server component에서 비차단 `wiki_view_logs.create()`
  - 페이지: `app/wiki/recent/page.tsx` — `$queryRaw DISTINCT ON (page_id)`로 페이지당 가장 최근 1건 → 50개 표시
- **검색**:
  - API: `/api/wiki/search?q=&tagId=` — `title` + `plain_text` ILIKE, 태그 필터 동시 적용, snippet 60자 radius
  - 페이지: `app/wiki/search/page.tsx` — 검색 입력 + 태그 칩 필터 + 결과 하이라이트 (제목·snippet 모두 `<mark>` 강조)
- **버전 히스토리**:
  - 자동 스냅샷: 페이지 PUT 시 `contentJson` 변경되면 직전 상태를 `wiki_versions`에 `$transaction` 안에서 저장
  - API: `/api/wiki/pages/[id]/versions` (GET 목록), `/api/wiki/pages/[id]/versions/[versionId]` (GET 상세, POST 복원). 복원도 현재 본문을 새 버전으로 보존한 뒤 적용 → 무손실
  - UI: `app/wiki/[id]/VersionHistoryModal.tsx` — 페이지 상단 "🕘 버전" 버튼으로 열림, 행마다 "복원" 버튼
- **댓글** (flat, 스레드 미지원):
  - API: `/api/wiki/pages/[id]/comments` (GET, POST), `/api/wiki/comments/[id]` (PUT, DELETE)
  - 권한: 본인 댓글 + ADMIN/SUPER_ADMIN 수정·삭제 가능, VIEWER 읽기만
  - UI: `app/wiki/[id]/CommentSection.tsx` — 페이지 하단, Ctrl+Enter 등록 단축키
- **BlockNote 페이지 블록 (커스텀)**:
  - 신규 블록 타입 `wikiPageLink` — props: `pageId`, `title`. 렌더는 `contentEditable={false}` 박스 (📄 + 제목)로 `/wiki/<pageId>` 링크
  - 슬래시(`/`) 메뉴에 "하위 페이지 추가" 항목 — `window.prompt`로 제목 받고 `POST /api/wiki/pages`로 자식 생성 → 받은 id로 `wikiPageLink` 블록 본문 삽입
  - `SuggestionMenuController triggerCharacter="/"`로 기본 슬래시 메뉴 항목 + 커스텀 항목 통합, `filterSuggestionItems`로 쿼리 필터링
- **BlockNote 인라인 mention (커스텀)**:
  - 신규 inline content `mention` — props: `refType` (`hospital`|`project`), `refCode`, `label`. 렌더는 `target="_blank"` 링크 (`/hospitals/[code]` 또는 `/projects/[code]`)
  - `SuggestionMenuController triggerCharacter="@"` + `/api/wiki/mention?q=` (병원/프로젝트 통합 검색, 타입별 5개) → 자동완성 메뉴 → `editor.insertInlineContent`로 본문 삽입
  - 사이드 효과: 명시적 `WikiPageReference`와는 별개로 본문 내 inline 링크가 검색 plain_text에도 포함됨 (label 추출)
- **사이드바 변경** (`WikiSidebar.tsx`): 상단에 3-grid 네비 추가 (🔍 검색 / ⭐ 즐겨찾기 / 🕐 최근), 현재 경로 하이라이트
- **WikiEditor.tsx 대규모 리팩토링**:
  - `BlockNoteSchema.create({blockSpecs, inlineContentSpecs})` 로 커스텀 스키마 정의
  - `createReactBlockSpec`은 팩토리 함수 반환 → 호출하여 spec 얻은 뒤 스키마에 주입 (BlockNote 0.51.4 API)
  - `useCreateBlockNote({schema: wikiSchema, ...})`, `<BlockNoteView slashMenu={false}>` + `<SuggestionMenuController>` 2개 직접 마운트
  - 기존 페이지(50개 임포트 + 테스트) 호환 — 기본 블록은 그대로 인식
  - `onChange` 시그니처를 `(blocks: unknown[]) => void`로 광역화 → 소비자(WikiPageView, new) 상태도 `useState<unknown[]>`로 변경
- **이연 결정**: 드래그앤드롭 트리 이동 — 기존 ↑↓ 버튼이 잘 동작 + DnD는 별도 라이브러리(`@dnd-kit` 등) 필요해서 다음 batch로 이연
- **검증**: `npx tsc --noEmit` 통과, `npm run build` 통과 (`/wiki/[id]` 413KB, 신규 라우트 4종 등록), PM2 재시작 후 모든 신규 라우트 smoke test OK (미인증 307)
- **영향 파일** (총 30+개):
  - `prisma/schema.prisma`, `prisma/migrations/20260610075023_add_wiki_phase7/migration.sql` (신규)
  - `lib/wiki/blockText.ts` (신규), `scripts/backfill-plain-text.mts` (신규)
  - `app/api/wiki/tags/route.ts` + `[id]/route.ts` (신규)
  - `app/api/wiki/pages/[id]/tags/route.ts` (신규)
  - `app/api/wiki/favorites/route.ts` + `/api/wiki/pages/[id]/favorite/route.ts` (신규)
  - `app/api/wiki/search/route.ts` (신규)
  - `app/api/wiki/pages/[id]/versions/route.ts` + `[versionId]/route.ts` (신규)
  - `app/api/wiki/pages/[id]/comments/route.ts` + `/api/wiki/comments/[id]/route.ts` (신규)
  - `app/api/wiki/mention/route.ts` (신규)
  - `app/api/wiki/pages/route.ts`, `app/api/wiki/pages/[id]/route.ts` (plainText 동기화 + 버전 스냅샷)
  - `app/wiki/components/WikiEditor.tsx` (커스텀 스키마 전면 재작성)
  - `app/wiki/components/WikiSidebar.tsx` (네비 추가)
  - `app/wiki/[id]/page.tsx` (server, 태그·favorite·열람 로그·current user 전달)
  - `app/wiki/[id]/WikiPageView.tsx` (FavoriteButton/TagPicker/VersionHistoryModal/CommentSection 통합)
  - `app/wiki/[id]/TagPicker.tsx`, `FavoriteButton.tsx`, `VersionHistoryModal.tsx`, `CommentSection.tsx` (신규)
  - `app/wiki/favorites/page.tsx`, `app/wiki/recent/page.tsx`, `app/wiki/search/page.tsx` (신규)
  - `app/wiki/new/page.tsx` (상태 타입 변경)
  - `wiki_dev_schedule.md`, `README.md`

---

## 2026-06-09 | 사내 위키(Wiki) Phase 6 — 감사 로그 + 명시적 참조 + 병원 상세 역참조

- **목적**: 위키 mutation을 audit_logs에 기록 + 위키 페이지와 메인 도메인(병원/프로젝트)을 명시적으로 연결하고, 병원 상세에서 관련 위키 문서를 표시.
- **인라인 mention 이연**: 스케줄의 BlockNote 커스텀 inline content + 자동완성(`@hospital:HOSP-001`)은 BlockNote 스키마 커스터마이징 + 에디터 안정성 리스크가 커서 Phase 7로 연기. 대신 **명시적 참조(WikiPageReference)** 로 동일 기능 효과 확보 — 사용자가 "관련 항목"에 직접 병원/프로젝트를 chip으로 추가.
- **DB 마이그레이션** (`20260609091541_add_wiki_page_references`):
  - `wiki.wiki_page_references` 테이블 신설 (`id`/`page_id`/`ref_type`/`ref_code`/`created_by`/`created_at`)
  - 인덱스 3종: `(page_id, ref_type, ref_code)` UNIQUE / `(ref_type, ref_code)` / `(page_id)`
  - FK: `page_id → wiki.wiki_pages CASCADE`, `created_by → public.users RESTRICT` (단방향 wiki→public 유지)
- **Prisma 모델**: `WikiPageReference` 추가, `WikiPage.references`, `User.wikiPageRefsCreated` 역참조 등록
- **감사 로그 적용** (`lib/audit.ts`):
  - 위키 페이지 CREATE/UPDATE/DELETE 모두 `resource='wiki_page'`로 기록
  - `before/after`는 메타(`title`, `parentId`, `isPublished`, `slug`)만 + UPDATE에는 `contentChanged: boolean` 플래그
  - 본문 JSON 통째 저장은 비용/가치 비효율로 제외 (필요해지면 Phase 7 WikiVersion 활용)
- **참조 API 신규**:
  - `GET /api/wiki/pages/[id]/references` — 페이지의 참조 목록 + 메인 도메인 라벨(병원명/프로젝트명) enrich
  - `POST /api/wiki/pages/[id]/references` — `{refType, refCode}` 추가. 도메인 객체 존재 검증 + UNIQUE 위반 시 409
  - `DELETE /api/wiki/pages/[id]/references/[refId]` — 연결 해제
- **GET /api/wiki/pages 확장**: `?refType=&refCode=` 쿼리로 역참조 검색 (특정 병원/프로젝트를 참조하는 페이지 목록)
- **위키 상세 UI**:
  - `app/wiki/[id]/page.tsx` (server) — 참조 + 라벨 enrich
  - `app/wiki/[id]/WikiPageView.tsx` — "관련 항목:" 영역에 chip 렌더 + "+ 연결" 버튼. 내부 `ReferenceChip` 컴포넌트로 분리
  - `app/wiki/[id]/ReferencePickerModal.tsx` (신규) — 병원/프로젝트 탭 + debounce 검색 + 클릭 시 POST → onAdded
- **병원 상세 역참조** (CLAUDE.md 절대 규칙 #7 준수 — 메인 → 위키 코드 import 금지):
  - `app/hospitals/[code]/_components/RelatedWikiPagesCard.tsx` (신규, 메인 모듈 내) — `useEffect`에서 `fetch('/api/wiki/pages?refType=hospital&refCode=...')` 호출. `@/app/wiki/*`, `@/lib/wiki/*` import 0건 (소스 상단 주석으로 명시)
  - `app/hospitals/[code]/page.tsx` — 마지막 카드로 `<RelatedWikiPagesCard hospitalCode={...} />` 삽입. 참조 0건이면 카드 자체 미렌더
- **검증**: `npx tsc --noEmit` 통과, `prisma validate` OK.
- **영향 파일**: `prisma/schema.prisma`, `prisma/migrations/20260609091541_add_wiki_page_references/migration.sql` (신규), `app/api/wiki/pages/route.ts`, `app/api/wiki/pages/[id]/route.ts`, `app/api/wiki/pages/[id]/references/route.ts` (신규), `app/api/wiki/pages/[id]/references/[refId]/route.ts` (신규), `app/wiki/[id]/page.tsx`, `app/wiki/[id]/WikiPageView.tsx`, `app/wiki/[id]/ReferencePickerModal.tsx` (신규), `app/hospitals/[code]/page.tsx`, `app/hospitals/[code]/_components/RelatedWikiPagesCard.tsx` (신규), `README.md`, `wiki_dev_schedule.md`

---

## 2026-06-09 | 사내 위키(Wiki) Phase 5 — 권한 가드 강화 + 메인 메뉴 등록

- **목적**: 위키를 일반 운영 시스템처럼 메인 네비게이션에서 접근 가능하게 등록 + 권한 정책 명문화.
- **권한 가드**: Phase 2 시점에 이미 `getAuthUser` + `VIEWER POST/PUT/DELETE 403` 적용되어 있어 추가 코드 없음 (재확인만).
  - Phase 0 결정대로 페이지별 ACL은 미구현 (Phase 7 후순위)
- **메인 메뉴 등록**:
  - `nav_menu_items` 테이블에 `wiki` 행 1건 INSERT — `(menu_key='wiki', label='사내 위키', href='/wiki', icon_key='book', sort_order=15, allowed_roles='{}', allowed_org_codes='{}', is_active=true)`
  - 정렬: `hira-hospitals(10)` 다음, `hospitals(20)` 앞
  - `allowed_roles='{}'`로 전체 역할(VIEWER 포함) 노출, 향후 SUPER_ADMIN UI에서 토글 가능
- **NavIcons**: `BookIcon` SVG 신규 추가, `ICON_MAP['book']` 매핑 등록
- **PROD 반영 필요**: 동일 INSERT를 PROD `nav_menu_items`에도 실행해야 메뉴 노출됨 (사용자 명시 요청 후 진행)
- **영향 파일**: `app/components/NavIcons.tsx`, DB 직접 변경 (마이그레이션 파일 X — 데이터 시드성), `README.md`, `wiki_dev_schedule.md`

---

## 2026-06-09 | 사내 위키(Wiki) Phase 4 — 파일 첨부 (S3) + BlockNote 업로드 연동

- **목적**: 위키 페이지에 이미지/파일을 BlockNote 에디터 안에서 직접 업로드·표시.
- **S3 통합**: 기존 `lib/s3.ts` 재사용 (`uploadToS3`, `getSignedUrl`, `deleteFromS3`)
- **S3 키 패턴** (Phase 0 결정): `wiki/{pageId}/{timestamp}_{safeFileName}` (파일명은 `[^\w.\-]+` → `_` 치환으로 안전화)
- **신규 API**:
  - `POST /api/wiki/upload?pageId=<id>` — multipart `file` 업로드. 50MB 초과 시 413, pageId 누락/페이지 부재 시 400/404. 응답에 `url='/api/wiki/files/[attachmentId]'` (BlockNote 본문에 영구적으로 박을 URL)
  - `GET /api/wiki/files/[id]` — 인증 사용자에게 24h presigned URL로 **307 redirect**. BlockNote 렌더 시점마다 fresh URL 발급
  - `DELETE /api/wiki/files/[id]` — S3 + DB row 삭제 (USER+). S3 실패는 로그만 남기고 DB는 정리
- **BlockNote 연동** (`app/wiki/components/WikiEditor.tsx`):
  - `pageId` prop 추가. 있을 때만 `uploadFile` 콜백 활성화하여 BlockNote 이미지/파일 블록의 업로드 핸들러 동작
  - `pageId` 없는 경우(=`/wiki/new`)는 업로드 비활성, 안내 문구 표시
- **페이지 삭제 시 첨부 정리**:
  - `app/api/wiki/pages/[id]/route.ts` DELETE — 자식 페이지 ID를 BFS로 수집 → 모든 해당 페이지의 첨부 S3 키 best-effort 삭제 → 페이지 삭제 (DB CASCADE가 첨부 row 정리)
- **검증**: `npx tsc --noEmit` 통과
- **영향 파일**: `app/api/wiki/upload/route.ts` (신규), `app/api/wiki/files/[id]/route.ts` (신규), `app/api/wiki/pages/[id]/route.ts`, `app/wiki/components/WikiEditor.tsx`, `app/wiki/[id]/WikiPageView.tsx`, `app/wiki/new/page.tsx`, `README.md`, `wiki_dev_schedule.md`

---

## 2026-06-09 | 사내 위키(Wiki) Phase 3 — 페이지 트리 + 사이드 네비게이션 + 이동/정렬 API

- **목적**: Notion-like 좌측 사이드바에서 위키 페이지를 계층 탐색 + 순서/부모 변경 가능하게.
- **API 신규**:
  - `GET /api/wiki/tree` — 전체 위키 페이지를 평면 리스트로 반환 (클라이언트에서 트리 구성)
  - `PATCH /api/wiki/pages/[id]/move` — 3가지 모드
    1. `{ direction: 'up' | 'down' }` — 같은 부모 안 인접 형제와 sortOrder 교환 (단일 트랜잭션)
    2. `{ parentId: string | null }` — 새 부모로 이동. sortOrder 미지정 시 새 부모 자식 최하단
    3. `{ sortOrder: number }` — 명시적 위치 지정
  - **순환 참조 방지**: 새 parentId가 본인이거나 본인의 후손이면 400. 후손 집합은 BFS로 in-memory 계산
- **UI 신규**:
  - `app/wiki/layout.tsx` — 좌측 사이드바(고정 폭 288px) + 우측 콘텐츠 flex 레이아웃. `/wiki/*` 모든 페이지에 자동 적용
  - `app/wiki/components/WikiSidebar.tsx` (client) — 트리 렌더, 행 hover 시 ↑↓+ 버튼 노출
    - chevron(▼/▶) 토글로 자식 접기/펼치기 (로컬 state, 기본 펼침)
    - ↑↓: 형제 sortOrder 교환 API 호출 → `router.refresh()`
    - +: `/wiki/new?parentId=<id>`로 이동
    - 현재 페이지는 `bg-blue-100`으로 하이라이트 (`usePathname` 기반)
    - 재귀 컴포넌트(`TreeRow`)로 무한 깊이 지원, 들여쓰기 depth*12px
  - `app/wiki/new/page.tsx` — `?parentId=` 쿼리 수용, "하위 페이지로 추가됩니다" 뱃지 표시
  - `app/wiki/[id]/page.tsx` — server-side에서 부모 체인 BFS로 수집 (방문 set으로 무한루프 방지)
  - `app/wiki/[id]/WikiPageView.tsx` — breadcrumb (`위키 / 부모 / ... / 현재`) + "+ 하위 페이지" 버튼 추가
  - `app/wiki/page.tsx` — 사이드바와 중복되는 헤더/버튼 제거, "최근 수정 페이지" 목록으로 간소화
- **검증**: `npx tsc --noEmit` 통과. `Map.values()` 이터레이션은 `Array.from()`으로 래핑 (TS target ES2017 호환).
- **빌드/PM2 재시작**: CLAUDE.md 절대규칙 #3에 따라 사용자 명시 요청 대기.
- **영향 파일**: `app/api/wiki/tree/route.ts` (신규), `app/api/wiki/pages/[id]/move/route.ts` (신규), `app/wiki/layout.tsx` (신규), `app/wiki/components/WikiSidebar.tsx` (신규), `app/wiki/new/page.tsx`, `app/wiki/[id]/page.tsx`, `app/wiki/[id]/WikiPageView.tsx`, `app/wiki/page.tsx`, `wiki_dev_schedule.md`, `README.md`

---

## 2026-06-09 | 사내 위키(Wiki) Phase 2 — BlockNote POC (페이지 1개 CRUD)

- **목적**: BlockNote 에디터로 페이지 1개를 작성·저장·조회·수정·삭제하는 최소 동작 확보.
- **에디터 선택 변경**: Phase 0 결정의 `@blocknote/mantine` → **`@blocknote/ariakit`** 전환
  - 사유 1: Mantine 9.3.1이 React 19 peer dep 강제 → React 18 프로젝트와 충돌
  - 사유 2: `@blocknote/shadcn`은 Tailwind 4.x 요구 → 프로젝트는 Tailwind 3.4.1 (메이저 업그레이드 비용은 위키 도입과 별개)
  - Ariakit은 헤드리스라 Tailwind 3 + React 18과 무충돌
  - `wiki_dev_schedule.md`의 Phase 0 결정 요약에 반영
- **신규 패키지**: `@blocknote/core` `@blocknote/react` `@blocknote/ariakit` (모두 0.51.4)
- **API 라우트 신설**:
  - `app/api/wiki/pages/route.ts` — GET 목록(`?parentId=` 필터 지원) / POST 생성
  - `app/api/wiki/pages/[id]/route.ts` — GET 상세 / PUT 수정 / DELETE 삭제
  - 권한: 미들웨어로 미인증 차단(자동) + API에서 VIEWER는 POST/PUT/DELETE 403
  - 자기 자신을 parent로 지정 시 400
- **UI 라우트 신설**:
  - `app/wiki/page.tsx` (server) — 최근 50개 페이지 목록, "+ 새 페이지" 버튼
  - `app/wiki/new/page.tsx` (client) — 제목 + BlockNote 에디터로 신규 작성
  - `app/wiki/[id]/page.tsx` (server) — 페이지 fetch 후 클라이언트 컴포넌트로 전달
  - `app/wiki/[id]/WikiPageView.tsx` (client) — 읽기 모드 ↔ 편집 모드 토글, 저장/삭제
  - `app/wiki/components/WikiEditor.tsx` (client) — BlockNote 래퍼 (initialContent, editable, onChange)
- **저장 형식**: BlockNote JSON 블록 배열을 `wiki.wiki_pages.content_json` JSONB에 그대로 저장
- **mutation 후 처리**: 모든 POST/PUT/DELETE 후 `router.refresh()` + 필요 시 `router.push()` (코딩 컨벤션 준수)
- **검증 진행**:
  - `npx tsc --noEmit` 통과
  - `npm run build`/PM2 재시작은 CLAUDE.md 절대규칙 #3에 따라 **사용자 명시 요청 대기**
  - 메인 메뉴 등록(`nav_menu_items` INSERT)은 Phase 5에서 진행 — 현재는 직접 `/wiki` URL 접근 (또는 SUPER_ADMIN UI 설정)
- **영향 파일**: `package.json`, `package-lock.json`, `app/api/wiki/pages/route.ts` (신규), `app/api/wiki/pages/[id]/route.ts` (신규), `app/wiki/page.tsx` (신규), `app/wiki/new/page.tsx` (신규), `app/wiki/[id]/page.tsx` (신규), `app/wiki/[id]/WikiPageView.tsx` (신규), `app/wiki/components/WikiEditor.tsx` (신규), `wiki_dev_schedule.md`, `README.md`

---

## 2026-06-09 | 사내 위키(Wiki) 모듈 Phase 0~1 — 설계 확정 + DB 스키마 신설

- **목적**: thynC Ops에 Notion-like 사내 위키 기능 추가. 기존 시스템과 통합하되 모듈/DB 스키마/의존성으로 격리하여 추후 분리 가능성 보존.
- **Phase 0 — 설계 결정 확정 (`wiki_dev_schedule.md`)**:
  - 통합 방식: 소스 모듈 분리 + 단일 배포 (B)
  - DB: 같은 DB + 새 PostgreSQL 스키마 `wiki`
  - 에디터: BlockNote (기존 Tiptap 3.20.4 위)
  - 의존성: wiki → main 코드 import OK / main → wiki 금지 (HTTP fetch만)
  - 권한: 역할 기반만 / 트리: parent_id 무한 깊이 / 버전: 덮어쓰기 / 검색: 제목·태그만 (풀텍스트 Phase 7) / 첨부: 50MB, `wiki/{pageId}/{ts}_{name}` / VIEWER 읽기 허용 / 테마 `@blocknote/mantine`
- **Phase 1 — DB 스키마 신설 + Prisma 모델**:
  - `prisma/schema.prisma`: `multiSchema` preview 활성화, `schemas = ["public", "wiki"]` 추가
  - 기존 36개 모델 + Role enum 전체에 `@@schema("public")` 부여 (sed 일괄)
  - 신규 모델: `WikiPage` (id/parentId/title/slug/contentJson(JSONB)/isPublished/sortOrder/authorId→User/lastEditorId→User), `WikiAttachment` (id/pageId→WikiPage/fileName/s3Key UNIQUE/size/mimeType/uploaderId→User) 둘 다 `@@schema("wiki")`
  - User 모델에 역참조 추가 (`wikiPagesAuthored`, `wikiPagesEdited`, `wikiAttachmentsUploaded`)
  - FK 방향: wiki → public 만 (CLAUDE.md 절대규칙 #8 준수)
- **마이그레이션** (`20260609083213_add_wiki_schema/migration.sql`):
  - `CREATE SCHEMA IF NOT EXISTS wiki`
  - `wiki.wiki_pages`, `wiki.wiki_attachments` 테이블 + 인덱스 (`(parent_id, sort_order)`, `(updated_at DESC)`, `(author_id)`, `(page_id)`, `s3_key` UNIQUE)
  - 수동 SQL → `psql -f` 적용 → `prisma migrate resolve --applied` → `prisma generate`
  - `prisma migrate status` clean, 타입체크 통과
- **CLAUDE.md 갱신**:
  - 절대 규칙 #7 추가 — 위키 모듈 경계 (단방향 의존성)
  - 절대 규칙 #8 추가 — 위키 DB 테이블은 `wiki` 스키마에만, FK 역방향 금지
  - "약속어" 섹션에 "위키 Phase 진행" 트리거 추가
  - "코딩 컨벤션 > 에디터 사용 분기" 추가 (위키는 BlockNote, 기존 Tiptap 유지)
  - "작업 시작 시" 4번 항목 추가 — 위키 작업 시 `wiki_dev_schedule.md` 확인
- **DEV 적용 완료, PROD 미적용** — Phase 진행 모두 끝나고 사용자 명시 요청 시 동일 SQL을 PROD에도 실행 필요
- **영향 파일**: `prisma/schema.prisma`, `prisma/migrations/20260609083213_add_wiki_schema/migration.sql` (신규), `CLAUDE.md`, `wiki_dev_schedule.md` (신규), `README.md`

---

## 2026-05-19 | 메일 자동 동기화 스케줄러 — 외부 fetch 제거 (직접 함수 호출)

- **문제**: 설치계획·답사 모두 자동 메일 동기화가 동작하지 않음. "메일 가져오기" 버튼(수동)을 누를 때만 그동안 누락된 메일이 한꺼번에 수집됨.
- **원인**:
  1. `mail-scheduler.ts`가 `fetch(NEXT_PUBLIC_APP_URL + path)`로 **외부 HTTPS 도메인을 통해 자기 자신을 호출**하는 구조였음. nginx/middleware/SSL 경로를 거치며 부작용 발생.
  2. `middleware.ts`가 `/api/mail-queue`만 공개 경로로 두고 `/api/site-visit-queue`는 보호 → 스케줄러의 Bearer 인증이 통과하지 못해 `/login`으로 307 redirect → fetch가 POST 메서드 유지한 채 follow → `/login`은 페이지 라우트라 POST 미지원 → **HTTP 405**. 이로 인해 답사 자동 sync는 약 5일 동안 0회 성공(`mail_sync_last_site_visit` 갱신 5/14에 멈춤).
- **수정**: 두 sync 라우트의 비즈니스 로직을 `lib/mail-sync.ts`로 추출하고, 스케줄러는 외부 fetch 없이 그 함수를 직접 import해 호출. middleware·nginx·도메인·인증 전부 우회.
- **영향 파일**:
  - `lib/mail-sync.ts` (신규) — `syncInstallPlanMails()` / `syncSiteVisitMails()` 순수 함수
  - `lib/mail-scheduler.ts` — `fetch`/`CRON_SECRET`/`NEXT_PUBLIC_APP_URL` 의존 제거, 직접 함수 호출
  - `app/api/mail-queue/sync/route.ts` — 인증 wrapper로 슬림화(107→약 35줄)
  - `app/api/site-visit-queue/sync/route.ts` — 동일 패턴(99→약 35줄)
- **수동 버튼 동작**: 페이지의 "메일 가져오기" fetch는 쿠키 인증으로 middleware 통과하므로 그대로 작동.
- **남은 작업**: `middleware.ts`가 `/api/site-visit-queue`를 보호하는 부분은 자동 sync와 무관해졌지만, 외부 cron이나 curl로 답사 sync route를 직접 호출하는 시나리오에는 여전히 영향. 필요 시 별도 추가.

---

## 2026-05-19 | DB ↔ Prisma 스키마 drift 정합화 (DEV)

- **배경**: DEV DB와 `schema.prisma`·마이그레이션 히스토리 비교 결과 3건의 drift 발견
  1. `daewoong_staff` 테이블이 DB에는 존재하나 schema·코드에 정의 없음. 어떤 마이그레이션도 CREATE한 적이 없는 잔재. 행 0건.
  2. `install_plans.created_at`, `updated_at`이 DB에서 NULL 허용으로 생성되어 있으나 `schema.prisma`는 required. 실데이터는 모두 기본값으로 채워져 있어 영향 없음.
  3. `20260401000000_add_hira_sync_jobs` 마이그레이션 파일이 존재하나 `_prisma_migrations`에 적용 기록 없음(테이블은 이미 DB에 존재) — `prisma migrate status`가 미적용으로 경고.
- **적용 내용**:
  - DEV DB: `DROP TABLE IF EXISTS daewoong_staff`, `install_plans` 타임스탬프 NOT NULL 전환
  - 신규 마이그레이션 `prisma/migrations/20260519000000_fix_schema_drift/migration.sql` 생성 + `migrate resolve --applied`
  - **과거 마이그레이션 수정** `prisma/migrations/20260323120000_add_site_visit/migration.sql`: 존재하지 않는 `daewoong_staff` 테이블을 FK 참조하던 `ALTER TABLE site_visits ADD CONSTRAINT site_visits_daewoong_staff_id_fkey` 블록 제거. `daewoong_staff_id` 컬럼 자체는 후속 `20260324000004_update_site_visit_fk`가 DROP하므로 유지. `_prisma_migrations.checksum`을 새 파일 sha256으로 갱신
  - 누락된 `20260401000000_add_hira_sync_jobs`를 `migrate resolve --applied`로 기록
- **검증**: `prisma migrate status` → "Database schema is up to date!" / drift 비교 스크립트 → 0건
- **PROD 반영 필요**: 동일 작업을 PROD DB(`thync_ops`)와 `thynC-Ops-PROD` 리포에도 적용해야 환경 간 정합이 완성됨 (사용자 명시 요청 후 진행)

---

## 2026-05-04 | 업무 등록에 따른 병원 thynC 현황상태 자동 진행

- **요구사항**:
  1. 설치계획(가안) 등록 → 병원 status `가견적요청`
  2. 답사 등록 → 병원 status `답사요청`
  3. 프로젝트 등록 시 `contractDate` 입력 → 병원 status `계약완료` + `Hospital.contractDate` 갱신(단, 기존 값이 있으면 보존 — 추가도입)
  4. 프로젝트 `buildStatus`가 `구축완료`(라벨에 `완료` 포함)로 변경 → 병원 status `운영`
- **단방향 규칙**: 진행 단계 rank(미계약=1 → 가견적요청=2 → 답사요청=3 → 계약완료=4 → 운영=5 → 해지=6) 기준, **현재보다 후행 단계로만 갱신**한다. 이미 `운영`인 병원에 새 설치계획·답사가 들어와도 status는 보존(추가도입 케이스).
- **lib/hospitalStatus.ts 신규**:
  - `advanceHospitalStatus({ hospitalCode, targetStatus, newContractDate?, req?, actor?, source? })` — 단방향 검사 → Hospital.status·contractDate 부분 갱신 → AuditLog `UPDATE`(`resource='hospital'`, label에 `(자동: <source>)` 표기) 기록.
  - 변경이 발생했을 때만 audit 기록(노이즈 방지). `newContractDate`는 Hospital.contractDate가 NULL일 때만 채움.
  - 모든 실패는 try-catch로 흡수 → 본 작업(설치계획/답사/프로젝트 저장) 비차단.
- **적용 위치**:
  - `app/api/install-plans/route.ts` POST → `가견적요청`
  - `app/api/site-visits/route.ts` POST → `답사요청`
  - `app/api/projects/route.ts` POST(contractDate 있을 때) → `계약완료` + Hospital.contractDate fill
  - `app/api/projects/[code]/route.ts` PUT — 두 트리거:
    - `contractDate`가 PUT으로 채워졌을 때(등록 시 미입력 → 사후 입력 케이스 포함) → `계약완료` + Hospital.contractDate fill(NULL일 때만)
    - `buildStatus` 라벨에 `완료` 포함될 때(기존 task 완료 동기화 분기 안에서) → `운영`
  - `app/api/mail-queue/[id]/route.ts` PUT(설치계획 자동 등록 시) → `가견적요청`
  - `app/api/site-visit-queue/[id]/route.ts` PUT(답사 자동 등록 시) → `답사요청`
  - 메일 큐 `sync` 핸들러(폴링→큐 적재)에는 적용하지 않음 — 사용자 정책: 큐 적재 시점 아닌 실제 관리자 등록 시점에만 반영.
- **DB/스키마 변경 없음** (`hospitals.status`는 기존 text 컬럼 그대로 사용).
- **검증**: `npx tsc --noEmit` 통과.
- **영향 파일**: `lib/hospitalStatus.ts` (신규), `app/api/install-plans/route.ts`, `app/api/site-visits/route.ts`, `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`, `app/api/mail-queue/[id]/route.ts`, `app/api/site-visit-queue/[id]/route.ts`, `README.md`, `DEV_HISTORY.md`

---

## 2026-05-04 | PROD → DEV 데이터 동기화 스크립트 추가

- **목적**: 상용 데이터를 기준으로 DEV 환경 테스트가 필요할 때, 매번 수동 절차(덤프·TRUNCATE·복원)를 반복하지 않도록 스크립트화.
- **scripts/sync-prod-data-to-dev.sh 신규**:
  - DEV DB(`thync_ops_dev`) 자체는 유지하고 데이터만 PROD(`thync_ops`)로 덮어쓰기 (DROP DATABASE 미사용)
  - 단계: ① `.env`에서 DB 비번 자동 추출 → ② PROD/DEV 연결 확인 → ③ **스키마 diff 검사**(불일치 시 중단, `\restrict`/`\unrestrict` 무작위 토큰 라인은 무시) → ④ 사용자 확인(`--yes`로 생략) → ⑤ DEV 전체 백업 → ⑥ PROD `--data-only` 덤프(`_prisma_migrations` 제외) → ⑦ TRUNCATE + 적재 단일 트랜잭션 → ⑧ 7일 지난 백업 자동 삭제
  - `_prisma_migrations`는 동기화 제외(DEV 고유 마이그레이션 상태 보존)
  - `thync` 유저가 슈퍼유저가 아니라 `session_replication_role` 사용 불가 → `pg_dump` 의존성 정렬에 의존 + TRUNCATE/적재를 단일 트랜잭션으로 묶어 실패 시 DEV 무변경 보장
  - 백업 위치: `/home/ubuntu/backups/db-sync/`, 보관 7일
- **사용법**: `./scripts/sync-prod-data-to-dev.sh` (또는 `--yes`)
- **롤백**: `gunzip -c <backup>.sql.gz | psql -U thync -d thync_ops_dev`
- **첫 실행 결과** (2026-05-04 00:16): 약 9초 소요, users/projects/hospitals/tasks/audit_logs 등 주요 테이블 row 수 PROD↔DEV 일치 확인.
- **영향 파일**: `scripts/sync-prod-data-to-dev.sh` (신규)

---

## 2026-05-03 | 답사(SiteVisit) 삭제 실패 수정 — site_visit_queue FK 분리 후 삭제

- **증상**: PROD에서 답사 상세페이지에서 삭제 시 실패 (예: VISIT-202604-00023). 답사가 답사 등록 큐(`site_visit_queue`)로부터 자동 등록된 경우 재현.
- **원인**: `site_visit_queue.site_visit_id` FK가 `ON DELETE NO ACTION` (Prisma `SiteVisitQueue.siteVisit` 관계에 `onDelete` 미지정). 큐 레코드가 답사를 참조 중이면 PostgreSQL이 SiteVisit DELETE를 거부.
- **수정**: `app/api/site-visits/[id]/route.ts` DELETE 핸들러에서 `prisma.$transaction`으로 (1) `siteVisitQueue.updateMany({ siteVisitId } → null)` 실행 후 (2) `siteVisit.delete` 실행하도록 변경. 큐 이력 자체는 보존.
- **영향 파일**: `app/api/site-visits/[id]/route.ts`
- **DB/스키마 변경 없음**. (스키마 차원의 `onDelete: SetNull` 변환은 향후 별도 검토)

---

## 2026-04-28 | 감사 로그(AuditLog) 시스템 도입 — 모든 mutation·인증 이벤트 기록 + 관리자 조회 UI

- **DB 마이그레이션** (20260428000000_add_audit_logs):
  - `audit_logs` 테이블 신규 생성 (id SERIAL PK, actor_id/email/name/role 스냅샷, action, resource, resource_id, resource_label, before/after JSONB, ip_address, user_agent, created_at)
  - 인덱스 3종: (actor_id, created_at DESC), (resource, resource_id, created_at DESC), (created_at DESC)
  - User FK는 의도적으로 두지 않음 — 사용자 삭제 후에도 로그 보존 위해 actor 정보 스냅샷 컬럼으로 보관
- **lib/audit.ts 신규 작성**:
  - `logAudit({ req, actor, action, resource, resourceId, resourceLabel, before, after })` — 동기 기록, try-catch로 본 작업 비차단
  - `auditActorFromJWT(jwt)` — JWTPayload(`userId/email/name/role`)를 AuditActor로 변환
  - `redact()` — `password`/`passwordHash`/`hashedPassword` 키를 `[REDACTED]`로 자동 마스킹 (재귀 적용, Date는 ISO 문자열로 변환)
  - `getRequestMeta()` — `x-forwarded-for`/`x-real-ip` 우선순위로 IP 추출, User-Agent 추출
- **적용 범위 — Stage 2a (인증 2개)**:
  - `app/api/auth/login/route.ts` LOGIN 기록 (성공 시)
  - `app/api/auth/logout/route.ts` LOGOUT 기록 (시그니처에 `req: NextRequest` 추가)
- **적용 범위 — Stage 2b (User CRUD 4개)**:
  - `app/api/users/route.ts` POST → CREATE
  - `app/api/users/[id]/route.ts` PUT/PATCH/DELETE → UPDATE/UPDATE/DELETE (PATCH는 isActive 토글만, target 미리 조회로 정확한 before snapshot 확보)
- **적용 범위 — Stage 2c (4대 업무 모듈)**:
  - Project (POST/PUT/DELETE) — VIEWER의 issueNote/remark 부분 수정도 별도 UPDATE 기록
  - SiteVisit (POST/PUT/DELETE)
  - Maintenance (POST/PUT/DELETE)
  - InstallPlan (POST/PUT/DELETE) — PUT/DELETE에 existing 사전 조회 추가, 04-24 Task 동기화 fix와 충돌 해결하여 병합
- **적용 범위 — Stage 3 (부가 모듈)**:
  - Hospital (POST/PUT/DELETE) + 대웅 담당자 배정/해제 (`hospital_daewoong_assignment` resource)
  - Constructor (POST/PUT/DELETE)
  - Settings StatusCode 7종 (status, site-visit-status, intro-type, consultation-type, document-type, maintenance-type, maintenance-status) — 모두 `setting:*` resource로 분리, PUT 핸들러에 findUnique 추가
  - Settings 7종 (build-status, organization, department, field-engineer, device-info, nav-menu) — device 비활성화 케이스도 UPDATE로 기록
- **Stage 4 — 관리자 UI**:
  - `app/api/settings/audit-logs/route.ts` 신규 — GET 목록 + 페이지네이션 + 필터 (search/action/resource/from/to) + facets (distinct resource/action 목록 반환)
  - `app/settings/audit-logs/page.tsx` 신규 — 검색·필터 폼, 액션별 색상 뱃지, 역할별 색상 뱃지, 행 클릭 시 상세 모달 (before/after 필드별 비교 테이블, 변경된 필드는 노란색 하이라이트)
  - NavMenuItem `settings/audit-logs` 추가 (SUPER_ADMIN, sortOrder=7)
- **검증**:
  - 프로젝트 전체 `tsc --noEmit` 통과
  - `npm run build` (NODE_OPTIONS=--max-old-space-size=4096) 통과 — `/settings/audit-logs` 라우트 정상 등록
  - DEV DB `audit_logs` 테이블 정상 생성 확인
- **주의**: PROD DB는 아직 미적용 — 사용자 명시 요청 시 동일 SQL 실행 필요
- 영향 파일 (총 30+개):
  - `prisma/schema.prisma`, `prisma/migrations/20260428000000_add_audit_logs/`
  - `lib/audit.ts` (신설)
  - `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`
  - `app/api/users/route.ts`, `app/api/users/[id]/route.ts`
  - `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`
  - `app/api/site-visits/route.ts`, `app/api/site-visits/[id]/route.ts`
  - `app/api/maintenances/route.ts`, `app/api/maintenances/[id]/route.ts`
  - `app/api/install-plans/route.ts`, `app/api/install-plans/[id]/route.ts`
  - `app/api/hospitals/route.ts`, `app/api/hospitals/[code]/route.ts`, `app/api/hospitals/[code]/daewoong-staff/route.ts`, `app/api/hospitals/[code]/daewoong-staff/[sid]/route.ts`
  - `app/api/constructors/route.ts`, `app/api/constructors/[code]/route.ts`
  - `app/api/settings/{status,site-visit-status,intro-type,consultation-type,document-type,maintenance-type,maintenance-status,build-status,organizations,departments,field-engineers,devices,nav-menus}/route.ts` 및 각 `[id]/route.ts`
  - `app/api/settings/audit-logs/route.ts` (신설), `app/settings/audit-logs/page.tsx` (신설)
  - `README.md`, `DEV_HISTORY.md`

---

## 2026-04-24 | 설치계획 메일큐 planCode 포맷·Task 생성 누락 수정 + 답사 자동 sync 진단 로그 보강

- **메일큐 설치계획 등록 시 planCode 구포맷 버그 수정** (`app/api/mail-queue/[id]/route.ts`):
  - 기존: `IP-${created.id}` → `IP-00123` 같은 구 포맷으로 생성 (2026-04-13 코드체계 변경 이후 누락)
  - 변경: 수동 등록과 동일하게 `IP-YYYYMM-NNNNN` 월별 순번 채번
- **Task 레코드 생성 누락 보강**:
  - `app/api/mail-queue/[id]/route.ts` PUT: Task 레코드 자동 생성 추가 (`TASK-YYYYMM-NNNNN`, taskType=`INSTALL_PLAN`)
  - `app/api/install-plans/route.ts` POST (수동 등록 경로도 동일하게 누락되어 있었음) Task 생성 로직 추가
  - `app/api/install-plans/[id]/route.ts` DELETE: 설치계획 삭제 시 연결된 Task 레코드도 `deleteMany`로 함께 삭제 (Maintenance DELETE와 동일 패턴)
  - 영향: 그동안 /tasks 업무 현황 페이지에서 설치계획이 안 보이던 현상 해소. 기존 누락 레코드는 데이터 백필 별도 필요
- **답사 메일 자동 sync "마지막 동기화 시간은 최신인데 새 메일 리스트업 안 됨" 이슈 원인 + 수정**:
  - 원인 1: `mail_sync_last` 키가 설치계획 sync에서만 upsert되는데 답사 페이지도 같은 키를 읽어 표시 → 설치계획 sync만 성공해도 답사 페이지는 "최근 동기화됨"으로 보임
  - 원인 2: `lib/mail-scheduler.ts`의 fetch try-catch가 네트워크 실패만 잡고 HTTP 4xx/5xx는 silent pass → 답사 sync가 500 반환해도 "동기화 완료" 로그만 찍힘
  - 수정:
    - `lib/mail-scheduler.ts`: `res.ok` 체크 + HTTP 에러 시 status·body를 console.error로 로깅, 각 sync별 성공/실패 로그 분리
    - `app/api/site-visit-queue/sync/route.ts`: 최상위 try-catch 추가 (핸들러 내부 throw를 500 + 에러 로그로 캡처), 완료 시 `mail_sync_last_site_visit` 전용 키 upsert
    - `app/api/site-visit-queue/route.ts` GET: 답사 전용 키 우선, 없으면 레거시 `mail_sync_last` fallback
    - `app/api/mail-queue/sync/route.ts`: `mail_sync_last_install_plan` 전용 키 추가 upsert (레거시 공용 키 병행 유지 → 하위 호환)
    - `app/api/mail-queue/route.ts` GET: 설치계획 전용 키 우선, 없으면 레거시 fallback
  - 후속 확인 필요: 재시작 후 30분 뒤 `pm2 logs thync-dev | grep mail-scheduler`에서 `답사 동기화 HTTP 500: ...` 로그 확인 시 실제 실패 원인 파악 가능
- 영향 파일: `app/api/mail-queue/[id]/route.ts`, `app/api/mail-queue/route.ts`, `app/api/mail-queue/sync/route.ts`, `app/api/install-plans/route.ts`, `app/api/install-plans/[id]/route.ts`, `app/api/site-visit-queue/route.ts`, `app/api/site-visit-queue/sync/route.ts`, `lib/mail-scheduler.ts`

---

## 2026-04-22 | 구축일정 간트차트 개선 — 유지보수 방문일 단일일 처리 + 월 경계 주 잘림 해결

- **유지보수 바 표시 방식 단순화** (`app/projects/calendar/page.tsx`):
  - 기존: 접수일/방문일/완료일 중 min~max 범위로 다일 바 표시
  - 변경: `visitDate`(방문일)만 사용하는 1일짜리 단일 바. `visitDate` 미입력 건은 간트차트에 아예 표시되지 않음
  - `maintenancesToGanttItems()` 및 엔지니어별 필터 로직 모두 `visitDate` 기반으로 통일 (답사와 동일 패턴)
- **월 경계 주 잘림 해결**:
  - 기존: 해당 월의 1일~말일만 렌더링 → 월이 걸친 주가 잘려 다른 달 영역의 업무가 아예 보이지 않음
  - 변경: 월이 속한 ISO 주의 **월요일 ~ 일요일** 전체를 뷰 범위로 확장 (총 35~42일)
  - 예: 2026년 4월 보기 → 3/30(월) ~ 5/3(일)까지 표시
  - 헬퍼 추가: `getMondayOfWeek`, `getSundayOfWeek`, `daysBetween`, `toYmd`
  - `buildWeekGroups(startDate, totalDays)` 시그니처 변경 — 뷰 시작일부터 주차 그룹 생성
  - 바 포지셔닝: `monthStart.getDate() - 1` → `viewStart` 기준 ms-diff 계산으로 변경
  - 엔지니어별 업무 필터: `monthStartStr`/`monthEndStr` → `viewStartStr`/`viewEndStr`로 교체
  - `todayCol`: 뷰 범위 기준 판정 (인접 월 영역에 today가 걸쳐도 빨간 세로선 정상 표시)
  - Day 헤더: 현재 월 외 날짜는 연한 회색 글자 + `#FAFAFA` 배경으로 시각 구분
- 영향 파일: `app/projects/calendar/page.tsx`, `README.md`

---

## 2026-04-20 | 담당자 풀 업무 유형별 분리 (필드엔지니어 → PROJECT / INSTALL_PLAN / MAINTENANCE)

- **DB 마이그레이션** (20260420000000_add_work_type_to_field_engineers):
  - `field_engineers` 테이블 `user_id` UNIQUE 제거
  - `work_type` 컬럼 추가 (NOT NULL, DEFAULT 'PROJECT')
  - 기존 row 12개는 PROJECT로 유지, INSTALL_PLAN/MAINTENANCE 타입으로 복제 (총 36 row)
  - (user_id, work_type) 복합 UNIQUE + work_type INDEX 추가
- **Prisma 스키마**: User→FieldEngineer 관계 1:1 → 1:N (`fieldEngineer` → `fieldEngineers`), FieldEngineer 모델에 workType·복합 unique·인덱스 추가
- **API 확장** (`app/api/settings/field-engineers/`):
  - GET·POST에 `workType` 쿼리 파라미터 (기본값 PROJECT). POST 바디에도 workType 수용
  - candidates GET도 workType별 미등록 사용자 필터링
  - DELETE는 id 기준이라 변경 없음
- **설정 페이지 탭 UI** (`app/settings/field-engineers/page.tsx`): 프로젝트/설치계획/유지보수 3개 탭, 탭 전환 시 목록 재조회, 추가 모달 제목도 탭별로 변경. 페이지 제목을 "담당자 리스트"로 변경
- **FieldEngineerSelectModal**: `workType` prop 추가 (기본 PROJECT). API 호출 시 전달
- **Form 소비처 업데이트**:
  - `MaintenanceForm` → `workType="MAINTENANCE"` 전달
  - `InstallPlanForm` → `workType="INSTALL_PLAN"` 전달
  - 프로젝트(new/edit) 및 SiteVisitForm은 기본값 PROJECT 유지 (답사는 프로젝트 풀 공유)
- **주의**: 간트차트(`/projects/calendar`)는 workType 지정 없이 호출 → PROJECT 풀 기준으로 행 구성. 기존 12명은 3풀 모두에 존재하므로 당장은 차이 없으나, 향후 유지보수 전용 담당자만 추가되면 간트차트에 해당 엔지니어 행이 안 생기는 엣지 케이스 있음 (후속 논의 대상)
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260420000000_add_work_type_to_field_engineers/`, `app/api/settings/field-engineers/route.ts`, `app/api/settings/field-engineers/candidates/route.ts`, `app/settings/field-engineers/page.tsx`, `app/components/FieldEngineerSelectModal.tsx`, `app/maintenances/MaintenanceForm.tsx`, `app/install-plans/InstallPlanForm.tsx`, `README.md`

---

## 2026-04-20 | 업무 삭제 권한 정책 통일 + Google Calendar ID 라벨 스왑 수정

- **Google Calendar ID 라벨 스왑 수정** (`.env`): `GOOGLE_CALENDAR_MAINTENANCE_ID`와 `GOOGLE_CALENDAR_SITE_VISIT_ID` 값이 맞바뀌어 있어 유지보수 등록이 "답사일정" 캘린더로 들어가던 이슈 수정. 실제 캘린더 summary로 검증 후 값 스왑 (DEV 반영 완료, PROD는 별도)
- **프로젝트 DELETE 권한 강화**: `app/api/projects/[code]/route.ts` DELETE를 VIEWER 제외 → `isAdminOrAbove`로 변경. 프로젝트/답사/유지보수/설치계획 4개 업무 모듈 삭제 정책을 ADMIN 이상으로 통일
- **403 응답 메시지 한글화**: 4개 업무 모듈 DELETE 핸들러의 `'Forbidden'` → `'삭제 권한이 없습니다. 관리자(ADMIN)에게 문의하세요.'`. USER가 유지보수·답사 폼의 삭제 버튼을 누를 때 원인이 바로 보이도록 함 (삭제 버튼은 `isAdmin` 변수가 VIEWER 제외로 정의되어 USER에게도 노출됨)
- **프론트 핸들러 에러 표시 보강**: 프로젝트 상세(`app/projects/[code]/page.tsx`)는 응답 상태 확인 없이 항상 redirect하던 로직 → 실패 시 `data.error` alert 후 버튼 복구. 설치계획 상세(`app/install-plans/[id]/DetailClient.tsx`)도 하드코딩 메시지 대신 API 메시지 사용
- **README**: 프로젝트·답사 관리 섹션에 "삭제는 ADMIN 이상" 표기 추가
- 영향 파일: `.env`, `app/api/projects/[code]/route.ts`, `app/api/maintenances/[id]/route.ts`, `app/api/site-visits/[id]/route.ts`, `app/api/install-plans/[id]/route.ts`, `app/projects/[code]/page.tsx`, `app/install-plans/[id]/DetailClient.tsx`, `README.md`

---

## 2026-04-16 | 답사(실측) 요청 메일 큐 기능 추가

- **DB 마이그레이션**: `site_visit_queue` 테이블 생성 (20260416200000_add_site_visit_queue)
  - InstallPlanQueue와 동일 구조, `site_visit_id` FK → SiteVisit 연결
- **환경변수**: `GMAIL_SV_SENDER_EMAIL`, `GMAIL_SV_SUBJECT_KEYWORD` 추가 (설치계획과 완전 분리)
- **Gmail 폴링 동기화** (`app/api/site-visit-queue/sync/route.ts`): 답사용 env로 Gmail API 조회, SiteVisitQueue 적재
- **답사 등록** (`app/api/site-visit-queue/[id]/route.ts`):
  - 큐 항목에서 병원 선택 → SiteVisit 생성 (status: 접수, notes: 메일 본문 HTML)
  - siteVisitCode 자동 채번, Task 레코드 생성, Google Calendar 이벤트 생성
  - 도면 파일 URL → S3 다운로드/업로드 → SiteVisitFile 생성
- **큐 관리 API** (`app/api/site-visit-queue/route.ts`): GET 목록, DELETE 일괄삭제
- **스케줄러 확장** (`lib/mail-scheduler.ts`): 기존 설치계획 sync + 답사 sync 둘 다 호출
- **관리 페이지** (`app/site-visit-queue/page.tsx`): 기존 mail-queue 페이지 패턴 동일, 대기/등록완료/무시 탭, 병원 선택 모달
- **네비게이션**: MailIcon 추가, '실측요청 메일' 메뉴 (답사 관리 아래, ADMIN 이상)
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260416200000_add_site_visit_queue/`, `.env`, `lib/mail-scheduler.ts`, `app/api/site-visit-queue/` (신설), `app/site-visit-queue/page.tsx` (신설), `app/components/NavIcons.tsx`

---

## 2026-04-16 | Google Calendar 프로젝트·유지보수·답사 3종 캘린더 동기화

- **DB 마이그레이션**:
  - projects 테이블에 `calendar_event_id` 추가 (20260416000000_add_calendar_event_id_to_projects)
  - maintenances, site_visits 테이블에 `calendar_event_id` 추가 (20260416100000_add_calendar_event_id_to_maintenances_and_site_visits)
- **OAuth2 인증 라우트 신규 생성** (Gmail OAuth 패턴 동일):
  - `app/api/auth/calendar/route.ts`: GET → Google Calendar OAuth 인증 URL redirect (SUPER_ADMIN 전용)
  - `app/api/auth/calendar/callback/route.ts`: GET → code로 토큰 교환, refresh_token을 app_settings 테이블에 저장
- **lib/googleCalendar.ts 신규 생성**: OAuth2Client 사용, CalendarType(`project`/`maintenance`/`site-visit`)으로 3종 캘린더 분기
  - `createCalendarEvent(type, data)`: All-day 이벤트 생성 + 담당자 이메일 참석자 추가
  - `updateCalendarEvent(type, eventId, data)`: 이벤트 수정 (일정·담당자 변경 반영)
  - `deleteCalendarEvent(type, eventId)`: 이벤트 삭제
  - 모든 함수 try-catch, 실패 시 console.error만 (업무 저장 비차단)
- **프로젝트 캘린더 동기화** (`app/api/projects/`):
  - POST: startDate 있으면 이벤트 생성, 담당자 이메일 참석자 추가
  - PUT: 일정/담당자 변경 시 이벤트 업데이트, startDate 삭제 시 이벤트 삭제, 신규 startDate 시 이벤트 생성
  - DELETE: 이벤트 삭제
  - summary: `{projectName}` (병원명 N차)
- **유지보수 캘린더 동기화** (`app/api/maintenances/`):
  - POST/PUT/DELETE 동일 패턴, visitDate(방문일) 기준
  - summary: `[유지보수] {병원명} - {제목}`
- **답사 캘린더 동기화** (`app/api/site-visits/`):
  - POST/PUT/DELETE 동일 패턴, visitDate(방문일) 기준
  - summary: `[답사] {병원명}`
- **환경변수**: `GOOGLE_CALENDAR_PROJECT_ID`, `GOOGLE_CALENDAR_MAINTENANCE_ID`, `GOOGLE_CALENDAR_SITE_VISIT_ID` 추가
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260416*`, `.env`, `lib/googleCalendar.ts` (신설), `app/api/auth/calendar/` (신설), `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`, `app/api/maintenances/route.ts`, `app/api/maintenances/[id]/route.ts`, `app/api/site-visits/route.ts`, `app/api/site-visits/[id]/route.ts`

---

## 2026-04-15 | 구축일정 간트차트 기능 개선

- **바 색상 과거/미래 반전**: 과거 일정은 옅게(opacity 0.45), 미래 일정은 짙게 표시. 오늘을 걸치는 바는 gradient로 과거 부분만 투명하게 처리
- **유지보수 업무 간트차트 통합**: 프로젝트뿐 아니라 유지보수(Maintenance) 업무도 필드 엔지니어별 간트차트에 표시
  - 유지보수 바 날짜: reportedAt, visitDate, resolvedAt 중 가장 이른 날짜~가장 늦은 날짜 범위 사용
  - 유지보수 바 색상: 장애유형(type.color) 사용, 구축 프로젝트와 구분을 위해 좌측 3px 보더 + 사선 패턴(미래) 적용
  - 유지보수 바 라벨: 🔧 아이콘 + 병원명 - 제목 형식
  - 바 클릭 시 유지보수 상세 페이지 새 탭 오픈
- **답사(SiteVisit) 간트차트 통합**: 필드 엔지니어에 배정된 답사도 간트차트에 표시
  - 답사 바 날짜: visitDate(방문일) 기준 단일일 바
  - 답사 바 색상: 답사 상태(status.color) 사용, 📋 아이콘 + 병원명 답사 라벨
  - 바 클릭 시 답사 상세 페이지 새 탭 오픈
- **통합 GanttItem 타입 도입**: Project, Maintenance, SiteVisit을 통합 GanttItem으로 변환 후 레인 배치
- 영향 파일: `app/projects/calendar/page.tsx`

---

## 2026-04-14 | 유지보수(Maintenance) 업무 모듈 신규 추가

- **DB 스키마**: Maintenance, MaintenanceAssignee, MaintenanceFile 3개 모델 추가 (마이그레이션: 20260414000000_add_maintenances)
  - Maintenance: maintenanceCode(`MNT-YYYYMM-NNNN` 자동채번), 병원 연결, 장애유형(MAINTENANCE_TYPE)/상태(MAINTENANCE_STATUS) StatusCode 연결, 우선순위(긴급/높음/보통/낮음), 원격처리 여부, 증상/원인/조치내용/비고 필드
  - MaintenanceAssignee: N:M 담당자 관계, MaintenanceFile: S3 첨부파일
- **StatusCode 관련**: status_codes 테이블 레거시 `name` unique 인덱스 제거 (name+category 복합 unique만 유지)
- **설정 API/페이지**: 장애유형 관리(`/settings/maintenance-type`), 유지보수 상태 관리(`/settings/maintenance-status`) CRUD 추가
- **seed 데이터**: MAINTENANCE_TYPE 4건(하드웨어/소프트웨어/네트워크/기타), MAINTENANCE_STATUS 4건(접수/처리중/완료/보류), NavMenuItem 3건(유지보수, 장애유형 관리, 유지보수 상태 관리)
- **유지보수 CRUD API**: `app/api/maintenances/` — GET 목록(필터: 병원명/장애유형/상태/우선순위), POST 등록(코드 자동채번), GET/PUT/DELETE 단건, 파일 업로드/삭제/presigned URL
- **유지보수 페이지**: 목록(`/maintenances`), 등록(`/maintenances/new`), 상세/수정(`/maintenances/[id]`), MaintenanceForm 공용 폼 컴포넌트
  - 기존 SiteVisitForm 패턴 동일 적용: 병원 검색 모달, FieldEngineerSelectModal 담당자 복수 배정, RichTextEditor(조치내용/비고), MultiFileField(edit 모드)
  - 목록: 접수일/병원명/제목/장애유형/우선순위/상태/원격/담당자/방문일/완료일 컬럼, 우선순위 색상 뱃지
- **네비게이션**: NavIcons에 WrenchIcon 추가, NavMenuItem에 유지보수 메뉴(답사 관리 아래, sortOrder 55) + 설정 하위 2개 항목 추가
- **Task 통합 연동**: 유지보수 생성 시 tasks 테이블에 `MAINTENANCE` 타입 Task 자동 생성 (TASK-YYYYMM-NNNNN 채번), 수정 시 title/hospitalCode 동기화, 삭제 시 Task도 삭제
- **업무(Task) 현황 페이지** (`/tasks`): 프로젝트·답사·설치계획·유지보수 전체 업무 통합 조회, 업무유형별 요약 카드(클릭 필터), 검색(업무코드/병원명/제목), 행 클릭 시 원본 상세 이동
- **Task API** (`app/api/tasks/route.ts`): GET 목록 + 원본 레코드 id lookup (상세 페이지 이동용)
- **네비게이션**: ClipboardListIcon 추가, '업무(Task) 현황' 메뉴 추가 (설치계획과 답사 사이, sortOrder 45)
- **병원 상세 연동**: `app/hospitals/[code]/_components/MaintenancesCard.tsx` 신설, 병원 상세 페이지에 유지보수 카드 추가
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260414000000_add_maintenances/`, `prisma/seed.ts`, `app/api/maintenances/` (신설), `app/api/tasks/` (신설), `app/api/settings/maintenance-type/` (신설), `app/api/settings/maintenance-status/` (신설), `app/maintenances/` (신설), `app/tasks/` (신설), `app/settings/maintenance-type/` (신설), `app/settings/maintenance-status/` (신설), `app/components/NavIcons.tsx`, `app/hospitals/[code]/page.tsx`, `app/hospitals/[code]/_components/MaintenancesCard.tsx` (신설)

---

## 2026-04-13 | TASK 통합 개념 도입 - tasks 테이블 신규 생성 및 기존 데이터 마이그레이션

- **tasks 테이블 신규 생성** (마이그레이션: 20260413120000_add_tasks): task_code(TASK-YYYYMM-NNNNN), task_type, ref_code, hospital_code, title
- 기존 3개 업무(projects 199건, site_visits 15건, install_plans 11건)를 tasks 테이블로 통합 마이그레이션 (총 225건)
- task_code 채번: 3개 소스의 날짜 기준 오름차순 정렬 후 월별 시퀀스 통합 채번
- 마이그레이션 스크립트 `scripts/migrate-tasks.ts` 작성 (--dry-run / --execute 모드 지원)
- 기존 테이블(projects, site_visits, install_plans)은 변경 없음
- Prisma 스키마에 Task 모델 추가, Hospital 모델에 역방향 관계(tasks) 추가
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260413120000_add_tasks/`, `scripts/migrate-tasks.ts`

---

## 2026-04-13 | 답사·설치계획 코드체계 변경

- **site_visits 테이블에 `site_visit_code` 컬럼 추가** (마이그레이션: 20260413200000_add_site_visit_code): `VISIT-YYYYMM-NNNNN` 코드체계, unique 제약
- **install_plans `plan_code` 코드체계 변경**: `IP-NNNNN` → `IP-YYYYMM-NNNNN` 형식으로 전환
- 기존 데이터 백필: created_at 기준 월별 순번 부여 (DEV/PROD 양쪽 적용)
- **답사 생성 API** (`app/api/site-visits/route.ts`): 생성 시 `siteVisitCode` 자동 발번 로직 추가
- **설치계획 생성 API** (`app/api/install-plans/route.ts`): `planCode` 발번 로직을 월별 순번 방식으로 변경
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260413200000_add_site_visit_code/`, `app/api/site-visits/route.ts`, `app/api/install-plans/route.ts`

---

## 2026-04-13 | 필드 엔지니어 기준 간트차트로 캘린더 페이지 교체

- **캘린더 페이지 전면 교체** (`app/projects/calendar/page.tsx`): 기존 프로젝트 기준 간트/캘린더 탭 구조 완전 제거, 필드 엔지니어 기준 월간 간트차트로 재작성
  - Y축: 필드 엔지니어 1명 = 1행 그룹, 배정 프로젝트 겹칠 시 레인(sub-row) 자동 분리 알고리즘 적용
  - X축: 월 단위 날짜, URL `?month=YYYY-MM` 파라미터로 월 관리, 주차·일별 2행 sticky 헤더
  - 바: buildStatus.color 사용, 클릭 시 프로젝트 상세 새 탭, 주말 오버레이, 오늘 세로선
- **필드 엔지니어 API 확장** (`app/api/settings/field-engineers/route.ts`): `?all=true` 파라미터 추가, 페이지네이션 없이 전체 목록 반환 (기존 페이지네이션 하위 호환 유지)
- 영향 파일: `app/projects/calendar/page.tsx`, `app/api/settings/field-engineers/route.ts`, `README.md`

---

## 2026-04-13 | 네비게이션 메뉴 설정 관리 시스템

- **nav_menu_items 테이블 신설** (마이그레이션: 20260413000000_add_nav_menu_items): menuKey, label, href, iconKey, parentKey, allowedRoles(TEXT[]), allowedOrgCodes(TEXT[]), isActive, sortOrder
- 기존 하드코딩 메뉴 22개 항목(메인 8 + 설정 하위 14) seed 데이터 이관
- **NavIcons.tsx 신설**: Navigation.tsx에서 메뉴용 SVG 아이콘 분리, ICON_MAP 룩업 + getMenuIcon 헬퍼
- **네비게이션 조회 API** (`app/api/nav-menus/route.ts` 신설): 활성 메뉴만 반환, Navigation 컴포넌트에서 사용
- **메뉴 관리 CRUD API** (`app/api/settings/nav-menus/` 신설): SUPER_ADMIN 전용, GET/POST/PUT/DELETE
- **메뉴 관리 설정 페이지** (`app/settings/nav-menus/page.tsx` 신설): 메인 메뉴/설정 하위 메뉴 2개 섹션, 메뉴명 인라인 수정, 허용 역할 체크박스(SUPER_ADMIN/ADMIN/USER/VIEWER), 허용 소속 체크박스(Organization 동적 로드), 활성 토글, 순서 변경(↑↓), 새 메뉴 추가/삭제
- **Navigation.tsx 전면 리팩터**: DB 기반 동적 메뉴 렌더링, 역할+소속 기반 클라이언트 필터링(`isMenuVisible`), API 실패 시 폴백 메뉴, 로딩 스켈레톤
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260413000000_add_nav_menu_items/`, `app/components/NavIcons.tsx` (신설), `app/components/Navigation.tsx`, `app/api/nav-menus/route.ts` (신설), `app/api/settings/nav-menus/route.ts` (신설), `app/api/settings/nav-menus/[id]/route.ts` (신설), `app/settings/nav-menus/page.tsx` (신설)

---

## 2026-04-12 | AI 어시스턴트 전체 기능 구현

- `@anthropic-ai/sdk` 패키지 설치, `ANTHROPIC_API_KEY` 환경변수 추가
- **ConsultationQueue 테이블 신설** (마이그레이션: 20260412010000_add_consultation_queue): hospitalCode, consultationTypeId, documentTypeId, conclusion, chatHistory(JSONB), aiSummary, status, consultedById
- **StatusCode 테이블에 `value` 컬럼 추가** (마이그레이션: 20260412000000_add_value_to_status_codes)
- **문서유형(DOCUMENT_TYPE)** 설정 관리 CRUD + seed 7건, **상담유형(CONSULTATION_TYPE)** 설정 관리 CRUD + seed 5건
- **AI 정제 API** (`app/api/ai-assistant/summarize/route.ts`): Anthropic claude-sonnet-4-5 호출, 대화를 마크다운 상담이력으로 정리
- **상담이력 저장 API** (`app/api/ai-assistant/consultation/route.ts`): ConsultationQueue 저장, 대화 없이도 등록 가능
- **채팅 UI 전면 개편** (`app/ai-assistant/page.tsx`):
  - 병원 검색: debounce 검색 → 드롭다운 선택 방식, 기본값 '공통', 선택 시 파란 태그 + X 해제
  - 병원 선택 영역 카드 분리, 대화 영역 border+bg-white 적용, 전체 여백 개선
  - 우측 상담 정리 패널: 토글 열기/닫기, 제목에 "(선택사항)" 표시
  - 상담유형/문서유형 선택, AI 정제 버튼, 결론 텍스트, 대기리스트 등록
- Navigation 설정 메뉴에 상담유형/문서유형 관리 추가
- 영향 파일: `.env`, `.env.example`, `package.json`, `tailwind.config.ts`, `prisma/schema.prisma`, `prisma/seed.ts`, `app/ai-assistant/page.tsx`, `app/components/Navigation.tsx`, `app/api/ai-assistant/route.ts`, `app/api/ai-assistant/summarize/route.ts` (신설), `app/api/ai-assistant/consultation/route.ts` (신설), `app/api/settings/consultation-type/` (신설), `app/api/settings/document-type/` (신설), `app/settings/consultation-type/page.tsx` (신설), `app/settings/document-type/page.tsx` (신설), `prisma/migrations/20260412000000_add_value_to_status_codes/`, `prisma/migrations/20260412010000_add_consultation_queue/`

---

## 2026-04-12 | AI 어시스턴트 채팅 + 상담유형 관리 기능 추가 (초기 버전)

- `@anthropic-ai/sdk` 패키지 설치, `ANTHROPIC_API_KEY` 환경변수 추가
- **ConsultationQueue 테이블 신설** (마이그레이션: 20260412010000_add_consultation_queue): hospitalCode, consultationTypeId, documentTypeId, conclusion, chatHistory(JSONB), aiSummary, status, consultedById
- **Prisma 스키마**: ConsultationQueue 모델 추가, StatusCode·User·Hospital 역방향 관계 추가
- **AI 정제 API** (`app/api/ai-assistant/summarize/route.ts` 신설): Anthropic claude-sonnet-4-5 호출, 대화를 마크다운 상담이력으로 정리
- **상담이력 저장 API** (`app/api/ai-assistant/consultation/route.ts` 신설): ConsultationQueue에 저장, 현재 유저 자동 적용
- **채팅 UI 2단 레이아웃** (`app/ai-assistant/page.tsx` 전면 개편):
  - 좌측: 병원 선택 드롭다운(검색 포함) + 채팅 영역
  - 우측: 상담유형/문서유형 선택, AI 정제 버튼, 결론 텍스트에어리어, 대기리스트 등록 버튼
- 영향 파일: `.env`, `.env.example`, `package.json`, `prisma/schema.prisma`, `prisma/migrations/20260412010000_add_consultation_queue/`, `app/ai-assistant/page.tsx`, `app/api/ai-assistant/summarize/route.ts` (신설), `app/api/ai-assistant/consultation/route.ts` (신설)

---

## 2026-04-12 | 문서유형 관리 기능 추가

- StatusCode 테이블에 `value` 컬럼(String?, nullable) 추가 (마이그레이션: 20260412000000_add_value_to_status_codes)
- 문서유형(DOCUMENT_TYPE) seed 데이터 7건 추가 (정책, 기술문서, 릴리즈노트, 병원별 설정, 교육/매뉴얼, FAQ, 상담이력)
- 문서유형 설정 관리 CRUD API 추가 (GET/POST/PUT/DELETE, value 필드 포함)
- 문서유형 설정 관리 페이지 추가 (순서/문서유형명/값(value)/색상 컬럼)
- Navigation 설정 메뉴에 "문서유형 관리" 항목 추가
- 영향 파일: `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/migrations/20260412000000_add_value_to_status_codes/`, `app/api/settings/document-type/route.ts` (신설), `app/api/settings/document-type/[id]/route.ts` (신설), `app/settings/document-type/page.tsx` (신설), `app/components/Navigation.tsx`

---

## 2026-04-12 | AI 어시스턴트 채팅 + 상담유형 관리 기능 추가

- Flowise RAG 서버 연동 AI 어시스턴트 채팅 기능 추가 (Next.js API → Flowise API 프록시 구조)
- AI 답변 마크다운 렌더링 적용 (react-markdown + @tailwindcss/typography)
- 환경변수 FLOWISE_API_HOST, FLOWISE_CHATFLOW_ID 추가
- 상담유형(CONSULTATION_TYPE) 설정 관리 CRUD 추가 (StatusCode 테이블 category 활용)
- 상담유형 seed 데이터 5건 추가 (알람 관련, 디바이스 트러블슈팅, 소프트웨어 설정, 네트워크 연결, 기타)
- Navigation 사이드바에 "AI 어시스턴트" 메뉴 (모든 역할), 설정 > "상담유형 관리" 메뉴 (ADMIN 이상) 추가
- 영향 파일: `.env`, `.env.example`, `tailwind.config.ts`, `package.json`, `prisma/seed.ts`, `app/components/Navigation.tsx`, `app/ai-assistant/page.tsx` (신설), `app/api/ai-assistant/route.ts` (신설), `app/api/settings/consultation-type/route.ts` (신설), `app/api/settings/consultation-type/[id]/route.ts` (신설), `app/settings/consultation-type/page.tsx` (신설)

---

## 2026-04-09 | [STAGE 6] 메일 동기화 스케줄러 + 설정 UI

- app_settings 테이블 신설 (key-value 형태, 마이그레이션: 20260409030000_add_app_settings)
- lib/mail-scheduler.ts 신설: setInterval 기반 스케줄러 (30분/1시간/2시간/6시간/OFF)
- instrumentation.ts 신설: 서버 시작 시 DB에서 간격 읽어 스케줄러 자동 복원
- GET/PUT /api/settings/mail-sync: 동기화 주기 조회/변경 API
- app/settings/mail-sync/page.tsx 신설: 동기화 주기 선택 UI
- 네비게이션 설정 메뉴에 "메일 동기화" 항목 추가
- 영향 파일: prisma/schema.prisma, next.config.mjs, instrumentation.ts (신설), lib/mail-scheduler.ts (신설), app/api/settings/mail-sync/route.ts (신설), app/settings/mail-sync/page.tsx (신설), app/components/Navigation.tsx

---

## 2026-04-09 | [STAGE 5.2] 메일 큐 — 주소 필드 + 비고 메일 원문 삽입

- install_plan_queue 테이블에 address 컬럼 추가 (마이그레이션: 20260409020000_add_address_to_queue)
- lib/gmail.ts: parseFormEmail()에 '거래처 주소' 복수줄 파싱 + fullText(응답 본문 전체) 추출 추가
- PUT /api/mail-queue/[id]: note에 주소 포함 + 메일 원문 전체 텍스트 삽입
- 메일 큐 UI: 테이블·모달에 주소 컬럼 추가
- 영향 파일: prisma/schema.prisma, prisma/migrations/20260409020000_add_address_to_queue/, lib/gmail.ts, app/api/mail-queue/sync/route.ts, app/api/mail-queue/[id]/route.ts, app/mail-queue/page.tsx

---

## 2026-04-09 | [STAGE 5.1] 메일 큐 도면 파일 자동 등록

- install_plan_queue 테이블에 file_url 컬럼 추가 (마이그레이션: 20260409010000_add_file_url_to_queue)
- lib/gmail.ts: parseFormEmail()에 daewoongfmc.imweb.me 파일 다운로드 링크 파싱 추가
- 폴링(sync) 시 file_url 저장, 등록(PUT) 시 파일 다운로드 → S3 업로드 → InstallPlanFile(FLOOR_PLAN) 자동 생성
- 메일 큐 UI에 도면 컬럼 추가 (파일 링크 표시)
- 기존 50건 raw_body에서 file_url 백필 완료
- 영향 파일: prisma/schema.prisma, prisma/migrations/20260409010000_add_file_url_to_queue/, lib/gmail.ts, app/api/mail-queue/sync/route.ts, app/api/mail-queue/[id]/route.ts, app/mail-queue/page.tsx

---

## 2026-04-09 | [STAGE 5] 설치계획 요청 메일 큐 — UI

- app/install-plans/page.tsx: 헤더에 "메일 확인" 버튼 추가 (/mail-queue 이동)
- app/mail-queue/page.tsx 신설: 메일 가져오기, 탭 필터, 등록 모달(병원 연결 필수, HospitalSelectModal 재사용), 무시 처리
- 영향 파일: app/install-plans/page.tsx, app/mail-queue/page.tsx (신설)

---

## 2026-04-09 | [STAGE 4] 설치계획 요청 메일 큐 — 큐 관리 API

- GET /api/mail-queue: 큐 전체 목록 조회
- PUT /api/mail-queue/[id]: 큐 → install_plans 등록 (IP-NNNNN 코드 자동생성, 담당자 정보 note 자동 삽입)
- DELETE /api/mail-queue/[id]: 무시 처리 (status: ignored)
- 영향 파일: app/api/mail-queue/route.ts (신설), app/api/mail-queue/[id]/route.ts (신설)

---

## 2026-04-09 | [STAGE 3] 설치계획 요청 메일 큐 — Gmail 폴링 API

- POST /api/mail-queue/sync: Gmail 조회 → HTML 파싱 → install_plan_queue 저장
- JWT 쿠키 + CRON_SECRET Bearer 이중 인증 지원
- gmail_message_id 기준 중복 방지, 개별 메시지 오류 시 skip 처리
- 영향 파일: app/api/mail-queue/sync/route.ts (신설)

---

## 2026-04-09 | [STAGE 2] 설치계획 요청 메일 큐 — Gmail 유틸리티 + OAuth

- lib/gmail.ts 신설 (getGmailClient, decodeBase64Url, extractHtmlBody, parseFormEmail, parseKstDate)
- OAuth2 Refresh Token 발급용 API 신설 (1회성)
- 영향 파일: lib/gmail.ts (신설), app/api/auth/gmail/route.ts (신설), app/api/auth/gmail/callback/route.ts (신설)

---

## 2026-04-09 | [STAGE 1] 설치계획 요청 메일 큐 — DB 준비

- googleapis 패키지 설치
- install_plan_queue 테이블 신설
- InstallPlanQueue Prisma 모델 추가, InstallPlan에 queueItem 관계 추가
- 영향 파일: prisma/schema.prisma, prisma/migrations/20260409000000_add_install_plan_queue/

---

## 2026-04-08 17:00 | 프로젝트 필터 복수 선택(체크박스) 전환

- **프로젝트 필터 컴포넌트** (`app/projects/_components/ProjectFilters.tsx`): 진행상태·구축업체·담당자 3개 필터를 단일 `<select>` → 체크박스 기반 복수 선택 드롭다운(`MultiSelectDropdown`)으로 교체. 선택된 항목 수에 따라 이름 또는 "외 N건" 표시, X 버튼으로 전체 해제
- **프로젝트 목록 서버** (`app/projects/page.tsx`): URL 파라미터를 콤마 구분 배열로 파싱, Prisma `where` 조건을 `in` 연산자로 변경하여 복수 필터 지원
- 영향 파일: `app/projects/_components/ProjectFilters.tsx`, `app/projects/page.tsx`

---

## 2026-04-07 | 답사 상태값 개편 + 정렬 로직 변경 + 상태 필터

- **DB 마이그레이션** (`20260407000000_update_site_visit_statuses`): 답사 상태 '대기' → '접수' 이름 변경, '답사예정' 상태 신규 추가 (order=2, color=#F59E0B). 최종 상태: 접수(1) → 답사예정(2) → 작성완료(3) → 회신완료(4)
- **답사 API 정렬** (`app/api/site-visits/route.ts`): 상태 우선순위 접수(0) > 답사예정(1) > 작성완료(2) > 회신완료(3). 접수 상태는 요청일 오래된 순(ASC), 나머지는 요청일 최신 순(DESC). `statusId` 쿼리 파라미터로 상태 필터 추가
- **답사 등록 기본값** (`app/site-visits/SiteVisitForm.tsx`): create 모드 기본 상태를 '접수'로 변경
- **답사 리스트 필터** (`app/site-visits/page.tsx`): 상태 드롭다운 필터 UI 추가 (전체/접수/답사예정/작성완료/회신완료)
- 영향 파일: `prisma/migrations/20260407000000_update_site_visit_statuses/`, `app/api/site-visits/route.ts`, `app/site-visits/SiteVisitForm.tsx`, `app/site-visits/page.tsx`

---

## 2026-04-07 | 프로젝트 담당자 컬럼 추가 + 답사/설치계획 기본값 및 정렬 개선

- **프로젝트 리스트** (`app/projects/page.tsx`): '진행상태'와 '구축 시작일' 사이에 '담당자' 컬럼 추가 (assignees 이름 콤마 구분 표시)
- **답사 리스트 정렬** (`app/api/site-visits/route.ts`): 상태 우선순위 정렬 적용 (대기 → 작성완료 → 회신완료 → 기타/없음), 같은 상태 내에서는 요청일 오래된 순(ASC)
- **답사 등록 기본값** (`app/site-visits/SiteVisitForm.tsx`): create 모드에서 상태 필드 기본값을 '대기'로 설정
- **설치계획(가안) 등록 기본값** (`app/install-plans/InstallPlanForm.tsx`): new 모드에서 작성완료여부·회신여부 기본값을 '미완료'로 설정
- 영향 파일: `app/projects/page.tsx`, `app/api/site-visits/route.ts`, `app/site-visits/SiteVisitForm.tsx`, `app/install-plans/InstallPlanForm.tsx`

---

## 2026-04-04 | 담당자 선택 모달 X버튼 아이콘 및 스크롤 구조 개선

- `FieldEngineerSelectModal.tsx`, `DaewoongSelectModal.tsx` 두 모달의 X 닫기 버튼을 lucide-react `X` 아이콘 컴���넌트로 교체
- 모달 내부 레이아웃을 flex column 3영역 구조로 개선: 상단 고정(헤더), 중간 스크롤(검색+테이블), 하단 고정(페이지네이션+버튼)
- 모달 최대 높이 85vh, 중간 영역만 overflowY auto 스크롤 적용
- 영향 파일: `app/components/FieldEngineerSelectModal.tsx`, `app/components/DaewoongSelectModal.tsx`

---

## 2026-04-04 | 내 정보 수정 모달에 소속/부서 필드 추가

- `app/users/page.tsx`의 "내 정보 수정" 모달에 소속(organization) 드롭다운과 부서(department) 드롭다운 추가
- 이름 필드 위(최상단)에 소속 → 부서 순서로 배치
- 소속 변경 시 `/api/settings/departments?organizationId={id}` 동적 fetch로 부서 목록 로드
- 모달 열릴 때 현재 본인의 organizationId/departmentId 초기값 설정 및 부서 목록 사전 로드
- 저장 시 PUT body에 organizationId, departmentId 포함 전송
- 저장 후 currentUser 및 users 목록 상태에 organization/department 반영
- 영향 파일: `app/users/page.tsx`

---

## 2026-04-04 | 담당자 선택 모달 오버레이 fixed 전환 + 배경 불투명도 개선

- `FieldEngineerSelectModal.tsx`, `DaewoongSelectModal.tsx` 두 모달의 오버레이 래퍼를 `absolute` → `fixed` 포지션으로 변경하여 스크롤 시에도 화면 전체를 덮도록 수정
- `zIndex: 9999`, `backgroundColor: rgba(0,0,0,0.55)`, `backdropFilter: blur(2px)` 적용
- 내부 컨텐츠 박스에 `maxHeight: 80vh`, `overflowY: auto` 추가하여 긴 목록 스크롤 지원
- 영향 파일: `app/components/FieldEngineerSelectModal.tsx`, `app/components/DaewoongSelectModal.tsx`

---

## 2026-04-04 | 담당자 N:M 교체 + 병원 대웅 담당자 복수 선택

- **DB 마이그레이션** (`20260404010000_add_assignee_tables`): `project_assignees`, `install_plan_assignees`, `site_visit_assignees` 테이블 신설 (각각 N:M 관계). 기존 단일 FK 데이터 이관 후 `projects.builder_user_id`, `install_plans.author_id`, `site_visits.assignee_id` 컬럼 삭제
- **Prisma 스키마**: `ProjectAssignee`, `InstallPlanAssignee`, `SiteVisitAssignee` 모델 추가. `Project`, `InstallPlan`, `SiteVisit` 모델에서 기존 단일 FK 관계 제거 → `assignees` 역방향 관계로 교체. `User` 모델에서 기존 역방향 관계 제거 → `projectAssignees`, `installPlanAssignees`, `siteVisitAssignees`로 교체
- **필드 엔지니어 선택 공통 모달** (`app/components/FieldEngineerSelectModal.tsx`) 신설: `/api/settings/field-engineers` 기반 체크박스 복수 선택, 검색(300ms debounce), 페이지네이션
- **대웅 담당자 선택 공통 모달** (`app/components/DaewoongSelectModal.tsx`) 신설: `/api/users?organization=DAEWOONG` 기반 체크박스 복수 선택, 검색, 페이지네이션
- **Users API 확장** (`app/api/users/route.ts`): `?search=`, `?page=`, `?limit=` 파라미터 추가. 페이지네이션 파라미터 있으면 `{ data, total, page, limit }` 반환, 없으면 기존 배열 반환 (하위 호환)
- **프로젝트 API** (`app/api/projects/route.ts`, `[code]/route.ts`): `builderUserId` → `assigneeIds` 배열로 교체. GET include에 `assignees` 추가. PUT에서 트랜잭션으로 N:M 갱신
- **설치계획 API** (`app/api/install-plans/route.ts`, `[id]/route.ts`): `authorId` → `assigneeIds` 배열로 교체. 동일 패턴 적용
- **답사 API** (`app/api/site-visits/route.ts`, `[id]/route.ts`): `assigneeId` → `assigneeIds` 배열로 교체. 동일 패턴 적용
- **대시보드 API** (`app/api/dashboard/route.ts`): `builder` → `assignees` include로 교체
- **프로젝트 상세 페이지** (`app/projects/[code]/page.tsx`): 기존 radio(시스템 사용자/직접 입력) UI 제거 → 칩 기반 복수 담당자 + FieldEngineerSelectModal. `builderNameManual` 별도 텍스트 input 유지
- **프로젝트 등록 페이지** (`app/projects/new/page.tsx`): 동일하게 복수 담당자 UI 교체
- **프로젝트 목록 페이지** (`app/projects/page.tsx`): `builder` → `assignees` 기반 표시, 필터 쿼리 업데이트
- **설치계획 폼** (`app/install-plans/InstallPlanForm.tsx`): 작성자 단일 select → 칩 기반 복수 담당자 + FieldEngineerSelectModal
- **설치계획 목록** (`app/install-plans/page.tsx`): `author` → `assignees` 기반 표시
- **설치계획 상세** (`app/install-plans/[id]/page.tsx`, `DetailClient.tsx`): `author`/`authorId` → `assignees` 교체
- **답사 폼** (`app/site-visits/SiteVisitForm.tsx`): 담당자 단일 select → 칩 기반 복수 담당자 + FieldEngineerSelectModal
- **답사 목록** (`app/site-visits/page.tsx`): `assignee` → `assignees` 기반 표시
- **답사 상세** (`app/site-visits/[id]/page.tsx`): `assigneeId` → `assignees` 교체
- **병원 대웅 담당자** (`app/hospitals/[code]/_components/DaewoongStaffTab.tsx`): 기존 한 명씩 추가/해제 리스트 방식 → DaewoongSelectModal 기반 복수 선택(체크박스) 방식. 칩 UI로 표시, 개별 × 버튼 해제
- **병원 상세 하위 카드** (`SiteVisitsCard.tsx`, `InstallPlansCard.tsx`): `assignee`/`author` → `assignees` 기반 표시
- **대시보드** (`app/page.tsx`): `builder` → `assignees` 기반 담당자명 표시
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260404010000_add_assignee_tables/`, `app/components/FieldEngineerSelectModal.tsx` (신설), `app/components/DaewoongSelectModal.tsx` (신설), `app/api/users/route.ts`, `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`, `app/api/install-plans/route.ts`, `app/api/install-plans/[id]/route.ts`, `app/api/site-visits/route.ts`, `app/api/site-visits/[id]/route.ts`, `app/api/dashboard/route.ts`, `app/projects/[code]/page.tsx`, `app/projects/new/page.tsx`, `app/projects/page.tsx`, `app/install-plans/InstallPlanForm.tsx`, `app/install-plans/page.tsx`, `app/install-plans/[id]/page.tsx`, `app/install-plans/[id]/DetailClient.tsx`, `app/site-visits/SiteVisitForm.tsx`, `app/site-visits/page.tsx`, `app/site-visits/[id]/page.tsx`, `app/hospitals/[code]/page.tsx`, `app/hospitals/[code]/_components/DaewoongStaffTab.tsx`, `app/hospitals/[code]/_components/SiteVisitsCard.tsx`, `app/hospitals/[code]/_components/InstallPlansCard.tsx`, `app/page.tsx`

---

## 2026-04-04 | 부서 관리 + 필드 엔지니어 리스트 신설

- **DB 마이그레이션** (`20260404000000_add_departments_and_field_engineers`): `departments` 테이블 신설 (id, name, organization_id FK, sort_order, created_at), `users` 테이블에 `department_id` 컬럼 추가, `field_engineers` 테이블 신설 (id, user_id UNIQUE FK, created_at)
- **Prisma 스키마**: `Department` 모델 추가 (Organization 역방향 관계), `FieldEngineer` 모델 추가, `User` 모델에 `departmentId`, `department`, `fieldEngineer` 필드 추가, `Organization` 모델에 `departments` 역방향 관계 추가
- **부서 관리 API 신설**:
  - `GET/POST /api/settings/departments`: 소속별 부서 목록 조회 / 부서 추가 (ADMIN 이상). 각 부서에 `_count.users` 포함. 동일 소속 내 이름 중복 409
  - `PUT/DELETE /api/settings/departments/[id]`: 부서명·순서 수정 / 삭제 (ADMIN 이상). 연결 계정 있으면 삭제 409
- **필드 엔지니어 API 신설**:
  - `GET/POST /api/settings/field-engineers`: 목록 조회(검색·페이지네이션) / 등록 (SEERS 소속 + 미등록 검증, 중복 409)
  - `DELETE /api/settings/field-engineers/[id]`: 삭제 (204 반환)
  - `GET /api/settings/field-engineers/candidates`: SEERS 소속·활성·미등록 유저 후보 목록 (ADMIN 이상, 검색·페이지네이션)
- **소속 관리 페이지 고도화** (`app/settings/organizations/page.tsx`): 각 소속 행에 "부서 관리" 버튼 추가. 클릭 시 인라인 아코디언 펼침 (다른 소속 아코디언 자동 닫힘). 부서 테이블(순서↑↓, 부서명 인라인 수정, 계정 수, 삭제), 하단 부서 추가 행
- **필드 엔지니어 설정 페이지 신설** (`app/settings/field-engineers/page.tsx`): ADMIN 이상 접근 (미인증 시 `/` redirect). 목록 테이블(번호·이름·이메일·소속·부서·추가일·삭제). "+ 추가" 버튼으로 모달 오픈. 모달: 검색 debounce 300ms + 후보 페이지네이션 + 선택 시 등록. 409 인라인 에러 표시
- **사용자 관리 페이지 부서 필드 추가** (`app/users/page.tsx`): 테이블에 '부서' 컬럼 추가 (소속 우측). 계정 생성 폼에 부서 드롭다운 추가 (소속 선택 시 동적 로드, 부서 없으면 비활성). SUPER_ADMIN 타계정 수정 모달에도 동일 적용. POST/PUT body에 `departmentId` 포함
- **API 업데이트**: `GET/POST /api/users` — select에 `department` 추가, POST body에 `departmentId` 수신. `PUT /api/users/[id]` — `departmentId` 수신 (null 허용). `GET /api/auth/me` — select에 `department` 추가
- **내 프로필 페이지 부서 표시** (`app/settings/profile/page.tsx`): 소속 항목 아래에 '부서' 읽기 전용 항목 추가 (없으면 '-')
- **Navigation 업데이트** (`app/components/Navigation.tsx`): 설정 하위 메뉴에 '필드 엔지니어 리스트' 추가 (ADMIN 이상, UsersIcon, 소속 관리 바로 아래)
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260404000000_add_departments_and_field_engineers/`, `app/api/settings/departments/route.ts` (신설), `app/api/settings/departments/[id]/route.ts` (신설), `app/api/settings/field-engineers/route.ts` (신설), `app/api/settings/field-engineers/[id]/route.ts` (신설), `app/api/settings/field-engineers/candidates/route.ts` (신설), `app/settings/organizations/page.tsx`, `app/settings/field-engineers/page.tsx` (신설), `app/users/page.tsx`, `app/api/users/route.ts`, `app/api/users/[id]/route.ts`, `app/api/auth/me/route.ts`, `app/settings/profile/page.tsx`, `app/components/Navigation.tsx`

---

## 2026-04-03 | 답사관리 리스트 개선 + 상세 병원카드 + 설치계획(가안) 상세 병원카드

- **답사관리 리스트** (`app/site-visits/page.tsx`):
  - 첫 번째 컬럼에 코드 추가 (`SV-XXXXX` 형식, id padStart 5자리)
  - 병원명 다음에 주소 컬럼 추가
  - 설치계획서 컬럼 제거 (colSpan 8→9)
  - `app/api/site-visits/route.ts`: hospital select에 `address` 추가
- **답사관리 상세** (`app/site-visits/[id]/page.tsx`): 병원 기본정보 카드 추가 (병원명/지역/상태/주소), 코드(`SV-XXXXX`) 헤더 표시. `app/api/site-visits/[id]/route.ts`: hospital select에 `sidoName`, `sigunguName`, `address`, `status` 추가
- **설치계획(가안) 상세** (`app/install-plans/[id]/page.tsx`): 병원 기본정보 카드 추가 (병원 매핑 시에만 노출). `app/api/install-plans/[id]/route.ts`: hospital select 동일하게 확장
- 영향 파일: `app/site-visits/page.tsx`, `app/site-visits/[id]/page.tsx`, `app/api/site-visits/route.ts`, `app/api/site-visits/[id]/route.ts`, `app/install-plans/[id]/page.tsx`, `app/api/install-plans/[id]/route.ts`

---

## 2026-04-03 | S3 계층 구조 개편 + 설치계획(가안) 파일 업로드 신설

- **S3 Key 패턴 변경**: 3개 메뉴 모두 `hospital/{hospitalCode}/{메뉴}/{...}` 구조로 통일
  - 답사 신규 staged 업로드: `hospital/{hospitalCode}/site-visits/{ts}_{name}`
  - 답사 edit 업로드: `hospital/{hospitalCode}/site-visits/{siteVisitId}/{ts}_{name}`
  - 프로젝트 파일 업로드: `hospital/{hospitalCode}/projects/{projectCode}/{ts}_{name}` (hospitalCode를 project에서 조회)
- **DB 마이그레이션** (`20260403010000_add_install_plan_files`): `install_plan_files` 테이블 신설 (id, install_plan_id FK, file_category, file_name, s3_key, uploaded_at)
- **Prisma 스키마**: `InstallPlanFile` 모델 추가, `InstallPlan`에 `files` 관계 추가
- **설치계획 파일 API 신설**:
  - `GET/POST /api/install-plans/[id]/files`: 파일 목록 조회 / S3 업로드 + DB 저장 (`hospital/{hospitalCode}/install-plans/{planCode}/{ts}_{name}`)
  - `DELETE /api/install-plans/[id]/files/[fileId]`: S3 + DB 동시 삭제
  - `GET /api/install-plans/file-url`: presigned URL 생성 (1시간 만료)
- **설치계획 UI 업데이트**: `InstallPlanForm.tsx`에 `FileField` 컴포넌트 추가 — 도면(FLOOR_PLAN), 설치계획서(INSTALL_PLAN) 각 1개 섹션. edit 모드 + 병원 매핑 시에만 노출. 병원 미매핑 시 안내 메시지 표시
- **`app/install-plans/[id]/page.tsx`**: files 포함하여 조회, `canEdit` prop 추가
- **`app/install-plans/[id]/DetailClient.tsx`**: `files`, `canEdit` prop 전달
- 영향 파일: `app/api/site-visits/upload/route.ts`, `app/api/site-visits/[id]/files/route.ts`, `app/api/projects/[code]/files/route.ts`, `app/api/install-plans/[id]/files/route.ts` (신설), `app/api/install-plans/[id]/files/[fileId]/route.ts` (신설), `app/api/install-plans/file-url/route.ts` (신설), `app/install-plans/InstallPlanForm.tsx`, `app/install-plans/[id]/page.tsx`, `app/install-plans/[id]/DetailClient.tsx`, `prisma/schema.prisma`, `prisma/migrations/20260403010000_add_install_plan_files/`

---

## 2026-04-03 | 파일업로드 멀티파일·ZIP 지원 + 프로젝트 상세 병원기본정보 카드 추가

- **DB 마이그레이션** (`20260403000000_add_site_visit_files`): `site_visit_files` 테이블 신설 (id, site_visit_id FK, file_category, file_name, s3_key, uploaded_at)
- **Prisma 스키마**: `SiteVisitFile` 모델 추가, `SiteVisit` 에 `files SiteVisitFile[]` 관계 추가
- **답사 파일 API 신설** (`app/api/site-visits/[id]/files/route.ts`): GET(목록), POST(파일 업로드 → SiteVisitFile 저장)
- **답사 파일 삭제 API 신설** (`app/api/site-visits/[id]/files/[fileId]/route.ts`): DELETE(S3+DB 삭제)
- **기존 API 업데이트**: `GET/POST /api/site-visits`, `GET /api/site-visits/[id]` — include에 `files` 추가, POST에 `files` 배열로 SiteVisitFile 일괄 생성 지원
- **SiteVisitForm.tsx 전면 재설계**: `FileField`(단일파일) → `MultiFileField`(멀티파일)로 교체
  - create 모드: S3 업로드 후 staged 상태로 로컬 관리 → 폼 제출 시 API에 files 배열 전달
  - edit 모드: 업로드 즉시 `POST /api/site-visits/[id]/files`, 삭제 즉시 DELETE. 레거시 `installPlanS3Key`/`floorPlanS3Key` 필드는 별도 표시 + PUT으로 null 처리
  - `accept`에 `.zip` 추가, `multiple` 속성 추가
- **`app/site-visits/[id]/page.tsx`**: `SiteVisitData` 인터페이스에 `files` 추가, `initialData`에 `files` 전달
- **프로젝트 상세 멀티파일** (`app/projects/[code]/page.tsx`): `multiple` + `.zip` 추가, `handleFileSelected`를 파일 배열 루프로 재작성
- **프로젝트 상세 병원기본정보 카드** (`app/projects/[code]/page.tsx`): 최상단에 병원명(HIRA명 병기)·지역·상태·주소 표시 카드 추가, 'Project.hospital' 타입 확장
- **병원 선택 팝업 주소 표시** (`app/projects/_components/HospitalSelectModal.tsx`): `address` 필드 추가, 테이블에 주소 컬럼 삽입, 모달 너비 `max-w-3xl`로 확장
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260403000000_add_site_visit_files/`, `app/api/site-visits/[id]/files/route.ts` (신설), `app/api/site-visits/[id]/files/[fileId]/route.ts` (신설), `app/api/site-visits/route.ts`, `app/api/site-visits/[id]/route.ts`, `app/site-visits/SiteVisitForm.tsx`, `app/site-visits/[id]/page.tsx`, `app/projects/[code]/page.tsx`, `app/projects/_components/HospitalSelectModal.tsx`

---

## 2026-04-03 | 계정관리 테이블 줄바꿈 수정 + USER 역할 등록/수정 권한 부여

- **계정관리 테이블 한줄 표시** (`app/users/page.tsx`): 컨테이너 `max-w-5xl` → `max-w-6xl` 확장, 테이블 wrapper에 `overflow-x-auto` 추가, 이름·이메일·연락처·소속·역할·상태·작업 `<td>` 전체에 `whitespace-nowrap` 적용
- **USER 역할 등록/수정 권한 부여**: 아래 4개 파일의 `isAdmin` 조건을 `ADMIN||SUPER_ADMIN` → `role !== 'VIEWER'`로 변경하여 일반(USER) 등급도 등록·수정 버튼 노출
  - `app/hospitals/[code]/page.tsx`: 병원 상세 내 답사 등록·설치계획 등록·프로젝트 등록 버튼
  - `app/projects/page.tsx`: 프로젝트 등록 버튼 (미사용 import `isAdminOrAbove` 제거)
  - `app/install-plans/page.tsx`: 설치계획(가안) 등록 버튼
  - `app/site-visits/SiteVisitForm.tsx`: 답사 폼 내 파일 삭제 버튼
- API 레벨 권한(VIEWER 차단)은 기존과 동일 유지, 삭제 기능은 여전히 ADMIN 이상만 가능

---

## 2026-04-02 | 계정 관리 마지막 로그인 시간 추가

- DB 마이그레이션 (`20260402000000_add_last_login_at`): `users` 테이블에 `last_login_at TIMESTAMP(3)` 컬럼 추가
- `prisma/schema.prisma`: `User` 모델에 `lastLoginAt DateTime?` 필드 추가
- `app/api/auth/login/route.ts`: 로그인 성공 시 `last_login_at` 현재 시각으로 업데이트
- `app/api/users/route.ts`: GET/POST select에 `lastLoginAt` 포함
- `app/users/page.tsx`: `User` 타입에 `lastLoginAt` 추가, 테이블에 '마지막 로그인' 컬럼 추가 (미기록 시 `-` 표시)
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260402000000_add_last_login_at/`, `app/api/auth/login/route.ts`, `app/api/users/route.ts`, `app/users/page.tsx`

---

## 2026-04-02 | 대시보드 thynC 현황 종별 테이블 추가

- `app/api/dashboard/hospital-stats/route.ts` 신설: 종별 × (전체/도입검토중/도입확정) 집계
- 도입검토중 기준: status IN ('가견적요청', '답사요청')
- 도입확정 기준: status IN ('계약완료', '운영')
- hospitals.type 컬럼 직접 사용 (hira_hospitals 조인 불필요), hiraId 없는 병원은 '기타' 분류
- 대시보드 최상단에 'thynC 현황' 테이블 추가 (합계 행 포함, 0건 종별 행 생략, 도입검토중 파란색·도입확정 초록색)
- 영향 파일: `app/api/dashboard/hospital-stats/route.ts` (신규), `app/page.tsx`

---

## 2026-04-02 | 병원 목록 상태 멀티필터 추가

- `HospitalFilters.tsx`: 상태 멀티선택 드롭다운 추가. 체크박스 클릭 즉시 URL 반영, 선택 건수 버튼에 표시, 외부 클릭 시 닫힘, 선택 초기화 버튼 포함
- `page.tsx`: `searchParams.status` 배열 파싱 → `where: { status: { in: [...] } }` 조건 적용. `statusOptions`·`initialStatuses` props 전달. statusCode 쿼리에 `category: 'HOSPITAL'` 조건 추가
- `Pagination.tsx`: `statuses` prop 추가, `buildHref`에 다중 `status` 파라미터 유지
- 영향 파일: `app/hospitals/page.tsx`, `app/hospitals/_components/HospitalFilters.tsx`, `app/hospitals/_components/Pagination.tsx`

---

## 2026-04-01 | HIRA → Hospital 일괄 마이그레이션 스크립트 작성

- `scripts/migrate-hira-to-hospitals.ts` 신규 생성
- 대상: hira_hospitals에서 한의원·치과의원 제외, 이미 hospital에 매핑된 hiraId 중복 제외
- dry-run 결과: 전체 79,618건 중 신규 삽입 대상 45,247건 (한의원/치과의원 34,197건 제외, 기매핑 174건 제외)
- `--dry-run` / `--execute` 플래그 지원, 500건 배치 `createMany(skipDuplicates: true)`
- StatusCode `'미계약'`(HOSPITAL) 없으면 스크립트 종료 처리
- hospitalCode 채번: 기존 최댓값(HOSP-000174) 이후 HOSP-000175부터 순번 증가
- 영향 파일: `scripts/migrate-hira-to-hospitals.ts` (신규)

---

## 2026-04-01 | 심평원 연동 백그라운드 전환 + 연동 관리 설정 페이지 신설

- **아키텍처 전환**: SSE 스트리밍 방식 → DB 저장 + 백그라운드 비동기 방식으로 전면 전환. POST 핸들러가 즉시 jobId를 반환하고 `runSync()`를 await 없이 실행 → 브라우저 닫아도 연동 계속 진행.
- **DB 마이그레이션** (`20260401000000_add_hira_sync_jobs`): `hira_sync_jobs`(id, started_at, ended_at, status, total_count), `hira_sync_logs`(id, job_id, type, message, stats, created_at) 테이블 신설.
- **API 재작성** (`app/api/hira-hospitals/sync/route.ts`): GET=히스토리 목록(최신 50건), POST=백그라운드 연동 시작(중복 실행 방지). 연동 진행 중 각 단계별 로그를 DB에 저장.
- **잡 상세 API 신설** (`app/api/hira-hospitals/sync/[id]/route.ts`): GET=특정 잡 상세 + 전체 로그 반환.
- **설정 페이지 신설** (`app/settings/hira-sync/`): SUPER_ADMIN 전용. 연동 시작 버튼, 히스토리 테이블(시작시간/종료시간/상태/연동건수), 행 클릭 시 우측 로그 패널 오픈. 진행 중인 잡은 2초 폴링으로 실시간 갱신.
- **Navigation 업데이트** (`app/components/Navigation.tsx`): 설정 하위에 '심평원 연동 관리' 메뉴 추가 (SUPER_ADMIN만 노출).
- **hira-hospitals 페이지 정리** (`app/hira-hospitals/page.tsx`): 기존 HiraSyncButton 완전 제거.
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260401000000_add_hira_sync_jobs/`, `app/api/hira-hospitals/sync/route.ts`, `app/api/hira-hospitals/sync/[id]/route.ts` (신설), `app/settings/hira-sync/page.tsx` (신설), `app/settings/hira-sync/_components/HiraSyncPageClient.tsx` (신설), `app/components/Navigation.tsx`, `app/hira-hospitals/page.tsx`

---

## 2026-04-01 | 심평원 연동 Nginx 타임아웃 버그 수정 (keepalive + 타임아웃 연장)

- **원인**: Nginx `proxy_read_timeout` 기본값(60초) 초과로 커넥션 강제 종료
- **TASK 1 — API keepalive ping 추가** (`app/api/hira-hospitals/sync/route.ts`): `group_start` 직후, 각 페이지 fetch 직전, DB upsert 100건 배치마다 `{"type":"keepalive"}` SSE 이벤트 전송. `upsertHospitals` → `upsertBatch(items, onKeepalive)` 로 리팩터(배치 단위 콜백).
- **TASK 2 — Nginx SSE 전용 location 추가** (`/etc/nginx/sites-available/thync-ops`): DEV 서버 블록에 `/api/hira-hospitals/sync` location 추가 — `proxy_read_timeout 600s`, `proxy_buffering off`, `proxy_cache off`, HTTP/1.1 chunked 전송. PROD 설정 미변경. `sudo nginx -t && sudo systemctl reload nginx` 적용.
- **TASK 3 — 클라이언트 오류 처리 개선** (`HiraSyncButton.tsx`): keepalive 이벤트 수신 시 무시(로그 미출력). `lastEventTypeRef`로 스트림 종료 시 정상/비정상 구분. 네트워크 에러 메시지에 "network error"/"failed to fetch" 포함 시 사용자 친화적 문구 출력.
- 영향 파일: `app/api/hira-hospitals/sync/route.ts`, `/etc/nginx/sites-available/thync-ops`, `app/hira-hospitals/_components/HiraSyncButton.tsx`

---

## 2026-04-01 | 심평원 연동 SSE 이벤트 구조 세분화 및 UI 전면 재작성

- **TASK 1 — API 라우트 재작성** (`app/api/hira-hospitals/sync/route.ts`): SSE 이벤트를 6종(init / group_start / group_api_done / group_db_done / done / error)으로 세분화. 각 이벤트에 `stats` 객체 포함. 종별코드별 오류는 해당 그룹만 스킵하고 계속 진행. fatal 오류 시 `stats.fatal: true` 추가. `cumulativeCount` 누적 카운터 도입.
- **TASK 2 — HiraSyncButton 전면 재작성** (`app/hira-hospitals/_components/HiraSyncButton.tsx`): EventSource → `fetch + ReadableStream` 방식으로 교체 (자동 재연결 오발화 방지). 상단 요약 바(진행 그룹 수 / 누적 처리 건수 / 프로그레스 바) 추가. 이벤트 타입별 로그 스타일 구분(회색/기본/파란색 ✓/노란색 ⚠/초록색/빨간색 ✗). AbortController로 연결 취소 지원.
- 영향 파일: `app/api/hira-hospitals/sync/route.ts`, `app/hira-hospitals/_components/HiraSyncButton.tsx`

---

## 2026-04-01 | 심평원 연동 버튼 추가, 병원 상태코드 필터 버그 수정, 대시보드 섹션 순서 변경

- **TASK 1 — 심평원 SSE 연동 API** (`app/api/hira-hospitals/sync/route.ts`): SUPER_ADMIN 전용 GET 핸들러 신설. 종별코드 15개를 순서대로 처리하며 HIRA Open API 호출 → xml2js 파싱 → Prisma upsert. 각 단계별 진행 상황을 SSE(`text/event-stream`)로 실시간 스트리밍. `maxDuration=300` 설정.
- **TASK 2 — 심평원 연동 버튼 + 팝업** (`app/hira-hospitals/_components/HiraSyncButton.tsx`): 클라이언트 컴포넌트 신설. 버튼 클릭 시 모달 오픈 + `EventSource`로 SSE 연결. 로그 실시간 추가·자동 스크롤. progress/done/error 타입별 텍스트 색상 구분. 연동 중 닫기 비활성화, 완료/오류 시 닫기 활성화.
- **TASK 3 — 심평원 페이지 구조 개편** (`app/hira-hospitals/page.tsx`): 서버 컴포넌트 유지. `verifyToken` + `isSuperAdmin`으로 권한 확인 후 헤더 우측에 `HiraSyncButton` 조건부 렌더링.
- **TASK 4 — 병원 상태코드 필터 버그 수정**: `app/hospitals/[code]/page.tsx`(line 70) 및 `app/api/hospitals/[code]/route.ts`(line 17)의 `statusCode.findMany()`에 `where: { category: 'HOSPITAL' }` 조건 추가. 기존에 SITE_VISIT 카테고리 값까지 함께 조회되던 문제 수정.
- **TASK 5 — 대시보드 섹션 순서 변경** (`app/page.tsx`): '월별 누적 사용 현황' 섹션을 '이번주 구축 현황' 및 '차주 구축 예정' 카드보다 위로 이동. JSX 순서만 변경, 데이터 로직 무변경.
- 영향 파일: `app/api/hira-hospitals/sync/route.ts` (신설), `app/hira-hospitals/_components/HiraSyncButton.tsx` (신설), `app/hira-hospitals/page.tsx`, `app/hospitals/[code]/page.tsx`, `app/api/hospitals/[code]/route.ts`, `app/page.tsx`

---

## 2026-03-31 | 답사 병원 검색 모달 전환, 설치계획 코드 관리, 계정 미배정 탭 추가

- **TASK 1 — 답사 병원 선택 UX 개선** (`app/site-visits/SiteVisitForm.tsx`): 병원 `<select>` 드롭다운 → 검색 모달 방식으로 전환 (InstallPlanForm과 동일한 패턴). edit 모드에서 기존 hospitalCode로 `/api/hospitals/{code}` 호출해 병원명 자동 표시.
- **TASK 2 — 설치계획 검색 버그 수정** (`app/api/install-plans/route.ts`): 목록 검색 시 `hospitalName`만 검색하던 것을 `hiraHospitalName`도 OR 조건으로 추가.
- **TASK 3 — 설치계획 planCode 관리**: DB `install_plans` 테이블에 `plan_code VARCHAR(50) UNIQUE` 컬럼 추가 (마이그레이션명 `20260331120000_add_install_plan_code`). 신규 등록 시 `IP-NNNNN` 형식 자동 생성. UI 노출: 목록 페이지(코드 컬럼 추가), 병원 상세 InstallPlansCard(코드 컬럼 추가), 설치계획 상세 페이지 헤더에 코드 표시.
- **TASK 4 — 계정관리 미배정 탭 추가** (`app/users/page.tsx`): 소속(organization)이 없는 계정이 SEERS/DAEWOONG 탭 어디에도 표시되지 않던 문제 수정. '미배정' 탭 추가하여 organization이 null인 계정(최고관리자 등) 접근 가능.
- 영향 파일: `app/site-visits/SiteVisitForm.tsx`, `app/api/install-plans/route.ts`, `prisma/schema.prisma`, `prisma/migrations/20260331120000_add_install_plan_code/`, `app/install-plans/page.tsx`, `app/install-plans/[id]/page.tsx`, `app/hospitals/[code]/_components/InstallPlansCard.tsx`, `app/hospitals/[code]/page.tsx`, `app/users/page.tsx`

---

## 2026-03-31 | 프로젝트명 표시 수정, 답사 관리 명칭 변경, 병원 상세 카드 추가

- **TASK 1 — 프로젝트명 표시 수정** (`app/projects/page.tsx`): 컬럼 헤더 '병원명' → '프로젝트명', 셀 데이터 `hospitalName` → `p.projectName`으로 변경. 링크는 유지.
- **TASK 2 — 메뉴명 변경**: `app/components/Navigation.tsx` 및 `app/site-visits/page.tsx`에서 '답사 현황' → '답사 관리'로 일괄 변경.
- **TASK 3 — 병원 상세 카드 추가**:
  - `app/api/site-visits/route.ts`: `?hospitalCode=` 필터 파라미터 추가
  - `app/api/install-plans/route.ts`: `?hospitalCode=` 필터 파라미터 추가
  - `app/hospitals/[code]/page.tsx`: Prisma로 해당 병원의 답사/설치계획 목록 조회, 직렬화 후 클라이언트 카드 컴포넌트 전달. 구축 프로젝트 카드 위에 '답사 관리' → '설치계획(가안) 관리' 순서로 추가.
  - `app/hospitals/[code]/_components/SiteVisitsCard.tsx`: 신설 (행 클릭 시 `/site-visits/[id]`, + 답사 등록 버튼 ADMIN 이상)
  - `app/hospitals/[code]/_components/InstallPlansCard.tsx`: 신설 (행 클릭 시 `/install-plans/[id]`, + 등록 버튼 ADMIN 이상, 상태 뱃지)
  - `app/site-visits/new/page.tsx`: 클라이언트 컴포넌트 → 서버 컴포넌트로 전환, `?hospitalCode=` 쿼리 읽어 `SiteVisitForm`에 `initialData` 전달
  - `app/install-plans/new/page.tsx`: `?hospitalCode=` 쿼리 읽어 Prisma로 병원 조회, `InstallPlanForm`에 `initialHospital` 전달
  - `app/install-plans/InstallPlanForm.tsx`: `initialHospitalCode`, `initialHospital` props 추가

---

## 2026-03-31 | 설치계획(가안) 관리 기능 신설 + 프로젝트 등록 버튼 권한 수정

- **TASK 1 — 등록 버튼 권한 수정** (`app/projects/page.tsx`): `isAdmin` 조건을 `user.role === 'ADMIN'` → `isAdminOrAbove(user.role)` 로 수정. SUPER_ADMIN도 등록 버튼 노출.
- **TASK 2 — DB 마이그레이션**: `install_plans` 테이블 신설 (SQL 직접 실행). 마이그레이션명 `20260331000000_add_install_plans`. `prisma/schema.prisma`에 `InstallPlan` 모델 추가, `Hospital.installPlans`, `User.authoredInstallPlans` 역방향 관계 추가. `npx prisma generate` 실행.
- **TASK 3 — API 구현**: `app/api/install-plans/route.ts` (GET 목록 전체 반환+필터+정렬, POST 등록), `app/api/install-plans/[id]/route.ts` (GET 단건, PUT 수정, DELETE ADMIN 이상만) 신설.
- **TASK 4 — 페이지 구현**: `app/install-plans/page.tsx` (목록: 클라이언트 컴포넌트, 필터+컬럼 정렬 토글, 행 클릭 상세 이동, 상태 색상 뱃지), `app/install-plans/new/page.tsx` (ADMIN 이상 접근), `app/install-plans/[id]/page.tsx` + `DetailClient.tsx` (상세/수정+삭제), `app/install-plans/InstallPlanForm.tsx` (병원 검색 모달, 상태 select, 씨어스 유저 select, RichTextEditor 비고).
- **TASK 5 — 네비게이션**: `app/components/Navigation.tsx`에 '설치계획(가안) 관리' 메뉴 추가 (FileText SVG 아이콘, 답사 현황 위, 모든 역할 접근 가능).
- 영향 파일: `app/projects/page.tsx`, `prisma/schema.prisma`, `prisma/migrations/20260331000000_add_install_plans/`, `app/api/install-plans/route.ts`, `app/api/install-plans/[id]/route.ts`, `app/install-plans/page.tsx`, `app/install-plans/new/page.tsx`, `app/install-plans/[id]/page.tsx`, `app/install-plans/[id]/DetailClient.tsx`, `app/install-plans/InstallPlanForm.tsx`, `app/components/Navigation.tsx`

---

## 2026-03-30 | 프로젝트 목록 페이징 제거, 컬럼 개편, 보류 하단 정렬

- **TASK 1 — 페이징 제거**: `app/api/projects/route.ts`에서 `?all=true`/`page`/`limit` 파라미터 및 `skip/take` 로직 완전 제거, 항상 전체 목록 반환. `page.tsx`에서 `ProjectPagination` 컴포넌트 제거 및 prisma 쿼리 페이징 제거. `ProjectFilters.tsx`에서 `page=1` 파라미터 제거. `ProjectPagination.tsx` 파일 삭제.
- **TASK 2 — 보류 하단 정렬**: API(`route.ts`) 및 페이지(`page.tsx`) 모두에서 DB 정렬 후 JS 레벨 재정렬 — `buildStatus.label === '보류'` 항목을 배열 맨 뒤로 이동.
- **TASK 3 — 컬럼 순서 변경**: 기존 16컬럼(프로젝트 코드·프로젝트명·차수·담당자 포함) → 12컬럼으로 축소 및 재배열: 병원명 | 진행상태 | 구축 시작일 | 구축 종료일(예상) | 도입형태 | 계약일 | 병동 수 | 병상 수 | G/W | 심전계 | 산소포화도 | 구축업체. 병원명에 프로젝트 상세 링크 적용.
- **TASK 4 — 프로젝트 폴더 컬럼 삭제**: 테이블에서 "프로젝트 폴더" 컬럼 헤더 및 `driveFolderId` 렌더링 코드 완전 제거.
- 영향 파일: `app/api/projects/route.ts`, `app/projects/page.tsx`, `app/projects/_components/ProjectFilters.tsx`, `app/projects/_components/ProjectPagination.tsx` (삭제)

---

## 2026-03-30 | 간트 탭 뷰 방식 변경 (고정 61일 + flex 레이아웃)

- **토글 버튼 제거**: ±1주/±2주/±1개월 토글 완전 제거, 뷰 고정 61일 (centerDate ±30일)
- **컨트롤 바 재구성**: 좌측 이전/오늘/다음(30일씩 이동), 중앙 기간 텍스트, 우측 `<input type="date">` 직접 입력으로 centerDate 설정
- **레이아웃 전환**: 고정 픽셀(28px×N) → `flex: 1` 동적 너비. 61개 날짜 셀이 가로 공간을 균등 분할하여 우측 빈 공간 없이 꽉 채움. 가로 스크롤 제거
- **바 위치/너비 퍼센트 계산**: `left: (startOff / 61) × 100%`, `width: (duration / 61) × 100%`
- **오버레이 calc() 포지셔닝**: 주말·오늘 컬럼·오늘 세로선을 `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * fraction)`으로 절대 위치 계산
- **월/주차 헤더**: `flex: count` 비례 너비로 날짜 셀과 동기화
- `WindowSize` 타입, `DAY_W` 상수, `scrollRef`, `didAutoScroll`, `windowDays`, `totalW`, `weekendIndices`, `todayIdx` 제거 → `TOTAL_DAYS = 61`, `todayOffset` 로 대체
- 영향 파일: `app/projects/calendar/page.tsx`

---

## 2026-03-30 | 간트 뷰 레이아웃 버그 수정

- **버그 1 수정**: 스크롤 컨테이너 직계 자식 div에 `width: LABEL_W + totalW` 명시 (`minWidth` → `width`). flex/flex-1 제거로 우측 빈 공간 제거
- **버그 2 수정**: 헤더 4행(월/주차/일/진행건수)의 날짜 트랙 wrapper에 `width: totalW, flexShrink: 0` 명시. 모든 날짜 셀 `width: DAY_W, minWidth: DAY_W, flexShrink: 0` 통일
- **버그 3 수정**: 라벨 컬럼(150px) 전체에 `position: sticky, left: 0, zIndex: 20(헤더)/15(행), background` 명시. 축 행 블록 `position: sticky, top: 0, zIndex: 10` 유지
- Tailwind className 대신 인라인 스타일로 레이아웃 속성 통일 (border, flex 등)
- 영향 파일: `app/projects/calendar/page.tsx`

---

## 2026-03-30 | 프로젝트 캘린더 페이지 재구성

- 프로젝트 캘린더 페이지 재구성. 간트 보기(포커스 윈도우, ±1주/2주/1개월 토글, 기간 내 프로젝트만 필터링) + 캘린더 보기(월간 히트맵, 날짜 클릭 시 하단 상세 패널) 탭 구성으로 교체.
- **공통 헤더**: 제목 '구축 일정 캘린더'(16px 500) + 우측 탭 버튼('간트 보기' / '캘린더 보기'), 탭 상태는 URL 쿼리스트링(?tab=gantt / ?tab=calendar)에 반영
- **간트 탭**: centerDate 기준 ±1주(15일)/±2주(29일)/±1개월(61일) 포커스 윈도우, 이전/오늘/다음 버튼으로 windowDays씩 이동, 기간 내 프로젝트만 행 표시(0건 시 안내 텍스트), 구축일 미입력 하단 별도 섹션, 오늘 세로선(빨강) + 오늘 컬럼 연파랑, 4행 스티키 헤더(월/주차/일요일/진행건수)
- **캘린더 탭**: 월간 히트맵(0~4건+ 색상 강도), 이전달/오늘/다음달 이동, 날짜 클릭 시 하단 상세 패널 업데이트(기본값 오늘), 주차 레이블(좌측 36px 컬럼)
- **공통 유틸**: `countProjectsOnDate`, `getProjectsOnDate` 함수 파일 상단 정의
- 영향 파일: `app/projects/calendar/page.tsx`

---

## 2026-03-30 | 프로젝트 목록 정렬 변경 + 캘린더 보기 버튼 + 간트 캘린더 페이지 신설

- **정렬 변경**: 프로젝트 목록 기본 정렬을 `startDate DESC nulls first`로 변경 — 구축시작일 미입력 프로젝트가 맨 위, 이후 최신순 정렬
- **API `?all=true` 지원**: `/api/projects` GET에 `all=true` 파라미터 추가 — 페이지네이션 없이 전체 프로젝트 반환 (캘린더 페이지 전용)
- **캘린더 보기 버튼**: 프로젝트 목록 페이지 헤더에 아웃라인 스타일 '캘린더 보기' 버튼 추가 (CalendarDays 아이콘, 새 탭 오픈)
- **간트 캘린더 페이지 신설** (`/projects/calendar`):
  - 전체 클라이언트 컴포넌트, 외부 캘린더 라이브러리 미사용 (직접 구현)
  - 상단 바: 제목, 이전/오늘/다음 네비게이션, 현재 기간 텍스트, 뷰 토글(1개월/2주/3개월)
  - 스티키 4행 헤더: 월 / ISO주차(W{n} M/D~M/D) / 일+요일 / 날짜별 진행건수 (0~4건+ 색상 강도)
  - 주말 음영 컬럼 오버레이 (콘텐츠 전체 적용, 행별 반복 렌더링 없음)
  - 오늘 세로선: 1.5px rgba(239,68,68,0.45), 콘텐츠 전체 높이
  - 간트 바: 인덱스 기준 3색 순환, 클리핑, 40px 이상 시 병원명 표시, 클릭 시 상세 새 탭 오픈
  - 구축시작일 미입력 프로젝트: 하단 별도 섹션으로 분리
  - 라벨 열(150px) sticky left, 헤더 4행 sticky top
  - 페이지 로드 시 오늘 날짜로 자동 스크롤
- `lucide-react` 패키지 신규 설치
- 영향 파일: `app/api/projects/route.ts`, `app/projects/page.tsx`, `app/projects/calendar/page.tsx`

---

## 2026-03-30 | 도입형태 기능 전면 개편 및 기타 수정

- **TASK 4** 로그인 페이지: "Seers" → "SEERS" 텍스트 수정 (`app/login/page.tsx`)
- **TASK 2** router.refresh() 감사: settings 페이지(status, site-visit-status)의 인플레이스 뮤테이션 핸들러에 `router.refresh()` 추가
- **TASK 3** 도입형태 기능 전면 개편:
  - DB: `hospital_intro_types` 조인 테이블 신설, `projects.intro_type_id` 컬럼 추가, INTRO_TYPE StatusCode 시드(구축형·구독형·사용량비례형) — SQL 직접 실행 후 prisma 스키마 동기화
  - Prisma 스키마: `HospitalIntroType` 모델, `Hospital.introTypes`, `Project.introType / introTypeId` 관계 추가
  - API: `/api/settings/intro-type` (GET/POST), `/api/settings/intro-type/[id]` (PUT/DELETE) 신설
  - API: `/api/hospitals/[code]` GET에 `introTypes` include 추가, PUT에 `introTypeIds` 배열 처리(트랜잭션 delete+createMany)
  - API: `/api/hospitals` POST에 `introTypeIds` 처리 추가 (이전 `introType` 문자열 제거)
  - API: `/api/projects/[code]` GET/PUT에 `introType` 관계 include 및 `introTypeId` 저장 추가
  - API: `/api/projects` POST에 `introTypeId` 저장 추가
  - 네비게이션: 설정 메뉴에 "도입형태 관리" 링크 추가
  - 설정 페이지: `/settings/intro-type` 관리 페이지 신설 (추가/수정/삭제/순서변경)
  - 병원 상세(`/hospitals/[code]`): `introTypes` junction 데이터로 도입형태 칩 표시
  - 병원 수정(`/hospitals/[code]/edit`): API에서 INTRO_TYPE 목록 동적 로드, chip 토글 UI, `introTypeIds` 전송
  - 병원 등록(`/hospitals/register`): 동일 방식으로 chip 토글 UI, `introTypeIds` 전송
  - 프로젝트 상세(`/projects/[code]`): 자유 텍스트 `contractType` → INTRO_TYPE select(`introTypeId`)로 교체
  - 프로젝트 등록(`/projects/new`): 동일 방식으로 INTRO_TYPE select 추가
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/`, `app/login/page.tsx`, `app/components/Navigation.tsx`, `app/settings/intro-type/page.tsx`, `app/settings/status/page.tsx`, `app/settings/site-visit-status/page.tsx`, `app/api/settings/intro-type/route.ts`, `app/api/settings/intro-type/[id]/route.ts`, `app/api/hospitals/route.ts`, `app/api/hospitals/[code]/route.ts`, `app/api/projects/route.ts`, `app/api/projects/[code]/route.ts`, `app/hospitals/[code]/page.tsx`, `app/hospitals/[code]/edit/page.tsx`, `app/hospitals/register/page.tsx`, `app/projects/[code]/page.tsx`, `app/projects/new/page.tsx`

---

## 2026-03-30 | 병원 상세 UI 개선, 계정관리 탭 분리, S3 병원 디렉토리 자동 생성

- Hospital detail: added contractDate field (DB+API+UI), removed Drive creation button, reorganized 기본정보 layout (종별+주소 one row), added thynC 시스템 현황 placeholder card.
- Account management: Organization tab split (씨어스/대웅) with user count badges.
- S3: auto-create /hospitals/{code}/ directory on hospital creation (best-effort, non-blocking).
- 상세 내용:
  - 병원 상세(`app/hospitals/[code]/page.tsx`): 기본정보 카드에서 종별·주소를 2-col 나란히 배치; DriveFolderRow 컴포넌트 및 관련 import 제거; thynC 현황 카드에 (최초)계약일 필드 추가(DB/API는 기존에 존재); thynC 시스템 현황 카드 신설(플레이스홀더)
  - 계정 관리(`app/users/page.tsx`): 씨어스테크놀로지(SEERS)/대웅제약(DAEWOONG) 탭 추가, 탭별 사용자 수 뱃지, 클라이언트 사이드 필터링, 기본 탭 씨어스
  - 병원 등록 API(`app/api/hospitals/route.ts`): 병원 생성 성공 후 S3에 `hospitals/{code}/` 빈 오브젝트 생성(실패 시 로그만 남기고 응답 계속)
- 영향 파일: `app/hospitals/[code]/page.tsx`, `app/users/page.tsx`, `app/api/hospitals/route.ts`

---

## 2026-03-30 | 로그인 페이지 UI 개편

- 로그인 페이지 UI를 thynC 브랜드 기반 스플릿 레이아웃으로 전면 개편
- 좌측 브랜드 패널(#0B2E5A 딥 네이비): 그리드 텍스처, 방사형 글로우, 코너 아크, 로고(/logo.svg), 서비스 태그라인, 운영 통계(병원·프로젝트·병상), 시스템 상태 표시(펄스 애니메이션)
- 우측 폼 패널(#F8FAFC): 상단 브랜드 컬러 액센트 라인, 아이디/비밀번호 입력, 로그인 상태 유지 체크박스, 로그인 버튼(호버 시 화살표 이동), 푸터
- DM Sans(본문) + DM Mono(숫자·레이블·푸터) 폰트 적용, 이 페이지에만 스코프
- 마운트 시 fadeUp 애니메이션(좌측·헤더·폼·푸터 순차 적용)
- 768px 미만에서 좌측 브랜드 패널 숨김, 폼 패널 단독 전체 표시
- 기존 로그인 제출 로직(JWT 인증, 에러 처리) 그대로 유지
- 영향 파일: `app/login/page.tsx`

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
