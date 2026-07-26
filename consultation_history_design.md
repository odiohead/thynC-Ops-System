# 상담이력 저장 재설계 (Consultation History)

> 작성: 2026-07-25 · 구현 완료: 2026-07-26 (dev2) · 상태: **DEV 반영 완료 / PROD 미반영**
> 관련: `ai_assistant_v3_design.md`(2축 원리), `function_ai_assistant.html`(v2 §6.3 병원 노트)

---

## 1. 배경 — 현재 무엇이 잘못되어 있나

### 1.1 이력
| 시점 | 저장 방식 | 상태 |
|---|---|---|
| v1 (`03752f0`) | `POST /api/ai-assistant/consultation` → `consultation_queue` 테이블 (`status='PENDING'` 대기열) | 라우트 제거됨. 대기열을 지식화하는 후속 코드는 **저장소에 존재한 적 없음** |
| v1 챗봇 | Flowise 프록시 (`FLOWISE_API_HOST`) — 벡터DB는 Flowise 쪽 | v2에서 전면 제거 (현 저장소 벡터/임베딩 코드 0건) |
| v2 (`c0a4e6c`, 07-18) | 위키 '병원 노트' 페이지에 마크다운 append | **현재 방식** |

### 1.2 현재 방식의 결함 4가지

**(가) 검색 사각지대 — v3 2축 원리 위반**
v3는 축1 고정형(위키 = 제품 사양·매뉴얼)과 축2 운영(DB = 이벤트 이력)을 나누고 검색 전략까지 분리했다. 상담이력은 성격상 **축2**인데 축1에 저장되어 있다. 그 결과:
- `search_operation_history`의 소스 5종(maintenances / maintenance_logs / site_visits / etc_tasks / ticket_logs)에 없음
- `search_wiki`는 `wiki.wiki_chunks`만 조회하는데, hospital-notes append 라우트가 `rebuildPageChunks`를 호출하지 않아 **append분은 영구 미색인**

→ 병원을 특정해 `read_hospital_note`를 부를 때만 읽힌다. "이런 증상 상담한 적 있나" 같은 횡단 검색은 불가능.

**(나) 데이터 유실 경로**
협업 편집의 진실의 원천은 `wiki_page_ydoc`(Y.Doc)인데 append는 `content_json`을 직접 갱신한다. 병원 상세에 `HospitalNotePanel`이 임베드되어 있어 노트가 열려 있을 수 있고, 그 동안의 append는 **다음 협업 저장에 덮여 사라진다**. 라우트 헤더 주석에 이미 알려진 리스크로 명시되어 있다.

**(다) 구조 부재**
작성자·시각·상담유형이 `## 2026-07-25 상담 (홍길동) — 기술문의` 헤딩 **문자열**로만 존재한다. 유형별 집계·기간 필터·담당자별 건수·원 대화 추적이 전부 불가능하다. 문서유형(`documentType`)은 폼에서 사라져 아무데도 저장되지 않는다.

**(라) 역할 혼선**
'병원 노트'가 사람이 쓰는 자유 메모이면서 동시에 시스템이 기록을 쌓는 원장이다. 두 성격이 한 페이지에 겹쳐 있어 어느 쪽으로도 신뢰할 수 없다.

### 1.3 코드베이스 자체의 선례
`MaintenanceLog`(유지보수 처리 기록)가 정확히 같은 형상이다 — 1:N 타임라인, 작성자·시각 자동 기록, 폼과 독립 저장, 수정·삭제 권한 분리. 그리고 **"구 비고 자유텍스트 → 구조화 타임라인" 이관이 개선이었다고 DEV_HISTORY(2026-07-18)에 기록**되어 있다. 상담이력의 위키 append는 그 반대 방향이다.

---

## 2. 설계 원칙

