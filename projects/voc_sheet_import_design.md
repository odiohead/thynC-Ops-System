# VOC현황 시트 과거 이력 적재 + VOC 등록대기 큐 — 설계·구현 기록

> **상태: 완료 (PROD 배포·적재 2026-10-30, 27bfd75 — VOC 7,896 생성·큐 175+46)** — 사용자 지시("시트 기반으로 모두 시스템에 생성 + AS업무처럼 등록대기 기능")로 분석 → 결정 3건 확인 후 착수. 본 문서는 결정·구현 기록
> 상위: `voc_channeltalk_promotion_design.md`(채널톡 → VOC 승격), `as_channeltalk_intake_design.md`(AS 등록대기 — UI·API 패턴 원형)

---

## 1. 배경 — 시트와 시스템의 차이 (2026-10-30 분석)

구글시트 'thynC VOC 현황' > **'VOC현황_NEW'** 탭(10,672행, 2024-10-24 ~ 2026-10-28)은 CS가 모든 상담을 문의 단위로 기록해 온 원장. 시스템 VOC(`voc_receipts`)는 2026-07-14부터(채널톡 승격 소급분) 존재.

| 구간 | 시트 행 | 시스템 | 판정 |
|---|---|---|---|
| 2024-10-24 ~ 2026-07-13 | 7,560 | 0 | 적재 대상 (유형 1 — 채널톡 이전) |
| 2026-07-14 ~ 10-28 | 3,112 | VOC 2,592 | 행 단위 대조 — 2,616행은 기존 VOC와 매칭(건너뜀), 302행은 상담은 있으나 VOC 없음(구 태그명 186·담당자 선발신 42·태그 없음 13), 194행은 상담 없음(유선·대웅 경유 45, 병원 확인불가 17, A/S 탭 복제 행 73, 기타 59) |

대조 방법: 시트 '접수시간' = 상담 내 고객 메시지 시각(±2분) + 병원코드 + 본문 유사도 → 93.8% 매칭. 결과는 `scripts/data/voc_sheet_match.tsv`(행 → 채널톡 상담 id, 환경 무관 — 상담 id는 PROD·dev2 동일).

구조 차이: 시트는 **문의 1건 = 1행**(상담 1건이 2~5행으로 분할 456건), 시스템은 **상담 1건 = VOC 1건**. 2026-08부터 시트의 완료여부·1차대응·문의유형 열은 기재되지 않음(채널톡 태그만).

## 2. 결정 (2026-10-30, 사용자)

| # | 질문 | 결정 |
|---|---|---|
| D1 | 기존 VOC와 매칭된 2,616행 | **건너뛰기** — 시스템에 없는 행만 생성(중복 VOC·티켓 없음). 기존 VOC 보강은 하지 않음 |
| D2 | 등록대기 큐 유입 범위 | **시트 잔여 + 미승격 상담** — 시트에서 병원 미식별 행 + 채널톡 상담 중 분류 태그가 없거나 구 태그명뿐이라 승격 안 된 상담. 병원 없는 상담은 지금처럼 VOC 바로 생성(큐로 돌리지 않음) |
| D3 | 시스템에 없는 시트 필드(담당부서·확인담당자·문의유형 대/중/소·1차 대응시각·병동·반복문의) | **본문 메모 블록**으로 보존(`[VOC현황 시트 rN] …`), 조치 내용은 처리결과(resolution). 스키마 변경 없음 |

## 3. 시트 적재 — `scripts/import-voc-sheet.mts`

```
npx tsx scripts/import-voc-sheet.mts --dry [--max-row=10688] [--limit=N] [--match=scripts/data/voc_sheet_match.tsv]
npx tsx scripts/import-voc-sheet.mts --apply
```

- 멱등: `voc_receipts.source_ref` / `voc_intake_items.source_ref` = `sheet:VOC현황_NEW:r{n}` (UNIQUE). 재실행 시 이미 적재된 행은 건너뜀. `--max-row` 기본 10688(분석 시점 마지막 행) — 시트는 CS가 계속 쓰고 있으므로 이후 행은 별도 결정
- 행 판정: ① 대조표의 상담이 이미 VOC에 연결 → 건너뜀 ② 병원 공란·'확인불가' → 큐 `HOSPITAL_UNKNOWN`, 매처(`lib/hospitalNameMatcher`) 미매칭 → 큐 `HOSPITAL_UNMATCHED` ③ 그 외 → VOC 생성
- 필드 매핑: 제목 = 접수 내용 첫 줄(4자 미만이면 `병원 유형소분류 내용`) · 본문 = 접수 내용 + 시트 원본 메모 블록 · 처리결과 = 조치 내용(`<p>` 래핑) · 분류 = 채널톡 태그 연계(W) ↔ `VOC_TYPE.value`(28종 전부 매핑) · 채널 = 유선문의 TRUE → 전화 / 접수시간 또는 상담 있음 → 채널톡 / 그 외 없음 · 접수시각 = 접수시간(Q, KST) 없으면 날짜 09:00 · 생성자 = 등록자 이름 ↔ `users.name`(ALF·미매칭은 채널톡 접수봇)
- 상태: 완료여부(T) '처리완료' → **종결**, '진행중' → 처리중, 공란이면 7/14 이전 → 종결 / 상담 있으면 상담 상태(종료 → 종결, 진행 → 처리중) / 상담 없으면 14일 경과 → 종결, 아니면 1차대응완료 → 처리중, 그 외 접수. 완료시각 = 전체 완료시간 → 1차 완료시간 → 상담 종료시각 → 접수시각
- 코드: **접수 월 기준** `VOC-YYYYMM-NNNN`(`createVocCodeAllocator` — 프리픽스별 다음 번호 메모리 유지, P2002 시 bump). 티켓 코드는 생성 시점 월
- 생성 경로 `lib/vocImport.createVocFromImport`: `createVocReceipt`(VOC+CS 마스터 티켓 단일 tx) 후 보정 — VOC·티켓 `created_at`=접수시각, 종결이면 티켓 CLOSED·`closed_at`/`resolved_at`=완료시각(+status_change 이벤트 via `import`). `fix-voc-retro-promotion.mts`와 같은 방식, 자동 종결 배치 미경유. **Slack 알림·SLA 없음**
- 상담 연결: 대조표 상담이 VOC 없는 경우 `voc_channeltalk_chats`(link_reason **SHEET**) — 같은 상담의 2번째 행부터는 연결 없이 VOC만(상담은 최대 1 VOC). 연결 후 `syncVocTypesFromChats`(복수 분류)
- dev2 실측(드라이런): 생성 7,894(상담 연결 299) · 큐 177(확인불가 84·미매칭 93) · 건너뜀 2,616 · 상태 종결 7,769/처리중 122/접수 3

