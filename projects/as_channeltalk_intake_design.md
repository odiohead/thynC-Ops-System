# AS접수 인입 소스 전환 — 구글시트 → 채널톡 상담 원문 (as-channeltalk-intake) — 설계안

> **상태: P1~P3 구현 완료 (dev2 2026-10-27, 빌드·재시작·Playwright 실화면 검증) — P4 PROD 그림자(dry)·P5 전환 대기** — 방법론·결정 사항은 사용자와 대화로 확정(§9), D1~D4는 권장안 채택(§13). 리플레이 보고 `as_intake_replay_report_20261027.md`. 폴링 주기 1분(전환 시).
> 상위: `as_work_design.md`(AS업무 도메인), `voc_channeltalk_intake_design.md`(채널톡 원천 적재), `voc_channeltalk_promotion_design.md`(VOC 승격) · 대체 대상: `channeltalk_as_intake_design.md`(시트 폴링)
>
> **목적: 구글시트('thynC VOC 현황 > A/S')를 AS 업무에서 제거한다.** AS접수 레코드의 생성 소스를 시트 행이 아니라 **이미 적재 중인 채널톡 상담 원문(`channeltalk_user_chats`·`channeltalk_messages`)** 으로 바꾸고, ALF가 하던 "대화 → 구조화" 정제를 시스템이 직접 수행한다.

---

## 1. 배경 — 실측으로 확인한 현황 (dev2, PROD 10/20 동기화분 + dev2 채널톡 폴링분)

### 1.1 두 경로의 병존
| 경로 | 모듈 | 소스 | 주기 | 산출 |
|---|---|---|---|---|
| AS 시트 폴링 | `lib/channeltalkAsSync.ts` | 시트 A~T열 (ALF 태스크가 행 추가, 특이 케이스는 상담사 수기) | 1분 | `as_receipts` + 시트 AI~AL 되쓰기, 역기입 ②~⑤ |
| 채널톡 원천 적재 → VOC 승격 | `lib/channeltalk/vocSync.ts` · `vocPromote.ts` | Open API 상담·메시지 전량 | 5분 (PROD) | `channeltalk_*` 4테이블, 분류 태그 시 `voc_receipts` |

- `as_receipts`에는 **source 컬럼·상담 연결 키가 없다.** 출처는 note 태그(`[채널톡 rN]`)로만 추정. 멱등 키가 시트 행번호라 행 밀림(9/19)·동명 병원(10/14) 등 운영 사고가 반복됨.
- `voc_receipts.content`에는 고객 초기 발화 ≤5건 + 데스크 링크만 있다. **구조화 데이터는 없다** → 소스는 VOC 레코드가 아니라 상담 원문이어야 한다(사용자 확정).

### 1.2 구조화 정보가 있는 곳
- **ALF 봇 확정 확인문** (`channeltalk_messages.person_type='bot'`, personId `FRONTALF-…`). LLM 생성 텍스트라 문장은 흔들리지만 **필드 라벨은 안정적**:
  ```
  병원 : 광주한국병원 / 병동 : 4병동 / 기기종류 : 산소포화도기 7대
  시리얼번호 : P013499, P013492, …
  접수사유 : - P013499 / 노후로 인한 파손 …
  발송지 정보 : … / 받으실 분 : … / 연락처 : … / 수리품 발송지는 회수지와 동일합니다.
  위 내용으로 A/S 접수를 진행할까요?
  ```
  고객 "네" → 봇 "AS 접수가 완료되었습니다" → ALF 태스크가 시트 행 기록 → **`f_AS_고장접수`/`f_AS_분실접수` 태그 자동 부착**(사용자 확인). "내용 수정" 흐름이 있으면 확인문이 여러 번 나오며 **마지막 확정본**이 유효.
