# VOC 주간 대시보드 (voc-dashboard) — 설계안

> **상태: v2 (2026-10-28 개정 — 금~목 주·SLA 제외·AS 보강) 구현, PROD 반영** — v1(d2e945e)은 ISO 월~일 주·Responsiveness 축 포함이었음. §2b 참조. — 사용자 결정 7건(§2·§8) 반영.
> 참고 자료: `주간_thynC_VOC&AS_현황_26W43.pdf`(Looker 주간보고, 형태는 참고만 — 구조 이식 금지). 관련: `voc_channeltalk_promotion_design.md`(VOC = 채널톡 승격), `as_channeltalk_intake_design.md`, 규칙: `feature-design-principles`·`ui-start-simple`

---

## 1. 목적

서비스 운영 관점의 **VOC 주간 리포트**를 시스템이 직접 산출한다. 지금은 Looker 캡처 + 수기 서술(PDF)이며, 수치의 원천(채널톡 상담·VOC·AS접수)은 전부 이 시스템 DB에 있다.

리포트가 답해야 할 질문 (우선순위 순):
1. **얼마나 들어왔고, 무엇이 늘었나** — 주간 건수·전주比, 분류별 증감
2. **얼마나 빨리 대응·해결했나** — 1차 대응(사람)·종료까지 시간, 미해결 백로그
3. 누가 받았나 — 팀·담당자 부하
4. 어디서 반복되나 — 반복 발생 병원 (구조적 문제 신호)
5. AS로 얼마나 이어졌나 — 접수·고장/분실·기기·수리출하

## 2. 확정 결정 (2026-10-28)

| # | 결정 | 내용 |
|---|---|---|
| D1 | 주 경계 | **월~일 (ISO 주, KST)**. 기본 표시 = 지난주(완결 주). 주 선택기로 과거 이동, 이번주(진행 중)도 선택 가능하되 "진행 중" 배지 |
| D2 | 1차 대응 | **사람 담당자 첫 답변** — ALF/봇·워크플로 메시지 제외, `log` 액션(assign/open/close) 제외, 고객 첫 발화 이후 첫 `manager` 텍스트 메시지. 담당자 발신 상담(`manager_initiated`)·사람 답변 없는 상담(ALF 단독 처리)은 분모에서 제외하고 건수만 별도 표기 |
| D3 | 팀·담당자 축 | **채널톡 팀 태그(`팀/…`) + 상담 assignee** (VOC 100% 채널톡 승격분이라 커버리지 완전). 티켓 Assignment Group은 쓰지 않음 |
| D4 | AS 범위 | **AS 섹션 포함** — 접수 추이·고장/분실·기기군·수리출하 소요일·미완료 |

## 2b. v2 개정 (2026-10-28 사용자 요청 — "더 많은 정보를 더 자세히")

| # | 개정 | 내용 |
|---|---|---|
| R1 | 주 경계 | **금~목**(기존 주간보고 리듬). 표기는 목요일이 속한 ISO 주(PDF 'W43' 관행: 10/16~10/22 = 2026-W43). `week=` 파라미터는 금요일 날짜 또는 `YYYY-Www`. 기본 = 마지막 완결 창 |
| R2 | 처리시간 제외 | Responsiveness 축(1차 대응·종료·24h·사람 개입률) 삭제 — "SLA는 아직". 미해결 백로그 KPI만 VOC 행에 유지 |
| R3 | AS 보강 — 고장/분실 분리 | 카테고리 카드 2장: 주간 접수 건·기기 대수(기기군)·전주 대비·미완료(7일 경과)·VOC 연계 + (고장만) 선교체 요청·수리출하 소요 / 미완료 단계별(접수·수거중·입고·발송·발송완료·보류) / 최근 4주 처리 결과(수리반환·교체·분실종결·진행·미회수) / **누적 접수 대수 ÷ 현재 배치(ACTIVE) 기기** 기기군별. 8주 추이는 고장·분실 각각 기기군 적층 막대 + 접수 건수 선 |
| R4 | 병원 TOP10 | 최근 **28일**(선택 주 종료일 기준) ① AS 접수 대수 TOP10(접수·고장대·분실대·배치 기기·비율) ② **배치 기기 대비 접수율 TOP10**(배치 50대 이상 — 소규모 병원 왜곡 방지) ③ VOC 건수 TOP10(주요 분류). 분모 = `hospital_devices` ACTIVE(기기 원장 — 최근 4주 AS 병원 전부 등록돼 있음 실측), `intro_beds`는 쓰지 않음 |
| R5 | 2차 토글 해제 | 팀 추이·담당자별(상담 수·비중)을 항상 표시, 반복 병원 토글은 VOC 병원 TOP10으로 대체 |

## 3. 지표 정의 (단일 소스 — 구현 시 `lib/vocDashboard.ts`에 그대로)

