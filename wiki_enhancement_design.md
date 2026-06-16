# 사내 위키 고도화 상세 설계 (v1)

> 작성일: 2026-06-16
> 목적: 현재 위키(BlockNote 기반, Phase 0~8 완료)를 **상용 제품 수준의 완성도**로 끌어올리기 위한 상세 설계.
> 이 문서는 **코드 작성 전 합의용**이며, 확정 후 각 항목을 Phase 9~13으로 쪼개 진행한다.
> 진행 원칙·DB 마이그레이션 규칙·빌드/배포 규칙은 `CLAUDE.md`, `wiki_dev_schedule.md`를 그대로 따른다.

---

## 0. 범위 (Scope)

### 포함 (In Scope)
- **UI/디자인 시스템 전면 고도화** — 본 프로젝트 최우선 요구사항
- 편집 경험 개선 (자동 저장 + 충돌 감지, 편집 모드 제거)
- 페이지 아이콘/커버, 블록 종류 확장(콜아웃·토글·구분선·다단)
- 정보구조 개선 (사이드바 상태 유지·접기, 목차, 백링크)
- 인라인 댓글, 템플릿, 휴지통, 검색 고도화, 사용자 멘션·알림

### 제외 (Out of Scope) — 이번 사이클에서 다루지 않음
- **C1. 실시간 공동 편집 (Yjs + WebSocket)** — 동시 편집 빈도 "거의 없음"으로 확인됨. 자동저장 + 충돌 감지로 대체.
- **C2. 데이터베이스/표·보드·캘린더 뷰 (Notion DB)** — 이번 사이클 제외(보류). 향후 별도 의사결정.
  - ⚠️ 참고: 초기 논의에서 "가벼운 DB 뷰 추가"로 기울었으나 최신 지시로 제외. 되살릴 경우 본 문서 부록 `Parked-1` 참고.

### 불변 제약 (변경 금지)
- 위키 모듈 단방향 의존성 (`CLAUDE.md` 규칙 7): 메인 → 위키 import 금지
- 위키 테이블은 `wiki` 스키마에만 (`CLAUDE.md` 규칙 8)
- 위키 본문은 BlockNote, 기존 Tiptap 사용처는 불변 (`CLAUDE.md` 코딩 컨벤션)
- React 18 / Tailwind 3.4 / Next 14 / BlockNote 0.51.4 (ariakit 테마) 환경 유지

---

## 1. 설계 원칙

1. **"항상 편집 가능" 모델** — Notion처럼 모드 전환 없이 바로 쓰고 자동 저장. 단, 동시 편집이 드무므로 실시간 동기화 대신 **저장 시 충돌 감지**로 데이터 보호.
2. **시각적 완성도 우선** — 기능보다 "매끄러움"을 먼저 체감하게. 디자인 토큰을 먼저 정의하고 모든 컴포넌트를 거기에 맞춘다.
3. **점진적·비파괴적** — 기존 contentJson 데이터 100% 호환. 신규 블록/컬럼은 추가만, 기존 스키마 변경 최소화.
4. **저비용 고체감 우선순위** — 인프라 변경 없는 항목부터.

---

# Part 1 — UI / 디자인 시스템 고도화  ★최우선

> "상용 제품처럼 매끄럽게". 기능 추가 이전에, **디자인 언어를 먼저 정의**하고 전 컴포넌트를 통일한다.
> 현재 문제: 에디터가 `border rounded p-4` 박스에 갇힘, 액션 버튼 6개가 한 줄에 나열, 이모지 아이콘(📂🕘⧉) 남발, 사이드바 정보 위계 약함, 빈 상태·로딩 처리 부재.

## 1.1 디자인 토큰 (Design Tokens)

`tailwind.config.ts`에 위키 전용 토큰을 확장하거나, `app/wiki/wiki-theme.css`로 CSS 변수를 정의한다.