1. **상담이력의 원본은 DB** — 문서가 아니라 이벤트 기록이다
2. **위키 병원 노트는 사람이 쓰는 자유 메모로 되돌린다** — 시스템 자동 append 중단, 역할 분리
3. **축2에 편입한다** — `search_operation_history` 소스에 추가하면 `find_similar_cases`까지 자동으로 따라온다
4. **선례를 따른다** — 데이터 모델·권한은 `MaintenanceLog`, ID 보관 방식은 `AiUsageLog`

---

## 3. 데이터 모델

### 3.1 신규 테이블 `consultations` (public 스키마)

`consultation_queue`는 컬럼 의미(`status` 대기열 개념)와 이름이 현 요구와 맞지 않으므로 **동결 보존**하고 새로 만든다. 폐기 테이블 동결은 이 코드베이스의 확립된 선례다(`tasks` 561건 동결, `consultation_queue` 자체도 v2에서 동결).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | Int PK autoincrement | |
| `consultationCode` | String UNIQUE | `CS-YYYYMM-NNNN` 자동 발번 (도메인 코드 관례) |
| `hospitalCode` | String? → Hospital (SetNull) | 병원 미지정 상담 허용 (§7 D4) |
| `consultationTypeId` | Int? → StatusCode(CONSULTATION_TYPE) | |
| `documentTypeId` | Int? → StatusCode(DOCUMENT_TYPE) | 컬럼만 유지, UI 부활은 범위 밖 |
| `title` | String | 첫 줄 60자 자동 추출 (목록 표시용) |
| `content` | Text | **최종 저장 본문**(마크다운) — 현 `conclusion` textarea 값 |
| `aiSummary` | Text? | AI 정제 원문 — 사람이 손댔을 때 비교용 |
| `sessionId` | String? | `AiChatSession` id. **FK 없이 ID만 보관** — 대화를 삭제해도 상담이력은 남는다(`AiUsageLog` 선례) |
| `consultedById` | String → User (Restrict) | 상담자 |
| `consultedByName` | String | 스냅샷 — 계정 삭제 후에도 목록 표시(`AiUsageLog` 선례) |
| `consultedAt` | Date | 상담일 (기본 오늘, 소급 입력 허용) |
| `createdAt` / `updatedAt` | DateTime | |

인덱스: `(hospital_code, consulted_at DESC)` · `(consulted_by_id, consulted_at DESC)` · `(consulted_at DESC)`
전문 검색용: `content` trigram GIN (§5 축2 편입 시 순차 스캔이지만 병원 노트와 달리 계속 쌓이므로 선제 부여)

`chatHistory` 스냅샷은 두지 않는다 — 원 대화는 `sessionId`로 추적하고, 정제 결과가 본문이다. 세션이 삭제되면 링크만 끊긴다(본문은 보존).

### 3.2 마이그레이션
CLAUDE.md 규칙 1에 따라 `migrate dev` 미사용. SQL 직접 실행 → 마이그레이션 파일 수동 생성 → `migrate resolve --applied` → `schema.prisma` 수동 갱신 → `prisma generate`.

---

## 4. API

| Method | Endpoint | 권한 |
|---|---|---|
| `GET` | `/api/consultations?hospitalCode=&from=&to=&consultedById=&q=&page=&pageSize=` | §7 D3 |
| `POST` | `/api/consultations` | AI 어시스턴트 접근 권한자 (`checkAiAccess` 재사용) |
| `GET/PUT/DELETE` | `/api/consultations/[id]` | 조회 §7 D3 · 수정/삭제 = 본인 or ADMIN (`MaintenanceLog` 선례) |

- 감사 로그 `resource='consultation'`으로 CREATE/UPDATE/DELETE 기록
- 코드 발번은 동시성 대비 P2002 재시도 (`InventoryTransaction` 선례)

---

## 5. AI 어시스턴트 통합