- 메시지 raw에 구조화 payload 없음(블록 텍스트뿐). Open API에 ALF 태스크 결과 엔드포인트 없음. 목록 API에 태그 필터 없음(원천 적재는 전량 유지, 판정 단계에서 태그로 거른다).

### 1.3 수치 (9/29~10/20)
| 항목 | 값 |
|---|---|
| 시트 경로 AS접수 | 331건 (시트 컷오버 8/26 이후 누적 659건) |
| ALF 완료 상담('접수가 완료되었습니다') | 302건 — 라벨(`시리얼번호`+`접수사유`) 보유 284(94%), `발송지 정보` 288(95%), AS 태그 292, VOC 연결 298, 병원 힌트 없음 56, 파일 첨부 74 |
| 시트 접수의 시리얼 전부가 ±3일 내 한 메시지에 존재 | 293/331 (89%) |
| 첫 시리얼이 4~14일 차이로 존재 / 메시지에 전혀 없음 | 16 / 5 (hwp·사진 첨부 대량 접수, 대웅 경유, 상담사 수기 행) |
| note에 `접수담당:`(시트 K열 = 사람 개입) | 67/331 |

→ 약 90%는 ALF 확인문 규칙 파싱으로 자동화 가능, 나머지 ~10%는 사람 확정 경로가 필요하다.

---

## 2. 목표·범위

- **소스 전환**: 태그가 걸린 상담 1건 → AS접수 ≤1건. 멱등 키 = `chat_id`.
- **정제 3계층**: L1 규칙 파서(ALF 확인문) → 실패 시 **등록대기 큐**(L3, 사람 확정) → 큐 상세에서 선택적 **[Claude 도움요청]**(L2, 빈칸 채움만, 자동 등록 없음).
- **양방향 변경 대응**: 접수 생성 후 채널톡 변경은 **감지·표시**, 반영은 사람이 [반영].
- **시트**: 인입은 끊고(연결 전용 모드), 역기입 ②~⑤는 유지. 시트에 행이 없으면 오류 없이 로그만.
- **VOC 복수 태그**: VOC 분류 N개 보관 + 태그 변경 재동기화(대표 분류 = 첫 태그 유지).
- 범위 밖: 채널톡으로의 쓰기(메시지 발송), 기존 접수 소급 연결(백필 없음 — 기존 데이터는 리플레이 테스트 용도로만), ALF 자체 변경.

---

## 3. 데이터 모델

### 3.1 `as_receipts` 추가 컬럼
| 컬럼 | 타입 | 의미 |
|---|---|---|
| `source` | VARCHAR(16) NOT NULL DEFAULT 'MANUAL' | `MANUAL` 화면 / `SHEET` 시트 폴링 / `CHANNELTALK` 상담 자동 / `INTAKE_QUEUE` 등록대기 수동 확정 / `IMPORT` 마이그. 기존 행은 note 태그로 1회 백필(`[채널톡 r`→SHEET, `마스터 AS이력`·`메디인 AS이력`→IMPORT) |
| `voc_id` | INT NULL FK `voc_receipts` SetNull | 마스터 VOC (상담이 VOC에 연결돼 있으면 자동) |