### 색상 (Color)
| 토큰 | 값(예시) | 용도 |
|---|---|---|
| `--wiki-bg` | `#ffffff` | 본문 배경 |
| `--wiki-bg-subtle` | `#f7f7f5` | 사이드바·패널 배경 (Notion의 따뜻한 그레이) |
| `--wiki-text` | `#37352f` | 본문 기본 텍스트 (순흑 대신 웜 블랙) |
| `--wiki-text-muted` | `#9b9a97` | 메타·플레이스홀더 |
| `--wiki-border` | `#e9e9e7` | 구분선·테두리 |
| `--wiki-accent` | `#2383e2` | 링크·포커스·선택 |
| `--wiki-hover` | `rgba(55,53,47,0.06)` | hover 배경 (반투명 오버레이) |
| `--wiki-selected` | `rgba(35,131,226,0.10)` | 현재 페이지/선택 |

> 핵심: 순흑(`#000`)·순백 대비를 피하고 **웜 그레이 계열**로. 이것만으로 "상용 느낌"의 절반이 잡힌다.

### 타이포그래피 (Typography)
- 본문 폰트: BlockNote 기본 Inter 유지. 한글은 `Pretendard` 또는 시스템 `-apple-system` 폴백 추가 검토.
- 타입 스케일: H1 `1.875rem/700`, H2 `1.5rem/600`, H3 `1.25rem/600`, 본문 `1rem/1.6 line-height`.
- 페이지 제목: `2.5rem/800`, letter-spacing `-0.02em` (Notion 제목 톤).

### 간격·모양·그림자·모션
- 간격 스케일: 4 / 8 / 12 / 16 / 24 / 32 px (8px 그리드).
- 라운드: 카드 `8px`, 버튼·인풋 `6px`, 칩 `4px`, 모달 `12px`.
- 그림자: 1단계 `0 1px 2px rgba(0,0,0,0.04)`, 모달 `0 8px 32px rgba(0,0,0,0.12)`.
- 모션: 표준 트랜지션 `150ms ease` (hover/색상), 패널 슬라이드 `200ms cubic-bezier(0.4,0,0.2,1)`. **과한 애니메이션 금지** — 미세하게.

## 1.2 레이아웃 재설계

### 현재 → 목표
- **에디터 박스 제거**: `WikiPageView`의 `border rounded p-4 min-h-[400px]` 컨테이너를 없애고 **full-bleed** 본문으로. 좌우 여백은 `max-w-[900px] mx-auto px-12` 정도의 읽기 폭으로.
- **페이지 헤더 3단 구성** (Notion 구조):
  1. (선택) **커버 이미지** — 풀폭 배너, 높이 `200~240px`, hover 시 "커버 변경/제거"
  2. **아이콘** — 제목 위 큰 이모지(`64px`), 클릭 시 이모지 피커
  3. **제목** — placeholder "제목 없음", 본문과 시각적으로 연속 (인풋 보더 제거)
- **메타 라인**: 작성자·수정시각·태그·관련항목을 제목 아래 **한 줄 요약 + 접이식 상세**로 정리 (현재는 3개 블록으로 흩어짐).

### 상단 액션 바 재설계
현재: `🕘버전 | +하위 | 📂이동 | ⧉복제 | 삭제 | 편집` 6개 버튼 나열 → **과밀**.

목표:
- 자동 저장이므로 **`편집`/`저장`/`취소` 버튼 제거**. 우측에 **저장 상태 인디케이터**("저장됨 ✓" / "저장 중…" / "오프라인").
- 나머지는 우측 끝 **`⋯` 오버플로 메뉴** 하나로 통합:
  - 하위 페이지 추가 · 이동 · 복제 · 템플릿으로 저장 · 버전 기록 · 내보내기 · 삭제(휴지통)
- 즐겨찾기 ☆, 공유(추후), `⋯` 만 헤더에 노출.

## 1.3 BlockNote 테마 커스터마이징

`@blocknote/ariakit`는 헤드리스 → CSS 변수로 톤 통제 가능. `BlockNoteView`에 `theme`/CSS override 적용.
- 슬래시 메뉴·툴바·드래그핸들 색을 디자인 토큰에 맞춤.
- 블록 hover 시 좌측 `⋮⋮` 핸들·`+` 버튼 톤 정리.
- 플레이스홀더 텍스트("Enter 입력 또는 / 명령") 한글화·톤 정리.
- 코드블록·인용·체크리스트 스타일을 본문 타이포와 일치.