## 4. VOC 등록대기 큐

- 모델 `voc_intake_items`(마이그 `20261030170000_voc_intake_queue`): `source`(SHEET/CHANNELTALK) · `chat_id` UNIQUE · `source_ref` UNIQUE · `state`(PENDING/REGISTERED/IGNORED) · `fail_class`(`lib/vocIntakeShared.ts` — HOSPITAL_UNMATCHED·HOSPITAL_UNKNOWN·NO_TAG·OLD_TAG·ERROR) · `draft` JSONB(`VocIntakeDraft` — 등록 폼 프리필 + 시트 원본 열) · `voc_id` · 결정자/시각/제외 사유. `voc_receipts.source_ref` 추가(시트 멱등 키), `source`에 'SHEET' 값 추가(CHECK 없음)
- 채널톡 유입(`lib/channeltalk/vocPromote.queueUnpromotedChats`, 승격 틱 끝에 호출): 승격 조건 중 **태그만** 못 갖춘 상담 — `OLD_TAG`(a~h_ 태그는 있으나 현 마스터에 없음) 즉시, `NO_TAG`(분류 태그 없음)는 **종료 후 24h 경과**(늦은 태그 유예). 컷오버 이후 고객 발화 ∧ 담당자 선발신 아님 ∧ 제외 아님 ∧ 미연결. 큐 항목의 상담이 이후 태그·수동 승격으로 VOC에 연결되면 REGISTERED로 정리(settled). PROD 실측 기준 컷오버(9/29) 이후 해당 상담 48건 수준(하루 1~2건)
- API(로그인, 등록·제외는 VIEWER 제외): `GET /api/voc-receipts/intake?state=&failClass=&source=&countOnly=1` · `GET /api/voc-receipts/intake/[id]`(초안·병원·상담 타임라인) · `POST …/[id]/register`(수동 등록과 같은 검증 → `createVocFromImport`, 상담 연결 MANUAL, 종결로 등록하면 알림·SLA 생략) · `POST …/[id]/ignore {reason|undo}`
- 화면(nav 미등록): `/voc` 우측 상단 **[등록대기 N]**(건수 있으면 주황) → `/voc/intake`(상태 탭·출처/사유 칩·표) → `/voc/intake/[id]`(좌 등록 폼 — 병원 검색·분류·채널·상태·접수일시·완료일·제목·내용·처리결과, 빈칸 노란 강조 / 우 원문 — 채널톡이면 타임라인, 시트면 원본 열 표). VOC 목록 채널 옆 '시트' 표기

## 5. 검증 (dev2 2026-10-30)

- 적재·화면 검증 결과는 `DEV_HISTORY.md` 2026-10-30 항목 참조

## 6. PROD 반영 절차

1. git pull → `psql -f prisma/migrations/20261030170000_voc_intake_queue/migration.sql` → `migrate resolve --applied` → `prisma generate` → 빌드·재시작(협업 서버 무관)
2. `npx tsx scripts/import-voc-sheet.mts --dry` → 건수 확인 → `--apply` (규칙 5 — 사용자 명시 허락). 약 8,000 VOC + 티켓 생성, 수 분. 채널톡 승격 틱과 동시 실행 가능(코드 충돌은 P2002 bump로 흡수)
3. 이후 시트 신규 행(10688행 이후)은 적재하지 않음 — CS 기록 경로를 시스템으로 전환하는 결정은 별도

## 7. 알려진 한계·후속

- 시트의 '진행중' 122건은 시트 기준 그대로 처리중(열린 티켓)으로 들어감 — 오래된 건은 사람이 종결 필요
- 시트 문의 단위 분할 행(상담 1 : 행 N)은 기존 VOC가 있으면 통째로 건너뜀(D1) — 분할된 2번째 이후 문의 내용은 시스템에 없음
- 대조표는 분석 시점(PROD 10/29 덤프) 기준 — PROD 적재 시 상담 연결 여부는 실시간 DB로 재판정(대조표는 행↔상담만 제공)