### 3.2 신규 `as_intake_links` — 상담 ↔ AS접수 연결·등록대기 큐 (public)
| 컬럼 | 의미 |
|---|---|
| `id` | PK |
| `chat_id` VARCHAR(40) **UNIQUE** FK `channeltalk_user_chats` Cascade | 멱등 키 |
| `receipt_id` INT NULL FK `as_receipts` SetNull | 연결된 접수 (LINKED 시) |
| `state` VARCHAR(16) | `PENDING` 등록대기 / `LINKED` 연결됨 / `IGNORED` AS 아님 / `SUPERSEDED` 재태깅 등으로 대체 |
| `fail_class` VARCHAR(24) NULL | 자동 실패 분류: `NO_CONFIRM`(확인문 없음 — L2 필요) / `PARSE_INCOMPLETE`(라벨 일부 결손) / `HOSPITAL_UNMATCHED` / `NO_SERIAL` / `BAD_SERIAL` / `QTY_MISMATCH` / `TX_ABORT`(기기 동시 변경 재시도 소진) / `ALREADY_EXISTS`(동일 병원·접수일·시리얼 접수 존재 → 연결 제안) |
| `fail_note` TEXT NULL | 사유 상세(후보 병원 등) |
| `extracted` JSONB | 추출 결과 (§4.3 스키마) — 큐 상세 프리필 원천 |
| `extract_layer` VARCHAR(8) | `L1` / `L2` / `NONE` |
| `source_message_ids` TEXT[] | 근거 메시지(확정 확인문 등) |
| `seen_message_id` VARCHAR(40) NULL | 마지막으로 추출에 사용한 메시지 id — 변경 감지 기준 |
| `change_detected_at` TIMESTAMPTZ NULL · `change_diff` JSONB NULL | 접수 생성 후 채널톡 변경 감지 (§6) |
| `ai_requested_at` / `ai_requested_by_id` | [Claude 도움요청] 이력 |
| `decided_by_id` / `decided_at` | 큐에서 등록·제외한 사용자 |
| `created_at` / `updated_at` | |

인덱스: `(state)`, `(receipt_id)`. 상담 삭제는 없음(원천 적재 upsert).

### 3.3 VOC 복수 분류 — 신규 `voc_receipt_types` (public)
`voc_id` FK Cascade · `voc_type_id` FK `status_codes` · `tag` (원 태그명) · `created_at`, UNIQUE(voc_id, voc_type_id). `voc_receipts.voc_type_id`는 **대표 분류**(첫 분류 태그)로 유지 — 목록·필터·티켓 CTI 규칙은 대표 분류 기준.

### 3.4 시트 되쓰기 컬럼
기존 `as_receipts.sheet_done_synced` 유지. 추가 없음.

---

## 4. 인입 모듈 `lib/channeltalk/asIntake.ts`

### 4.1 위치·주기
- `vocSync` 틱 후처리(`promoteChanneltalkVocs` 직후)에 `intakeAsFromChats(changedChatIds)` 호출. 별도 스케줄러 없음.
- 후보 = 변경 상담 ∪ DB상 미처리 대상(태그 있음 ∧ `as_intake_links` 없음) — VOC 승격과 같은 누락 방지 패턴.
- ALF가 시트 기록 직후 자동 태깅하므로 지연 = 폴링 주기. 설정 `channeltalk_voc_interval`을 **1m**으로 내리는 것을 전환 시 권장(API 예산 실측상 여유 — 틱당 상한 200회, 레이트리밋 1,000회).
- ON/OFF: AppSetting `channeltalk_as_intake` (`on`/`off`, 기본 off) + `channeltalk_as_intake_cutover`(KST 일자 — 이 일자 이후 고객 첫 발화 상담만. **컷오버 없이 ON 저장 거부** — VOC 소급 생성 사건 재발 방지).
- 봇 계정: 기존 `channeltalk-bot@seersthync.com`.

### 4.2 판정 (`evaluateChatForAs`)
대상 조건(전부 결정적):
1. `tags`에 `f_AS_고장접수` 또는 `f_AS_분실접수` 포함 (다른 태그 공존 무관. `f_AS_소모품-부속품`·`f_AS_진행상황문의`는 제외)
2. `as_intake_links`에 행 없음(있으면 §6 변경 감지 경로)
3. `firstUserMessageAt ≥ cutover`
4. 수동 제외(`IGNORED`) 아님
구분: `f_AS_분실접수`만 있으면 LOST, 고장 태그가 있으면 FAULT(둘 다면 FAULT — 확인문의 분실 라벨이 있으면 LOST 우선).