## 1.4 컴포넌트별 폴리시 체크리스트

| 컴포넌트 | 개선 항목 |
|---|---|
| **사이드바** (`WikiSidebar`) | 폭 접기 토글(≪), 상단 검색 인라인 필터, 현재 페이지 자동 펼침+스크롤, 펼침상태 localStorage 유지, hover 액션은 `⋯`로 통합, 즐겨찾기 섹션 상단 고정, 트리 들여쓰기 가이드라인(얇은 세로선), 아이콘(이모지) 표시 |
| **페이지 헤더** | 커버/아이콘/제목 3단, 메타 요약 라인, 저장 인디케이터 |
| **모달 전반** (`MovePageModal`·`ReferencePicker`·`VersionHistory`·링크피커) | 공통 `<WikiModal>` 컴포넌트로 통일 (오버레이 블러, 라운드 12px, 그림자, ESC 닫기, 포커스 트랩, 진입 트랜지션) |
| **칩/뱃지** (태그·참조·멘션) | 색/라운드/간격 토큰 통일, hover·삭제(×) 인터랙션 매끄럽게 |
| **댓글** (`CommentSection`) | 아바타(이니셜 원형), 상대시간("3분 전"), 인라인 댓글로 확장(Part 2) |
| **빈 상태** (홈·검색·트리 빈값) | 일러스트/아이콘 + 안내문 + CTA 버튼. 현재 "아직 페이지가 없습니다" 텍스트만 |
| **로딩** | 페이지 전환·검색·트리 로드에 **스켈레톤** 적용 (현재 없음 → 깜빡임) |
| **토스트** | `alert()` 전부 제거 → 우하단 토스트 컴포넌트로 교체 (저장 실패·이동·복제 결과) |

## 1.5 마이크로 인터랙션 / 접근성 / 반응형
- hover/focus/active 상태를 모든 인터랙티브 요소에 명시 (현재 일부 누락).
- 키보드: 모달 ESC·포커스 트랩, 트리 화살표 탐색(후순위), 슬래시·@ 메뉴 키보드 이미 동작.
- 포커스 링: `--wiki-accent` 기반 통일.
- 반응형: 사이드바 `w-72` 고정 → 모바일/좁은 폭에서 오버레이 드로어로 전환 (`< 768px`).
- (선택) 다크모드: 토큰을 CSS 변수로 잡아두면 추후 저비용 도입 가능. 이번엔 변수 구조만 준비.

## 1.6 Part 1 산출물
- `app/wiki/wiki-theme.css` (또는 tailwind 토큰 확장)
- 공통 컴포넌트: `<WikiModal>`, `<Toast>`, `<Skeleton>`, `<EmptyState>`, `<SaveIndicator>`, `<OverflowMenu>`, `<EmojiPicker>`
- 기존 컴포넌트 리팩터: `WikiPageView`, `WikiSidebar`, `WikiEditor`, 각 모달

---

# Part 2 — 기능 고도화

> 우선순위: **Phase A (저비용 고체감)** → **Phase B (코어)**. 각 항목에 데이터모델/API/난이도/리스크 명시.

## Phase A — Quick Wins (인프라 변경 없음)

### A1. 자동 저장 + 충돌 감지 (편집 모드 제거)  ★최우선
- **UX**: 페이지 진입 = 바로 편집 가능. 본문 변경 시 debounce 1.5초 후 자동 PUT. 헤더에 저장 상태 표시.
- **충돌 감지**: 클라이언트가 진입 시 받은 `baseUpdatedAt`을 PUT에 동봉 → 서버가 현재 `updatedAt`과 비교, 더 최신이면 `409 Conflict` 반환. 클라이언트는 "다른 곳에서 수정됨 — 새로고침/덮어쓰기" 안내.
- **데이터 모델**: 변경 없음 (`updatedAt` 활용). 선택적으로 `WikiPage.revision INT` 추가해 더 명확히.
- **권한**: VIEWER는 자동저장 비활성 (읽기 전용 렌더).
- **영향 파일**: `WikiPageView`(편집 state 제거), `WikiEditor`(onChange debounce), `api/wiki/pages/[id]/route.ts`(충돌 체크).
- **난이도**: 중 · **리스크**: 자동저장 누락/중복 호출 주의(디바운스·in-flight 가드).
- **부수효과**: A1 도입 시 기존 "하위페이지/링크 삽입 직후 강제 PUT" 임시코드(`WikiEditor.tsx:369,443`)를 자동저장 경로로 통합 정리.