**축2 편입** — `lib/ai/opsSearch.ts`의 `OPS_SOURCE`에 갈래 추가:
```
SELECT 'CONSULTATION', c.consultation_code, ('/hospitals/' || c.hospital_code || '#consultations'),
       c.hospital_code, h.hospital_name, c.consulted_at::date, c.title, c.content
  FROM consultations c LEFT JOIN hospitals h ON h.hospital_code = c.hospital_code
```
이것만으로 `search_operation_history`(workType enum에 `CONSULTATION` 추가)와 `find_similar_cases`에 동시 편입된다. 출처 링크(v3 G1) 규격도 자동 충족.

**신규 도구 `read_consultations`** (도구 15종 → 16종)
- 입력: `hospitalCode`(필수), `limit`(기본 5·최대 20)
- 반환: 최근순 상담이력 — 일자·유형·상담자·본문·`link`
- `read_hospital_note`는 **존치** — 이제 사람이 쓴 병원 메모만 담기며, 성격이 다르므로 도구도 분리한다

**시스템 프롬프트**: 상담 응대 시 `read_consultations`(해당 병원 과거 상담) → `find_similar_cases`(유사 장애) 순으로 참조하도록 안내 문구 추가.

---

## 6. UI

### 6.1 AI 어시스턴트 (`/ai-assistant`)
- 우측 '상담 정리' 패널 버튼: `📋 병원 노트에 추가` → **`💾 상담이력 저장`**
- 저장 대상 안내 문구 교체, 저장 후 "상담이력에 저장되었습니다 · 병원 상세에서 확인" 토스트
- 병원 미지정 시 동작은 §7 D4 결정에 따름
- `sessionId`를 함께 전송해 원 대화와 연결

### 6.2 병원 상세 (`/hospitals/[code]`)
- **`ConsultationsCard` 신규** — `MaintenancesCard`와 동일한 카드/테이블 패턴, `InventoryUsageCard` 바로 아래(병원 노트 위)에 배치
- 컬럼: 상담일 | 상담유형 | 상담자 | 제목 | (본문 발췌)
- 행 클릭 → 모달로 본문 전체(마크다운 렌더) + 수정/삭제(권한자) + 원 대화 링크(세션 살아 있으면)
- 앵커 `#consultations` — AI 출처 링크 대상

### 6.3 위키 병원 노트
- `HospitalNotePanel` 임베드는 **그대로 유지**, 카드 설명만 "상담이력·특이사항 축적" → "병원 특이사항 메모"로 수정
- 자동 append 중단 여부는 §7 D1

---

## 7. 결정 사항 (2026-07-25 사용자 확정)

| # | 쟁점 | **확정** | 근거 |
|---|---|---|---|
| **D1** | 위키 병원 노트 자동 append | **중단** — 라우트 append 분기 제거 | 이중 기록은 (나) 유실 리스크와 내용 불일치를 그대로 안고 감. 노트는 '사람이 쓰는 병원 메모'로 역할 복귀 |
| **D2** | 테이블 | **새 `consultations` 신설** + `consultation_queue` 동결 보존 | 선례 일치(`tasks` 동결), 스키마가 깨끗함 |
| **D3** | 조회 권한 | **SEERS 소속만** | 원본이 SEERS 전용 어시스턴트 산출물. 대웅 소속 계정에는 카드 자체를 노출하지 않음 |
| **D4** | 병원 미지정 상담 | **병원 필수** (현행 유지) | 병원 상세가 유일한 열람 지점이므로 미지정 건은 갈 곳이 없음 |
| **D5** | 전용 목록 페이지 `/consultations` | **안 만듦** — 병원 상세 카드만 | 지금은 횡단 조회 수요 불명. 필요해지면 별건 |

### D3 세부 — 역할별 적용
| 동작 | 조건 |
|---|---|
| 조회 (목록·상세·카드 노출) | SEERS 소속 + 활성 계정 (VIEWER 포함 — VIEWER는 읽기 전용 역할이므로 조회는 허용) |
| 생성 | `checkAiAccess` 재사용 (SEERS + USER 이상) — 어시스턴트가 유일한 생성 경로 |
| 수정·삭제 | 위 조회 조건 + (본인 or ADMIN 이상) — `MaintenanceLog` 선례 |