### 4.3 L1 추출 (`parseAlfConfirmation`) — 추출 결과 스키마
```ts
interface AsExtract {
  hospitalNameRaw: string | null      // '병원 :'
  hospitalCode: string | null         // OpsCode 정확 일치 → 병원명 매처(loadHospitalMatcher, 2계층 풀)
  hospitalMatchSource: 'opscode'|'name'|'none'
  wardName: string | null             // '병동 :'
  category: 'FAULT'|'LOST'
  deviceKindText: string | null       // '기기종류 :' (참고)
  serials: string[]                   // '시리얼번호 :' — parseSerialTextarea, 괄호 제거, 대문자
  lines: { serial, symptom, ward }[]  // '접수사유 :' — 기존 parseSymptoms 재사용 ('SERIAL / 병동 / 증상')
  destInfo: string | null             // '발송지 정보 :' + '받으실 분 :' + '연락처 :' → ' / ' 결합
  pickupDestInfo: string | null       // '회수지' 구획 — 기존 parseDestCell 규칙 재사용
  pickupDestDiffers: boolean          // "수리품 발송지는 회수지와 동일" 문구면 false
  preReplace: boolean                 // '선교체' 언급
  reporterName: string | null         // 상담 name(채널톡 고객명 '병원/병동/이름') → 시트 J열과 동일 원천
  receiptDate: Date                   // ALF 완료 메시지 시각(KST 일자) — 없으면 고객 첫 발화 일자
  confidence: { label: boolean; serialQtyMatch: boolean|null }
}
```
- 확인문 선택: 봇 메시지 중 `시리얼번호`·`접수사유` 라벨을 모두 가진 **마지막** 메시지. 이후 "접수가 완료되었습니다" 봇 메시지가 있어야 확정으로 간주(없으면 `NO_CONFIRM`은 아니지만 `PARSE_INCOMPLETE`로 큐행).
- 라벨 변형 허용: 콜론 전각/반각, 공백, `시리얼 번호`/`시리얼번호`, `발송지 정보`/`발송지정보`, 줄바꿈 vs ' / '.
- 수량 대조: `기기종류 : … N대`의 N 합과 시리얼 수 불일치 → 경고(큐행 아님, 시트와 동일하게 note 경고).

### 4.4 검증·자동 생성 (`autoCreate`)
통과 조건: 병원 매칭 성공 ∧ 시리얼 ≥1 ∧ 시리얼 전부 형식 정상(`/^[AP]\d{6}$/`) ∧ 확정 메시지 존재.
→ `createAsReceipt()`(기존 서비스 — 티켓·AS표시·SLA·Slack 동일)에 시트 경로와 같은 기본값: `pickupMethod` PARCEL/익일(분실은 NONE/없음), `allowInvalidSerial:false`(형식 오류는 큐로), `note` = `[채널톡 상담 {chatId}]` + 경고. `source='CHANNELTALK'`, `voc_id` = 연결 VOC(있으면), AS 티켓 `parentId` = VOC 티켓.
→ 생성 전 **기존 접수 가드**: 동일 병원·접수일·시리얼 전부 포함 접수가 있으면 생성하지 않고 `ALREADY_EXISTS`로 큐행(사람이 [연결] 또는 [등록]).
→ `as_intake_links` LINKED 기록. 실패(예외·검증 미통과) → PENDING + `fail_class`.

### 4.5 L2 — [Claude 도움요청] (`lib/ai/asExtract.ts`)
- 큐 상세에서 사용자가 누를 때만 호출. 입력 = 상담 메시지(user·manager·bot 텍스트, 파일 메타 제외) + 라벨 힌트. 출력 = §4.3 `AsExtract` JSON(tool use로 스키마 강제, 모델 `AI_SUMMARIZE_MODEL`).
- 전처리 마스킹: 휴대전화·주민번호 패턴 마스킹은 하지 않는다(연락처가 필요 필드) — 환자명 등은 식별 불가하므로 **사용자 허용(§9 Q3)에 근거해 원문 전송**. 결과는 큐의 `extracted`에 덮어쓰지 않고 **빈 필드만 채움**(사람이 입력한 값 보존), `extract_layer='L2'`, 이력 기록. 자동 등록 없음.
- 감사 로그 `ai_as_extract` 1행/호출.