### A2. 페이지 아이콘(이모지) + 커버 이미지  ★고체감
- **UX**: 제목 위 아이콘/커버. 사이드바·홈·검색·breadcrumb 전반에 아이콘 노출 → 시각적 식별성 급상승.
- **데이터 모델** (`wiki.wiki_pages` 컬럼 추가):
  ```sql
  ALTER TABLE wiki.wiki_pages ADD COLUMN icon TEXT;          -- 이모지 문자 또는 null
  ALTER TABLE wiki.wiki_pages ADD COLUMN cover_url TEXT;      -- S3 URL 또는 null
  ALTER TABLE wiki.wiki_pages ADD COLUMN cover_offset_y INT DEFAULT 50;  -- 커버 세로 위치(%)
  ```
- **API**: `PUT /api/wiki/pages/[id]`에 icon/coverUrl 필드 수용. 커버 업로드는 기존 `/api/wiki/upload` 재사용.
- **컴포넌트**: `<EmojiPicker>` (경량 — 카테고리별 이모지 그리드, 외부 패키지 `emoji-mart` 검토 vs 자체).
- **난이도**: 중 · **리스크**: 낮음.

### A3. 블록 종류 확장 — 콜아웃 · 토글 · 구분선
- 현재 BlockNote 기본 블록만 사용. **커스텀 블록 추가** (file 카드 만든 `createReactBlockSpec` 패턴 재사용).
  - **콜아웃**: 아이콘 + 배경색 박스(💡 정보/⚠️ 경고/✅ 성공). propSchema: `{ emoji, color }`, content: 'inline'.
  - **토글 리스트**: 접이식 헤더 + 자식 블록. (BlockNote 0.51 토글 지원 여부 확인 필요 — 미지원 시 커스텀.)
  - **구분선**: 기본 제공 여부 확인, 없으면 간단 커스텀.
- **데이터 모델**: 변경 없음 (contentJson 내 블록 타입). **기존 문서 호환 OK**.
- **난이도**: 중 · **리스크**: 토글의 자식 블록 중첩 저장/렌더 검증 필요.

### A4. 사이드바 상태 유지 + 접기
- **UX**: 펼침/접힘 상태를 localStorage에 저장(페이지 이동·새로고침에도 유지). 현재 페이지 경로의 부모들 자동 펼침. 사이드바 전체 폭 접기(≪) 토글.
- **데이터 모델**: 없음 (클라이언트 상태).
- **영향 파일**: `WikiSidebar`(현재 `useState(true)` per-row → 전역 expanded Set + localStorage).
- **난이도**: 하 · **리스크**: 낮음.

### A5. 상단 액션 → `⋯` 오버플로 메뉴 (Part 1.2와 연동)
- 위 1.2 참조. 기능 변화 없이 정리만. **난이도**: 하.

### A6. 페이지 목차 (TOC)
- **UX**: 본문 heading 블록을 파싱해 우측(넓은 화면) 또는 `⋯`에서 목차 패널. 클릭 시 스크롤. 현재 스크롤 위치 하이라이트.
- **데이터 모델**: 없음 (contentJson에서 런타임 추출).
- **난이도**: 중 · **리스크**: 낮음.

### A7. 홈/빈 상태/토스트/스켈레톤 (Part 1.4와 연동)
- 홈을 "최근 수정 20개"에서 → **즐겨찾기 + 최근 본 + 최근 수정 3섹션 대시보드**로.
- `alert()` → 토스트, 로딩 → 스켈레톤, 빈 상태 → CTA. **난이도**: 하~중.

