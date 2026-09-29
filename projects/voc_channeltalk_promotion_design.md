# 채널톡 상담 → VOC 승격 (voc-channeltalk-promotion) — 설계·구현 기록

> **상태: PROD 배포 완료 (2026-09-29, df44a7a) — 컷오버 공란 소급 생성 1,774건은 `scripts/fix-voc-retro-promotion.mts`로 보정(유지, §6) · 컷오버 2026-09-29·자동 승격 ON** — 기준은 사용자와 대화로 확정 후 "일단 개발해봐" 지시로 문서 없이 착수, 본 문서는 결정·구현 기록
> 상위: `voc_channeltalk_intake_design.md`(원천 적재 1단계), `cs_ticket_workflow_design.md`(VOC 도메인 본체)

---

## 1. 확정 기준 (2026-09-28 사용자 결정)

| 축 | 기준 |
|---|---|
| ① 트리거 | **채널톡 분류 태그(a~h_ 접두)가 걸린 시점**에 VOC 생성. CS 담당자가 늦게라도 태그를 걸면 그때 VOC 현황에 올라옴. **팀 태그(팀/…)는 조건 아님 — 보류** |
| ② 대상 | 고객 텍스트 발화 ≥1 ∧ 담당자 발신 상담(발송안내 등) 아님 ∧ 수동 제외 아님 |
| ③ 컷오버 | AppSetting `channeltalk_voc_cutover`(KST 일자) 이후 고객 첫 발화 상담만 자동. 과거 상담은 소급하지 않음(원본 화면에서 수동 승격만) |
| ④ 단위 | 상담 1건 = VOC 1건 기본. **같은 고객(user_id)의 미종결 VOC가 14일 내 있으면 새로 만들지 않고 그 VOC에 상담 추가**(AUTO_FOLLOWUP) |
| ⑤ 시점·시각 | 태그가 걸린 틱에 생성. **receivedAt = 고객 첫 발화 시각**(SLA 왜곡 방지). 제목 = 첫 의미 있는 고객 메시지(인사말만인 발화 제외, 8자 이상) 1줄, 본문 = 고객 초기 발화 ≤5건 + 데스크 링크 |
| ⑥ 분류·채널·담당 | 분류 = 상담 tags 중 첫 분류 태그 ↔ `status_codes(VOC_TYPE).value` / 채널 '채널톡' / 티켓 담당 = 채널톡 assignee 매니저 이메일 ↔ `users.email`(활성) — 생성 tx에서 OPEN→ASSIGNED |
| ⑦ 종결 | 연결 상담이 전부 closed → VOC '회신완료'(RESOLVED, 자동 종결 배치 대상). **하위 티켓 미종결이면 유지**. 재오픈 → '처리중'. 사람이 보류·종결로 둔 VOC는 불간섭 |
| ⑧ 늦은 태그 | 종료 상담 **전량 재검사**(`channeltalk_voc_rescan_hours`, 기본 24h, API 7~8회)로 수집 |

실측 근거(dev2 3,061건): 태그 트리거 시 진행 중 17건 중 14건에 이미 태그 → 현장 부담 낮음. 고객 발화 2,261 · 발송안내 891 · 봇만 73.

## 2. 모델 (마이그 `20260928190000_voc_channeltalk_promotion`)

- `voc_receipts` + `source`(MANUAL/CHANNELTALK) · `auto_created`
- **`voc_channeltalk_chats`** (VOC 1 : 상담 N, `chat_id` UNIQUE — 상담은 최대 1 VOC) `link_reason`(AUTO_TAG/AUTO_FOLLOWUP/MANUAL)·`linked_by_id`·`linked_at`
- `channeltalk_user_chats` + `first_user_message_at`(고객 첫 텍스트 발화 — receivedAt 원천)·`manager_initiated`(첫 메시지가 담당자)·`voc_excluded_at/by_id`(수동 제외). 기존 적재분은 메시지에서 백필
- **VOC 분류 마스터 재편**(`seed-cs-masters.sql` 8)): 구 6종(불만·장애·요청·문의·칭찬·기타 — dev2·PROD 모두 참조 0) 제거 → 채널톡 분류 태그 체계 **28종** `name='대분류/소분류'`(예 `AS/고장접수`), `value=태그명`(매핑 키), 대분류별 색. VOC_CHANNEL '채널톡' 추가

## 3. 구현