---

## 5. 등록대기 큐 화면

- 진입: `/as-receipts` 우측 상단 **[등록대기 N]** 버튼(N = PENDING 수, 0이면 회색) → `/as-receipts/intake`.
- 목록: 상담 일시·병원(매칭/원문)·구분·시리얼 수·실패 분류·VOC 코드·담당(채널톡 assignee). 필터: 실패 분류. 기본 정렬 오래된 순.
- 상세 `/as-receipts/intake/[id]`: **좌 = AS 접수 폼**(수동 등록 폼과 동일 필드, `extracted`로 프리필, 빈칸 강조, 실패 사유 배지), **우/하단 = 상담 원문 타임라인**(기존 `ChatTimeline` 재사용) + 데스크 링크.
  - [Claude 도움요청] → §4.5 → 빈칸 채움 후 사용자 확인
  - [등록] → `POST /api/as-receipts`와 같은 검증·생성 경로(`source='INTAKE_QUEUE'`) + LINKED
  - [기존 접수에 연결] (`ALREADY_EXISTS`일 때) → 생성 없이 LINKED
  - [AS 아님] → IGNORED(사유 선택: 진행문의/부속품/중복/기타). 재태깅돼도 재진입하지 않음(상담 상세에서 해제 가능)
- 권한: 기존 AS 등록 권한과 동일(`isUserOrAbove`). nav 등록 없음(버튼 진입만 — `ui-start-simple`).

---

## 6. 접수 생성 후 채널톡 변경 — 감지·표시, 반영은 사람 (사용자 확정 ①)

- 연결(LINKED) 상담에 새 메시지·태그 변경이 오면(`rawHash`·메시지 증분이 이미 잡음) 재추출 → 현재 접수 값과 비교. 비교 대상 = 접수 필드만(시리얼 집합·라인 증상·병동·구분·발송지/회수지·선교체). 처리 필드(수거·입고·발송·완료)는 비교하지 않음.
- 차이가 있으면 `change_detected_at`·`change_diff` 기록 → AS 상세 상단 배지 **"채널톡 변경 감지"** + diff 패널(필드별 현재값 / 상담값) + [반영](선택 필드만) / [무시]. 반영은 기존 수정 API(`applyItemChanges` 등) 경유 → 타임라인에 기록.
- 자동 반영 없음. 태그 제거 시에도 접수 유지 + 배지 표시만.

---

## 7. 시트 — 연결 전용 모드 + 역기입 유지 (사용자 확정 ②, Q7)

- `channeltalkAsSync` ①(접수 인입)을 **연결 전용**으로 변경: 새 행(AI 공란)을 보면 생성하지 않고 동일 병원·접수일·시리얼(전부 포함) 접수를 찾아 AJ에 코드·AI '등록완료'·AK '(채널톡 경로 연결)' 기입. 못 찾으면 '대기'(채널톡 경로가 수 분 내 만듦) → 24h 경과 시 AI '미연결' + 로그(오류 아님, Slack 없음).
- ②~⑤ 역기입은 **무변경** — AJ 코드로 행을 찾는 구조라 그대로 동작. 시트에 행이 없는 접수(상담사 수기 중단분·큐 등록분)는 대상에서 자연히 빠지며 틱 로그에 건수만 남김.
- 설정 키 `channeltalk_as_sheet_mode`: `create`(현행) / `link`(전환 후). 기본 `create` — 전환 시점에 `link`로.
- ALF의 시트 기록은 당분간 유지(사용자). 상담사 수기 기재는 기능 적용 시점에 중단(운영 공지는 사용자 몫).

---