### 3.1 기간
- 주 W = `[월 00:00 KST, 다음 월 00:00 KST)`. 비교 주 = 직전 주. 추이 = 최근 8주(선택 주 포함)
- VOC 귀속 시각 = `voc_receipts.received_at`(= 고객 첫 발화). AS 귀속 = `as_receipts.receipt_date`
- 영업일 = 월~금 중 공휴일 제외 — **공휴일 마스터가 없으므로 1차는 월~금 5일 고정**(PDF의 "영업일수 4.5일"은 재현 불가, 평균은 "일평균(영업일 5)"로 표기)

### 3.2 Volume
| 지표 | 정의 |
|---|---|
| 주간 VOC 건수 | W에 `received_at` 속한 `voc_receipts` 수. 전주比 Δ·%  |
| 일평균 | 건수 / 5 |
| 대분류 추이 (8주 적층) | `voc_receipt_types` 전체(복수 분류) 기준, 대분류 = `status_codes.name`의 `/` 앞(AS·오류SW·오류HW·EMR·사용·운영·개선·타사). **복수 분류는 각 분류에 1씩 계상**(합계 > VOC 수일 수 있음 — 화면에 "분류 기준, 중복 포함" 명시) |
| 중분류 TOP 10 | 같은 기준, W 건수 desc, 전주比 Δ |
| 채널 | 채널톡 100%라 1차 제외 (수동 등록이 생기면 `source` 축 추가) |

### 3.3 Responsiveness (채널톡 상담 기준 — VOC에 연결된 상담 `voc_channeltalk_chats`)
| 지표 | 정의 |
|---|---|
| 1차 대응 시간 | `min(manager 텍스트 메시지.created_at_ct) − chat.first_user_message_at` (D2). **중앙값 · p90** 표기, 평균은 툴팁 |
| 종료까지 시간 | `chat.closed_at − first_user_message_at`, W에 접수된 상담 중 종료된 것. 중앙값 · p90 |
| 24h 내 종료율 | 종료 시간 ≤ 24h 비율 (W 접수 기준, 미종료는 분모 포함·분자 제외) |
| 사람 개입률 | 사람 답변이 있는 상담 / 전체 (ALF 단독 처리 비율의 보수) — 운영 부하·ALF 효과 추적용 |
| 미해결 백로그 | 조회 시점 기준 VOC 상태 `ticket_status ∉ {RESOLVED, CLOSED}` 전체 수 + 그중 접수 후 7일 경과 수. 상태별(접수/처리중/보류) 분해 |

### 3.4 팀·담당자 (2차 진입 — 토글)
| 지표 | 정의 |
|---|---|
| 팀별 건수 | 상담 `tags` 중 `팀/…` 각 1 계상 (복수 팀 태그 중복 포함, 태그 없음 = '미지정'). 8주 추이 + W 점유율 |
| 담당자별 | `assignee_id` → `channeltalk_managers.name`, W 건수·1차 대응 중앙값 |

### 3.5 반복 발생 병원 (2차 진입)
- 최근 4주(선택 주 포함) VOC ≥ **5건** 병원 목록: 건수·주요 분류(최빈 중분류)·마지막 접수일. dev2 실측 3건 기준 59개 병원이라 5건으로 상향, 화면에서 임계값 조절(3/5/10)

### 3.6 AS (D4)
| 지표 | 정의 |
|---|---|
| 주간 AS 접수 | `as_receipts` W 건수(취소 제외), 고장/분실 분해, 전주比 |
| 기기군 대수 | `as_receipt_items` W 라인 수를 `AS_DEVICE_GROUPS`(심전계/산소포화도/기타)로 — 원장 연결 라인은 `device_info.device_name`, 미등록은 `device_kind` (`lib/asReceiptShared.ts` 접기 함수 재사용) |
| 수리출하 소요일 | W에 발송된 라인(`items.shipped_at ∈ W`, outcome ∈ {REPAIR_RETURN, REPLACE})의 `shipped_at − receipt.receipt_date` 중앙값·평균(영업일 아님 — 달력일, 명시) |
| 미완료 | 조회 시점 기준 비종결(`ticket_status ∉ CLOSED`) + 접수 후 7일 경과 수 |
| VOC 연계율 | W AS 중 `voc_id IS NOT NULL` 비율 (전환 품질 추적 — 2026-10-28 채널톡 전환 효과) |

## 4. 화면 — `/voc/dashboard`