- `lib/vocService.ts` `createVocReceipt` — POST `/api/voc-receipts`에서 추출(동작 동일), 승격과 공용. ownerId 지정 시 같은 tx에서 배정+assign 이벤트
- `lib/channeltalk/vocPromote.ts` — `evaluateChat`(제외 사유 6종: LINKED·EXCLUDED·NO_TAG·NO_USER_TEXT·MANAGER_INITIATED·BEFORE_CUTOVER) · `promoteChat`(자동·수동 공용, 수동은 컷오버·태그 무시) · `syncVocStatusFromChat`(⑦) · `promoteChanneltalkVocs`(틱 후처리 — 후보 = 변경 상담 ∪ **DB상 미승격 대상 전부**(설정 변경·ON 직후 누락 방지, API 호출 없음))
- `lib/channeltalk/vocSync.ts` — `firstUserMessageAt`·`managerInitiated` 갱신, 변경 상담 id 수집, **`syncClosedFull`**(재검사 주기 도달 시 증분 대신), 틱 끝에 승격 훅. 결과 `promote`·`fullRescan`이 sync_runs.stats에 기록
- API: `POST /api/channeltalk/chats/[id]/promote`(USER+, 409 연결됨) · `POST …/exclude {excluded}`(USER+, 연결 상담 409) · 목록 `?voc=linked|none|eligible|excluded` + `vocSkipReason`·`vocLink` · 상세 `vocLink`·`vocExcludedBy`·`vocSkipReason` · VOC 상세 `channeltalkChats[]` · 설정 `promote`·`cutover`·`rescanHours`·`lastRescanAt`·`stats.vocLinked`, run `mode:'rescan'`
- 화면: `/voc/inbox` VOC 열(코드 링크 / 제외 사유 / '승격 대기')·VOC 필터 · `/voc/inbox/[id]` VOC 카드([VOC 생성]·[자동 승격 제외/해제]) · `/voc/[id]` **채널톡 상담 섹션**(연결 상담 목록 + 펼침 타임라인 + 데스크 링크, `VocChanneltalkSection`) · `/voc` 목록 채널 옆 '자동'·상담 수 · 설정 'VOC 자동 승격' 블록(ON·컷오버·재검사 주기·[전량 재검사 지금]). 타임라인은 `app/voc/_components/ChatTimeline.tsx` 공용

## 4. 검증 (dev2 2026-09-28)

- 자동 승격 ON·컷오버 9/28 → 전량 재검사 틱 13건 생성 → 후보 집합 개선 후 틱 28건 추가(대상 41/41) → 재틱 0(멱등). 분류·채널·담당(ASSIGNED)·receivedAt=첫 발화(13/13) 확인, 종료 상담은 생성 즉시 회신완료/RESOLVED
- 재오픈 시뮬레이션: 회신완료→처리중(IN_PROGRESS)→회신완료(RESOLVED), 재호출 null
- 수동 승격(컷오버 이전) 201·VIEWER 403·재승격 409·MANUAL 기록·종료 상담이라 회신완료 / 제외→EXCLUDED→해제, 연결 상담 제외 409 / voc 필터 4종 / VOC 상세 링크·목록 source / 수동 등록 경로 회귀(MANUAL, 티켓 생성) / 페이지 5종 200 / 감사 3행
- **후속 연결(AUTO_FOLLOWUP)은 dev2 오늘 데이터에 같은 고객 2건이 없어 실데이터 미검증** — PROD 운영 중 sync_runs.stats.promote.followups로 확인

## 5. 알려진 한계·후속

- 제목 휴리스틱: 고객이 워크플로 버튼을 누른 텍스트("기기 AS(❗)/분실 접수")가 제목이 되는 경우 있음 → ALF 확인 템플릿(병원·기기종류) 기반 제목 생성은 AS 인입 소스 전환 단계에서
- 팀 태그 → Assignment Group 라우팅 (보류) / 채널톡 태그 변경 시 VOC 분류 재동기화(현재는 생성 시 1회) / 병원 미매칭 VOC 확인 큐·OpsCode 역기입 / AS접수 ↔ VOC 하위 티켓 연결(시트 '식별번호' 공란 — 고객명·접수일 매칭) / 채널톡 회신
- PROD 반영 시: 마이그 → `seed-cs-masters.sql` 재실행(VOC_TYPE 재편 — PROD voc_receipts 0건 확인됨) → 기존 적재분 `first_user_message_at`·`manager_initiated` 백필 SQL(§2) → 설정 화면에서 컷오버 일자 지정 후 자동 승격 ON

## 6. PROD 소급 생성 사건·보정 (2026-09-29)

- 배포 직후 자동 승격이 **컷오버 공란**으로 ON → 과거 상담 1,774건 일괄 VOC(Slack 1,980건 발송, 티켓 생성·해결일이 전부 당일, 후속 연결 46건 역순). 사용자 결정: 삭제 대신 **유지·보정**
- `scripts/fix-voc-retro-promotion.mts`(멱등, dev2 리허설 후 사용자 `!` 셸 실행): 역순 후속 해제·재생성 46, 티켓 created_at=첫 발화 1,778, 상담 종료분 종결·CLOSED(상담 종료시각) 1,773, 진행 중 5 유지, 컷오버 2026-09-29 기록
- 교훈: 자동 승격 ON 전 컷오버 필수 — 설정 API에서 **컷오버 없이 ON 저장을 막는 가드**는 후속 과제