## 8. VOC 복수 태그 (참고사항 반영, 사용자 확정 ③)

- 승격 시 상담 `tags` 중 분류 태그 전부를 `voc_receipt_types`에 저장. 대표 `voc_type_id` = 첫 분류 태그(현행 유지).
- 틱 후처리에 **태그 재동기화**: 연결 상담의 분류 태그 합집합과 `voc_receipt_types` diff → 추가/제거 반영. 대표 분류는 사람이 바꿨을 수 있으므로 **대표는 건드리지 않음**(비어 있을 때만 채움).
- VOC 목록·상세에 분류 칩 N개 표시, 필터는 "분류 포함" 의미로 변경.

---

## 9. 결정 사항 (사용자 확정, 2026-10-27)

| # | 결정 |
|---|---|
| 소스 | `voc_receipts`가 아니라 **채널톡 상담 원문**. VOC는 마스터(parentId)로만 연결 |
| 후보 | 태그 있는 상담만 — `f_AS_고장접수`·`f_AS_분실접수` 2종 |
| 트리거 | 태그가 걸린 틱(ALF가 시트 기록 후 자동 태깅) |
| 정제 | L1 규칙 파서 자동 → 실패는 **등록대기 큐**(AS업무 우측상단 버튼) → 상세에서 프리필 폼 + 원문 + [Claude 도움요청] + [등록] |
| L2 | Claude API 사용 **허용**, 단 필요 건은 분류해 건수 확인·사람이 등록(자동 등록 없음) |
| 생성 후 변경 | **(b)** 감지·diff 표시, 사람이 [반영] |
| 시트 | ALF 기록은 당분간 유지, 상담사 수기는 중단. 폴러는 **연결 전용 모드**, 역기입 유지, 행 없으면 로그만 |
| 리플레이 | 돌려서 % 보고 후 함께 판단(90%는 불합격 수준) |
| 백필 | 없음. 기존 데이터는 기능 검증 테스트 용도로만 |
| VOC 복수 태그 | 분류 N개 보관 + 재동기화, 대표 = 첫 태그 |
| 보류 | 채널톡 쓰기(출하 안내 자동 발송) — 시트 역기입을 유지하므로 이번 범위 밖 |

---

## 10. P0 리플레이 (자체 테스트) — 보고 형식

스크립트 `scripts/tmp-as-intake-replay.mts`(dry-run, DB 쓰기 없음, Slack 없음):
1. 대상: 시트 경로 AS접수(note `[채널톡 r`) — 8/26 이후 659건(9/29 이후 331건은 별도 집계).
2. 상담 매칭: 시리얼 전부 포함 메시지 ±3일 → 없으면 병원·±1일·AS 태그 → 없으면 '상담 없음'.
3. 매칭된 상담에 §4.2~4.4 적용 → 가상 생성값 vs 실제 접수 필드별 비교.
4. 보고표:
   - 자동 생성 가능 비율(L1 통과) / 큐행 비율(실패 분류별 건수) / 상담 없음 비율
   - 필드별 일치율: 병원코드·구분·시리얼 집합(정확 일치)·라인 증상(정규화 비교)·병동·발송지·회수지 상이·선교체·접수자명·접수일(±1일)
   - 불일치 전수 목록(접수코드·상담 id·필드·시트값·추출값) → 원인 분류(시트가 틀림 / 추출이 틀림 / 표기 차이)
5. 합격선은 결과를 보고 사용자와 결정. 병원·구분·시리얼은 100%에 가까워야 함.

---

## 11. 개발 단계