## Phase B — 코어 기능

### B1. 인라인(텍스트 선택) 댓글 스레드  ★고체감
- **UX**: 본문 텍스트 드래그 → "💬 댓글" → 해당 구간에 앵커된 스레드. 우측 마진에 댓글 마커, 클릭 시 패널. 현재는 페이지 하단 flat 댓글만.
- **구현 방향**: BlockNote 0.51의 코멘트/스레드 기능 활용 가능 여부 우선 검증. 미지원/과결합 시 → **자체 앵커 방식**: 선택 텍스트에 mark(블록ID + 오프셋) 부여, 스레드는 별도 테이블.
- **데이터 모델** (`wiki` 스키마 신규):
  ```sql
  CREATE TABLE wiki.wiki_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE,
    anchor JSONB,            -- { blockId, from, to } 또는 BlockNote thread 데이터
    resolved BOOLEAN DEFAULT false,
    created_by UUID NOT NULL REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
  );
  -- 기존 wiki_comments에 thread_id 추가하여 스레드 댓글로 통합
  ALTER TABLE wiki.wiki_comments ADD COLUMN thread_id UUID REFERENCES wiki.wiki_threads(id) ON DELETE CASCADE;
  ```
- **난이도**: 상 · **리스크**: 본문 편집 시 앵커 위치 보존(텍스트 삽입/삭제로 오프셋 깨짐) — 해결 전략 필요.

### B2. 백링크 (Backlinks)  ★고체감
- **UX**: 페이지 하단/패널에 "이 페이지를 링크/멘션한 페이지" 목록. 양방향 탐색.
- **구현**: 페이지 저장 시 contentJson에서 `wikiPageLink` 블록·페이지 멘션을 파싱해 링크 인덱스 갱신. plainText 추출 로직(`lib/wiki/blockText.ts`) 옆에 링크 추출 추가.
- **데이터 모델**:
  ```sql
  CREATE TABLE wiki.wiki_page_links (
    source_page_id UUID NOT NULL REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE,
    target_page_id UUID NOT NULL REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE,
    PRIMARY KEY (source_page_id, target_page_id)
  );
  CREATE INDEX ON wiki.wiki_page_links (target_page_id);  -- 역참조 조회
  ```
- **난이도**: 중 · **리스크**: 저장 시 인덱스 동기화 누락 주의.

### B3. 템플릿 시스템
- **UX**: 페이지를 "템플릿으로 저장" → 새 페이지 작성 시 템플릿 갤러리에서 선택. 사내 표준(회의록·장애보고·병원 인수인계 등) 일관성 확보.
- **데이터 모델**: `ALTER TABLE wiki.wiki_pages ADD COLUMN is_template BOOLEAN DEFAULT false;` (트리에서 숨기고 갤러리에만 노출). 복제 로직(`duplicate`) 재사용.
- **난이도**: 중 · **리스크**: 낮음.

### B4. 휴지통 (Soft Delete) + 복구
- **UX**: 삭제 → 즉시 영구삭제(현재 hard delete)가 아니라 휴지통으로. 30일 후 정리(선택). 복구 가능.
- **데이터 모델**:
  ```sql
  ALTER TABLE wiki.wiki_pages ADD COLUMN deleted_at TIMESTAMPTZ;
  CREATE INDEX ON wiki.wiki_pages (deleted_at);
  ```
  모든 목록/트리/검색 쿼리에 `deleted_at IS NULL` 필터 추가 필요.
- **난이도**: 중 · **리스크**: **누락 위험** — 트리·검색·홈·breadcrumb·move·duplicate 전 경로에 필터 일괄 적용해야 함. 하위 페이지 동반 삭제/복구 정책 결정 필요.