---

## 8. 기존 데이터 이관

DEV 병원 노트 3건은 전부 테스트 데이터(본문 3자·0자)로 이관 대상 없음. **PROD 축적량 미확인**(dev2에서 SSH 불가).
- PROD도 비어 있으면 → 이관 불필요
- 실데이터가 있으면 → `## YYYY-MM-DD 상담 (이름) — 유형` 헤딩 파싱 스크립트 1건 추가 (`scripts/migrate-hospital-note-consultations.mts`)

---

## 9. 범위 밖 (별건)

- **위키 청크 인덱스 갱신 누락** — 협업 서버 `store()`와 hospital-notes append가 `rebuildPageChunks`를 호출하지 않아, 백필 이후 편집된 위키 본문이 AI 검색에서 정지 상태. 상담이력과 무관한 위키 전체 문제이므로 별도 티켓으로 처리한다. (D1 ①을 택하면 append 쪽 경로는 자연 소멸)
- 문서유형 UI 부활 (컬럼만 유지)
- 상담 통계·대시보드

---

## 10. 작업 결과 (2026-07-26 완료)

| # | 항목 | 결과 |
|---|---|---|
| 1 | 마이그레이션 `20260726090000_add_consultations` + 스키마 + generate | 완료 (drift 0) |
| 2 | `/api/consultations` (GET/POST) · `/api/consultations/[id]` (GET/PUT/DELETE) + 감사 로그 `resource='consultation'` | 완료 |
| 3 | AI 어시스턴트 패널 저장 경로 교체 (`💾 상담이력 저장`) | 완료 |
| 4 | `ConsultationsCard` + 상세/수정/삭제 모달 | 완료 |
| 5 | `opsSearch` 축2 편입 + `read_consultations`(도구 16종) + 시스템 프롬프트 | 완료 |
| 6 | 위키 append 폐지 (D1) | 완료 |
| 7 | 병원 업무 일괄 이전에 `consultations` 포함 | 완료 |

### 검증 결과
- `tsc --noEmit` 0오류 · `next lint` 0경고 · 빌드 성공 (`/api/consultations` 라우트 생성 확인)
- **E2E 18항목 전부 통과**: 저장(201·`CS-202607-0001` 발번·제목 자동추출·상담자 스냅샷·세션ID) → 목록 → 수정(제목 재추출) → 삭제, 축2 검색 도달(`work_type=CONSULTATION`), `read_consultations` 출처 link 규격, 위키 append 무시 확인
- **권한(D3)**: 대웅 소속 403(목록·상세) / SEERS VIEWER 조회 200·생성 403 / SEERS ADMIN 전권
- **라이브 에이전트 실동작**(`ai-agent-smoke.mts`, opus-5·effort medium):
  - "한라성심의원 과거 상담이력 알려줘" → `search_hospitals` + **`read_consultations`** 2회 호출, 2건 정확 요약
  - "산소포화도 센서 페어링 문의 유사 상담 있어?" → `find_similar_cases` + **`search_operation_history`**, 상담이력 검출 + 출처 링크 `[상담이력 보기](/hospitals/HOSP-038821#consultations)` 생성
  - 캐시 적중률 74.3% · 건당 평균 $0.0574
- 테스트 데이터(상담 3건·위키 노트 1건) 전량 삭제 확인 — `consultations` 0행, 병원 노트 원래 3건 유지

### PROD 반영 시 필요 작업
1. `git pull` 후 `npx prisma migrate deploy` — `consultations` 테이블 생성 (순수 추가 DDL, 롤백은 DROP)
2. `npx prisma generate` + 힙 4GB 빌드 + `pm2 restart thync-prod`
3. **§8 이관 판단**: PROD 병원 노트에 실제 상담이력이 쌓여 있는지 확인 후 이관 스크립트 필요 여부 결정
4. 신규 패키지·시드·환경변수 변경 **없음**