| 단계 | 내용 | 게이트 |
|---|---|---|
| **P0** | L1 파서 + 리플레이 스크립트 → 보고 | 사용자 판단 |
| **P1** | 마이그(§3.1~3.3, 규칙 1 수동 SQL) · Prisma · `source` 백필 SQL | tsc 0 |
| **P2** | `asIntake.ts`(판정·L1·자동 생성·큐 적재·변경 감지) · vocSync 훅 · 설정 키·설정 화면 블록 · 시트 폴러 `link` 모드 | dev2 E2E(테스트 상담 `[TEST]` 규약) |
| **P3** | 등록대기 큐 API·화면 · [Claude 도움요청] · AS 상세 변경 감지 배지 · VOC 복수 태그 | Playwright 실화면 검증(`ui-verify-real-screen`) |
| **P4** | PROD 그림자: `channeltalk_as_intake=dry`(판정·추출·결과 로그만, 생성 없음) N일 → 시트 경로 생성분과 대조 | 불일치 0 또는 설명 가능 |
| **P5** | 전환: intake `on`·컷오버 지정·시트 `link` 모드·폴링 1m, 운영 공지 | 사용자 승인 |

## 12. 파일 (예정)
- `lib/channeltalk/asIntake.ts` · `lib/channeltalk/alfParser.ts` · `lib/ai/asExtract.ts`
- `lib/channeltalkAsSync.ts`(link 모드) · `lib/channeltalk/vocSync.ts`(훅) · `lib/channeltalk/vocPromote.ts`(복수 분류·재동기화) · `lib/channeltalk/shared.ts`(키·라벨)
- `app/api/as-receipts/intake/route.ts` · `[id]/route.ts` · `[id]/ai/route.ts` · `[id]/decide/route.ts` · `app/api/as-receipts/[id]/chat-change/route.ts`
- `app/as-receipts/intake/page.tsx` · `[id]/page.tsx` · `app/as-receipts/page.tsx`(버튼) · `app/as-receipts/[id]/page.tsx`(변경 감지 배지)
- `app/voc/*`(분류 칩) · `app/settings/channeltalk-sync/page.tsx`(AS 인입 블록)
- `prisma/migrations/2026MMDD_as_channeltalk_intake/` · `scripts/tmp-as-intake-replay.mts`
- 문서: 본 문서 · `README.md` · `DEV_HISTORY.md` · `channeltalk_as_intake_design.md`(link 모드 추기)

## 13. 구현 노트 (2026-10-27)

- **결정 D1~D4(권장안 채택)**: 상담 1건 = 접수 1건 / 고장+분실 혼합 태그 → 큐(`MIXED_CATEGORY`) / 기기 원장에 없는 시리얼 → ~~큐(`UNKNOWN_DEVICE`)~~ **번복(2026-10-27 저녁, 사용자)**: 시트 선례대로 생성 + 라인 '미등록' 배지·[원장확정]/[시리얼 보정] — 큐에 보내도 AI가 오타를 못 고쳐 사람 손이 가는 건 같고, 접수가 즉시 존재해야 수거 일정이 안 밀림 / OpsCode↔확인문 병원명 충돌 → 큐(`HOSPITAL_CONFLICT`, 실측상 OpsCode가 틀린 프로필 존재)
- **§3 모델 차이**: `as_intake_links.ignore_reason` 추가(PROGRESS/ACCESSORY/DUPLICATE/OTHER). `source` 값에 `INTAKE_QUEUE`(큐에서 사람이 등록) 포함. 마이그 `20261027110000_as_channeltalk_intake`
- **§4 확인문 선택**: 마지막 **완료 안내 직전**의 마지막 봇 확인문(고객이 완료 후 수정하면 뒤의 완료 안내가 기준), 접수일은 **첫** 완료 안내 KST 일자. 완료 안내는 봇·담당자 모두 인정('접수가 완료되었습니다'·'접수 도와드렸습니다'). 선교체 = 확인문 ∨ 상담 전체 언급(봇 제외) ∨ 병원 태그 `PRE_REPLACE_DEFAULT`
- **§4.1 dry 모드**: 로그·sync_runs.stats.asIntake 카운트만(링크 행도 안 만듦) — P4 그림자용. ON 저장 시 컷오버 필수(VOC 승격 설정에도 같은 가드 추가)
- **§6**: 변경 감지는 연결 상담에 **새 메시지**가 왔을 때만(`seen_message_id`), OPS 쪽 수정은 트리거가 아님. 반영 API는 선택 항목만 적용하고 남은 diff는 유지
- **§7**: 시트 폴러 link 모드에서 병원 미매칭·시리얼 없음도 '실패' 대신 '대기'→'미연결'. `runChanneltalkAsSync(testIo.sheetMode)`로 테스트
- **§8**: `syncVocTypesFromChats` — 승격·후속 연결 시 + 변경 상담 틱에 재동기화. 대표 분류는 비어 있을 때만 채움. 화면(분류 칩 N개·필터)은 미구현 — 후속
- **검증**: 리플레이 외 dev2 직접 실행·Playwright 8시나리오 PASS(DEV_HISTORY 2026-10-27 14:30). 임시 스크립트 4종은 전환 후 삭제
- **PROD 반영 절차(P4~P5)**: 마이그 수동 SQL → `prisma generate` → 빌드·재시작 → 설정에서 `dry` N일(틱 로그 `[dry]` 비교) → `on`+컷오버+시트 `link`+폴링 `1m` → 운영 공지(상담사 시트 수기 중단)