### B5. 검색 고도화 (전문검색 + 필터)
- **UX**: 관련도 정렬, 작성자/기간/태그 필터, 더 나은 snippet.
- **구현**: 현재 `plainText ILIKE`. PostgreSQL 전문검색으로 전환.
  - ⚠️ **한글 토큰화 이슈**: pg 기본 `to_tsvector('simple'/'english')`는 한글 형태소 분리 안 됨. → **`pg_bigm` 또는 `pg_trgm`(trigram) 인덱스**로 부분일치 가속이 현실적. 또는 ILIKE 유지 + GIN trigram 인덱스.
  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX wiki_pages_plaintext_trgm ON wiki.wiki_pages USING gin (plain_text gin_trgm_ops);
  CREATE INDEX wiki_pages_title_trgm ON wiki.wiki_pages USING gin (title gin_trgm_ops);
  ```
- **데이터 모델**: 인덱스 추가 (extension 설치는 PROD 권한 필요 — 별도 허락).
- **난이도**: 중 · **리스크**: extension 권한, 한글 검색 품질 검증.

### B6. 다단 컬럼 블록
- `@blocknote/xl-multi-column` 패키지 추가로 좌우 분할 레이아웃.
- **데이터 모델**: 없음. **난이도**: 하~중 · **리스크**: 번들 크기·기존 문서 호환 확인.

### B7. 사용자 @멘션 + 알림
- **UX**: `@`로 병원/프로젝트뿐 아니라 **사람** 멘션. 멘션 시 대상에게 알림(헤더 벨 아이콘).
- **구현**: mention 스펙에 `user` 타입 추가. `/api/wiki/mention` 검색에 users 포함. 알림 테이블 신설.
- **데이터 모델**:
  ```sql
  CREATE TABLE wiki.wiki_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    page_id UUID REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE,
    type TEXT NOT NULL,        -- 'mention' | 'comment' | 'reply'
    actor_id UUID REFERENCES public.users(id),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX ON wiki.wiki_notifications (user_id, read_at, created_at DESC);
  ```
- **난이도**: 상 · **리스크**: 알림 UI는 위키 레이아웃에 한정(전역 알림 인프라 없음). 단방향 의존성 유지 주의.

---

# Part 3 — 데이터 모델 변경 종합

> 모든 변경은 `wiki` 스키마 한정. `prisma migrate dev` 금지 — 수동 SQL + `migrate resolve --applied` (CLAUDE.md 규칙 1).

| 마이그레이션 | 대상 | 항목 |
|---|---|---|
| M1 | `wiki_pages` | `icon`, `cover_url`, `cover_offset_y` 컬럼 (A2) |
| M2 | `wiki_pages` | `is_template` (B3), `deleted_at` (B4), (선택) `revision` (A1) |
| M3 | 신규 `wiki_page_links` | 백링크 인덱스 (B2) |
| M4 | 신규 `wiki_threads` + `wiki_comments.thread_id` | 인라인 댓글 (B1) |
| M5 | 인덱스/extension | `pg_trgm` + GIN 인덱스 (B5) |
| M6 | 신규 `wiki_notifications` | 멘션/댓글 알림 (B7) |

각 마이그레이션은 해당 Phase 진행 시점에 개별 생성. `prisma/schema.prisma`도 동일하게 수동 갱신 후 `prisma generate`.

---

# Part 4 — 실행 로드맵

> 기존 스케줄(Phase 0~8) 이후로 번호 이어감. 각 Phase는 이전 게이트 통과 후 진행. 빌드/PM2/git push/PROD는 **사용자 명시 요청 시에만**.

### Phase 9 — 디자인 시스템 기반 (Part 1.1~1.3)
디자인 토큰, BlockNote 테마, full-bleed 레이아웃, 공통 컴포넌트(`WikiModal`/`Toast`/`Skeleton`/`EmptyState`). **기능 변화 없이 룩앤필만** 먼저 통일.
- 게이트: 기존 기능 회귀 없음 + 사용자가 DEV에서 "확실히 매끄러워졌다" 확인.

### Phase 10 — 편집 경험 + 핵심 시각 요소 (A1·A2·A5·A4)
자동저장+충돌감지, 아이콘/커버, 오버플로 메뉴, 사이드바 상태유지.
- 게이트: 자동저장 무손실 동작, 충돌 감지 시 안전.

### Phase 11 — 블록·탐색 확장 (A3·A6·A7·B6)
콜아웃/토글/구분선, 목차, 홈 대시보드, 다단 컬럼.

### Phase 12 — 협업·지식그래프 (B1·B2·B3)
인라인 댓글, 백링크, 템플릿.

### Phase 13 — 운영 완성도 (B4·B5·B7)
휴지통, 검색 고도화, 멘션·알림.

### 진행 현황 (2026-06-16, dev2 적용)
- [x] **Phase 9** — 디자인 시스템 기반 (토큰/공통컴포넌트/full-bleed)
- [x] **Phase 10** — 자동저장+충돌감지(A1), 아이콘/커버(A2), 오버플로(A5), 사이드바 상태유지(A4)
- [x] **Phase 11** — 콜아웃·구분선(A3 일부), 목차(A6), 홈 대시보드(A7), **멀티컬럼(B6)**
- [x] **Phase 12** — 백링크(B2), 템플릿(B3)
- [x] **Phase 13** — 휴지통(B4), 검색 작성자·기간 필터+trgm(B5), 댓글 알림+벨(B7 일부)
- [ ] **Phase 14** — PROD 반영 (사용자 명시 요청 대기)

**개발 목록에서 제외 (진행 안 함)**: 토글 리스트, 인라인 텍스트선택 댓글, 사용자 @멘션 알림. 기존 페이지 댓글·병원/프로젝트 멘션은 정상 유지.

### Phase 14 — PROD 반영
`wiki_dev_schedule.md` Phase 8 절차 준용. 마이그레이션·extension·빌드·smoke test. **별도 명시 허락 필수.**

> 우선순위 조정 가능: "UI 완성도"가 최우선이므로 **Phase 9~10을 먼저 완료해 체감 개선을 확보**한 뒤 11~13은 사용 빈도 보고 선별 진행 권장.

---

# Part 5 — 결정 필요 포인트 (착수 전 확인)

1. **이모지 피커**: 외부 패키지(`emoji-mart`, ~수십KB) vs 자체 경량 구현 — 번들/유지보수 트레이드오프.
2. **인라인 댓글(B1) 구현 경로**: BlockNote 네이티브 스레드 기능 채택 vs 자체 앵커 구현 — POC 후 결정.
3. **한글 검색(B5)**: `pg_trgm` 트라이그램으로 충분한지, 아니면 ILIKE 유지 + 인덱스만 — 실제 데이터로 품질 검증 후.
4. **휴지통(B4) 하위 페이지 정책**: 부모 삭제 시 자식 동반 휴지통 이동 여부, 복구 시 부모 없으면 루트로 승격 여부.
5. **다크모드**: 이번 사이클 토큰 구조만 준비하고 실제 테마는 보류? 아니면 포함?
6. **폰트**: 한글 본문에 `Pretendard` 도입 여부(웹폰트 로딩 비용 vs 가독성).

---

# 부록 — Parked (보류 항목)

### Parked-1. 데이터베이스 뷰 (C2, 향후 재검토)
표/보드/캘린더로 페이지 묶음을 보는 Notion DB. 이번 사이클 제외. 재도입 시: `wiki_databases`, `wiki_db_rows`(= 페이지에 properties JSONB), 뷰 정의 테이블 신설 + 뷰 렌더러 필요. 귀사 도메인(병원/프로젝트)은 이미 정식 모듈이 있어 역할 중복 가능성 — 재검토 시 "위키 안에서만 필요한 경량 표 사례"를 먼저 수집.

### Parked-2. 실시간 공동 편집 (C1)
Yjs + WebSocket 서버 필요(PM2 단일 구성에 WS 추가). 동시 편집 빈도 낮아 제외. 대신 A1 충돌 감지로 데이터 보호.

### Parked-3. 페이지 단위 권한/공유, PDF·MD 내보내기
권한: 현재 전역 역할로 충분 판단. 내보내기: `@blocknote/server-util` 이미 설치되어 추후 저비용 도입 가능.