- 진입: VOC 접수 메인 우측 상단 **[대시보드]** 버튼 (등록 버튼 왼쪽, 보조 스타일). 권한 = VOC 열람과 동일(로그인 사용자 전원, nav 미등록)
- 상단: 주 선택기(◀ 2026-W43 10/20~10/26 ▶ · "지난주" 복귀) · 진행 중 배지 · 조회 시점
- **메인 축 1 — Volume**: KPI 4칸(주간 건수·전주比 / 일평균 / AS 접수 / 미해결 백로그) → 8주 대분류 적층 막대 + 중분류 TOP10 표(Δ 화살표)
- **메인 축 2 — Responsiveness**: KPI 4칸(1차 대응 중앙값·p90 / 종료 중앙값·p90 / 24h 종료율 / 사람 개입률) → 8주 1차 대응 중앙값 선 그래프 + 백로그 상태별 한 줄
- **AS 섹션**: KPI 3칸(접수·고장/분실 / 기기군 / 수리출하 중앙값) + 8주 접수 막대(고장·분실)
- **2차(토글, 기본 접힘)**: 팀·담당자 / 반복 발생 병원
- 요약 한 줄 + 툴팁 원칙(`ui-start-simple`). 카드 나열 지양 — 섹션당 KPI 행 1 + 차트 1 + 표 ≤1
- 내보내기: 1차는 브라우저 인쇄(`@media print` 정리)만. PDF 생성·Slack 자동 발송은 2차

## 5. API — `GET /api/voc-receipts/dashboard?week=2026-W43`
- 응답 한 번에 전 섹션(`{ week, prevWeek, volume, responsiveness, teams, repeatHospitals, as }`), 8주 추이는 서버 집계($queryRaw, KST `date_trunc('week')`)
- 캐시 없음(주간 단위라 쿼리 부담 작음, 상담 2.5k·메시지 수십만 건에서 1초 내 목표 — 1차 대응은 상담별 `min()` 서브쿼리 대신 `DISTINCT ON (chat_id)` 1회 스캔)
- 권한: `getAuthUser`만 (VOC 열람과 동일)

## 6. 범위 밖 (명시)
- 수기 "주요 이슈" 서술·CX 업무 코멘트 → 2차 후보: 주간 코멘트 입력란(위키 페이지 연결)
- 공휴일 반영 영업일, 담당 부서 매핑 마스터(채널톡 팀 태그를 그대로 씀), PDF 생성·Slack 발송
- VOC 복수 분류 칩·필터 UI(별건, `as_channeltalk_intake_design.md` 후속)

## 7. 파일
`lib/vocDashboard.ts`(집계) · `app/api/voc-receipts/dashboard/route.ts` · `app/voc/dashboard/page.tsx`(recharts, `useChartTheme`) · `app/voc/page.tsx`(버튼 1개) · README·DEV_HISTORY. **스키마 변경 없음.**

## 8. 검토 확정 (2026-10-28)
- Q1 반복 병원 임계값 기본 **5건**(4주), 화면 3/5/10 조절 — 확정
- Q2 1차 대응·종료 시간 **중앙값 + p90**, 평균은 툴팁 — 확정 (기존 PDF 평균 기준과 달라짐을 보고 시 명시)
- Q3 분류 집계 **복수 분류 각 1 계상**(화면에 '분류 기준, 중복 포함' 명시) — 확정

## 9. 주간 보고 자료 패널 (2026-10-31 추가)
- 요구: 기존 주간보고 PDF(`thynC VOC 주요이슈_YYMMDD-YYMMDD`, PPT 1페이지)의 수기 이슈·CX 코멘트도 대시보드에서 보고 싶음. PPT 편집 기능은 만들지 않음(사용자 결정) → **PDF 업로드 → 이미지 표시**
- 귀속: 선택 주(금요일 `week_start`)당 1건. 주 이동 시 해당 주 자료 표시, 재업로드 = 교체
- 서버: `lib/vocDashboardReport.ts` — `%PDF-` 매직 바이트·`pdfinfo` 페이지 수(1페이지만, 아니면 400)·`pdftoppm -r 200 -png -singlefile`·sharp PNG 재압축 → S3 `voc-dashboard/reports/<금요일>/<ts>.{pdf,png}` → `voc_dashboard_reports` upsert → 이전 객체 삭제. presigned URL 1시간
- API: `GET/POST/DELETE /api/voc-receipts/dashboard/report?week=` (POST multipart `week`,`file`, 20MB). 권한: 조회 로그인 / 쓰기 USER 이상. 감사 로그 `voc_dashboard_report` CREATE·DELETE
- 화면: `app/voc/dashboard/_components/WeeklyReportPanel.tsx` — 하단 카드. 빈 상태(USER 이상)는 드롭존, 있으면 이미지(클릭 → PDF)·파일명·크기·업로더·시각, 우측 상단 [교체][삭제]. VIEWER는 안내 문구만. §6의 '주간 코멘트 입력란' 2차 후보는 이 패널로 대체
- dev2 검증: W44 PDF(2667×1500, PNG 265KB, 0.5s) 업로드→URL 200→교체(같은 id, 이전 이미지 404)→삭제(행 0, 이미지 404). 비PDF 거부