## 14. 보완 6건 (2026-10-27, 최근 100건 PROD 시뮬레이션 후)

| # | 내용 | 효과(100건 기준) |
|---|---|---|
| 1 | OpsCode↔확인문 병원명 충돌 완화 — OpsCode 병원명 ⊇ 확인문 병원명이면 OpsCode 채택 | 큐 2 → 자동 |
| 2 | 선교체 = 확인문 ∨ 고객 발언 ∨ 병원 태그 (담당자 발언 제외) | 과잉 true 감소 |
| 3 | 접수자명 — 닉네임 상담명은 프로필 '병원/병동/이름'으로 | CS 정규화 8건 흡수 |
| 4 | 수령지 2곳 이상(`destCount≥2`) → `MULTI_DEST` 큐행 | 다병동 분할을 사람이 결정 |
| 5 | 등록대기 폼 시리얼 일괄 붙여넣기 | 대웅 대리접수(엑셀 목록) 입력 |
| 6 | 변경 감지 [새 접수로 만들기] | 같은 상담 추가 접수 2건 |

100건 분류(보완 전): 자동·동일 50 / 자동·보정 25 / 큐 20 / 변경 감지 2 / 상담 없음 3. 채널톡 프로필 `OpsCode` 보유율: 최근 60일 AS 상담 고객의 76%(미보유는 대웅 직원 + 병원 직원 일부 → 병원명 매처).

## 15. D3 번복 + [Claude 도움요청] 실측 (2026-10-27)

- 큐행 22건(보완 후)에 PROD에서 실제 Claude 추출·병합 호출: **바로 등록 가능 10건(45%)**. 확인문 없는 자유 상담 11건 중 9건(82%) 준비 완료(대웅 대리접수 텍스트 목록 포함), 실패 2 = 고객 오타(영문 O)를 AI가 그대로 둠 1 · 엑셀 첨부(파일은 못 읽음) 1. 원장 미등록 3건은 모두 오타 한 자리(AI도 못 고침), 혼합 2·다병동 5건은 사람이 나누는 게 맞는 케이스(그중 1건은 CS도 안 쪼갠 건 — MULTI_DEST의 비용)
- **D3 번복**: `UNKNOWN_DEVICE`는 큐행 사유에서 제거, 자동 생성 + 접수 비고 경고 + 라인 '미등록'(기존 [원장확정]/[시리얼 보정] 동선). 100건 기준 자동 76 → 79, 큐 22 → 19
- 후속 후보: 원장 대조 기반 오타 교정 제안(한 자리 차이 + 같은 병원 배치 기기) — AI 없이 가능
