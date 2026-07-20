# thynC Operations System - 개발 작업 이력

> 최신 작업이 상단에 위치합니다.

---

## 2026-07-21 | 사이니지 월보드 진입 버튼 PROD 배포

- `5e75223` push → PROD pull → 힙 4GB 빌드 → `pm2 restart thync-prod` (DB 변경·신규 패키지 없음)
- 검증: login API 응답 정상 · `/`·`/dashboard` 307(인증 리다이렉트 정상) · 빌드 청크에 버튼 포함 확인 · 재시작 후 신규 에러 0 (기존 Anthropic 크레딧 부족 로그만 잔존)

## 2026-07-21 | 메인 대시보드에 사이니지 월보드 진입 버튼 추가

- **배경**: `/dashboard`(사이니지 월보드)는 URL 직접 입력 외 UI 진입 경로가 없었음 (사용자 요청)
- 메인 `/` 페이지 KPI 타일 위 우측 상단에 '사이니지 월보드' 버튼 추가 — lucide `Tv` 아이콘, 새 탭 오픈(`target="_blank"`, 네비 없는 전체화면 보드라 메인 이탈 방지), 다크모드 대응
- 검증(dev2): tsc 0오류 → 힙 4GB 빌드 → `pm2 restart thync-dev` → `/`·`/dashboard` 307(인증 리다이렉트 정상), 로그인 200, 빌드 청크에 버튼 문자열 포함 확인
- 영향 파일: app/page.tsx, README.md

## 2026-07-21 | 전표 수량 수정·병원 필터·이력 한 화면·운행일지 인쇄 PROD 배포

- `753ee28` push → PROD pull → 힙 4GB 빌드 → `pm2 restart thync-prod` (DB 변경·신규 패키지 없음)
- 검증: login 200 · /hospitals·/inventory/transactions·/vehicle-reservations/logs/print 307(인증 리다이렉트 정상) · 재시작 후 신규 에러 0 (기존 Anthropic 크레딧 부족 로그만 잔존)

## 2026-07-21 | 자재관리 전표 수량 수정 + 병원 필터 상시 노출 + 입출고 이력 한 화면 + 운행일지 인쇄

- **전표 수량 수정** (사용자 제안 → 추천안 승인): 전표 수정 모달에 수량 필드 추가 — **비시리얼 품목만**, 기존 `canEditTxMeta`(ADMIN+재고 담당자 풀) 게이트 재사용. `lib/inventory.ts`에 `assertQuantityEditable`(시리얼 품목·세트출고 부모 409) + `applyQuantityDelta`(변경분을 재고 버킷에 반영 — IN/OUT/MOVE별, LOT 버킷 포함, 결과 음수면 409) 추가, PUT 라우트에서 전표 update와 한 트랜잭션 처리·감사 로그 유지. 시리얼 품목은 개체 정정(기존)·취소 후 재등록 경로 유지
- **hospitals 필터**: 병원종·상태 멀티선택 드롭다운 → **표 상단 체크박스 상시 노출**(HospitalFilters 재작성 — 클릭 즉시 적용, 선택 시 파란 배경, 초기화 버튼, 상태 색 점 유지)
- **입출고 이력 한 화면**: max-w-7xl→screen-2xl, 컬럼 15→12 병합(입출고일+처리일시 / 유형+입출고유형 / 인벤토리+위치), 패딩 압축(px-2/py-2), 긴 텍스트 truncate(+title 툴팁) — 일반 해상도 가로 스크롤 제거
- **운행일지 인쇄**: 운행일지 탭 '인쇄' 버튼 → `/vehicle-reservations/logs/print`(신규, 네비 제외 경로 추가) — **A4 가로(@page landscape), 차량별 1장 페이지 나눔**, 표준 양식(번호·운행일자·운행시간·운전자·목적·행선지·계기판·주행거리·비고+합계), 현재 필터(차량·기간) 전달, 화면 전용 인쇄/닫기 툴바
- **검증(dev2)**: tsc 0오류 → 힙 4GB 빌드 → E2E 8케이스(IN 10→7 수정·재고 반영 / OUT 후 IN 축소 재고 부족 409 / OUT 5→3 / MOVE 2→3 양쪽 버킷 / 시리얼 품목 409 등) 전부 통과 + 재고 스냅샷 정합 확인, 페이지 4종 200. 테스트 데이터·임시 풀 등록 정리
- 영향 파일: lib/inventory.ts, app/api/inventory/transactions/[id]/route.ts, TxEditModal, transactions/page, HospitalFilters, VehicleLogsPanel, app/vehicle-reservations/logs/print/page.tsx(신규), MainWrapper, Navigation, README.md

## 2026-07-20 | AI 사용량 원장 PROD 배포

- `455f1cc` push → PROD pull → 마이그레이션 `20260720230000` psql 적용+resolve(기존 usage **28건 백필** — 입력 278,939·출력 30,075 토큰) → prisma generate → 힙 4GB 빌드 → `pm2 restart thync-prod`
- 검증: login 200 · `/settings/ai-usage` 307(인증 리다이렉트 정상) · `_prisma_migrations` 기록 확인 · 신규 에러 0
- 참고: PROD 에러 로그에 Anthropic API 크레딧 부족(`credit balance too low`) 이력 존재 — 배포와 무관, **AI 어시스턴트 응답 불가 상태이므로 Console 크레딧 충전 필요**

## 2026-07-20 | AI 사용 현황 보완 — 대화 삭제와 무관한 사용량 원장(`ai_usage_logs`) 도입

- **배경**: 사용 현황이 `ai_chat_messages.usage` 실시간 집계라 사용자가 채팅 이력(세션)을 삭제하면 Cascade로 통계에서 빠지는 문제 (사용자 요청 — 삭제해도 집계 유지)
- **DB**: `ai_usage_logs` 신설 (마이그레이션 `20260720230000_ai_usage_logs`) — 답변 1건=1행. `user_id`(FK SetNull)+이름·이메일 **스냅샷**(계정 삭제 대비), `session_id`/`message_id`는 FK 없이 ID만 보관(삭제 후 세션 수 집계, message_id UNIQUE 백필 중복 방지), `hospital_code`(FK SetNull), model·토큰 4종. 기존 assistant 답변 백필(DEV 2건 — 토큰 합계 일치 확인)
- **기록**: 채팅 라우트가 답변 저장 직후 원장 insert (best-effort — 실패해도 채팅 유지). 모델명은 `lib/ai/agent.ts` `AI_MODEL` export 공유
- **집계 전환**: `/api/settings/ai-usage` 월별·사용자별·병원별 쿼리를 원장 기준으로 재작성 — 질문 수=답변 행 수, 사용자별은 `LEFT JOIN users`로 살아있는 계정은 최신 이름 우선·삭제 계정은 스냅샷 표시, 페이지 안내 문구 갱신("삭제해도 집계 유지")
- **검증(dev2)**: tsc 0오류 → 힙 4GB 빌드 → 재시작 → E2E: 원장 집계 GET(백필 값 정확) → 테스트 세션 생성 후 세션 DELETE 204 → 메시지 Cascade 삭제·원장 잔존·집계 불변 확인 → user_id NULL(계정 삭제 시뮬레이션) 시 스냅샷 이름 표시 확인. 테스트 데이터 정리 (실채팅 검증은 API 크레딧 부족으로 불가 — insert 경로는 코드 단순 경로)
- 영향 파일: prisma/schema.prisma(AiUsageLog), prisma/migrations/20260720230000_ai_usage_logs, lib/ai/agent.ts, app/api/ai-assistant/chat/route.ts, app/api/settings/ai-usage/route.ts, app/settings/ai-usage/page.tsx, README.md
- **PROD 반영 시**: 마이그레이션 psql 적용+resolve 필요 (PROD 기존 usage 28건 백필됨)

## 2026-07-20 | AI 사용 현황 페이지 PROD 배포

- `e53022f` push → PROD pull → 네비 마이그레이션 `20260720200000` 적용+resolve → 힙 4GB 빌드 → `pm2 restart thync-prod`
- 검증: login 200 · `/settings/ai-usage` 307(인증 리다이렉트 정상) · 네비 행 존재 · PROD에 usage 기록 28건(즉시 표시 가능) · 신규 에러 0

## 2026-07-20 | AI 어시스턴트 사용 현황 관리 페이지 (`/settings/ai-usage`)

- **배경**: 사용자 요청 — 어시스턴트 사용 이력·토큰·비용 관리 필요. 기존 `ai_chat_messages.usage`(입력/출력/캐시읽기/캐시쓰기) 실시간 집계로 구현 — 신규 테이블 없음
- **구성**: KPI 4종(이번달 질문·토큰·예상 비용·사용자, 전월 병기) / 월별 추이 12개월(질문 수·예상 비용 — 단일 축 차트 2개) / 사용자별 테이블(기간 필터, 비용 내림차순) / 병원 컨텍스트 Top 10 / **단가 설정**(AppSetting `ai_usage_pricing` — opus-4-8 기본값 $5·$25·$0.5·$6.25/MTok + 원화 환율, 감사 로그)
- 비용은 추정치(실청구=Anthropic Console), 대화 내용 미노출(메타데이터만), 삭제 세션 통계 제외(Cascade) — 페이지에 명시
- 네비: 설정 하위 '연동·알림' 그룹 'AI 사용 현황' (마이그레이션 `20260720200000_ai_usage_nav`, ADMIN)
- 검증: tsc 0오류 → 빌드 → E2E(집계 GET 정확 — DEV 실데이터 질문 2건·토큰 합계 일치, 단가 PUT/원복, 페이지 200)
- 영향 파일: `app/api/settings/ai-usage/route.ts`(신규), `app/settings/ai-usage/page.tsx`(신규), 마이그레이션, README.md
- 2차 후보(미착수): AI 정제(summarize) 사용량 기록 추가 + GW 플래너 합산 "AI 비용 통합" 뷰, 월 예산 임계 Slack 알림

## 2026-07-20 | 입출고일·전표 수정 권한 강화 PROD 배포

- **사전 백업**: PROD `~/backups/db/thync_ops_pre_txdate_20260720.dump` (inventory_transactions)
- `ee69068` push → PROD pull → 마이그레이션 `20260720170000` psql 적용+resolve(기존 전표 25건 KST 백필: 7/19~7/20) → prisma generate → 힙 4GB 빌드 → `pm2 restart thync-prod`
- 검증: login 200 · tx_date 백필 확인 · 재고 담당자 풀 5명(수정 버튼 대상) · 재시작 후 신규 에러 0

## 2026-07-20 | 자재관리 — 입출고일(소급 등록) + 전표 수정 권한 강화

- **입출고일(`tx_date` DATE)**: 시스템 처리시각과 별개의 업무 기준일 — 지난 날짜 소급 등록 지원 (사용자 요청). 단건 입출고 모달(입고일/출고일 date 입력, 기본 KST 오늘)·Excel 일괄 업로드에서 지정, 이동(MOVE)은 자동. 세트출고 자식 전표 상속. 이력 페이지 컬럼 분리(입출고일·처리일시)·품목 상세 이력·Excel export 반영, **기간 필터를 입출고일 기준으로 전환**. 기존 전표는 created_at의 KST 날짜로 백필 (마이그레이션 `20260720170000_wms_tx_date`)
- **전표 수정 권한 강화**: 기존 ADMIN 이상 → **ADMIN 이상이면서 재고 담당자 풀 등록자만** (`canEditTxMeta`, can-manage API에 `canEditTx` 추가, 이력 페이지 수정 버튼 게이트 교체). 수정 모달에 입출고일 필드 추가
- 검증: E2E 6케이스 — 소급 입고(7/1) 저장·미입력 시 오늘·형식 오류 400·기간 필터(입출고일 기준) 적중·풀 미등록 ADMIN 수정 403·풀 등록 ADMIN 입출고일 수정 200. 테스트 데이터·임시 풀 등록 정리
- 영향 파일: prisma/schema.prisma, lib/inventory.ts(kstToday·parseTxDate·canEditTxMeta), lib/inventoryQuery.ts(기간 필터), transactions API 3종(route·[id]·bulk-serial), can-manage, TransactionModal, BulkSerialTxModal, TxEditModal, transactions/page, 품목 상세 2곳, transactions/export, README.md

## 2026-07-20 | LOT 재고 차원(A안) + 수량 쉼표 표기 PROD 배포

- **사전 백업**: PROD `~/backups/db/thync_ops_pre_lot_dim_20260720.dump` (WMS 4테이블)
- `851569c` push → PROD pull → 마이그레이션 `20260720150000` psql 적용+resolve → prisma generate → 힙 4GB 빌드 → `pm2 restart thync-prod`
- 검증: login 200 · `inventory_stocks` PK `(item_id, warehouse_id, inventory_id, lot_no)` 확인 · 기존 재고 5행 8,950개 전량 '' 버킷 보존 · 재시작 후 신규 에러 0

## 2026-07-20 | 자재관리 — LOT 재고 차원(A안): 비시리얼 LOT 품목의 LOT별 수량 관리·LOT별 출고

- **배경**: 비시리얼 LOT 품목의 LOT가 "전표 기록"뿐이라 LOT별 잔량 추적·검증 불가 → 사용자 A안 승인(재고 스냅샷에 LOT 차원 추가)
- **DB**: `inventory_stocks`에 `lot_no VARCHAR(100) NOT NULL DEFAULT ''` 추가 + PK `(item_id, warehouse_id, inventory_id, lot_no)` 재구성 (마이그레이션 `20260720150000_wms_lot_stock_dimension`). 기존 재고·시리얼 품목·비LOT 품목은 '' 버킷(=LOT 없음)
- **전표 로직** (`lib/inventory.ts`): 비시리얼 LOT 품목 — 입고 시 LOT 필수(전표당 1개), 출고·이동 시 보유 LOT 버킷 지정 필수(''=LOT 없음 버킷 허용 — 레거시 재고 소진용), LOT별 잔량 검증(부족 409), MOVE도 LOT 기록, 취소는 전표 LOT 버킷으로 역방향 복원. 시리얼 품목 버킷은 항상 ''(LOT는 개체 추적). **LOT 관리 부자재 세트출고 금지**(개별 출고 안내), **LOT 버킷 품목의 전표 LOT 사후 수정 금지**(409)
- **API**: stocks 버킷 모드에 `lotNo` 노출(위치×LOT 단위), 품목 목록 모드는 위치 합산 유지, 재고 Excel에 LOT 컬럼
- **UI**: 입출고 모달 — 비시리얼 LOT 품목 입고 LOT 필수 입력, 출고·이동 **LOT 드롭다운**(보유 LOT+잔량, '(LOT 없음)' 포함, 위치 변경 시 초기화). 품목 상세 2곳 — 위치 합산 재고 요약 + **LOT별 잔량** 칩
- **검증**: E2E 12케이스 — LOT 없이 입고 400 / LOT-A·B 입고 버킷 분리 / LOT 미지정 출고 400 / LOT별 출고·초과 409(잔량 정확) / LOT 이동(위치 간 버킷 이전) / 전표 LOT 수정 409 / 취소 시 LOT 복원 / **레거시 시나리오**(LOT 켜기 전 재고 '' 버킷 출고 + 새 LOT 공존) 전부 통과, 테스트 데이터 정리
- 영향 파일: prisma/schema.prisma, `lib/inventory.ts`, stocks·stocks/export·transactions/[id] API, TransactionModal, 품목 상세 2곳, README.md
- **숫자 표기**: 재고관리 전 화면 수량 표시에 천 단위 쉼표 적용 (자재 현황 위치 칩·섹션 합계, 품목 상세 총재고·위치·LOT 칩·이력, 입출고 이력, 모달 가용·재고 표시)
- 기존 산소포화도센서 170개 재고는 '(LOT 없음)' 버킷으로 표시·출고 가능 (PK 재구성이지만 기존 데이터 무손실 — '' 버킷 이전)

## 2026-07-20 | 자재관리 — LOT 관리 잠금 해제 + 품목관리 테이블 한 화면 표시

- **LOT 잠금 해제**: 입출고 이력이 있어도 품목의 LOT 관리 여부 변경 허용 (사용자 요청 — 평가용재고 산소포화도본체(평가용) LOT 켜기). 기존 재고·전표의 LOT는 빈 값으로 남고 이후 입출고부터 규칙 적용. **시리얼 관리 여부는 기존대로 이력 시 409 잠금**(수량↔개체 정합). 편집 폼 안내 문구 갱신
- **품목관리 테이블**: 컨테이너 max-w-6xl→screen-2xl, 셀 패딩 압축(px-3/py-3→px-2/py-2), 분류·품목명·모델명·제조사·규격·비고 truncate(+title 툴팁) — 일반 해상도에서 가로 스크롤 없이 표시
- 검증: E2E 4케이스(이력 있는 품목 LOT ON 200 → OFF 200 → 시리얼 OFF 409 유지 → LOT ON 후 신규 입고 LOT 필수 400) 통과, 테스트 데이터 정리
- 영향 파일: `app/api/inventory/items/[id]/route.ts`, `app/inventory/items/page.tsx`, README.md
- **PROD 배포**: `f266c6d` push → pull → 빌드 → 재시작 (DB 변경 없음). login 200·신규 에러 0

## 2026-07-20 | 메인 대시보드 개편 + 통계 기준 전환 PROD 배포

- 커밋 2건(대시보드 개편, 통계 완료월 전환) push → PROD pull → 힙 4GB 빌드 → `pm2 restart thync-prod` (DB 변경·신규 패키지 없음)
- 검증: login 200 · `/` 307(인증 리다이렉트 정상) · 재시작 후 신규 에러 0

## 2026-07-20 | 월별 통계 집계 기준 — 완료 익월 → 완료월(실시간) 전환

- 사용자 요청: 7월 완료 프로젝트가 8월 통계로 잡히던 "서비스 시작월(완료 익월)" 기준을 폐지, **프로젝트 완료일(endDateExpected)의 당월**로 즉시 집계
- `app/api/dashboard/monthly/route.ts`의 익월(+1개월) 계산 제거 — 메인 대시보드·사이니지 월보드 공통 반영(같은 API), 다른 통계는 상태 기반이라 무관
- 검증: DEV에서 7월 완료 4건·194병상이 7월 버킷에 집계 확인
- README 대시보드 섹션 집계 기준 문구 갱신

## 2026-07-20 | 메인 대시보드(`/`) 개편 — 첫 화면 정보 밀도 강화

- **배경**: 사용자 요청 — 스크롤 없이 첫 화면에서 더 많은 정보를 볼 수 있도록 재설계 (디자인 재량 위임)
- **KPI 스탯 타일 6종** 신설: 도입 병원·도입 병상·유지보수 진행중(긴급 시 빨강)·이번주 구축·차주 예정·누적 도입률 — 기존 `/api/dashboard/summary`·`maintenance`·`hospital-stats` 재사용(신규 API 없음), 타일 클릭 시 관련 페이지 이동
- **2단 그리드**: 좌(2/3) 이번주·차주 구축 현황(비고 인라인 수정 유지, 날짜 MM/DD 축약·패딩 축소), 우(1/3) 유지보수 진행중 최신 7건(우선순위 점+상태 뱃지+상세 링크) + 종별 도입 현황(대형 테이블 → 도입/전국 미니 진행바로 압축)
- **차트 개선**: 이중 축(dual-axis) 차트 2개 → **단일 축 소형 멀티플 4개**(누적 병원/병상 라인, 신규 병원/병상 막대 — 병원=파랑·병상=초록 고정, 팔레트 CVD 검증 통과). 월별 표는 기본 접힘(토글), 엑셀 다운로드 유지
- 다크모드 클래스 전면 적용(구 페이지는 라이트 전용이었음), 컨테이너 max-w-6xl→7xl
- 검증: tsc 0오류 → 빌드 → 재시작 → `/`·대시보드 API 5종 인증 200
- 영향 파일: `app/page.tsx` (전면 개편), README.md

## 2026-07-20 | 자재관리 버그·개체 태그 + GW 배치 플래너 PROD 배포

- 커밋 2건(`38dd972` GW 플래너 Phase 0~2, `1e2e374` 자재관리 수정) push → PROD pull → `npm install`(sharp·pptxgenjs) → poppler-utils 확인(기설치) → 마이그레이션 2건 psql 적용+resolve(`20260719120000_gateway_plan_jobs`, `20260720100000_wms_unit_tags`) → prisma generate → 힙 4GB 빌드 → `pm2 restart thync-prod`
- 검증: login 200 · /gateway-planner·/inventory 307(인증 리다이렉트 정상) · 네비 2행(GW 배치 플래너·GW 배치 규칙, ADMIN 전용) · `inventory_units.tags` 컬럼 존재 · 재시작 후 신규 에러 0
- **GW 배치 플래너가 PROD에 함께 배포됨** (같은 main — ADMIN 전용 메뉴, 기존 모듈 무영향). 미노출 원하면 메뉴 관리에서 비활성 가능

## 2026-07-20 | 자재관리 — 출고 유형 400 버그 수정 + 태그를 개체(시리얼 단품) 단위로 이관

- **출고 버그**: 재고 입출고 모달을 '출고' 버튼으로 바로 열면 "전표 유형에 맞지 않는 입출고 유형입니다"(400) — 마스터 로드 시 reasonId를 무조건 **입고 유형 1번으로 시드**해서, 출고 탭에서 select는 첫 출고 유형을 표시하지만 실제 전송값은 입고 유형 ID였음. 시드 제거 + 현재 탭 목록에 없는 reasonId면 첫 항목으로 교정하는 정합성 effect 추가 (BulkSerialTxModal은 전환 시 리셋 구조라 무관)
- **개체 태그**: 사용자 피드백 — 태그는 품목이 아니라 **자재 개체(시리얼 단품)** 단위가 맞음. `inventory_units.tags`(TEXT[], 최대 10개) 추가(마이그레이션 `20260720100000_wms_unit_tags`), `PATCH /api/inventory/units/[id]`에 tags 지원(트림·중복 제거), 개체 목록 2곳(품목 마스터 상세·인벤토리 자재 상세)에 태그 컬럼 + '편집' 모달(`UnitEditModal` 신규 — 태그·메모, 처리 권한자). 품목 단위 태그 UI(2026-07-19 추가분)는 제거 — `inventory_items.tags` 컬럼·API는 백업 보존(deprecated)
- 검증: tsc 0오류 → 빌드 → E2E(시리얼 품목 생성→입고→개체 태그 PATCH(정규화 확인)→정상 출고→입고 유형으로 출고 시 400) 통과, 테스트 데이터 정리
- 영향 파일: TransactionModal, UnitEditModal(신규), units [id] API, 개체 목록 페이지 2곳, items/page(태그 UI 제거), prisma/schema.prisma, README.md

## 2026-07-19 | 게이트웨이 배치 플래너 — Phase 1·2 구현 (파이프라인 + UI, DEV 배포)

- **기능**: 도면 업로드 → 백그라운드 파이프라인(래스터화 pdftoppm → sharp 정규화 → Claude Vision 2×2 타일 공간 인식 + 전체 뷰 치수 판독 → robust median 스케일 후보 → 결정론적 배치 엔진) → 스케일 확정(AI 후보 승인/2점 보정/스케일 없이) → 배치 미리보기(SVG 오버레이) → **PPTX 생성**(A4 가로, 빨간 점 0.2cm 개별 도형 + 총대수 텍스트박스). 접근 ADMIN 이상, 신규 메인 네비 'GW 배치 플래너'(wifi 아이콘)
- **DB**: `gateway_plan_jobs` 테이블(마이그레이션 `20260719120000`, psql+resolve 적용) + nav_menu_items 2행(메인·설정, allowed_roles ADMIN). 배치 규칙은 AppSetting `gw_planner_rules`
- **신규 의존성**: sharp·pptxgenjs(npm), poppler-utils(시스템 — PROD 배포 시 `apt install poppler-utils` 필요)
- **파일**: `lib/gateway-planner/`(types·rules·vision·scale·placement·pptx·runner), `app/api/gateway-planner/jobs/*`(6 라우트), `app/api/settings/gateway-planner/`, `app/gateway-planner/`(메인·[id] 상세), `app/settings/gateway-planner/`, NavIcons(wifi)
- **검증(dev2)**: tsc 0오류 → 힙4GB 빌드 → pm2 재시작(200) → API E2E: good_1.jpg 업로드 → 분석(호출 5회, in 20k/out 7.5k 토큰) → NEED_SCALE(공간 87·후보 0.068m/px·미리보기 127대) → 스케일 확정 → 재배치 → PPTX 생성·다운로드(ellipse 127개·A4 가로·이미지·총대수 확인). 설정 GET 정상. E2E 잡(#1)은 UI 확인용으로 보존
- 미결: 성능튜닝(사용자 결정으로 추후), PROD 배포 시 poppler 설치 + 마이그레이션 적용 필요

## 2026-07-19 | 게이트웨이 배치 플래너 — Phase 0 인식 개선 라운드 (타일 분석 + 2-pass 검증)

- 사용자 피드백(우상단 복도 미검출·good_2 병실 미분리) 반영 개선 3종: **2×2 타일 분할 고해상도 분석**(`analyze2.mjs`, 실효 해상도 1.8배, IoU 병합+복도 세그먼트 이어붙이기), **2-pass 검증**(`verify.mjs`, 오버레이 재검수 교정), **프롬프트 보강**(복도 필수·호실 분리·인출선 추적)
- 결과: good_1 복도 4→5(날개 복도 검출)·화장실 1→8, good_2 병실 16→32(호실 단위 분리). 스케일은 robust median + "공간=타일·스케일=전체뷰" 조합으로 산포 41.6%→7.2%(good_1, 면적 표기 대비 2% 내)
- 복도 점이 통로 중앙선 등간격("형광등식") 배치 확인. 상세 비교는 `scripts/gateway-planner-phase0/RESULT.md` 개선 라운드 섹션
- 영향 파일: scripts/gateway-planner-phase0/(analyze2.mjs·verify.mjs 신규, place.mjs·render_spaces.mjs variant/robust scale), RESULT.md

## 2026-07-19 | 게이트웨이 배치 플래너 — 설계안 v0.2 + Phase 0 프로토타입 검증 완료

- **설계안** `function_gateway_planner.html` 작성(v0.1→v0.2): 도면 업로드 → Claude Vision 공간 인식 → 스케일 확정(사용자) → 결정론적 배치 엔진 → 편집 가능한 PPTX(A4 가로, 빨간 점 개별 도형) 파이프라인. 확정 — 접근 ADMIN 이상, 점 번호 없음, 제외공간(계단·EV·야외) 외 전 공간 배치 후 사람이 제거. 신규 의존성: poppler-utils(시스템)·sharp(설치됨)·pptxgenjs(미설치)
- **Phase 0 검증** (`scripts/gateway-planner-phase0/`, 결과 `RESULT.md`): 샘플 4종(`docs/gateway-planner-samples/` — CAD 2종·피난안내도 사진·Excel 개략도)으로 전처리→공간 인식(claude-opus-4-8, 1568px+그리드 오버레이, tool use)→치수 기반 스케일(중앙값)→배치(복도 8m 간격·병실 면적 1~2개)→점 오버레이 이미지까지 완주. good_1: 공간 58개·스케일 오차 병실 면적 대조 ±25% 내·95대 배치. 무치수 도면(bad_1)도 개소 기반 배치 동작. 발견: 인출선 화장실 인식 약함, 피난안내도류 복도 미검출 → RESULT.md에 Phase 1 반영사항 정리
- 영향 파일: function_gateway_planner.html(신규), docs/gateway-planner-samples/(신규 4), scripts/gateway-planner-phase0/(신규 — preprocess/analyze/render_spaces/place.mjs, RESULT.md, work/ 산출물), package.json(sharp)
- 다음 단계: 사용자 판정(work/*_placed.png) → Phase 1 코어 파이프라인 착수 여부 결정

## 2026-07-19 05:55 | 태그·비시리얼 LOT PROD 배포 + 센서 기초 재고 마이그레이션

- `446cb86` push → PROD pull → 마이그레이션 `20260719050000` 적용+resolve → 빌드 → 재시작 → 정상
- **PROD 데이터 마이그 1차**: 산소포화도센서(ITEM-0003) LOT 관리 켜기 → 903호 기초 재고 **170개 입고** (`STK-202607-0001`, devices.xlsx 대장 잔량 일치)
- 심전계·산소화도본체·게이트웨이는 시리얼 관리 — 현재고 시리얼이 대장에 미기재라 **실사 대기**. 출고중 개체 검증용 엑셀(`마이그검증_출고중시리얼.xlsx`, 356건: 심전계 119·산소포화도 135·GW 102, 본사회수대장 충돌 표시) 사용자 PC에 생성

## 2026-07-19 05:40 | 자재관리 — 품목 태그·비고 노출·비시리얼 LOT (마이그 2차 준비)

- **품목 태그**: `inventory_items.tags`(TEXT[], 최대 10개·30자, 중복 제거) — 폼 쉼표 입력, 목록 뱃지 표시
- **비고 노출**: 기존 `memo` 필드를 폼 라벨 '비고'로 변경 + 품목 목록에 비고 컬럼 (신규 컬럼 추가 없음 — 중복 필드 방지)
- **비시리얼 LOT**: LOT 관리 플래그를 시리얼과 독립 — 비시리얼 품목도 체크 가능. 전표 단위 `inventory_transactions.lot_no`(선택) 기록: 단건 모달 입고·출고 LOT 입력란, 이력 LOT 컬럼·Excel export, 전표 수정(ADMIN)으로 변경 가능. LOT 비관리 품목에 입력 시 400. 시리얼+LOT 품목의 개체 단위 필수 로직은 기존 유지
- 마이그레이션 `20260719050000_wms_item_tags_tx_lot` (DEV 적용)
- 검증: E2E 10케이스(태그 정규화·수정, 비시리얼 LOT 입출고·생략 허용·비관리 거부·전표 LOT 수정) 통과
- 영향 파일: prisma/schema.prisma, lib/inventory.ts, items API 3종(태그·플래그 독립), transactions API 2종, TransactionModal, TxEditModal, transactions/page, transactions/export, items/page(태그·비고·LOT 체크), README.md

## 2026-07-19 03:20 | 유지보수 개편 + 자재관리 보완 PROD 배포

- `bb2d12d` push → PROD pull → **사전 백업** `~/backups/db/thync_ops_pre_mnt_logs_20260719.dump`(maintenances 테이블) → 마이그레이션 2건 psql 적용+resolve(`20260718235500_maintenance_logs`: 비고 30건 이관·원인 85건 병합 — DEV와 동일 수치, `20260719023000_wms_requester_lot`) → prisma generate → 힙 4GB 빌드 → `pm2 restart thync-prod` → HTTP 응답 정상

## 2026-07-19 03:10 | 자재관리 보완 — 요청자·LOT 추적·전표 메타 수정 (실데이터 입력 준비)

- **요청자**: `inventory_transactions.requester`(자유 텍스트) — 출고 필수(서버 400)·입고 선택·이동 없음. 단건 모달/일괄 업로드 입력, 세트출고 자식 상속, 이력 컬럼·Excel export 반영
- **LOT 추적**: `inventory_items.is_lot_managed`(시리얼 품목만, 이력 생기면 변경 409 잠금) + `inventory_units.lot_no`. 신규 입고 시 LOT 필수(비관리 품목은 거부), 회수·출고 시 값이 있으면 개체 LOT 대조. 단건 입고 모달=전표당 LOT 1개, Excel 일괄=C열 행별 LOT. 품목 폼·목록 뱃지·Excel 가져오기 K열·개체 목록 LOT 컬럼
- **전표 메타 수정(ADMIN)**: 신규 `PUT /api/inventory/transactions/[id]` + TxEditModal — 유형(같은 시스템 동작 부류만: 일반↔일반/회수↔회수/폐기↔폐기, 그 외 409)·요청자·출고처·병원/업무·비고. 수량·품목·위치·시리얼은 불가(취소 후 재등록), 취소·이관(구) 전표 불가, 감사 로그 before/after
- 마이그레이션 `20260719023000_wms_requester_lot` (DEV 적용, 컬럼 3개 추가 — PROD 배포 시 적용 필요)
- 검증: dev2 E2E 17케이스(LOT 필수/금지/대조, 요청자 필수 단건·일괄, 메타 수정·부류 제한·권한) + 유지보수 처리기록 6케이스 통과, 테스트 데이터 정리
- 영향 파일: prisma/schema.prisma, lib/inventory.ts, `app/api/inventory/transactions/[id]/route.ts`(신규), bulk-serial/route.ts, items API 2종, items/import, `app/inventory/components/TxEditModal.tsx`(신규), TransactionModal, BulkSerialTxModal, transactions/page, items/page, 품목상세 2종(개체 LOT), transactions/export, README.md, function_wms.md

## 2026-07-19 01:55 | PROD 자재관리 테스트 데이터 정리 (실데이터 입력 준비)

- 사용자 요청으로 PROD WMS 가비지 데이터 삭제: 품목 8·재고 6·전표 22·개체 0·매핑 0 → TRUNCATE RESTART IDENTITY (품목 채번 ITEM-0001부터 재시작)
- **보존**: 인벤토리 4, 품목 분류 11, 위치 12, 재고 담당자 풀, 입출고 유형
- 삭제 전 백업: PROD `~/backups/db/thync_ops_pre_wms_cleanup_20260719.dump` (해당 6개 테이블, 31KB)

## 2026-07-19 00:20 | 유지보수 원인·조치·비고 개편 — 처리 기록 타임라인 (C안)

- **배경**: 비고 필드가 사실상 진행 경과 로그로 쓰임(Slack 붙여넣기 등, 평균 272자) + 전체 폼 일괄 저장이라 이력·작성자 없음. 설계 승인(C안) 후 개편
- **처리 기록 타임라인**: 신규 `maintenance_logs` 테이블(작성자 FK SetNull·Tiptap HTML·sanitize) + CRUD API(`/api/maintenances/[id]/logs`) + 상세 페이지 하단 `MaintenanceLogPanel` — 엔트리별 독립 저장, 수정·삭제는 본인+ADMIN
- **필드 재편**: 원인(cause)→조치 요약(resolution) 상단에 병합(HTML 이스케이프), 비고(notes)→처리 기록 이관(작성자 NULL='(구 비고 이관)', 시각=updated_at). `cause`·`notes` 컬럼은 백업용 보존(deprecated), API 입출력에서 제거. 폼은 증상+조치 요약만 남기고 완료 처리 시 요약 미작성이면 안내 배지
- **AI 어시스턴트**: listMaintenances에 recentLogs(최근 3건, 작성자·날짜 포함) 노출
- **신규 lib**: `lib/richtext.ts`(sanitizeRichTextHtml·isEmptyRichText — 위키 htmlText와 동일 규칙, 모듈 경계 때문에 별도 구현)
- **마이그레이션**: `20260718235500_maintenance_logs` (DEV 적용: 비고 30건 이관, 원인 85건 병합 — 멱등 가드 포함). **PROD 미적용** — 배포 시 psql 적용 + resolve 필요
- 검증: tsc --noEmit 통과, DEV DB 이관 데이터 확인. 빌드·재시작·E2E는 사용자 요청 시
- 영향 파일: prisma/schema.prisma, `app/api/maintenances/[id]/logs/*`(신규 2), `app/api/maintenances/route.ts`, `app/api/maintenances/[id]/route.ts`, `app/maintenances/MaintenanceForm.tsx`, `app/maintenances/MaintenanceLogPanel.tsx`(신규), `app/maintenances/[id]/page.tsx`, `lib/richtext.ts`(신규), `lib/ai/tools.ts`, README.md, CLAUDE.md(에디터 표)

## 2026-07-18 23:35 | Excel 일괄 입출고 PROD 배포

- `d210f2c` push → PROD pull → 힙 4GB 빌드 → `pm2 restart thync-prod` → HTTP 응답 정상 확인
- 스키마 변경 없음(마이그레이션 불필요 — Phase 10은 PROD 기적용 상태)

## 2026-07-18 23:20 | 자재관리 — 시리얼 품목 Excel 일괄 입출고 (마이그레이션용)

- 기존 엑셀 자재관리 데이터를 옮기기 위한 일괄 처리 기능. 입출고 이력 페이지에 'Excel 일괄 입출고' 버튼(재고 처리 권한자) — A열=품목명·B열=시리얼번호(1행 헤더) 업로드
- 구분(입고/출고)·인벤토리·위치·유형 선택 → 미리보기(행 단위 검증: 미등록 품목, 비시리얼 품목, 파일 내 중복, 기등록/미등록 시리얼, 위치·재고 상태 불일치) → 오류 0건일 때만 실행. **시리얼 관리 품목만** 대상, 품목별 전표 1건씩(품목명은 인벤토리 내 정확 일치), 최대 2000행, 전체 단일 트랜잭션(all-or-nothing, 실패 시 전부 롤백)
- 회수(RETURN)/폐기(DISPOSE) 등 유형별 시스템 동작은 기존 전표 로직 그대로 적용 — `createInventoryTransaction`을 계획(plan)/실행(apply)으로 분리해 일괄 처리가 동일 검증·시리얼 로직을 재사용
- 검증: dev2에서 API E2E 14케이스 통과(오류 검출 5종, 오류 시 실행 거부, 입고→중복 차단→위치 불일치 차단→출고→이중 출고 차단→회수 복귀), 테스트 전표는 취소로 원복
- README 자재관리 섹션의 "Phase 10 DEV만 반영" 주의 삭제 (PROD에 20260716100000 적용 확인됨 — 문서만 갱신)
- 영향 파일: `lib/inventory.ts`(plan/apply 분리), `app/api/inventory/transactions/bulk-serial/route.ts`(신규), `app/inventory/components/BulkSerialTxModal.tsx`(신규), `app/inventory/transactions/page.tsx`, `README.md`, `function_wms.md`

## 2026-07-18 22:25 | 문서 변경분 PROD 반영 (빌드·재시작 생략)

- 미푸시 커밋 87ae971(배포 기록) + CLAUDE.md 프로젝트 성격 섹션(f30bb77)을 push 후 PROD git pull
- 변경이 문서 2개(CLAUDE.md, DEV_HISTORY.md)뿐이라 빌드·PM2 재시작 생략 — thync-prod online, HTTP 응답 정상 확인

## 2026-07-18 22:17 | CLAUDE.md 프로젝트 성격 섹션 추가

- 이 프로젝트가 의료 시스템이 아니라 사내 업무관리 시스템임을 명시하는 "프로젝트 성격" 섹션을 CLAUDE.md 최상단에 추가. AI 세션이 도메인 용어(hospital 등)만으로 의료 프로젝트로 오분류하는 것을 방지하기 위함 (환자 데이터·PHI·임상 로직 없음을 명문화)
- CLAUDE.md 첫 줄의 bracketed-paste 잔여물(`[200~`) 제거
- 영향 파일: CLAUDE.md, DEV_HISTORY.md

## 2026-07-18 | AI 어시스턴트 — 답변 표 렌더링 개선 + 위키 AI 검색 제외 제어

- **배경**: 사용자 피드백 2건 — ①어시스턴트 답변의 표가 마크다운 파이프(`| a | b |`)로만 나와 가시성 저하 ②사내위키 중 어시스턴트에 포함되면 안 되는 영역을 제외하는 제어 필요
- **표 렌더링(①)**: `ReactMarkdown`에 `remark-gfm`(4.0.1) 미적용이 원인 — GFM 표가 렌더 안 됨. `app/ai-assistant/page.tsx`에 `remarkPlugins={[remarkGfm]}` + 커스텀 표 컴포넌트(테두리·헤더 강조·**가로 스크롤 래퍼**) 적용, 어시스턴트 말풍선 폭 75%→88%. `lib/ai/agent.ts` 프롬프트에 "표는 열 5개 이하로, 초과 시 핵심 열만 표+나머지 불릿 / 1~2건은 불릿" 가이드 추가
- **위키 AI 제외(②)**: `wiki.wiki_pages.ai_excluded`(bool, 마이그레이션 `20260718170000_wiki_ai_excluded`) 추가. 제외는 **하위 페이지 전체 cascade**(조회 시 재귀 CTE 계산 — `lib/wiki/aiExclusion.ts`: `getAiExcludedPageIds`/`isPageAiExcluded`). `lib/ai/tools.ts`의 `search_wiki`(notIn 필터)·`read_wiki_page`·`read_hospital_note`에서 제외 반영. 토글 API `PATCH /api/wiki/pages/[id]/ai-exclude`(ADMIN 전용, 감사로그). UI: 위키 페이지(블록·HTML 뷰) ADMIN에게 "AI 어시스턴트 검색 제외/해제" 메뉴·버튼 + 제외 시 앰버 배지. 카테고리에 걸면 그 영역 전체 제외
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드 → 재시작(200) → E2E: 카테고리 thync_1.3.0 제외 시 하위 13개 cascade·부정맥 검색 10→0→해제 후 복원 / PATCH API 200·권한·DB 반영·원복 / 실제 채팅 SSE로 "부정맥 Red·Yellow 표 정리" 요청 → search_wiki 10회 호출 후 **GFM 표 2개 포함 답변** 생성 확인
- **PROD 배포**: 커밋 `0f14a41` push → PROD pull → `npm install`(remark-gfm 4.0.1) → 마이그레이션 psql 적용+resolve → prisma generate → 힙4GB 빌드 → `pm2 restart thync-prod`(login 200) → 검증: ai_excluded 컬럼 존재·cascade CTE 13(카테고리+12문서)·ai-exclude 라우트 존재(미인증 307)·재시작 후 신규 에러 0(에러 로그 07-17 16:00)
- 영향 파일: `app/ai-assistant/page.tsx`, `lib/ai/{agent,tools}.ts`, `lib/wiki/aiExclusion.ts(신규)`, `app/api/wiki/pages/[id]/ai-exclude/route.ts(신규)`, `app/wiki/[id]/{page,WikiPageView,WikiHtmlPageView}.tsx`, `prisma/{schema.prisma,migrations/20260718170000_wiki_ai_excluded/}`, `package.json`(remark-gfm) / PROD: 소스·빌드·PROD DB(wiki.wiki_pages.ai_excluded 컬럼)

## 2026-07-18 | thynC 제품 산출물 문서 세트 12종 작성 → 사내위키 게시(dev2·PROD)

- **배경**: 사용자 요청 — thynC 솔루션(SEERS mobiCARE Console)은 운영 중이나 기능정의서·API규격서 등 기획/설계 산출물이 전무. PROD `/home/ubuntu/thynC`의 배포 산출물(백엔드 WAR·프론트엔드 2종·DB DDL)을 분석해 표준 산출물을 만들고 사내위키 `thync_1.3.0` 카테고리에 HTML 문서로 게시, AI 어시스턴트가 참조하도록 함
- **소스 분석**: PROD 산출물을 dev2로 회수 후 분석 — 백엔드 `mobiCARE_Console_thync-api-onpremise-01.01.431.war`(Spring Boot 2.3.12/Java8, CFR 디컴파일 컨트롤러 96개·엔드포인트 ~606), 서비스 콘솔 `thync.service M1.3.0.031`·관리자 콘솔 `thync.manager 1.0.1`(Vanilla JS SPA), DB DDL(MySQL 스키마 thync, 물리 1,847=논리 163 테이블·시계열 샤딩). 5개 분석 에이전트 병렬 수행
- **산출물 12종(HTML)**: 00 인덱스 / 01 시스템개요 / 02 아키텍처 / 03 기능정의서(서비스콘솔) / 04 기능정의서(관리자콘솔) / 05 API규격서(173KB·26도메인·94컨트롤러) / 06 DB설계서(163테이블) / 07 외부연동 / 08 알람·부정맥 정책 / 09 설치·배포 / 10 환경설정 / 11 용어·코드집. 공통 인라인 CSS 템플릿, 순수 HTML(위키 sandbox iframe 호환), 운영 비밀값 전부 마스킹, 근거 불명확 항목 (추정) 표기
- **게시 방식**: `scripts/publish-wiki-html-docs.mts`(신규) — manifest.json 기반으로 루트 카테고리(블록 페이지) + 하위 HTML 문서(pageType='html') 멱등 생성/갱신. API와 동일한 sanitize+plainText 추출 경유. 원본 HTML·manifest는 `docs/thync-product-1.3.0/`에 보존(재게시 가능)
- **AI 연동**: `search_wiki`가 plainText(HTML 페이지 포함)를 검색하므로 게시만으로 자동 참조. 추가로 `lib/ai/agent.ts` 시스템 프롬프트에 "제품 사양(기능/API/DB/알람/연동) 질문은 위키 thync_1.3.0 산출물을 먼저 검색" 힌트 1줄 추가
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드 → 재시작(HTTP 200, 포트 3000) → 12건 게시 → DB 확인(전 페이지 pageType=html·<style> 보존·<script> 제거·plainText 채워짐) → 검색 시뮬레이션(게이트웨이 35·부정맥 10 페이지 히트)
- **PROD 배포**: 커밋 `0c5a8eb` push → PROD git pull → 힙4GB 빌드 → `pm2 restart thync-prod`(login 200) → **사전 DB 백업**(`~/backups/db/thync_ops_pre_thync_docs_20260718.dump`, 14MB) → publish 스크립트로 12건 게시(카테고리 `1c357b24…`) → PROD DB 검증(전 페이지 html·style 보존·script 제거·plainText) → 검색 히트(부정맥 10) → wiki 페이지 307(인증 리다이렉트 정상) → 재시작 후 신규 에러 0(에러 로그 최종 수정 07-17 16:00)
- 영향 파일: `lib/ai/agent.ts`, `scripts/publish-wiki-html-docs.mts(신규)`, `docs/thync-product-1.3.0/(신규 12 HTML + manifest)`, `DEV_HISTORY.md`, `README.md` / PROD: 소스·빌드, PROD DB wiki 스키마(카테고리 1 + HTML 페이지 12행)

## 2026-07-18 | AI 어시스턴트 v2 (Phase 1~4·6) PROD 배포

- **배포**: dev2 커밋 2건(`c0a4e6c` v2 본체, `a325291` 선행 Phase 1 포함) push → PROD pull → **사전 백업**(`~/backups/db/thync_ops_pre_ai_v2_20260718.dump`, 14MB) → 마이그레이션 `20260718150000_ai_chat_tables` psql 적용+resolve → **PROD `.env` FLOWISE_* 제거** → prisma generate → 힙4GB 빌드 → `pm2 restart thync-prod`
- **스모크**: 도메인 login 200 · /ai-assistant·chat API 307(인증 리다이렉트 정상) · 재시작 후 신규 에러 0 (에러 로그 최종 수정 시각이 배포 전)
- **PROD 유의**: ANTHROPIC_API_KEY 실키 설정 완료(사용자, 배포 전). 병원 노트 루트 카테고리·페이지는 첫 사용 시 자동 생성. Flowise EC2(43.201.26.9)는 미결 #5대로 존치 — 종료 시점 별도 결정
- 영향: PROD DB(`ai_chat_sessions`/`ai_chat_messages` 신설), PROD 소스·빌드·env

---

## 2026-07-18 | AI 어시스턴트 v2 Phase 2·3·4·6 완주 — 도구 12종·캐싱·세션 UX·병원 노트·Flowise 폐기

- **배경**: 사용자 지시 — 로드맵 잔여 전체 진행 후 PROD 반영
- **Phase 2 (도구 완성+캐싱)**: 도구 8종 추가 — `list_site_visits`/`list_install_plans`/`list_etc_tasks`/`get_dashboard_summary`/**`aggregate_stats`**(metric 5종: new_contracts·completed_builds·maintenance_count·site_visit_count·new_hospitals — KST 기간, 그룹 분해)/`search_wiki`(snippet)/`read_wiki_page`/`read_hospital_note`(뒷부분 우선 8천자). 시스템 프롬프트 3축 재정비. **프롬프트 캐싱**: 도구 정의+시스템에 breakpoint, 가변 컨텍스트(날짜·병원)는 캐시 뒤 블록 — E2E에서 캐시 read 8152/write 0 확인
- **Phase 3 (세션 UX)**: `GET/DELETE /api/ai-assistant/sessions[/id]`(본인만, 도구 라벨 복원) + 좌측 사이드바(내 대화 목록·이어하기·삭제·병원 칩 복원, 모바일 드로어) + 전송 후 목록 갱신
- **Phase 4 (병원 노트)**: `lib/wiki/hospitalNote.ts`(이슈노트 패턴 복제 — 루트 `wiki_hospital_note_root_id`·refType `hospital_note`) + `/api/wiki/hospital-notes`(GET/POST 멱등 생성/**상담이력 append** — `@blocknote/server-util` 마크다운→블록, 날짜·상담자 헤더, 버전 스냅샷, 감사로그). 위키 보호 규칙 통합(pages POST/PUT/DELETE·move·duplicate — 루트 이동·삭제 차단/노트 이동 차단·삭제 ADMIN/직속 생성 차단/복제 시 참조 미복사). 병원 상세에 `HospitalNotePanel` 임베드(협업 편집 — CLAUDE.md 규칙 7 승인 예외 2 추가). 상담 정리 패널 개편: 문서유형 제거, "대기리스트 등록"→**"병원 노트에 추가"**. AI 정제 모델 `claude-opus-4-8` 교정. **상담 대기열 폐기**: `/api/ai-assistant/consultation` 삭제(테이블·모델은 이력 보존)
- **Phase 6 (Flowise 폐기)**: 프록시 `/api/ai-assistant` 라우트 삭제, dev2 `.env`·`.env.example`에서 FLOWISE_* 제거 (PROD env는 배포 시 제거). EC2 종료·문서 2건 이관은 추후 결정
- **기술 이슈**: `@blocknote/server-util` 정적 import가 Next 빌드 페이지 수집과 충돌 → 동적 import + `serverComponentsExternalPackages` 등록으로 해결(마크다운→블록 변환 정상화). SSE에 15초 하트비트 추가(Nginx read timeout 보호)
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드 → E2E — 집계(이번달 신규 계약 목록·병상합)/캐시 히트/위키 검색·본문(4회 검색 체이닝, 근거 없는 건 "없다" 답변)/병원 노트 생성→상담 append(마크다운 heading·bullet 블록 변환 확인)→GET→**어시스턴트 read_hospital_note로 과거 상담이력 재활용**/세션 목록·조회(도구 라벨)·삭제 204/보호 규칙 3종 400(노트 이동·루트 삭제·직속 생성). 테스트 데이터 정리 완료
- 영향 파일: `lib/ai/{tools,agent}.ts`, `lib/wiki/hospitalNote.ts(신규)`, `app/api/ai-assistant/{chat,sessions,sessions/[id],summarize}/`, `app/api/ai-assistant/{route,consultation}(삭제)`, `app/api/wiki/{hospital-notes(신규),pages,pages/[id],pages/[id]/move,pages/[id]/duplicate}/`, `app/wiki/components/HospitalNotePanel.tsx(신규)`, `app/hospitals/[code]/page.tsx`, `app/ai-assistant/page.tsx`, `next.config.mjs`, `.env(.example)`, `README.md`, `CLAUDE.md`, `function_ai_assistant.html`

---

## 2026-07-18 | AI 어시스턴트 v2 Phase 1 — 코어 에이전트 (tool use 실데이터 질의응답 + SSE 스트리밍 + 대화 영속화)

- **배경**: `function_ai_assistant.html` Phase 0 게이트 통과 (미결사항 확정: 모델 `claude-opus-4-8`·상담 대기열 폐기 예정·병원 노트 USER+·Flowise EC2 종료 추후 / **API 키 dev2·PROD 발급·유효성 확인**) → Phase 1 착수
- **DB(마이그레이션 `20260718150000_ai_chat_tables`)**: `ai_chat_sessions`(userId·hospitalCode·title) + `ai_chat_messages`(role·content·tool_calls·usage JSONB) — 세션 소유자만 접근, hard delete
- **에이전트**: `lib/ai/agent.ts` — `claude-opus-4-8` + adaptive thinking, `messages.stream()` 텍스트 델타 즉시 중계, tool use 루프 최대 8회(한도 도달 시 마무리 지시 주입), 도구 실패 is_error 전달, usage 집계
- **도구 4종**: `lib/ai/tools.ts` — `search_hospitals`(운영·계약 우선 랭킹 — E2E 중 "가나다순 20건 잘림에 실병원 매몰" 결함 발견·보완) / `get_hospital_overview`(도입형태·병상·담당자·장비·업무 카운트) / `list_projects`(상태·기간 필터) / `list_maintenances`(상태·우선순위·접수일 필터, HTML strip). 전부 read-only Prisma SELECT, row 상한 명시
- **API**: `POST /api/ai-assistant/chat`(신규) — SSE(`text`/`tool_start`/`done`/`error`), 세션 자동 생성(제목=첫 질문 40자)·소유자 403·병원 컨텍스트 주입, user/assistant 메시지 저장, 히스토리 최근 30개 텍스트 재구성. VIEWER 403
- **UI**: `app/ai-assistant/page.tsx` — Flowise 호출 제거 → SSE 스트리밍 파서(fetch reader), 어시스턴트 말풍선에 도구 진행 라벨("🔍 유지보수 조회 중...") 인라인 표시 + 인라인 로딩, done의 sessionId로 대화 이어하기, 선택 병원 hospitalCode 전송
- **검증(dev2, Phase 1 게이트)**: `tsc` 0오류 → 힙4GB 빌드 → 재시작 → **실데이터 E2E 5종 + 이어하기 통과**: ①병원검색(아산 20건 랭킹) ②병원현황(서울아산 — 도구 2연쇄, 유지보수 19건 DB 일치) ③기간집계(7월 유지보수 17건 — DB 정확 일치, 우선순위 분해) ④진행중 프로젝트 8건(지연 의심 자체 식별) ⑤복합(한양대 현황+유지보수 — 도구 3연쇄) ⑥세션 이어하기(도구 재호출 없이 맥락 답변). 세션·메시지 DB 저장 확인
- **미반영**: git push·PROD 배포 안 함 (사용자 dev2 테스트 후 요청 시)
- 영향 파일: `prisma/{schema.prisma,migrations/20260718150000_ai_chat_tables/}`, `lib/ai/{agent.ts,tools.ts}(신규)`, `app/api/ai-assistant/chat/route.ts(신규)`, `app/ai-assistant/page.tsx`, `README.md`, `function_ai_assistant.html`

---

## 2026-07-18 | 사내위키 HTML 문서 페이지 지원 PROD 배포

- **배포**: dev2 커밋 `a325291` push → PROD pull → 마이그레이션 `20260718120000_wiki_html_pages` psql 적용+resolve → prisma generate → 힙4GB 빌드 → `pm2 restart thync-prod`
- **dev2 검증**: 힙4GB 빌드 → 재시작 → API E2E 통과 — HTML 페이지 생성(sanitize: script·onload 제거, style 보존 확인)/상세 조회(pageType·plainText)/위키 검색 히트/문서 교체(PUT contentHtml)/블록 본문 저장 400/영구 삭제
- **백업 주의**: 사전 백업이 pg_dump 인증 문제로 1회 실패 → DDL(컬럼 추가, 데이터 무변경) 적용 직후 `~/backups/db/thync_ops_pre_wiki_html_20260718.dump`(14MB, DATABASE_URL 방식)로 확보. 추가 컬럼 외 데이터 동일하므로 복구 유효성 문제 없음
- **스모크(PROD)**: 도메인 login 200 · wiki API 307(인증 리다이렉트 정상) · 재시작 후 신규 에러 0 (에러 로그 최종 수정 시각이 배포 전 — GOOGLE_CALENDAR_ETC_TASK_ID 건은 기존 무관 이슈)
- 영향: PROD DB `wiki.wiki_pages` 컬럼 2개 추가, PROD 소스·빌드

---

## 2026-07-18 | 사내위키 HTML 문서 페이지 지원 (AI 어시스턴트 v2 기반 재설계)

- **배경**: 사용자 요청 — 앞으로 기능정의서·서비스 시나리오 등 산출물을 HTML로 작성해 위키에 게시하고, AI 어시스턴트가 HTML 문서도 지식으로 참조할 수 있도록 기반 구축
- **DB(마이그레이션 `20260718120000_wiki_html_pages`)**: `wiki.wiki_pages`에 `page_type`('block'|'html', 기본 block) + `content_html`(TEXT) 추가
- **저장 처리** `lib/wiki/htmlText.ts`(신규): sanitize(script 블록·인라인 이벤트 핸들러·`javascript:` URL·iframe/object/embed 제거 — 스타일·구조는 보존) + HTML→plain_text 추출 + `<title>` 추출. 본문 상한 2MB
- **API**: `POST /api/wiki/pages`에 `{pageType:'html', contentHtml}` 지원, `PUT /api/wiki/pages/[id]`에 `contentHtml` 문서 교체 지원(블록/HTML 본문 필드 상호 배타 400, HTML 페이지는 버전 스냅샷·백링크 생략), 복제 API가 `pageType`/`contentHtml` 동반 복사
- **UI**: 신규 작성 화면에 "🌐 HTML 문서 업로드" 카드(제목 `<title>`→파일명 자동, 미리보기 iframe, 템플릿 없어도 선택 화면 유지) + 상세 전용 뷰어 `WikiHtmlPageView`(신규 — sandbox iframe `allow-same-origin`만 허용해 스크립트 실행 차단, 높이 자동 조정, 제목 인라인 수정, 파일 교체·다운로드·휴지통, 즐겨찾기·열람로그 연동)
- **검색·어시스턴트 연동**: 저장 시 plain_text 추출로 기존 위키 검색(ILIKE+pg_trgm)에 자동 포함 — 향후 어시스턴트 `search_wiki`/`read_wiki_page` 도구(plain_text 기반)에서 추가 작업 없이 HTML 문서 참조 가능 (설계서 부록 A)
- **검증(dev2)**: `tsc` 0오류 · sanitize/추출 단위 테스트 14/14 통과(설계서 실파일 14K자 추출 포함) · DB 레벨 등록→plain_text 검색 히트→정리 확인. **빌드·PM2 재시작 미실행** (런타임 E2E는 빌드 요청 시 수행 예정)
- 영향 파일: `prisma/{schema.prisma,migrations/20260718120000_wiki_html_pages/}`, `lib/wiki/htmlText.ts(신규)`, `app/api/wiki/pages/{route,[id]/route,[id]/duplicate/route}.ts`, `app/wiki/{new/page.tsx,[id]/{page.tsx,WikiHtmlPageView.tsx(신규)}}`, `function_ai_assistant.html(부록 A)`, `README.md`, `CLAUDE.md`

---

## 2026-07-18 | AI 어시스턴트 v2 재구축 설계안 작성 (function_ai_assistant.html)

- **배경**: 사용자 요청 — 외부 Flowise RAG 프록시 기반 AI 어시스턴트의 실사용성 확보. 현행 분석 결과: RAG가 외부 EC2 블랙박스(문서 2건뿐), 병원 선택 미전달, 대화 휘발, AI 정제 모델 ID 무효(`claude-sonnet-4-5-20250514`), 상담 대기열 미소비 → **Flowise 폐기 + 에이전트형 직접 구현(B안)** 확정
- **역할 정의(3축, 사용자 요구 반영)**: ①CS 응대(위키 지식 기반 — 알람 기준·기능 안내) ②정보 조회(thynC 형상·병원 현황) ③영업·운영 현황 집계("이번주 신규계약", "A병원 이번달 유지보수 건수") — 특정 병원 히스토리 조회에 국한하지 않는 범용 업무 어시스턴트
- **설계 요지**: `@anthropic-ai/sdk` + tool use 에이전트 루프(read-only 도구 12종 — 병원·업무별 조회 + **aggregate_stats 집계** + 위키 검색/본문 + 병원 노트 읽기), SSE 스트리밍, 대화 영속화(`ai_chat_sessions`/`ai_chat_messages` 신규 2테이블), 프롬프트 캐싱, 세션 사이드바 UI
- **병원 노트(상담이력 자산화)**: 벡터DB 대신 프로젝트 이슈노트 패턴 복제 — 위키 '병원 노트' 시스템 카테고리 + `WikiPageReference` refType `hospital_note` 1:1 + 병원 상세 임베드 패널(컴포넌트 일반화, CLAUDE.md 규칙 7 예외 1건 추가 필요) + **상담 정제 결과를 노트에 append하는 파이프라인**(`/api/wiki/hospital-notes`) → `read_hospital_note` 도구로 재활용. pgvector는 규모 증가 시 확장 옵션으로 명시
- **로드맵**: Phase 0(승인) → 1(코어: 테이블+루프+도구4종+SSE) → 2(도구 12종+집계+캐싱) → 3(세션 UX) → 4(병원 노트+상담 append+AI 정제 수리) → 5(피드백 튜닝) → 6(Flowise 폐기)
- **미결사항**: DEV용 ANTHROPIC_API_KEY(dev2 placeholder), 모델 확정, 상담 대기열 폐기 여부, 병원 노트 append 권한, Flowise EC2 종료 시점 — Phase 0 게이트
- 영향 파일: `function_ai_assistant.html`(신규 — 시각화된 HTML 설계서: 아키텍처/시퀀스/ERD/파이프라인 다이어그램 포함, 초안 md는 HTML로 대체). 소스 코드 변경 없음

---

## 2026-07-18 | 목록 페이지 UX 보완 — 프로젝트 검색상태 유지 · 답사 한화면 표 · 답사/유지보수 필터·정렬 강화

- **배경**: 사용자 요청 3건 — ①프로젝트 상세에서 '목록으로' 복귀 시 검색 상태 유지 ②답사 목록 가로 스크롤 제거(한 화면 표시) ③답사·유지보수 목록 필터 확충 + 컬럼 헤더 정렬
- **프로젝트 검색 상태 유지**: 목록(서버 컴포넌트)의 URL 쿼리를 `ProjectFilters`가 sessionStorage(`projects:listQuery`)에 저장 → 상세의 '목록으로' 링크·저장/삭제 후 이동이 저장된 쿼리로 복귀
- **답사 목록 개편**: 컨테이너 max-w-7xl→full + 패딩 축소로 9컬럼 한 화면 표시(상단 동기화 스크롤바 제거), 서버 페이지네이션 폐기 — 전체 1회 로드(`limit=10000`) 후 클라이언트 필터·정렬. **필터 7종**: 병원명 검색 / 대웅담당자·담당자(실데이터 옵션 추출)·상태 select / 요청일·답사일·회신일 기간. **헤더 정렬** 전 컬럼(asc→desc→기본 해제, 빈 값 항상 뒤)
- **유지보수 목록 보강**: 서버 필터 재조회 방식 → 전체 1회 로드 + 클라이언트 필터로 전환. 기존 4필터에 **담당자 select + 접수일 기간** 추가, **헤더 정렬** 전 컬럼(우선순위는 긴급>높음>보통>낮음 랭크, 방문일은 첫 항목 시작일 기준)
- **공통**: 필터·정렬 상태 sessionStorage 보존(상세 다녀와도 유지, SSR 하이드레이션 불일치 방지 위해 mount 후 복원·복원 전 저장 금지), 총 N건(전체 M건) 표시, 필터 초기화 버튼
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드 → 재시작 → 실데이터 검증: 답사 100건·유지보수 215건 전체 로드 필드 무결, 필터 로직 재현 대조(병원명/대웅담당자 70건/요청일 6월 29건 경계 정확/우선순위·담당자 14건/접수일 6월 73건), 정렬 단조성(asc·desc·빈값 후순위), 페이지 4종 서버렌더 200 + 프로젝트 검색·정렬 쿼리 서버 필터 정상
- 영향 파일: `app/projects/{_components/ProjectFilters.tsx,[code]/page.tsx}`, `app/site-visits/page.tsx(개편)`, `app/maintenances/page.tsx(개편)`, `README.md`

---

## 2026-07-18 | 위키 본문 하이퍼링크 스타일 (파란색 + 밑줄)

- 사용자 요청 — 위키에서 텍스트에 링크를 걸어도 시각적 변화가 없어 링크 여부를 알 수 없음
- `wiki-theme.css`에 `.wiki-root .bn-editor a` 스타일 추가: `--wiki-accent` 파란색 + 밑줄(offset 2px), hover 시 옅어짐. 위키 상세·프로젝트 이슈노트 임베드 패널 모두 적용(같은 `.wiki-root` 스코프), 인라인 mention 링크도 동일 적용
- 영향 파일: `app/wiki/wiki-theme.css`

---

## 2026-07-17 | 차량예약 고도화 + 이슈노트 위키 전환 PROD 배포

- **배포**: dev2 커밋 2건(`8dcee79` 차량예약, `e3aa514` 이슈노트 위키 전환) push → PROD pull → **사전 백업**(`~/backups/db/thync_ops_pre_vehicle_issuenote_20260717.dump`, 14MB) → 힙4GB 빌드 → `pm2 restart thync-prod` (DB 마이그레이션 없음 — 스키마 변경 無)
- **이슈노트 이관 (PROD)**: `npx tsx scripts/migrate-issue-notes-to-wiki.mts` dry-run 확인 후 실행 — **22건 이관 완료**(빈 내용 3건 스킵), 위키 '프로젝트 이슈노트' 카테고리 하위 22페이지·`project_issue` 참조 22건 검증. 협업 서버(thync-collab-prod)는 기동 중이라 재시작 불필요(Y.Doc은 첫 열람 시 content_json으로 시딩)
- **스모크**: 도메인 login 200 · `/vehicle-reservations/mobile` 307(인증 리다이렉트 정상) · 재시작 후 신규 에러 0 (에러 로그의 GOOGLE_CALENDAR_ETC_TASK_ID 건은 배포 전부터 있던 무관 이슈 — 선택 환경변수 미설정)
- 영향: PROD 소스·빌드, PROD DB wiki 스키마(페이지 23행 — 루트 카테고리 1 + 이슈노트 22, 참조 22행, app_settings 1행). `projects.issue_note` 컬럼은 백업용 보존

---

## 2026-07-17 | 차량예약 — 미반납자 예약 차단 + 빠른 예약·반납 모바일 페이지

- **배경**: 사용자 요청 — ①반납 처리 안 한 이용자는 추가 예약 불가 ②앱 대신 폰에서 손쉽게 예약·반납하는 모바일 웹페이지
- **미반납자 예약 차단**: `POST /api/vehicle-reservations`에 가드 — 본인 예약 중 종료시각 경과 + `returnedAt` NULL(보드의 '반납필요'와 동일 정의)이 있으면 403 + 대상 건 안내 메시지(`unreturnedReservationId` 포함). 운행 중(종료 전) 예약은 차단 사유 아님. 반납 즉시 해제. 주간 보드에 경고 배너 + "바로 반납하기" 버튼(반납 모달 직행) 추가
- **빠른 예약·반납 모바일 페이지** `/vehicle-reservations/mobile` (max-w-md 단일 컬럼, 신규 API 없음):
  - **반납 섹션(최상단)**: 내 이용 중 예약 카드(운행중 파랑/반납필요 앰버 뱃지) → 탭하면 인라인 폼(최종 주행거리 — 직전 기록 placeholder 힌트, 비고) → 반납 완료. 반납 후 차량 lastOdometer 재조회·예약 차단 해제 반영
  - **예약 섹션**: 날짜+시작시각(30분 select) + 이용시간 칩(1/2/4시간·종일 09~18·직접입력 — 종료 날짜/시각) → 시간창 변경 시 250ms debounce로 해당 구간 예약 조회 → **차량 리스트에 가용성 실시간 표시**(가능=탭 선택, 충돌=예약자·기간 표시 dim) → 목적·행선지 입력 → 예약. 미반납 보유 시 앰버 안내 + 버튼 비활성(서버도 차단)
  - VIEWER·예약제한 계정은 조회만. 주간 보드 헤더에 "📱 빠른 예약·반납" 링크, 모바일 페이지에서 "주간 보드" 링크
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드 → 재시작 → E2E: 과거 미반납 예약 생성 → 신규 예약 403(안내 메시지 정확) → 반납 200 → 신규 예약 201 → 반납취소·예약취소로 원복(lastOdometer NULL 복원 확인), 모바일 페이지 200
- 영향 파일: `app/api/vehicle-reservations/route.ts`, `app/vehicle-reservations/{page.tsx,mobile/page.tsx(신규)}`, `README.md`

---

## 2026-07-17 | 프로젝트 이슈노트 → 사내위키 전환 (위키 페이지 임베드 + 기존 22건 이관)

- **배경**: 사용자 결정 — 이슈노트를 Tiptap 단일 HTML 필드 대신 위키 페이지로 관리(버전·작성자 추적·충돌 보호·첨부·검색 확보). 결정 사항: ①프로젝트 상세에서 인라인 편집(링크 아님) ②페이지는 생성 버튼으로 필요할 때만(빈 내용 프로젝트는 미생성) ③위키 트리에 전용 최상위 카테고리 '프로젝트 이슈노트'(이동 차단) ④프로젝트 삭제돼도 페이지는 카테고리에서 접근 유지 ⑤위키 쪽 삭제는 ADMIN만
- **연결 구조**: 루트 카테고리 페이지 id는 AppSetting `wiki_project_issue_root_id`(첫 생성 시 자동 발행), 프로젝트↔페이지 1:1은 `WikiPageReference` refType `project_issue`(FK 방향 규칙 준수 — DB 마이그레이션 없음). 헬퍼 `lib/wiki/projectIssueNote.ts`
- **전용 API** `/api/wiki/project-issue-notes`: GET(projectCode→페이지+본문 or null) / POST(생성 — USER+, 멱등, 루트 자동 보장, 감사로그)
- **보호 규칙(서버)**: 루트=이동·이름변경·템플릿화·삭제·복제 차단, 이슈노트 페이지=카테고리 밖 이동(부모 변경)·템플릿화 차단+삭제 ADMIN만(같은 부모 내 정렬은 허용), 일반 페이지의 카테고리 안 이동·직속 생성 차단, 복제 시 `project_issue` 참조 미복사(이슈노트 사본은 최상위 일반 페이지로), 참조 패널에서 `project_issue` 숨김. UI(사이드바 DnD·📂·＋, 상세 메뉴·제목 입력)도 동일하게 숨김 — tree API가 보호 정보(`projectIssueRootId`/`projectIssuePageIds`) 제공
- **임베드 패널** `app/wiki/components/ProjectIssueNotePanel.tsx`: 프로젝트 상세 이슈노트 카드에 위키 본문 인라인 편집 — 위키 상세와 동일한 실시간 협업(Y.Doc) 모드라 위키에서 동시에 열어도 일치, 협업 서버 미연결 시 스냅샷 읽기 전용 폴백. 미생성 시 "+ 이슈노트 생성" 버튼(USER+), "위키에서 열기" 링크. **메인→위키 import 승인 예외 1건**(CLAUDE.md 규칙 7에 명시) — 데이터 교환은 전부 HTTP
- **프로젝트 페이지**: 상세의 Tiptap `IssueNoteEditor` 제거(컴포넌트 삭제) → 패널 교체, 등록 폼의 이슈노트 textarea 제거(등록 후 상세에서 생성). `projects.issue_note` 컬럼·API 필드는 백업용 보존(deprecated)
- **기존 데이터 이관** `scripts/migrate-issue-notes-to-wiki.mts`(tsx ESM): issue_note 있는 프로젝트를 `@blocknote/server-util`로 HTML→블록 변환해 일괄 이관 — **DEV 22건 이관 완료**(빈 내용 3건 스킵), 멱등(재실행 시 기존 페이지 스킵). 협업 서버가 content_json으로 Y.Doc 1회 시딩하므로 추가 작업 불필요
- **검증(dev2)**: `tsc` 0오류, dry-run→실행→재실행 멱등 확인, DB 검증(카테고리 하위 22페이지·참조 22건·plain_text 정상)
- **미반영**: 빌드·PM2 재시작·git push 안 함 (DB 마이그레이션 불필요 — PROD 반영 시 소스 배포 + 이관 스크립트 1회 실행)
- 영향 파일: `lib/wiki/projectIssueNote.ts(신규)`, `app/api/wiki/{project-issue-notes(신규),pages,pages/[id],pages/[id]/move,pages/[id]/duplicate,pages/[id]/references,tree}/`, `app/wiki/{components/{ProjectIssueNotePanel(신규),WikiSidebar},[id]/{page,WikiPageView}}`, `app/projects/{[code]/page,new/page}`, `app/components/IssueNoteEditor.tsx(삭제)`, `scripts/migrate-issue-notes-to-wiki.mts(신규)`, `README.md`, `CLAUDE.md`

---

## 2026-07-16 | 자재관리 Phase 10 (인벤토리 완전 분리) PROD 배포

- **배포**: dev2 커밋 `20b310b` push → PROD pull → **사전 백업**(`~/backups/db/thync_ops_pre_wms_phase10_20260716.dump`, 14MB) → 마이그레이션 `20260716100000` psql 단일 트랜잭션 적용+resolve → prisma generate → 힙4GB 빌드 → `pm2 restart thync-prod`
- **PROD 백필 결과 검증**: 활성 이관 전표 0건(변환 이슈 없음). 품목 7→8종 — 두 인벤토리에서 쓰이던 `에바폼(903호_검정)`(ITEM-0007)이 평가용재고(299EA) 주 소속 + 대웅제약재고 복제 `ITEM-0012`(4EA)로 분리, 나머지 6종 단일 소속(사용 이력 없는 배터리 2종은 대웅제약재고 기본 배정). 활성 위치 4곳(903호·909호·B327호·사업지원팀) × 3인벤토리 = 12행 복제·참조 재매핑. **인벤토리별 총수량 보존 확인** — 대웅제약 5,577 / 평가용 4,949
- **스모크**: 도메인 login 200 · /inventory·API 307(인증 리다이렉트 정상) · 재시작 후 신규 에러 0
- **참고**: 사용 이력 없어 대웅제약재고로 기본 배정된 `배터리(909호_대웅)`·`배터리(903호)`는 소속이 다르면 삭제 후 원하는 인벤토리에 재등록 필요(품목 인벤토리는 변경 불가)
- 영향: PROD DB(품목·창고 inventory_id 귀속 + 분리 백필, is_transfer_locked 삭제), PROD 소스·빌드

---

## 2026-07-16 | 자재관리(WMS) Phase 10 — 인벤토리별 완전 분리 재설계 (품목·위치 귀속, 이관 폐지, 첫페이지 카드 섹션)

- **배경**: 사용자 요청 — 대웅제약재고/평가용재고/판매용재고 3개 인벤토리를 **완전 독립된 자재관리**로 전환. 같은 물건(MC200M-T)도 인벤토리마다 자재코드를 새로 따는 구조. 추가 요구: ①자재별 입출고 버튼 제거 → 섹션 단위 입고/출고 버튼 ②위치(창고)도 인벤토리별 독립 추가/삭제 ③첫페이지를 탭이 아닌 인벤토리별 카드 섹션으로
- **DB(마이그레이션 `20260716100000_inventory_scoped_items_warehouses`)**: `inventory_items.inventory_id`·`warehouses.inventory_id` NOT NULL FK 추가. **데이터 분리 백필(plpgsql, PROD 재적용 가능하게 범용 작성)** — 품목은 재고 합 최대 인벤토리를 주 소속으로, 그 외 사용 인벤토리마다 품목 복제(새 ITEM-NNNN 발번)+재고·개체·전표 재매핑(DEV: 게이트웨이→판매용 원본 + 평가용 복제 ITEM-0004). 활성 위치는 전 인벤토리에 복제(4곳×3), 참조 인벤토리별 재매핑. 위치명 UNIQUE → `(inventory_id, name)`. 수량 0 재고 스냅샷 사전 정리. `inventories.is_transfer_locked` 삭제. 인벤토리 갈라진 부자재 매핑 제거
- **이관(TRANSFER) 폐지(사용자 확정)**: 품목이 인벤토리 귀속이라 이관 개념 성립 불가 — 필요 시 A 출고 + B 입고로 처리. 전표 유형 IN/OUT/MOVE 3종, 과거 이관 전표는 '이관(구)'로 이력 표시만(취소 409). `to_inventory_id`/`transfer_date`/`transfer_price` 컬럼은 과거 전표 표시용 보존(deprecated)
- **lib/inventory.ts**: 전표의 인벤토리를 품목에서 파생(입력값 제거), 출발·도착 위치의 인벤토리 소속 검증(400), 회수 인벤토리 검증은 품목 격리로 자연 해소, 시리얼 가드에서 인벤토리 축 제거(품목=인벤토리)
- **API**: 품목 POST/import에 `inventoryId` 필수(+같은 인벤토리 내 이름 중복만 스킵), items/stocks GET에 inventoryId 필터(품목 소속 기준), 창고 POST에 `inventoryId` 필수·이름 중복 검사 인벤토리 내로, 부자재 매핑 같은 인벤토리 검증(409), 인벤토리 삭제 보호에 품목·위치 카운트 추가, stocks 버킷 모드는 위치 축만 반환
- **UI**: ①**첫페이지 `/inventory` = 인벤토리별 카드 섹션**(탭 제거) — 헤더에 품목 수·총수량·위치 수 + **입고/출고/이동 버튼**(품목은 모달에서 검색·선택), 행별 입출고 버튼 제거 ②**TransactionModal 재작성** — 인벤토리 고정 prop + 품목 선택 모드, 이관 UI 제거 ③품목 관리: 인벤토리 탭·컬럼·등록 폼 인벤토리 select(수정 불가)·Excel 가져오기 인벤토리 선택 ④품목 마스터/인벤토리 자재 상세: 단일 인벤토리 기준 정리(스코프 불일치 안내) ⑤이력: 이관 필터 제거·위치 필터 탭 스코프 ⑥`/settings/warehouses` 인벤토리별 섹션 재작성 ⑦`/settings/inventories` 이관 잠금 컬럼 제거
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드 → `pm2 restart thync-dev` → **런타임 E2E 23/23 통과**(품목·위치 인벤토리 귀속/타 인벤토리 위치 400/TRANSFER 400/같은 이름 품목·위치 타 인벤토리 허용·같은 인벤토리 409/병원 연결 인벤토리 제한/시리얼 품목 격리/부자재 동일 인벤토리 409/과거 이관 취소 409/재고 정합). 테스트 데이터 정리, 기존 실데이터 재고 무결(판매용 5·평가용 1)
- **미반영**: git push·PROD 안 함 (요청 시 마이그레이션 `20260716100000` 1건과 함께 반영 — 백필이 PROD 데이터에도 범용 동작)
- 영향 파일: `prisma/{schema.prisma,migrations/20260716100000.../}`, `lib/inventory.ts`, `app/api/inventory/{items,items/[id],items/[id]/components,items/import,stocks,stocks/export,transactions,transactions/export}/`, `app/api/settings/{warehouses,warehouses/[id],inventories,inventories/[id]}/`, `app/inventory/{page,components/TransactionModal(재작성),transactions/page,items/page,items/[id]/page,[invId]/items/[itemId]/page}`, `app/settings/{warehouses(재작성),inventories}/page.tsx`, `README.md`, `function_wms.md`

---

## 2026-07-14 | 운영 상태인데 완료 프로젝트 없는 병원 6곳 → 미계약 변경 (PROD·DEV)

- **배경**: 사용자 요청 — 병상 집계 정합화 후 남은 513병상 차이의 원인이던 "상태 '운영'인데 완료 프로젝트가 없는(전부 '보류') 병원"을 미계약으로 정리
- **변경(PROD·DEV 동일, DML)**: 좋은강안(200)·광주열린(120)·좋은삼정(98)·담양사랑(35)·강릉고려(30)·곡성사랑(30) 6곳 status 운영→미계약. **서울아산병원은 제외** — 완료 프로젝트는 없지만 '진행중' 프로젝트가 있어(공사 중) 미계약 전환은 별도 판단 필요, 운영 유지(병상 미입력이라 수치 영향 없음). DEV의 전남대(0병상, PROD엔 해당 없음)도 동일 사유로 유지
- **결과**: 사이니지 도입병상(summary) = 메인 누적 병상(monthly) **완전 수렴** — PROD 17,653 / DEV 17,402. 두 대시보드 병상 수치 불일치 건 종결
- **남은 데이터 과제**: 완료 프로젝트인데 bed_count 미입력 3건(광주보훈 1차·나은필 2차·원광대 2차) 입력 시 그만큼 가산됨
- 영향: PROD·DEV DB `hospitals.status` 6행씩 (소스 변경 없음 — 빌드·재시작 불필요)

---

## 2026-07-14 | 병상 집계 정합화 + 모델명 PROD 배포

- **배포**: dev2 커밋 3건(`6fa5810` 모델명, `889ebaf` 병상 집계 정합화, `5b1a581` 상태 동기화 규칙) push → PROD pull → **사전 백업**(`~/backups/db/thync_ops_pre_bedfix_20260714.dump`, 14MB) → 마이그레이션 `20260708220000_add_item_model_name` psql 적용+resolve(사용자 승인 — 7/8 작업 동반 배포) → **`scripts/sync-intro-beds-from-projects.sql` 실행**(상태→운영 0곳: 완료 프로젝트 보유 병원은 이미 전부 운영 / intro_beds 45곳 갱신) → prisma generate → 힙4GB 빌드 → `pm2 restart thync-prod`
- **동기화 규칙 추가(사용자 요청)**: 완료 프로젝트 1건 이상인 병원은 `status='운영'`으로 갱신 — 스크립트에 ② 단계로 포함(멱등)
- **PROD 수치**: 메인 누적 병상(monthly) **17,653**(187개 병원) / 사이니지 도입병상(summary) **18,166**(207개 병원). 잔여 513 차이 = 상태 '운영'인데 완료 프로젝트가 없는 6곳(좋은강안 200·광주열린 120·좋은삼정 98·담양사랑 35·곡성사랑 30·강릉고려 30 — 프로젝트가 준비/진행중/보류) → 해당 프로젝트 구축완료 처리 후 스크립트 재실행 시 수렴
- **스모크**: 도메인 307(인증 리다이렉트)·API 401(미인증) 정상, 재시작 후 신규 에러 0 (에러 로그의 gaxios 건은 배포 전부터 있던 Google Drive 연동 이슈로 무관)
- 영향: PROD DB(`inventory_items.model_name` 컬럼, `hospitals.intro_beds` 45행), PROD 소스·빌드

## 2026-07-13 | 병상 집계 정합화 — monthly 차수별 집계 전환 + 2차·3차 도입 introBeds 데이터 보정

- **배경**: 사용자 문의 — 메인 대시보드의 누적 병상(18,714)과 사이니지 월보드(`/dashboard`)의 도입병상(16,378) 불일치. 조사 결과 두 가지 문제: ①`/api/dashboard/monthly`가 완료 프로젝트 **건수마다** 병원 introBeds 전체를 합산 → 완료 프로젝트 2~3건(2차·3차 도입) 병원 22곳의 병상 중복 집계(+2,849 과대) ②`hospitals.intro_beds`는 수기 필드라 **2차·3차 도입 병상이 미반영**된 병원 13곳 존재(사용자 확인: 다중 프로젝트 = 차수별 추가 도입이 맞음)
- **monthly API 수정**: 신규 병상 = 완료 프로젝트(차수)별 `bedCount`를 각 차수의 서비스 시작월(endDateExpected 익월)에 집계, 신규 병원 = 병원별 최초 완료 프로젝트 월에 1회(2차·3차는 병상만 가산). 병원 introBeds 참조 제거. 수정 후 누적 병원 185 / 누적 병상 17,402
- **기준 원칙(사용자 확정)**: **프로젝트의 `bed_count`가 도입 병상의 기준 데이터.** `hospitals.intro_beds`는 완료 프로젝트 bed_count 합계를 따라간다
- **데이터 마이그레이션(DEV 완료)**: `scripts/sync-intro-beds-from-projects.sql`(멱등, 항상 재계산) — 완료 프로젝트 1건 이상 병원 전체 대상 `intro_beds = 완료 프로젝트 bed_count 합`. 1차 다중 프로젝트 13곳(+624: 강릉아산 40→161, 대청 120→240, 동탄시티 90→156, 새통영 104→169, 영암한국 60→120, 바로본 60→100, 광주씨티 10→50, 문산중앙 60→99, 나은필 NULL→30, 서울성심 80→100, 양평 30→40, 해남우리 50→60, 광주센트럴 76→79) + 2차 전체 동기화 30곳(단일 프로젝트 불일치 29곳: 삼성서울 41→0, 명지성모 212→177, 동아대 NULL→257 등 + 광주보훈 NULL→0) = 총 43행. 변경 전 값 백업 CSV 보관(scratchpad). 프로젝트 구축완료 처리 후 이 스크립트를 재실행하면 intro_beds가 따라옴
- **수정 후 수치(DEV)**: 메인 누적 병상(monthly) 18,714→**17,402**(=완료 프로젝트 bed_count 총합), 사이니지 도입병상(summary) 16,378→**17,915**. 잔여 513 차이 = 병원 상태 '운영'인데 프로젝트가 준비/진행중/보류인 6곳(좋은강안 200·광주열린 120·좋은삼정 98·담양사랑 35·곡성사랑 30·강릉고려 30) — 프로젝트 완료 처리 후 스크립트 재실행하면 수렴. 완료 프로젝트인데 bed_count 미입력 3건(광주보훈 1차·나은필 2차·원광대 2차)은 입력 필요(현재 0으로 집계)
- **검증(dev2)**: `tsc` 0오류, 집계 로직 SQL 재현으로 총계 일치 확인
- 영향 파일: `app/api/dashboard/monthly/route.ts`, `scripts/sync-intro-beds-from-projects.sql(신규)`, `README.md`, DEV DB `hospitals.intro_beds` 43행

## 2026-07-08 | 자재관리 품목 마스터에 모델명(model_name) 필드 추가

- **배경**: 사용자 요청 — 품목 필드에 모델명 필요 (제조사 모델 식별자, 규격(spec)과 별개)
- **DB(마이그레이션 `20260708220000_add_item_model_name`)**: `inventory_items.model_name` VARCHAR(100) NULL
- **반영 범위**: 품목 CRUD API(POST/PUT)·품목 폼(품목명 아래 입력)·품목 관리 목록 컬럼·자재 현황(품목명 옆 회색 표기)·품목 마스터/인벤토리 자재 상세(모델명 뱃지)·**검색**(품목명·모델명·코드·규격 통합 — 현황/품목 관리)·**Excel 가져오기**(2번째 컬럼으로 삽입: 품목명·모델명·대/중/소분류·제조사·규격·단위·시리얼여부·참고단가)·재고 현황 export(모델명 컬럼)
- **검증(dev2)**: `tsc` 0오류 → 빌드 → 재시작 → E2E(모델명 저장·모델명 검색 매칭 확인)
- **미반영**: git push·PROD 안 함 (요청 시 마이그레이션 1건과 함께 반영)
- 영향 파일: `prisma/{schema.prisma,migrations/20260708220000.../}`, `app/api/inventory/{items,items/[id],items/import,stocks,stocks/export}/`, `app/inventory/{page,items/page,items/[id]/page,[invId]/items/[itemId]/page}`

---

## 2026-07-08 | 자재관리(WMS) 전체 + 설정 메뉴 그룹화 PROD 배포 (Phase 6 완료)

- **배포**: dev2 커밋 `b7a4c76` push → PROD pull → **사전 백업**(`~/backups/db/thync_ops_pre_wms_20260708_0007.dump`, 14MB) → **DB 마이그레이션 8건** psql 순차 적용+resolve(`20260707120000`~`20260708200000` — WMS Phase 1~9 전체 + link_hospital + 이관 필드·메뉴 그룹) → prisma generate → 힙4GB 빌드 → `pm2 restart thync-prod`. npm install 불필요(신규 패키지 없음)
- **PROD DB 검증**: `inventories` 3행(대웅제약재고 link_hospital=t / 평가용재고 잠금 / 판매용재고), 입고 유형 3·출고 유형 5 시드, 설정 메뉴 그룹 7종(일반/조직·계정/병원·구축/업무 유형·상태/자재관리 6메뉴/차량/연동·알림), migrate status "up to date"
- **스모크**: login 200 · 도메인 200 · /inventory·이력·설정 2종 307(인증 리다이렉트 정상) · 재시작 직후 구버전 클라이언트의 Server Action 미스매치 외 신규 에러 0
- **PROD 초기 상태**: 자재관리 메뉴는 SEERS 소속만 노출(메뉴 관리에서 변경 가능). 품목·창고·분류 마스터는 시드(분류 4종·위치 2종)만 있음 — 실운영 시작 시 품목 등록(Excel 가져오기)·초기 재고 입고 필요
- 영향: PROD DB(테이블 9종 신설·status_codes 시드·nav_menu_items 8행+그룹 라벨), PROD 소스·빌드

---

## 2026-07-08 | 자재관리 이관 보완(일자·단가·창고 자동선택) + 설정 메뉴 기능별 그룹화

- **배경**: 사용자 피드백 2건 — ①이관 시 수량·일자·단가 입력 필드 필요(대웅제약재고→판매용재고 이관은 대웅이 재판매하는 개념. 단가는 참고용 선택값, 일자는 기본 오늘). "이관을 해보면 입력할 필드가 없다" — 기본 선택 창고에 재고가 없으면 버킷·수량 UI가 비활성으로 보이던 UX 문제 ②설정 하위 메뉴 25개가 평면 나열되어 가독성 저하 — 기능별 그룹 계층 필요
- **DB(마이그레이션 `20260708200000_transfer_fields_and_settings_groups`)**: `inventory_transactions.transfer_date`(DATE)·`transfer_price`(INT, 참고용) + `nav_menu_items.group_label`(VARCHAR(50)) 추가. 설정 하위 25개 메뉴에 그룹 라벨·정렬 재부여 — **일반**(내 프로필·메뉴 관리) / **조직·계정**(소속·필드 엔지니어) / **병원·구축**(병원 상태·도입형태·구축상태·공사업체·기기·답사 상태) / **업무 유형·상태**(장애유형·유지보수/기타업무 상태·상담/문서유형) / **자재관리**(인벤토리·창고·품목 분류·제조사·입출고 유형·재고 담당자) / **차량** / **연동·알림**(심평원·메일·Slack)
- **이관(TRANSFER) 보완**: 모달에 **이관일자**(date, 기본 오늘 KST)·**이관 단가**(원, 선택) 필드. 서버 검증(날짜 형식·음수 단가 400) + DATE 컬럼 UTC 자정 고정으로 날짜 밀림 방지. 이력·인벤토리 자재 상세·Excel export에 이관일자·단가 표시. **재고 있는 창고 자동 선택** — 출고/이동/이관 모달을 열 때 현재 선택 창고에 재고가 없으면 재고 있는 창고로 1회 자동 전환(빈 화면 방지). 수량 필드는 비시리얼 공통 입력, 시리얼은 직접 입력/스캔·목록 선택 그대로
- **설정 메뉴 그룹화**: Navigation 설정 아코디언이 `group_label` 기준 **그룹 헤더 + 항목** 구조로 렌더(그룹 순서 = 정렬순 첫 등장). 메뉴 관리 페이지 설정 하위 테이블에 '그룹' 컬럼(인라인 편집)·추가 폼에 그룹 입력 — 그룹명은 자유 텍스트라 신규 그룹도 즉시 생성 가능
- **검증(dev2)**: `tsc` 0오류 → 빌드 → 재시작 → E2E: 이관 일자/단가 저장(지정일 2026-07-08 정확 저장·미지정 시 오늘 기본·단가 미입력 NULL·음수 400), 이관 취소 원복, nav API 그룹 7종 순서·자재관리 그룹 6메뉴 확인. 테스트 전표는 취소로 원복
- 영향 파일: `prisma/{schema.prisma,migrations/20260708200000.../}`, `lib/inventory.ts`, `app/api/inventory/transactions/{route,export/route}.ts`, `app/api/settings/nav-menus/{route,[id]/route}.ts`, `app/inventory/{transactions/page,components/TransactionModal,[invId]/items/[itemId]/page}`, `app/components/Navigation.tsx`, `app/settings/nav-menus/page.tsx`

---

## 2026-07-08 | 자재관리(WMS) — 인벤토리 자재 상세 라우트 분리 (`/inventory/[invId]/items/[itemId]`)

- **배경**: 사용자 피드백 — 인벤토리 탭에서 자재 클릭 시 품목 마스터 페이지(전체 정보)로 이동해 인벤토리 분리가 무의미. 직전의 `?inv=` 쿼리 컨텍스트 승계는 클라이언트 전환 시점에 URL을 읽는 버그로 미동작(현황 페이지 탭이 URL에 반영되지 않은 상태에서 신규 페이지가 이전 주소를 읽음). **쿼리 방식 폐기, URL 경로 레벨로 인벤토리 승격** 재설계(사용자 승인)
- **신규: 인벤토리 자재 상세** `/inventory/[invId]/items/[itemId]` — 경로에 인벤토리 고정. 인벤토리 뱃지 헤더 + 이 인벤토리의 재고 총량·위치별 칩 + 이 인벤토리의 입출고 이력(이관은 출발→도착 방향 표시)·개체 목록만 표시. 다른 인벤토리/전체 탭 없음(철저 분리). "품목 마스터 보기" 링크 제공
- **전표 모달 인벤토리 고정 모드**: `fixedInventoryId` prop — 인벤토리 자재 상세에서 열면 입고/출고/이동/이관 전부 해당 인벤토리로 고정(select disabled `(고정)` 표시, 버킷도 해당 인벤토리만 로드). 기존 `defaultInventoryId`(현황 탭 기본값, 변경 가능)와 별개
- **품목 마스터 상세 정리** (`/inventory/items/[id]`): 어정쩡한 인벤토리 탭 제거 → 기준정보·부자재 구성 관리 + **인벤토리별 재고 요약 카드**(카드 클릭 → 해당 인벤토리 자재 상세로 이동) + 전체 이력·개체 목록. breadcrumb `자재 현황 / 품목 마스터 / 코드`
- **진입 규칙**: 현황·이력의 인벤토리 탭에서 자재 클릭 → 인벤토리 자재 상세 / 전체 탭·품목 관리에서 클릭 → 품목 마스터 상세
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드(신규 라우트 등록 확인) → 재시작 → 스코프 라우트 3종·마스터·현황 200, 스코프 데이터 분리(평가용=개체 2·전표 1건만)는 API 레벨 재확인, 신규 에러 로그 0
- 영향 파일: `app/inventory/[invId]/items/[itemId]/page.tsx(신규)`, `app/inventory/{page,transactions/page,items/[id]/page,components/TransactionModal}`, `README.md`, `function_wms.md`

---

## 2026-07-08 | 자재관리(WMS) Phase 9 보완 — 인벤토리 분리 레벨 상향·병원연결 제한·시리얼 바코드 대량 출고

- **배경**: 사용자 피드백 4건 — ①탭에서 입출고 열면 인벤토리 기본값이 대웅제약 고정 ②이력·개체목록도 인벤토리 분리 필요(분리 레벨 상향) ③병원 연결은 대웅제약재고 출고만 ④재고 1만 개·1회 100~200개 출고 — 체크박스로 불가, 시리얼 직접 입력/바코드 스캔 필요
- **DB(마이그레이션 `20260708150000_add_inventory_link_hospital`)**: `inventories.link_hospital`(BOOLEAN DEFAULT false, 대웅제약재고만 true) — 병원 연결 허용 인벤토리 플래그. 설정 페이지·API에 편집 칼럼 추가
- **인벤토리 분리 레벨 상향**: 입출고 이력 페이지에 **인벤토리 탭**(전체/3종, 기존 select 필터 승격), 품목 상세에 **인벤토리 탭**(재고 칩·총재고 카드·입출고 이력·시리얼 개체 목록이 탭 기준으로 분리 조회). 현황↔이력 이동 시 `?inv=` 쿼리로 탭 유지
- **품목 상세 인벤토리 컨텍스트 승계**: 현황·이력의 인벤토리 탭에서 품목 클릭 시 `?inv=`로 상세 진입 → 상세가 그 인벤토리로 스코프되어 열림(재고·이력·개체 전부 해당 인벤토리만, breadcrumb에 인벤토리명 표시, 탭 전환 시 URL 동기화). 부자재↔주자재 상호 링크·자재현황 복귀 링크도 컨텍스트 유지. 데이터 근거: 재고·개체·전표 레코드마다 `inventory_id` 독립 컬럼 보유(품목 기준정보만 인벤토리 공통)
- **전표 모달 탭 컨텍스트**: `defaultInventoryId` prop — 현재 탭의 인벤토리가 기본 선택(입고=마스터 select preselect, 출고/이동/이관=해당 버킷 우선 선택)
- **병원 연결 제한**: 출고 폼의 병원 검색·업무 연결은 `linkHospital` 인벤토리에서만 노출, 서버도 검증(그 외 인벤토리에 hospitalCode 오면 400). 평가용/판매용은 출고처 텍스트만
- **시리얼 대량 출고 (바코드 스캔)**: 출고/이동/이관의 개체 지정을 **시리얼 직접 입력 textarea**(줄 단위 붙여넣기·바코드 리더기 연속 스캔)로 전환 — `lib/inventory.ts`가 `serials[]`를 개체로 해석(미등록 시리얼 400·버킷 불일치/비재고 409, 문제 시리얼 최대 10건 명시). 가용 개체 목록(최대 200개 표시)에서 클릭 추가/제거 병행, 기존 `unitIds` 경로도 유지
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드 → 재시작 → **E2E 11/11 통과**(linkHospital 플래그·판매용+병원 400/대웅+병원 성공·시리얼 200개 벌크 입고→120개 직접입력 출고→30개 이관·미등록 시리얼 명시 400·출고된/타 인벤토리 시리얼 409·이력 인벤토리 분리). 테스트 데이터 정리(사용자 수기 입고분 평가용 2EA 보존)
- **미반영**: git push·PROD 안 함 (Phase 6 일괄, 마이그레이션 누적 6건)
- 영향 파일: `prisma/{schema.prisma,migrations/20260708150000.../}`, `lib/inventory.ts`, `app/api/settings/inventories/{route,[id]/route}.ts`, `app/inventory/{page,transactions/page,items/[id]/page,components/TransactionModal}`, `app/settings/inventories/page.tsx`, `function_wms.md`

---

## 2026-07-08 | 자재관리(WMS) Phase 9 — 인벤토리 재설계(3분리·이관)·주자재/부자재·유형 설정화·출고처·Excel export

- **배경**: 사용자 재설계 요청. 소유×용도 2차원(Phase 7) 폐기 → **인벤토리 1차원**으로 전환. 재고 = **품목×위치×인벤토리**(대웅제약재고/평가용재고/판매용재고 — 같은 품목도 인벤토리별 수량·입출고 완전 독립). PROD 미배포 시점이라 구조 교체 부담 없음
- **DB(마이그레이션 `20260708100000_redesign_inventory_inventories`)**: `inventories`(시드 3행, `is_transfer_locked` — 평가용 true) + `inventory_item_components`(주자재-부자재 매핑, 구성 수량, 1단계 깊이) 신설. stocks/transactions/units의 `owner_id`/`purpose_id` → `inventory_id` 치환(기존 데이터 **판매용재고** 백필 — 사용자 확정), stocks PK 3컬럼 재구성. transactions에 `to_inventory_id`(이관)·`destination`(출고처)·`parent_tx_id`(세트출고)·`reason_id`(유형 FK) 추가, `reason` VARCHAR 제거. STOCK_OWNER/PURPOSE StatusCode 삭제, `STOCK_IN_TYPE`/`STOCK_OUT_TYPE` 시드(회수 `RETURN`·폐기/불량 `DISPOSE` value = 시스템 유형). **안전재고 제거**(`safety_stock` 컬럼·부족 뱃지·`notify_stock_enabled`·`maybeNotifyLowStock` — 사용자 확정, 수량·입출고 집중), '실사조정' 유형 미시드
- **이관(TRANSFER) 규칙**: 신규 전표 유형 — 출발·도착 인벤토리 모두 잠금 해제여야 허용. **대웅제약↔판매용 상호 이관, 평가용재고는 양방향 금지**(409). 시리얼 개체는 이관 시 `inventory_id` 소속 변경, 회수(반품)는 원래 인벤토리로만(우회 이관 차단 400). 취소는 역방향 복원
- **주자재/부자재 + 세트출고**: 품목 상세 "부자재 구성" 카드(추가·수량·해제, ADMIN). 부자재↔주자재 겸직 금지(1단계, 409). 출고 모달 "부자재 함께 출고" — 비시리얼 부자재를 같은 위치·인벤토리에서 자동 차감(수량=출고수량×구성수량, 수정 가능), 자식 전표 `parent_tx_id` 연결, **부모 취소 시 자식 일괄 취소**, 부자재 재고 부족 시 전체 롤백 409. 시리얼 부자재는 세트 제외(개별 출고 안내)
- **입출고 유형 설정화**: `/settings/stock-reasons`(입고/출고 2섹션, StatusCodeManager 재사용) + 공용 핸들러 `lib/stockReasonApi.ts`. 시스템 유형(value)·사용 중 유형 삭제 409, 카테고리 불일치 전표 400
- **출고처**: OUT 전표 `destination` 자유 텍스트(유관부서 출고요청 구조 — 평가용/판매용은 병원 미연결 가능) + 기존 병원/업무 연결 병행(대웅제약재고 권장)
- **Excel export**: 재고 현황·입출고 내역 다운로드(`stocks/export`·`transactions/export`, 화면 필터 그대로, 기존 `xlsx` 쓰기 재사용 — 신규 패키지 없음). 이력에 기간(from/to) 필터 추가
- **UI**: `/inventory` 인벤토리 탭(전체/3종) + 주자재·부자재 뱃지, 전표 모달 4유형(인벤토리 select 1개·이관 도착 선택·출고처·세트출고), 이력 인벤토리 필터·이관 `A → B` 표기·세트 표기, 품목 상세 개체 목록 **인벤토리/위치/설치처 컬럼 분리**(DB도 전 필드 독립 컬럼 — 사용자 요청 확인), `/settings/inventories`(잠금 토글) 신설, `/settings/stock-types`(소유/용도) 제거. nav 메뉴 치환+추가
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드 → `pm2 restart thync-dev` → **런타임 E2E 30/30 통과**(인벤토리 독립 입출고·초과출고 409·이관 허용/양방향 잠금 409·이관 취소 복원·부자재 매핑 규칙 4종·세트출고 차감/부족 롤백/부모취소 동반취소·시리얼 이관/회수 규칙·유형 CRUD/삭제보호·export 2종·이력 필터). 테스트 데이터 정리, 기존 실데이터(게이트웨이 5EA→판매용재고) 백필 무결
- **미반영**: git push·PROD 안 함 (Phase 6에서 마이그레이션 누적 5건 일괄 배포 예정)
- 영향 파일: `prisma/{schema.prisma,migrations/20260708100000.../}`, `lib/{inventory.ts(재작성),inventoryQuery.ts(신규),stockReasonApi.ts(신규),notify.ts}`, `app/api/inventory/{transactions(+export),stocks(+export),units,items,items/[id](+components),items/import}/`, `app/api/settings/{inventories(신규),stock-in-type(신규),stock-out-type(신규),stock-owner·stock-purpose(삭제),notifications}/`, `app/inventory/{page,transactions/page,items/page,items/[id]/page,components/TransactionModal}`, `app/settings/{inventories(신규),stock-reasons(신규),stock-types(삭제),notifications/page}`, `app/hospitals/[code]/_components/InventoryUsageCard.tsx`, `function_wms.md`(§4-10·Phase 9)

---

## 2026-07-07 | 자재관리(WMS) Phase 7·8 — 재고 구분 2차원(소유×용도)·계층 분류·제조사 + 검수 보완 5건

- **배경**: `function_wms.md` Phase 7·8 (Fable 직접 구현). 같은 품목이라도 소유(대웅제약/씨어스)·용도(판매/평가/기타)가 다르면 별개 재고로 — 재고 = **품목×위치×소유×용도** 4차원. 품목 기본정보에 대>중>소 계층 분류·제조사 추가. 구현 전 OPUS Phase 1~5 전수 검수 수행
- **Phase 7 (마이그레이션 `20260707150000`)**: StatusCode `STOCK_OWNER`(씨어스/대웅제약 재고)·`STOCK_PURPOSE`(판매/평가/기타) 시드. stocks/transactions/units에 `owner_id`/`purpose_id`(기존 행 (씨어스,기타) 백필→NOT NULL), **stocks PK 4컬럼 재구성**. **구분 간 전환 없음**(입고 시 확정·CONVERT 미구현, 회수도 원래 구분만 허용·400). MOVE는 같은 버킷 내 위치만 변경. 시리얼 개체도 버킷 보유 — OUT/MOVE 시 버킷 일치 강제. 설정 `/settings/stock-types`(소유·용도 2섹션, 공용 `StatusCodeManager` 컴포넌트 신설), 사용 중 구분 삭제 409. 전표 모달: IN=소유·용도 자유 선택, OUT/MOVE=재고 있는 버킷 select(가용수량 표시), 시리얼은 버킷 선택 후 개체 로드. 현황 칩 `위치·소유·용도 N` + 소유/용도 필터, 이력·품목상세·개체목록에 구분 표시
- **Phase 8 (마이그레이션 `20260707160000`)**: `inventory_categories`(계층 트리, parent_id·COALESCE UNIQUE·**3단계 제한/중복명/사용·하위 존재 삭제 409는 API 검증**). 기존 StatusCode ITEM_CATEGORY 4행 → 대분류 무손실 이관(FK 교체) 후 구 행 삭제. 제조사 = StatusCode `MANUFACTURER` + `/settings/manufacturers` + `items.manufacturer_id`. `/settings/item-category`는 트리 UI로 전면 재작성(들여쓰기·+하위·형제 순서). 품목 폼 대>중>소 연동 select, 목록·현황·상세에 분류 경로(`전자제품 > 모니터`)·제조사 표시, 분류 필터는 후손 포함. Excel 컬럼 확장: `품목명|대분류|중분류|소분류|제조사|규격|단위|시리얼여부|안전재고|참고단가`(경로·이름 매칭, 미매칭 경고)
- **검수 보완 5건 (OPUS Phase 1~5 대상)**: ①품목 PUT `isSerialManaged` 잠금(이력 존재 시 409 — 설계 요구인데 미구현이었음) ②이력 있는 품목 DELETE→비활성화 전환(기존엔 FK 500) ③창고 DELETE 보호(재고 잔존 409 / 이력 시 비활성화) ④**시리얼 동시성 가드** — 개체 갱신을 조건부 updateMany(상태·위치·버킷 where)+건수 검증으로 교체(동시 요청 이중 출고 차단), 취소 원복도 동일 ⑤IN 전표 취소 시 안전재고 알림 훅 + 전표코드 P2002 동시 채번 재시도
- **검증(dev2)**: `tsc` 0오류 → 힙4GB 빌드 → `pm2 restart thync-dev` → 신규 라우트 스모크 → **런타임 E2E 31/31 통과**(버킷 독립 차감·교차출고 409·이동 버킷 유지·취소 복원·시리얼 버킷 일치·회수 구분전환 400·분류 4단계 400·중복명/사용 중 삭제 409·분류경로·잠금 409·비활성화 전환). 테스트 데이터 정리, 기존 실데이터(게이트웨이 2EA) 백필 무결 확인
- **미반영**: git push·PROD 안 함(사용자 검토 후 Phase 6 진행 예정 — 마이그레이션 누적 4건). 모바일 카드 뷰는 후속(가로 스크롤로 대응 중)
- 영향 파일: `prisma/{schema.prisma,migrations/2026070715·16...}`, `lib/inventory.ts`(재작성), `lib/notify.ts`, `app/api/settings/{stock-owner,stock-purpose,manufacturers,item-category,warehouses/[id]}/`, `app/api/inventory/{items,items/[id],items/import,stocks,transactions,transactions/[id]/cancel,units}/`, `app/settings/{_components/StatusCodeManager.tsx(신규),stock-types(신규),manufacturers(신규),item-category}/`, `app/inventory/{page,transactions/page,items/page,items/[id]/page,components/TransactionModal}`

---

## 2026-07-07 | 자재관리(WMS) Phase 2~5 — 재고 원장·입출고·시리얼·병원연동·안전재고 알림

- **배경**: `function_wms.md` Phase 2~5 일괄 진행. Phase 1 마스터 위에 실제 재고 이동(입고·출고·이동·취소)·시리얼 개체 추적·병원/업무 연동·안전재고 Slack 알림 구축
- **DB(마이그레이션 2건)**: `20260707130000` — `inventory_stocks`(품목×위치 현재고 스냅샷, `CHECK quantity>=0`), `inventory_transactions`(입출고 원장 append-only, `tx_code=STK-YYYYMM-NNNN`, hospital/work_type/ref_code 포함). `20260707140000` — `inventory_units`(시리얼 개체 IN_STOCK/OUT/DISPOSED) + `inventory_transaction_units`(전표-개체 조인). schema 4모델 + Item/Warehouse/User/Hospital 역관계 → generate
- **핵심 로직 `lib/inventory.ts`**: `createInventoryTransaction`/`cancelInventoryTransaction`을 `prisma.$transaction`으로 원자 처리. 재고 감소는 조건부 `updateMany(quantity>=n)` + DB CHECK 이중 방어(음수 불가). 시리얼: IN 벌크입력·중복검사, `회수(반품)`은 기존 OUT 개체 복귀, OUT 개체선택(폐기/불량→DISPOSED), MOVE 위치이동. 취소는 역방향 되돌림 + `canceled_at` 마킹(역전표 미생성), 음수/개체이동 시 409. 스냅샷·개체·원장 정합을 한 트랜잭션에서 보장
- **API**: `inventory/transactions`(목록/등록), `[id]/cancel`, `stocks`(품목별 위치 집계+부족판정), `units`(조회)·`[id]`(정정), `hospital-works`(출고 업무연결 후보), `can-manage`(권한 UI 게이트). 권한=재고 담당자 풀 or ADMIN(`canManageStock` 실시간 조회), 감사로그 `inventory_tx`
- **UI**: `/inventory` 현황(위치별 재고칩·부족 뱃지·부족만 필터·입출고 모달), `/inventory/transactions` 이력(유형/위치 필터·취소), `/inventory/items/[id]` 상세(요약카드·위치별 재고·이력/개체 탭). 공용 `TransactionModal`(IN/OUT/MOVE 토글 + 비시리얼 수량/시리얼 벌크·개체선택 + 출고 시 병원검색·업무드롭다운). 병원 상세에 '사용 자재' 카드(출고 이력 + 설치 개체)
- **Phase 5 안전재고 알림**: `lib/notify.ts maybeNotifyLowStock` — OUT 커밋 후 best-effort 호출, `notify_enabled && notify_stock_enabled`(기본 off) 게이트, 품목 총재고<안전재고 시 `SLACK_CHANNEL_MAIN`로 `📦 [재고 부족]`, 같은 품목 24h dedup. 설정 페이지에 토글 추가. 기존 slack/notify 인프라(모드·로그·dedup) 재사용
- **검증(dev2)**: `tsc --noEmit` 0오류. 런타임 E2E는 빌드·재시작 후 진행
- **미반영**: git push·PROD 안 함. PROD 반영 시 마이그레이션 2건 필요
- 영향 파일: `prisma/{schema.prisma,migrations/2026070713·14...}`, `lib/{inventory.ts,notify.ts}`, `app/api/inventory/{transactions,stocks,units,hospital-works,can-manage,items/[id]}`, `app/inventory/{page,transactions,items/[id],components/TransactionModal}`, `app/hospitals/[code]/{page,_components/InventoryUsageCard}`, `app/api/settings/notifications/route.ts`, `app/settings/notifications/page.tsx`

---

## 2026-07-07 | 자재관리(WMS) Phase 1 — 품목·위치 마스터 + 재고 담당자 풀

- **배경**: `function_wms.md` Phase 1. 구축·판매에서 취급하는 하드웨어 자재(50~100품목) 재고관리 시스템의 마스터 계층 구축. Phase 2(재고 원장·입출고)의 토대
- **DB(마이그레이션 `20260707120000_add_inventory_phase1`)**: 신규 테이블 3개 — `inventory_items`(품목 마스터: item_code `ITEM-NNNN`·분류 FK·시리얼관리 플래그·DeviceInfo 선택 FK·참고단가·안전재고), `warehouses`(위치 마스터), `inventory_managers`(재고 담당자 풀 — **FieldEngineer와 별개 직무**, user_id UNIQUE). 시드: 품목 분류 4종(자사기기/전자제품/네트워크/잡자재, StatusCode `ITEM_CATEGORY`), 위치 2종(본사 창고/불량·수리 대기), nav 메뉴 4행(메인 `자재관리` sort 48 + 설정 하위 3종). psql 직접 적용 → migrate resolve → schema.prisma 수동 갱신(모델 3개 + StatusCode/DeviceInfo/User 역관계) → generate
- **API**: 설정 3종 — `item-category`(StatusCode CRUD, 삭제 시 사용 품목 검사), `warehouses`(CRUD), `inventory-managers`(목록/추가/삭제 + candidates 후보검색). 품목 — `inventory/items`(GET 필터·POST 채번), `[id]`(GET/PUT/DELETE), `import`(Excel 미리보기+등록, 중복 품목명 스킵·분류명 매핑). 모두 감사로그(`resource=inventory_item`/`setting:*`) + ADMIN 이상 쓰기
- **화면**: `/inventory`(자재 현황 — 전 로그인 조회, 검색·분류 필터), `/inventory/items`(품목 관리 ADMIN — 모달 폼 + Excel 가져오기), `/settings/{warehouses,inventory-managers,item-category}`. 기존 설정 CRUD·담당자 풀·병원 Excel 패턴 재사용
- **권한**: 조회=전 로그인, 품목·위치·분류·담당자 관리=ADMIN 이상. `lib/inventory.ts` `canManageStock`(ADMIN or 재고 담당자 풀 — Phase 2 입출고용) + `nextItemCode`
- **아이콘**: NavIcons에 `package`(box) 추가
- **검증(dev2)**: `tsc --noEmit` 0오류. DB 시드·테이블·nav 메뉴 삽입 확인. **런타임 E2E(품목 등록/수정·Excel·설정 CRUD)는 빌드·PM2 재시작 후 진행 예정**(사용자 요청 대기)
- **미반영**: git push·빌드·PROD 안 함. PROD 반영 시 `20260707120000_add_inventory_phase1` 마이그레이션 필요
- 영향 파일: `prisma/{schema.prisma,migrations/20260707120000_add_inventory_phase1/}`, `lib/inventory.ts(신규)`, `app/api/settings/{item-category,warehouses,inventory-managers}/`, `app/api/inventory/items/`, `app/settings/{item-category,warehouses,inventory-managers}/page.tsx`, `app/inventory/{page.tsx,items/page.tsx}`, `app/components/NavIcons.tsx`

---

## 2026-07-07 | Slack 알림 — 업무 타입별 on/off 토글

- **기능**: 업무 타입(프로젝트/답사/설치계획/유지보수/기타업무)별로 Slack 알림 사용/미사용 토글. 필요에 따라 특정 업무만 켜거나 끔
- **동작**: `notify_types_enabled`(AppSetting JSON, 기본 전부 on). 끈 타입은 **등록·상태변경·지연 요약·담당자 DM 모든 알림 미발송**
- **구현**: `lib/notify.ts` `getTypesEnabled()`/`typeEnabled()` — `notifyTaskEvent`·`notifyTaskStatusChanged` 진입 게이트 + `runDelayNotifications`에서 지연 목록을 활성 타입만 필터. 설정 API GET/PUT에 `typesEnabled`, 설정 페이지에 "업무별 알림 사용" 카드(5개 체크박스, 전역 off면 비활성)
- **검증(dev2)**: `tsc` 0오류. E2E — ETC off 시 등록 미발송·지연 요약에서 제외, on 시 정상 발송 확인
- 영향 파일: `lib/notify.ts`, `app/api/settings/notifications/route.ts`, `app/settings/notifications/page.tsx`

---

## 2026-07-07 | Slack 채널 알림 담당자 멘션(태그) 전환

- **변경**: 등록/상태변경 채널 알림의 담당자 필드를 이름 텍스트("홍길동 외 1명") → **Slack 멘션 태그(`<@ID>`)**로. 태그되면 담당자에게 개인 알림이 울림
- **규칙**: 계정 발송 플래그(`slack_notify_enabled`) **on + Slack 매핑 성공**인 담당자만 태그, 그 외(플래그 off·매핑 실패·Slack 미가입)는 이름 텍스트 폴백. "외 N명" 압축 제거(전원 나열 — 태그 목적). 매핑은 기존 `resolveSlackUserId`(이메일 조회+`slack_user_id` 캐시) 재사용
- **구현**: `lib/notify.ts` — enrich 담당자 select를 전체 필드(`ASSIGNEE_FULL`)로, `assigneeDisplay()` 헬퍼 신설(멘션/폴백 혼합 렌더), 기존 `assigneeText`/`asnNames` 제거
- **검증(dev2)**: `tsc` 0오류. E2E — 담당자 2명(플래그 on 이준호 → `<@U072NJMK363>` 태그, 플래그 off 함석민 → 이름만) 혼합 렌더 확인
- **PROD 반영**: 전원 플래그 off 상태라 배포 직후엔 전부 이름 텍스트 — 계정관리에서 발송 체크한 사람부터 태그됨 (별도 DB 작업 없음, 코드만)
- 영향 파일: `lib/notify.ts`

---

## 2026-07-07 | Slack 알림 시스템 PROD 배포 (Phase 6)

- **배포**: dev2 커밋 `fc0c85e` push → PROD pull → **DB 마이그레이션 4건** psql 적용+resolve(notification_logs / users.slack_user_id / users.slack_notify_enabled / 4테이블 status_changed_at) → nav_menu_items `settings/notifications`(sort 45, {SUPER_ADMIN,ADMIN}) INSERT → `.env`에 SLACK_* 5종 추가(**SLACK_NOTIFY_MODE=live**, 채널 3종은 임시로 테스트 채널 C0794GUQQ8Z — 운영 채널 확정 시 교체) → prisma generate → 힙4GB 빌드 → `pm2 restart thync-prod`. npm install 불필요
- **사용자 지시 반영**: **PROD 전 사용자(40명) `slack_notify_enabled=false`(발송 해제)** — DM은 계정관리에서 개별로 켠 사람에게만. 신규 계정 기본값은 true(생성 시 조정 가능)
- **초기 상태(안전)**: `notify_enabled` 미설정=off → **설정 페이지에서 켜기 전까지 아무 알림도 발송 안 됨**. 지연 감지 스케줄러 OFF 확인(`notify_delay_interval` 미설정). live 모드지만 이중 게이트로 무발송
- **스모크**: login 200 · root/도메인 307 · `/settings/notifications` 307(인증 리다이렉트 정상) · 재시작 후 신규 에러 0 · 스케줄러 로그 정상(mail 30m, notify OFF)
- **PROD 활성화 절차(추후)**: ①설정→Slack 알림에서 전역 on + 주기 선택 ②운영 채널 생성·봇 초대 후 `.env` `SLACK_CHANNEL_MAIN/DELAY` 교체+재시작 ③DM 원하는 계정만 계정관리에서 발송 체크
- 영향: PROD DB(테이블 1·컬럼 6·메뉴 1행·users 40행 UPDATE), PROD `.env`

---

## 2026-07-07 | Slack 알림 전체 검수 + 단계(상태) 체류 지연 기능

- **검수 배경**: `function_notification.md` 기준 Phase 0~5 구현 전수 검토(설계-코드 대조) + 사용자 요청 기능("각 단계별로 오래 지속되면 알림") 타당성 검토·구현
- **검수 발견·수정 3건**:
  - ①(버그) **레거시 업무 오알림** — 알림 도입 전 생성된 업무는 발송 이력이 없어 `lastSig=null` → 비고만 수정해도 "상태 변경" 알림 발송(기존 업무 수백 건 해당). 수정: 기준선 없으면 무발송으로 현재 상태를 baseline 캡처(`skipped/baseline` 로그, targetId `(baseline)`)하고 다음 실변경부터 정상 감지
  - ②(개선) **DM 루프** — mode off여도 담당자마다 Slack 매핑 API 호출 + opt_out/매핑실패 스킵 로그가 감지 주기마다 무한 누적. 수정: mode off 조기 반환, 스킵 로그도 dedupHours당 1건만
  - ③(일관성) users POST 생성이 `slackNotifyEnabled` 미수용, POST·[id] GET 응답 select 미포함 → 반영
- **신규 기능 — 단계(상태) 체류 지연**: 특정 상태에 지정 일수 이상 머물면 지연 판정(기준일 규칙과 병행, 둘 중 하나만 걸려도 지연·중복 1회 표시)
  - **DB**: projects/site_visits/maintenances/etc_tasks에 `status_changed_at`(TIMESTAMP, 기존 행 NULL·신규 DEFAULT now) — 마이그레이션 `20260707..._add_status_changed_at`(fast-default 회피 위해 ADD 후 SET DEFAULT), schema 4모델 `statusChangedAt @default(now())` + generate
  - **라우트**: 4개 [id]/[code] PUT이 상태(공사상태/상태ID) 실변경 시 `statusChangedAt` 갱신 (existing 비교, update data에 조건부 1줄)
  - **판정**: `lib/delay-rules.ts` — `notify_status_dwell`(JSON, 기본 빈값=미사용) + `dwellCheck`. 진입시각 = statusChangedAt → 레거시(NULL)는 요청/접수일→생성일 fallback. 앵커 규칙 우선, 라벨 `'처리중' 상태 N일째`. 쿼리 where에서 앵커일 not-null 필터 제거(앵커 없어도 체류 판정 가능) — **완료예정일 미입력 프로젝트도 지연 감지 가능해짐**(기존 빈틈)
  - **설정**: `/settings/notifications`에 "단계 체류 지연 기준" 카드 — 타입별 상태 목록 동적 로드(BuildStatus 라벨·StatusCode 3카테고리, 완료·보류성 제외), 상태별 일수 입력(0=미사용). API sanitize(양의 정수만 저장). INSTALL_PLAN은 작성/회신 2-플래그 구조라 체류 대상 제외
- **검증(dev2)**: `tsc --noEmit` 0오류. E2E — baseline(레거시 첫 PUT 무발송→실변경 시 `접수→처리중` 발송), 체류(처리중 5일 임계·10일 체류 감지 `'처리중' 상태 10일째`, 미설정 상태 미감지, 타 업무 오탐 0), 신규 생성 statusChangedAt 자동 기록 전부 통과
- **미반영**: git push·PROD 안 함. PROD 반영 시 `status_changed_at` 마이그레이션 추가 필요(누적 4건)
- 영향 파일: `prisma/{schema.prisma,migrations/20260707..._add_status_changed_at/}`, `lib/{notify.ts,delay-rules.ts}`, `app/api/settings/notifications/route.ts`, `app/settings/notifications/page.tsx`, `app/api/{projects/[code],site-visits/[id],maintenances/[id],etc-tasks/[id]}/route.ts`, `app/api/users/{route.ts,[id]/route.ts}`

---

## 2026-07-07 | Slack 알림 — 지연 기준일 설정 UI + 계정별 발송 플래그

- **지연 기준일 설정 UI**: 그동안 코드 기본값(DB JSON 오버라이드만 가능)이던 지연 기준을 `/settings/notifications`에서 편집 가능하게. 타입별 일수(답사·설치계획·기타업무 요청/접수일+N, 프로젝트 완료예정일+N) + 유지보수 우선순위별 4칸. API GET에 `getDelayRules()` 반환, PUT에 `sanitizeDelayRules`(음수·비수치 방지) 후 `notify_delay_rules` 저장. 저장 즉시 다음 감지부터 반영
- **계정별 Slack 발송 플래그**: `users.slack_notify_enabled`(BOOLEAN DEFAULT true) 신설 — 마이그레이션 `20260707..._add_user_slack_notify_flag`, schema+generate. false면 해당 계정에게 DM 미발송. `lib/notify.ts` `sendDelayDMs`가 매핑 전에 플래그 확인 → off면 `user_opt_out` 스킵 로그. `lib/delay-rules.ts` `AssigneeUser`·쿼리 select에 플래그 포함
- **UI**: 계정관리(`/users`) 타계정 수정 모달 '기능 제한'에 "Slack 알림 발송" 체크박스(ADMIN, 해제=미발송). users API [id] PUT·목록 GET에 `slackNotifyEnabled` 반영
- **검증(dev2)**: `tsc --noEmit` 0오류. 플래그 OFF→DM skipped(user_opt_out)·ON→sent 확인. 기준일 오버라이드는 findDelayedTasks E2E로 기검증
- **미반영**: git push·빌드·PROD 안 함. PROD 반영 시 `users.slack_notify_enabled` 마이그레이션 필요
- 영향 파일: `prisma/{schema.prisma,migrations/20260707..._add_user_slack_notify_flag/}`, `lib/{notify.ts,delay-rules.ts}`, `app/api/settings/notifications/route.ts`, `app/settings/notifications/page.tsx`, `app/api/users/{route.ts,[id]/route.ts}`, `app/users/page.tsx`

---

## 2026-07-07 | Slack 알림 Phase 4·5 — 담당자 DM + 설정/발송 이력 UI

- **Phase 4 (담당자 DM)**: 지연 업무 담당자에게 개인 DM 리마인드. ⏳ 확정 — 대상 담당자 전원, 조용시간·주말 제한 없음, 상한 무제한(해소 시까지 매일), 재알림 24h 1회
  - **DB**: `users.slack_user_id`(VARCHAR20, nullable) 추가 — 마이그레이션 `20260707071923_add_user_slack_id`, schema+generate
  - **매핑**: `lib/notify.ts` `resolveSlackUserId` — `users.email`로 `slackLookupUserByEmail` 조회 후 `slack_user_id` 캐시. 실패 시 그 담당자만 skip(`no_slack_mapping`)
  - **DM 발송**: `sendDelayDMs` — 지연 각 건×담당자, 24h dedup(같은 건·같은 사람), test 모드는 실제 담당자 대신 테스트 채널로 `[DEV][DM→이름]` 라우팅. `notify_dm_enabled`(기본 off) 게이트
  - **`lib/delay-rules.ts`**: `DelayedItem`에 `assignees`(id·name·email·slackUserId) 추가, 5개 타입 쿼리에 담당자 select
  - **스케줄러 개편**: `notifyDelayedSummary` → `runDelayNotifications`(채널 요약 + DM 통합, 각 자체 dedup). 채널 요약 dedup에 `targetType='channel'` 조건 추가(DM 로그와 분리)
- **Phase 5 (설정 UI + 발송 이력)**: `/settings/notifications`에 지연 요약 주기 select·담당자 DM 토글 추가(Phase 3·4에서 반영). **발송 이력** 섹션 — 최근 50건(상태 필터 전체/발송/스킵/실패), 이벤트·대상(채널/DM→이름)·시각·본문 미리보기. `GET /api/settings/notifications/logs`(ADMIN+). DM 로그 payload에 textPreview 저장
- **검증(dev2)**: `tsc --noEmit` 0오류. 매핑 표본 11/15 성공, DM 미매핑 skip·24h dedup·해피패스(이준호 U072… 발송+캐시 저장) 확인. 지연 요약 채널 발송 유지. dev2 기본값 enabled on·events on·delay 24h·**dm off**
- **미반영**: git push·빌드·PROD 안 함. PROD 반영 시 `users.slack_user_id` 마이그레이션 + `notify_*` 설정 필요
- 영향 파일: `prisma/{schema.prisma,migrations/20260707071923_add_user_slack_id/}`, `lib/{notify.ts,delay-rules.ts,notify-scheduler.ts}`, `app/api/settings/notifications/{route.ts,logs/route.ts(신규)}`, `app/settings/notifications/page.tsx`

---

## 2026-07-06 | Slack 알림 Phase 3 — 지연 감지 스케줄러 + 채널 요약

- **배경**: `function_notification.md` Phase 3. 지연 업무를 주기 점검해 지연 채널에 요약 발송. ⏳ 확정: 답사·설치계획 요청일+7일, 기타업무 접수일+14일, 프로젝트 완료예정일 경과, 유지보수 우선순위별(긴급1·높음3·보통7·낮음14), 감지 주기 매일 1회(24h)
- **`lib/delay-rules.ts`(신규)**: `DEFAULT_DELAY_RULES` + `getDelayRules`(AppSetting `notify_delay_rules` JSON 오버라이드) + `findDelayedTasks()` — 타입별 원본에서 기준일 초과 & 미완료(완료/회신완료·**보류 제외**) 항목 산출, KST 자정 기준 overdueDays 계산, 지연일 내림차순
- **`lib/notify.ts` 확장**: `notifyDelayedSummary()` — 전역 off·지연0건 스킵, 요약 1메시지(⏰ N건, 최대 20+"외 N건", 상세링크), `SLACK_CHANNEL_DELAY`(미설정 시 MAIN)로 발송. **12시간 내 동일 멤버십(refCode 집합) 재발송 스킵**(payload.sig 비교)
- **`lib/notify-scheduler.ts`(신규)** + **instrumentation.ts**: mail-scheduler 패턴. `notify_delay_interval`(off/1h/6h/24h)로 제어, 부팅 시 기동, 첫 실행은 인터벌 경과 후(재배포 즉시 발송 방지)
- **설정 페이지/API 확장**: `/settings/notifications`에 지연 요약 주기 select 추가, API GET/PUT에 `delayInterval` 추가 + 저장 시 `startNotifyScheduler` 즉시 반영
- **검증(dev2)**: `tsc --noEmit` 0오류. 실데이터 지연 48건 감지(프로젝트5·유지보수36·답사7, 우선순위 기준 반영) → 요약 발송 sent → 즉시 재실행 dedup 스킵 확인. dev2 `notify_delay_interval=24h` 설정
- **미반영**: git push·빌드·PROD 안 함. PROD 반영 시 `notify_delay_interval` env/설정 별도
- 영향 파일: `lib/{delay-rules.ts(신규),notify.ts,notify-scheduler.ts(신규)}`, `instrumentation.ts`, `app/api/settings/notifications/route.ts`, `app/settings/notifications/page.tsx`

---

## 2026-07-06 | Slack 알림 Phase 2 트리거 변경 — 완료 → 상태 변경 전체

- **배경**: "등록은 등록, 나머지는 상태가 바뀔 때마다 알림" 요구. 기존 완료(task_completed) 한정 → **모든 상태 변경**(task_status_changed)으로 확장. 완료는 "→ 완료" 상태 변경의 한 경우로 포함
- **상태 시그니처 방식**: enrich가 타입별 상태값을 시그니처로 산출 — 프로젝트=공사상태(buildStatus) 라벨, 답사/유지보수/기타업무=상태명, 설치계획=`작성:{작성완료여부}/회신:{회신여부}`. `notifyTaskStatusChanged`가 **직전 발송(sent) 로그의 payload.sig와 현재 값을 비교해 실제 변경 시에만 발송**(from→to 표기). 등록 알림이 baseline sig를 남김
- **route 훅**: 5개 [id] PUT(projects/site-visits/install-plans/maintenances/etc-tasks)의 완료 훅을 `notifyTaskStatusChanged` 무조건 호출로 교체 — 비상태 필드만 바꾼 저장은 notify 내부 비교로 자동 스킵. **업무현황(/tasks) 완료 체크박스 훅 제거**(Task.isCompleted 플래그만 토글, 원본 상태 미변경이라 상태변경 알림 대상 아님)
- **메시지**: 🔄 상태 변경 + `상태: 접수 → *처리중*` 라인 + 선택 필드. 등록은 기존 🆕 유지
- **부수**: notification_logs payload에 sig 저장, sig 조회는 `task_created`/`task_status_changed`만 대상(향후 delayed 오염 방지). 설정 페이지 토글 라벨 "등록·상태변경 알림"으로 변경
- **검증(dev2)**: `tsc --noEmit` 0오류. 임시 기타업무로 상태전이 E2E — 등록(baseline)→변경없음(스킵)→접수→처리중(발송, from→to)→변경없음(스킵)→처리중→완료(발송) 전부 기대대로. `[DEV]` 본문 표시 확인
- **미반영**: git push·빌드·PROD 안 함
- 영향 파일: `lib/notify.ts`, `app/api/{projects/[code],site-visits/[id],install-plans/[id],maintenances/[id],etc-tasks/[id],tasks/[id]}/route.ts`, `app/settings/notifications/page.tsx`

---

## 2026-07-06 | Slack 알림 Phase 2 추가 — 메시지 필드 설정화 (설정 페이지)

- **배경**: Phase 2 이벤트 알림에 대해 "타입별로 어떤 파라미터를 메시지에 넣을지 설정 화면에서 지정"하고 싶다는 요구(예: 답사는 '요청일'을 포함). Phase 5(설정 UI)의 필드 설정 부분을 앞당겨 구현. ⏳ 확정: 등록/완료 공통 필드셋 + 타입별 추천 세트 기본 on
- **`lib/notifyFields.ts`(신규)**: 타입별 선택 가능 필드 카탈로그(FIELD_CATALOG) + 추천 기본값(DEFAULT_FIELDS) + 라벨. 설정 페이지와 notify.ts가 공유. 답사=요청일/방문일/회신일/답사상태/대웅담당자, 유지보수=우선순위/장애유형/상태/신고자/접수일/완료일/원격/방문일정, 프로젝트=계약일/도입형태/구축일정/공사상태/시공사/규모 등
- **`lib/notify.ts` 개편**: enrich가 타입별 원본에서 전체 후보 필드를 조회해 `fieldValues`(값 있는 것만) 구성, `getEventFields`로 AppSetting `notify_event_fields`(JSON) 읽어 선택 필드만 카탈로그 순서로 렌더. 고정 표시(업무타입·병원명/제목·상세링크)는 유지. 값 없는 필드 자동 생략
- **설정 페이지 `/settings/notifications`(신규, ADMIN+)**: 발송 모드(읽기전용) + 전역/이벤트 토글 + 타입별 포함 필드 체크박스. API `/api/settings/notifications` GET/PUT(감사로그 `setting:notifications`). 네비 메뉴 `settings/notifications`(sort 45, {SUPER_ADMIN,ADMIN}) 추가(dev2 DML)
- **부수 수정**: test 모드 `[DEV]` prefix가 fallback text에만 붙고 실제 렌더되는 blocks 본문엔 미적용이던 버그 수정(첫 블록 본문에도 prefix). notification_logs `payload.textPreview`에 렌더 본문 저장(디버깅·향후 이력 UI용)
- **검증(dev2)**: `tsc --noEmit` 0오류. 필드 설정 E2E — 답사=요청일만 → `• 요청일: 2026-07-02` 표시, 유지보수=우선순위+접수일(값 없는 접수일 자동 생략), 프로젝트=필드없음 → 링크만. `[DEV]` 본문 표시 확인. 테스트 후 실 refCode 로그·임시 설정 정리
- **미반영**: git push·빌드·PROD 안 함. **PROD 반영 시 nav_menu_items INSERT 필요**(`settings/notifications` 행) — DB 마이그레이션 항목
- 영향 파일: `lib/{notify.ts,notifyFields.ts(신규)}`, `app/api/settings/notifications/route.ts(신규)`, `app/settings/notifications/page.tsx(신규)`, nav_menu_items(dev2)

---

## 2026-07-06 | Slack 알림 Phase 2 — 이벤트 알림 (등록/완료 → 단일 채널)

- **배경**: `function_notification.md` Phase 2. 주요 업무 5종 등록·완료 시 Slack 단일 채널(`SLACK_CHANNEL_MAIN`)에 핵심 필드 알림. ⏳ 결정 확정: 단일 채널 + 핵심 필드(이모지·타입·병원명·제목·담당자·상세링크, 등록🆕/완료✅)
- **중요 발견 — Task 미러 불완전**: 프로젝트·답사 POST는 Task 미러를 생성하지 않음(PROJECT 원본 235 vs Task 199). 설계서의 "모든 업무 API가 Task를 생성" 전제가 부분적으로 어긋남 → 훅을 **엔티티 생성/완료 지점**에 걸고, `lib/notify.ts`가 `(taskType, refCode)`로 **원본 엔티티 직접 조회(enrich)**해 병원명·담당자·상세 id 획득(Task 유무와 무관하게 동작)
- **멱등성 = notification_logs dedup**: `refCode`+`eventType`에 `sent` 로그가 있으면 스킵. 이전 완료상태 판정 없이 재저장·재시도·완료 재PUT 중복을 자동 차단. 완료 훅은 "isCompleted=true면 호출"만 하면 됨
- **`lib/notify.ts` 확장**: `notifyTaskEvent`(게이트→dedup→enrich→메시지빌드→dispatch), 타입별 enrich(Project/SiteVisit/InstallPlan/Maintenance/EtcTask), Block Kit 메시지 빌더, `eventsEnabled`(AppSetting `notify_enabled` 기본 off && `notify_events_enabled` 기본 on). ETC는 다병원이라 "첫병원 외 N곳" 표기
- **훅 13곳 연결** (Task 미러 갱신 지점/엔티티 지점, 전부 best-effort `.catch(()=>{})`): 등록 7 = projects·site-visits·install-plans·maintenances·etc-tasks POST + mail-queue·site-visit-queue 자동등록(autoRegistered). 완료 6 = projects/[code]·site-visits/[id]·install-plans/[id]·maintenances/[id]·etc-tasks/[id] PUT + **tasks/[id] PATCH(업무현황 완료 체크박스 — 설계서 누락분 반영)**
- **검증(dev2)**: `tsc --noEmit` 0오류. notify 레이어 E2E — 게이트 off 미발송·5타입 등록/완료 발송·dedup(재호출 sent 1 유지)·토큰부재 skipped·메시지 렌더(병원명/담당자) 전부 통과. 테스트 후 실 refCode 로그 정리(수동 테스트 dedup 방지). dev2 `notify_enabled=on` 유지(test 모드 → 테스트 채널로만)
- **미반영**: git push·빌드·PROD 안 함(규칙 준수)
- 영향 파일: `lib/notify.ts`, `app/api/{projects,site-visits,install-plans,maintenances,etc-tasks}/route.ts`, `app/api/{projects/[code],site-visits/[id],install-plans/[id],maintenances/[id],etc-tasks/[id],tasks/[id]}/route.ts`, `app/api/{mail-queue,site-visit-queue}/[id]/route.ts`

---

## 2026-07-06 | Slack 알림 Phase 0~1 — 전송 기반 (slack.ts + notification_logs)

- **배경**: 주요 업무(프로젝트/답사/설치계획/유지보수/기타업무) 등록·완료·지연 시 Slack 알림 기능 추가. 설계·진행 기준은 `function_notification.md`(Fable 작성). 이번은 Phase 0(사전 준비)~Phase 1(전송 기반)
- **Phase 0 (Slack 준비)**: 봇 `thync_ops_bot`(워크스페이스 SEERS) 생성, 스코프 `chat:write`/`users:read`/`users:read.email`/`im:write`, 테스트 채널 `C0794GUQQ8Z` 확보·봇 초대. `.env`에 `SLACK_BOT_TOKEN`·`SLACK_CHANNEL_{MAIN,DELAY,TEST}`·`SLACK_NOTIFY_MODE=test` 추가. 게이트: `auth.test`+`chat.postMessage` 실발송 성공
- **Phase 1 (전송 기반)**:
  - **DB** — `notification_logs` 테이블 신설(마이그레이션 `20260706215535_add_notification_logs`, dev2 로컬만): 발송 이력 + 중복발송 방지(dedup) 근거. `event_type`/`task_type`/`ref_code`/`target_type`/`target_id`/`status`/`error`/`payload`(jsonb)/`created_at` + dedup 인덱스 2종. schema.prisma `NotificationLog` 모델 추가 + generate
  - **`lib/slack.ts`(신규)** — 의존성 0 fetch 어댑터. `getSlackMode`(off/test/live, 비-production은 live→test 강등), `resolveTargetChannel`(test 모드 → 테스트 채널 라우팅), `slackPostMessage`, `slackLookupUserByEmail`(Phase 4 DM 매핑용). 토큰 미설정 시 자동 스킵, 모두 throw 안 함
  - **`lib/notify.ts`(신규)** — 정책·로그 골격. `dispatchToChannel`(모드 확인 → 채널 라우팅 → `[DEV]` prefix → 발송 → `notification_logs` 기록), `recordLog`, `sendConnectionTest`. 모든 export throw 안 함(호출부 mutation 보호). AppSetting 기능토글 게이트는 Phase 2 이벤트 함수에서 확인 예정
- **레이어 분리 확정**: slack.ts=순수 전송·모드 라우팅 / notify.ts=정책·dedup·로그
- **검증(dev2)**: `tsc --noEmit` 0오류. 전체 경로 E2E(notify→slack→Slack 발송→로그 기록) — test 채널 수신·`[DEV]` prefix·`status=sent`·`notification_logs` 0→1건 확인
- **설계서 보완 발견**: 완료 훅 지점에 `app/api/tasks/[id]/route.ts`(업무현황 완료 체크박스, Task.isCompleted 직접 토글) 포함 필요 → Phase 2 반영 예정 (function_notification.md 결정 이력 기록)
- **미반영**: git push·빌드·PROD 배포 안 함(규칙 준수, 사용자 요청 대기). PROD DB 마이그레이션은 Phase 6에서 별도 확인 후
- 영향 파일: `.env`, `prisma/{schema.prisma,migrations/20260706215535_add_notification_logs/}`, `lib/{slack.ts,notify.ts}`(신규), `function_notification.md`

---

## 2026-07-05 | 모바일 최적화 전면 작업 — 반응형 UI/UX (전 화면)

- **배경**: 데스크탑 기준으로만 발전해 온 화면들을 모바일에서도 최적 사용 가능하도록 전면 개편. 사전 실태 진단 결과 — 목록 8종 전부 raw 테이블(가로 스크롤 강제), MaintenanceForm 등 폼 `grid-cols-3` 하드코딩(모바일 붕괴), 위키 사이드바 고정 288px, 간트차트 min-width 부재, safe-area·터치 설정 전무
- **전역 토대**: `layout.tsx` viewport(`viewportFit: cover`)+테마컬러+appleWebApp, iOS 입력 포커스 자동확대 방지(coarse pointer에서 폼 컨트롤 16px), 탭 하이라이트 제거, `scrollbar-none` 유틸리티. safe-area 패딩은 커스텀 클래스 대신 **Tailwind 임의값**(`pb-[max(1rem,env(safe-area-inset-bottom))]`) 표준 — 다른 p-* 유틸리티와의 우선순위가 결정적이도록
- **네비게이션**: 모바일 드로어 슬라이드 애니메이션(항상 마운트 + transform/visibility 트랜지션), 열림 중 배경 스크롤 잠금+ESC 닫기, 터치 타깃 확대(메뉴 항목 py-2.5, 햄버거 p-2.5), 홈 인디케이터·노치 safe-area
- **공용 오버레이 훅 신설** `app/components/useOverlayDismiss.ts`: 스크롤 잠금+ESC 닫기 — Navigation 드로어·ui/Modal·위키 드로어에 공통 적용 (동작 통일)
- **ui/Modal**: 모바일에서 **바텀시트**(하단 정렬, 그랩 핸들, rounded-t-2xl) / sm 이상 중앙 다이얼로그, `max-h-[90dvh]` 내부 스크롤
- **목록 모바일 카드화 (테이블 병행)**: 병원·프로젝트·설치계획·답사·유지보수·기타업무·업무현황·계정 8종 + 메인 대시보드 공사현황 — 기존 테이블은 `hidden md:block`, md 미만에서 핵심 필드 4~6개 카드 리스트(`rounded-xl border bg-card`, 상태/우선순위 뱃지·담당자 "외 N명" 규칙 재사용, 행 클릭과 동일 이동). 필터 바는 모바일 세로 스택(검색 w-full + select 2컬럼 그리드), 답사 필터 flex-wrap 누락 버그 수정. tasks 카드는 완료 토글 포함(div role=button + stopPropagation), 메인 대시보드 카드는 비고 인라인 수정 동작 유지
- **폼**: MaintenanceForm·SiteVisitForm·EtcTaskForm의 `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`(모바일 라벨 위/입력 풀폭), FieldEngineer·Daewoong 선택모달 오버레이 p-4+85dvh, MaintenanceVisitPicker 320px 화면 이탈 보정, users 자체 모달 3종 오버플로 보정
- **위키**: lg 미만 사이드바 숨김 + **오프캔버스 드로어**(플로팅 트리거 44px, 백드롭, 라우트 변경 자동 닫힘, 기존 트리·DnD·알림벨 콘텐츠 공유 렌더), 트리 행 액션 버튼(↑↓📂+) 터치에선 상시 노출, layout 높이 `100dvh-3.5rem`(모바일 헤더) 보정
- **간트차트**: `h-screen`+모바일 헤더 pt-14 이중 적용으로 하단 56px 잘리던 문제 보정(`h-[calc(100dvh-3.5rem)] lg:h-screen`), min-width 가로 스크롤은 기존 구조 확인(정상)
- **AI 어시스턴트**: 상담 정리 패널 모바일 풀스크린 오버레이 전환(닫기 버튼, lucide X), 채팅 높이 dvh 보정, 입력영역 safe-area
- **셀프 코드리뷰 반영**: hospitals 목록 `role === 'ADMIN'` 하드코딩 → `isAdminOrAbove` (SUPER_ADMIN이 Excel 가져오기·Drive 내보내기 버튼 못 보던 실버그), safe-area 클래스 덮어쓰기 함정 제거, 필터 래퍼 패턴 통일(sm:flex), 미사용 xs 브레이크포인트·pt-safe 제거
- **검증**: `tsc --noEmit` 0오류
- **DEV·PROD 반영 완료 (2026-07-06)**: dev2에서 커밋 `7e50750` push → PROD pull(2커밋: docs `07683a7` + 모바일 `7e50750`) → 힙4GB 빌드 → `pm2 restart thync-prod`. 순수 UI라 npm install·DB 마이그레이션 불필요. 스모크: login 200·root 307·`ops.seersthync.com` 307 ✅. error 로그의 `/api/etc-tasks` 항목은 기존 `GOOGLE_CALENDAR_ETC_TASK_ID` env 미설정 캘린더 스킵 경고(예상 동작, 이번 배포와 무관)
- **남은 백로그**: 모바일 카드 셸·빈 상태 플레이스홀더가 8개 페이지에 중복 — 공유 `MobileListCard`/`EmptyState` 컴포넌트로 통합 여지. users 카드/테이블 액션 버튼 중복 → in-file 컴포넌트 추출 여지
- 영향 파일: `app/layout.tsx`, `app/globals.css`, `tailwind.config.ts`, `app/components/{Navigation,useOverlayDismiss(신규),DaewoongSelectModal,FieldEngineerSelectModal}.tsx`, `app/components/ui/Modal.tsx`, `app/{page,hospitals/page,projects/page,install-plans/page,site-visits/page,maintenances/page,etc-tasks/page,tasks/page,users/page,ai-assistant/page,projects/calendar/page}.tsx`, `app/hospitals/_components/{HospitalFilters,Pagination}.tsx`, `app/projects/_components/ProjectFilters.tsx`, `app/{maintenances/MaintenanceForm,maintenances/MaintenanceVisitPicker,site-visits/SiteVisitForm,etc-tasks/EtcTaskForm}.tsx`, `app/wiki/{layout,page}.tsx`, `app/wiki/components/WikiSidebar.tsx`

---

## 2026-07-05 | 월보드 차트 깜빡임 수정 + 패널명 변경

- "월별 누적 도입 추이" → "월별 누적 도입 현황" 명칭 변경
- **깜빡임 원인 제거**: 시계 state(1초)가 페이지 전체를 리렌더하면서 `chartMonths`가 매번 새 배열로 생성 → recharts가 데이터 변경으로 오인해 매초 애니메이션 재실행(병상 라벨이 애니메이션 중 사라졌다 나타나며 깜빡임). `useMemo`로 참조 고정 + Bar/Line `isAnimationActive={false}`(사이니지 정적 표시) 이중 차단
- 검증: tsc 0오류·빌드 통과·번들 청크에 신규 타이틀/애니메이션 off 포함 확인·dev2 재시작
- PROD 배포 완료 (아래 커밋)
- 영향 파일: `app/dashboard/page.tsx`

---

## 2026-07-05 | /dashboard 사이니지 월보드 리뉴얼 — 50인치 상시 표시용

- **배경**: 기존 /dashboard(KPI 2개+유지보수)를 50인치 TV 상시 표시(사이니지) 용도로 전면 재설계 — 네비게이션 없이 전체 화면, 스크롤 없이 한 화면에 핵심 지표 집약
- **레이아웃 (h-screen 고정 그리드, overflow-hidden)**: ①헤더(LIVE 인디케이터·실시간 시계(1초)·날짜·전체화면 버튼·마지막 갱신 시각) ②KPI 타일 5개(도입병원/도입병상/유지보수 진행중/이번주 구축/차주 구축예정 — 상태별 세부 서브텍스트) ③차트 2단(월별 누적 도입 추이 ComposedChart 병원 라인+병상 바 · 주간 유지보수 12주 바차트+상태별 칩) ④구축 리스트 2단(이번주/차주 — 병원·기간·담당·상태뱃지, 최대 6행+"외 N건")
- **사이니지 동작**: 60초 자동 폴링(기존 dashboard API 4종 재사용, 실패 시 기존 데이터 유지), Fullscreen API 토글, 다크 테마 강제(진입 시 적용·이탈 시 원복 — TV 상시 표시 최적화), hydration 안전 시계
- **네비게이션 제외**: MainWrapper `FULLSCREEN_PATHS`(/login, /dashboard) + Navigation 동일 조건 — 사이드바·모바일 헤더 미표시
- **피드백 반영 (같은 날)**: ①다크 강제 제거 → 헤더에 라이트/다크 토글(전역 ThemeProvider 연동, 차트도 useChartTheme로 전환) ②사이니지 원칙 적용 — 월별 추이 차트 Y축 눈금 제거 + 모든 데이터 포인트에 값 상시 표시(LabelList: 병원 라인 위 파랑, 병상 바 안쪽) ③주간 유지보수 추이 차트 → **진행중 내역 리스트**로 교체(병원·유형·제목·접수일·담당·상태뱃지, 우선순위 긴급 ! / 높음 ▲ 마커, 최신 7건+외 N건)
- **종별 타일 추가**: KPI 행 5→7컬럼 재구성, 도입병상 옆에 "종별 도입 현황 — 전국 대비" 2칸 폭 타일. **전국 모수(HIRA) 대비 도입수 + 도입률%** 표시 — 상급종합 15/47(32%)·종합병원 94/339(28%)·병원 87/1,449(6%)·기타 8(의원 등 모수 7.8만이라 도입수만). /api/dashboard/hospital-stats의 contracted(계약완료+운영)·total 재사용, 신규 API 없음
- **잠복 버그 수정**: /api/dashboard/maintenance의 기존 raw SQL이 `sc.sort_order` 참조 — 실제 컬럼은 `"order"`라 **이 API가 원래부터 500**(구 대시보드 유지보수 섹션도 조용히 실패 중이었음). `sc."order"`로 수정, DB 직접 검증(접수38·처리중14·완료141·보류4 — 진행중 52건 실존). 월보드 유지보수 패널이 비어 보이던 원인
- **차트 라벨 가독성(사이니지)**: 라인(병원)=상단 밴드(domain ×1.08)·바(병상)=하단 밴드(×1.75)로 세로 분리해 라벨 겹침 제거, 병원 라벨 15px·병상 라벨 13px 볼드(바 위 표시, 테마별 색 보정)
- **API 확장**: /api/dashboard/maintenance에 `items`(진행중 12건, 접수일 최신순, additive) 추가 — 기존 응답 필드 무변경
- **검증**: tsc 0오류, 힙4GB 빌드 통과, dev2 재시작, /dashboard 307(미인증 리다이렉트 정상)
- **PROD 배포 완료 (2026-07-05)**: `cb46613` push → PROD pull → 힙4GB 빌드 → `pm2 restart thync-prod`. 스모크: login 200·/dashboard 307(인증 리다이렉트 정상)·ops.seersthync.com 307 ✅. DB 마이그레이션·npm install 불필요
- 영향 파일: `app/dashboard/page.tsx`(전면 재작성), `app/api/dashboard/maintenance/route.ts`, `app/components/{MainWrapper,Navigation}.tsx`

---

## 2026-07-05 | UI 디자인 리뉴얼 Phase 1~4 — 디자인 토큰 + 팔레트 브리지 + 다크모드 (브랜치 design/renewal-liquid-glass)

- **배경**: create-next-app 기본값 위에 기능만 쌓여 비주얼 레이어 부재(Arial 렌더링, Tailwind 원색 남발, 토큰 없음) → 미니멀·클린(Linear/Vercel풍) 방향으로 전면 리뉴얼. main과 격리된 `design/renewal-liquid-glass` 브랜치에서 진행
- **Phase 0 (토대)**: Pretendard Variable self-host(`app/fonts/`)로 전 화면 폰트 교체(Arial 제거), `globals.css`에 시멘틱 디자인 토큰(HSL 채널, 라이트+다크 전 세트: background/card/muted/accent/primary/success/warning/destructive + subtle 계열), `tailwind.config.ts` darkMode='class' + 토큰 매핑 + 그림자/라운드 스케일, `lib/cn.ts`(의존성 0 className 헬퍼), `ThemeProvider`+`ThemeToggle`(localStorage 영속, FOUC 방지 인라인 스크립트, 라이트 기본), `layout.tsx` lang=ko, Navigation 토큰화+토글 노출
- **Phase 1 (팔레트 브리지 — 핵심 전략)**: 기존 98개 파일·3,600+ 하드코딩 색상 클래스를 무수정 커버 — tailwind.config에서 gray/blue/red/green/amber/emerald/yellow/purple/indigo/rose/teal/orange/sky 13계열을 CSS 변수 참조(`hsl(var(--x) / <alpha-value>)`)로 재정의. 라이트=gray→slate 톤 보정·blue→Heritage Blue(#2C5CE5), 다크=의미론 기반 스케일 반전(50~300=어두운 틴트, 400~900=밝은 텍스트). `.dark .bg-white`→card 표면 오버라이드(158곳, text-white는 유지). 새 코드는 시멘틱 토큰 사용이 표준
- **Phase 2 (프리미티브)**: `app/components/ui/` 신설 — Button(5 variant)/Card/Badge/Input·Select·Textarea/Table/Modal/PageHeader/EmptyState (전부 토큰 기반, 의존성 0). StatusBadge를 CSS 변수+`.dark .status-badge-dynamic`(color-mix 틴트 변환)으로 다크 대응 — DB 저장 hex 색상 유지하면서 서버 컴포넌트 호환. 로그인 페이지 액센트 정렬(#1A56DB→#2C5CE5, 한글 Pretendard 폴백)
- **Phase 3 (핵심 화면)**: `useChartTheme` 훅 신설 — recharts는 CSS 변수를 못 읽으므로 라이트/다크 값 직접 분기(그리드·틱·툴팁·시리즈 컬러). 메인(app/page.tsx)·대시보드 차트 하드코딩 hex 전량 치환. 프로젝트 캘린더 구조색(보더·헤더 배경·텍스트) 토큰화
- **Phase 4 (주변부)**: WikiEditor BlockNoteView에 `theme={theme}` 연동(wiki→main import, 허용 방향), Tiptap RichTextEditor 인라인 스타일 토큰화, 글로벌 마이크로(::selection, :focus-visible 링, 스크롤바 테마)
- **검증**: `tsc --noEmit` 0오류, 힙4GB 빌드 통과, dev2 재시작·HTTP 200 확인. 다크모드는 라이트 기본에 opt-in(사이드바 하단 토글)
- **핫픽스 (같은 날)**: bg 클래스 없는 네이티브 폼 컨트롤(select 56·input 187)이 다크에서 UA 흰 배경으로 남는 문제 — `color-scheme: light/dark` 선언 + base 레이어 폼 기본값(card 표면색·placeholder·accent-color)으로 일괄 해결. globals.css만 수정, 컴포넌트 무수정. option 드롭다운·date picker·스크롤바도 다크 적용
- **PROD 배포 완료 (2026-07-05)**: `design/renewal-liquid-glass` → main 머지(`60c9ba7`) → push → PROD pull → 힙4GB 빌드 → `pm2 restart thync-prod`. 스모크: login 200·root 307·ops.seersthync.com 307 ✅. npm install·DB 마이그레이션 불필요(순수 UI). 재배포 직후 Server Action 불일치 로그는 일시적 정상
- **남은 백로그**: 설정 페이지 색상 스와치 fallback(#E5E7EB) 다크 미세 보정, 데이터 도트(차량색 등)는 양 모드 허용으로 유지, 페이지별 시멘틱 토큰 점진 전환
- 영향 파일: `app/globals.css`, `tailwind.config.ts`, `app/layout.tsx`, `app/fonts/PretendardVariable.woff2(신규)`, `lib/cn.ts(신규)`, `app/components/theme/{ThemeProvider,ThemeToggle,useChartTheme}(신규)`, `app/components/ui/{Button,Card,Badge,Input,Table,Modal,PageHeader,EmptyState}.tsx(신규)`, `app/components/{Navigation,StatusBadge,RichTextEditor}.tsx`, `app/{page,dashboard/page,login/page,projects/calendar/page}.tsx`, `app/wiki/components/WikiEditor.tsx`

---

## 2026-07-03 | 기타업무(EtcTask) 모듈 신설 — 다병원·비유지보수 업무 관리

- **배경**: 유지보수는 병원 1곳 필수 연결이라 여러 병원을 커버하는 업무(다병원 펌웨어 점검 등)나 유지보수가 아닌 주요 업무를 담을 곳이 없음 → 전용 모듈 신설
- **DB** (dev2 로컬 적용, 마이그레이션 `20260703010000_add_etc_tasks`): `etc_tasks`(본체: 코드/제목/상태/우선순위/접수일/완료일/비고) + `etc_task_assignees`(User N:M) + `etc_task_hospitals`(**병원 N:M — 0~N곳 선택 연결**) + `etc_task_visits`(업무기간 다건: 단일일·기간 혼합, 항목별 캘린더 이벤트ID) + `etc_task_files`(S3 첨부). 상태코드 category `ETC_TASK_STATUS` 시드(접수/처리중/완료/보류, seed.ts에도 추가), 네비 메뉴 `etc-tasks`(sort 47, **SEERS 소속만 노출** — 메뉴 관리에서 변경 가능) + `settings/etc-task-status`(155) 시드
- **API**: `/api/etc-tasks` GET(제목검색·상태·우선순위·hospitalCode 필터)/POST, `[id]` GET/PUT/DELETE(ADMIN), `[id]/files` 업로드(S3 `etc-tasks/{id}/…`)·삭제, `file-url` presigned, `/api/settings/etc-task-status` CRUD. 코드 발번 `ETC-YYYYMM-NNNN`, **Task 미러 `taskType='ETC'`**(상태 '완료' → isCompleted 동기화, hospitalCode는 다병원이라 null), 감사로그 `resource='etc_task'`, **업무기간 항목별 Google Calendar 이벤트**(신규 타입 `etc-task` → env `GOOGLE_CALENDAR_ETC_TASK_ID`, 미설정 시 자동 스킵). 기간 reconcile·정규화는 `lib/maintenanceVisit` 공유(`normalizeVisits`/`visitKey`/`ymd`), 캘린더 페이로드는 `lib/etcTask.ts`
- **담당자 풀**: `FieldEngineer`에 workType `ETC_TASK` 추가(A안). 후보·등록 모두 **SEERS + thynC운영팀**(부서명 '운영' 포함)으로 서버 검증. 담당자 리스트에 "기타업무 담당자" 탭 추가
- **UI**: `/etc-tasks` 목록(접수일|제목|상태|우선순위|담당자|관련 병원(결합, 3곳↑ "외 N곳")|업무기간|완료일 + 필터), `new`/`[id]` 등록·수정 폼 — 병원 다중 선택 모달(칩 토글), 담당자 모달(ETC_TASK 풀), **업무기간은 유지보수 캘린더 선택기(`MaintenanceVisitPicker`) 재사용**, 비고 Tiptap 리치 텍스트, 첨부(edit 모드). `/settings/etc-task-status` 상태 관리 페이지. 네비 아이콘 `briefcase` 신규
- **통합**: 업무(Task) 현황 페이지에 ETC 타입(라벨 '기타업무', slate 색, 요약카드 5열, 상세 이동), **간트차트에 기타업무 바 표기** — 업무기간 항목별 바(상태 색, 🗂 prefix), 뷰 범위 교집합 필터·레인 배치·과거 옅게 등 기존 규칙 동일
- **검증(dev2 E2E)**: `tsc --noEmit`·힙4GB 빌드 통과, dev2 재시작 후 API E2E — 생성(코드 발번·병원 2곳·기간 2건·Task 미러) ✅, 수정(상태 완료→Task isCompleted, 기간 reconcile, 병원 축소) ✅, 파일 S3 업로드 ✅, 필터(제목·상태·우선순위·병원) ✅, tasks 통합 refId ✅, 운영팀 후보 필터 ✅, 삭제(자식·Task·파일 cascade) ✅, 감사로그 3건 ✅, 신규 페이지 6종 200 ✅
- **DEV·PROD 모두 반영 완료** (병원 재지정 `d3c00c5` + 기타업무 `9d9ed31` 함께 배포): dev2 빌드+`pm2 restart thync-dev`, git push → PROD pull → `thync_ops`에 마이그레이션 `20260703010000` 단일 트랜잭션 적용(테이블 5개+상태코드 4건+네비 2행) + migrate resolve + generate + 힙4GB 빌드 + `pm2 restart thync-prod`. PROD login 200·`/etc-tasks` 307·`ops.seersthync.com` 307 검증, 신규 에러 없음(재배포 직후 Server Action 불일치 로그는 일시적 정상). **PROD Google Calendar 동기화는 `GOOGLE_CALENDAR_ETC_TASK_ID` env 미설정으로 스킵 상태** — 캘린더 ID 확보 시 `.env` 추가
- 영향 파일: `prisma/{schema.prisma,seed.ts,migrations/20260703010000_add_etc_tasks/}`, `lib/{etcTask.ts(신규),googleCalendar.ts}`, `app/api/etc-tasks/**(신규)`, `app/api/settings/etc-task-status/**(신규)`, `app/api/settings/field-engineers/{route,candidates/route}.ts`, `app/api/tasks/route.ts`, `app/etc-tasks/**(신규)`, `app/settings/etc-task-status/page.tsx(신규)`, `app/settings/field-engineers/page.tsx`, `app/components/{NavIcons,FieldEngineerSelectModal}.tsx`, `app/tasks/page.tsx`, `app/projects/calendar/page.tsx`

---

## 2026-07-03 | 업무 병원 재지정(매핑 정정) 기능 + 병원 업무 일괄 이전(Phase 2)

- **배경**: 사람이 업무(프로젝트/답사/설치계획/유지보수) 등록 시 병원을 헷갈려 잘못 매핑하는 휴먼에러 발생(실제 HOSP-001807↔002967 사건). 그동안 DB 수동 수정으로 대응 → 정식 기능화
- **기존 상태 진단**: 유지보수·답사·설치계획 PUT은 이미 hospitalCode 변경+Task 미러 동기화를 지원. 빈틈 = ① 업무를 옮겨도 **옛 병원 status가 하향되지 않음**(advanceHospitalStatus는 전진 전용), ② 전용 동선·가드레일·프로젝트명 갱신 부재
- **`lib/hospitalStatus.ts`**: `recomputeHospitalStatus(hospitalCode, advanceOnly?)` 신규 — 병원의 실제 업무로부터 상태·계약일을 **정방향 재계산(하향 포함)**. 규칙: 구축완료 프로젝트→운영 / 계약 프로젝트→계약완료 / 답사→답사요청 / 설치계획→가견적요청 / 업무없음→미계약(해지는 수동 보존). 계약일은 프로젝트 계약일 최솟값. `advanceOnly=true`면 전진만(새 병원용)
- **`lib/workItemReassign.ts`**(신규): `reassignWorkItemHospital` — 한 트랜잭션으로 업무 hospitalCode(+프로젝트명 치환) + Task 미러(hospitalCode/title) 동기화, 이후 옛 병원 완전 재계산·새 병원 전진, 감사로그(병원 재지정 라벨). `transferAllWorkItems` — 병원의 모든 업무(프로젝트/답사/설치계획/유지보수/상담)+Task 일괄 이전(Phase 2)
- **API**: `POST /api/work-items/reassign`(ADMIN 이상, body: type/code/newHospitalCode/updateProjectName), `POST /api/hospitals/[code]/transfer-work`(SUPER_ADMIN, body: toHospitalCode/updateProjectNames)
- **UI**: `ReassignHospitalButton`(공유 컴포넌트) — 프로젝트/유지보수/답사/설치계획 상세에 "병원 재지정" 버튼(병원 검색 모달→확인, 프로젝트는 이름 변경 옵션, canReassign 미제공 시 /api/auth/me로 ADMIN 자체판별). `TransferAllWorkButton` — 병원 상세에 "업무 일괄 이전"(SUPER_ADMIN)
- **검증(dev2 자동 E2E)**: 단건 재지정(병원·프로젝트명·Task 동기화) ✅, 옛 병원 재계산(미계약+계약일 비움) ✅, 새 병원 전진(운영+계약일) ✅, 일괄 이전(B→A 전량) ✅. `tsc --noEmit`·Next 빌드 통과. DB 스키마 변경 없음(코드/컴포넌트만). **2026-07-03 PROD 반영 완료** (commit `d3c00c5`, 기타업무 모듈과 함께 배포 — 상단 항목 배포 기록 참조)
- 영향 파일: `lib/hospitalStatus.ts`, `lib/workItemReassign.ts`(신규), `app/api/work-items/reassign/route.ts`(신규), `app/api/hospitals/[code]/transfer-work/route.ts`(신규), `app/components/{ReassignHospitalButton,TransferAllWorkButton}.tsx`(신규), `app/{projects/[code],maintenances/[id],site-visits/[id],install-plans/[id]}/page.tsx`, `app/hospitals/[code]/page.tsx`

---

## 2026-06-30 | 위키 협업 — 연결상태 race로 인한 오(誤)폴백 수정 (PROD 핫픽스)

- **증상(PROD)**: 위키 페이지에서 "협업 서버에 연결할 수 없어 읽기전용" 폴백이 항상 표시. 그러나 서버 진단상 인증·DB·Nginx·WS 모두 정상(유효 토큰 연결 synced), 협업 서버 에러 로그에 브라우저발 인증실패 기록 없음 → 연결은 성공했는데 클라이언트가 오폴백
- **원인**: `HocuspocusProvider`는 `useState` 생성 즉시 연결 시작하는데 `provider.on('status')` 리스너는 `useEffect`(렌더 후)에서 부착 → 연결이 빠른 환경(특히 prod)에선 `'connected'` 이벤트가 리스너 부착 전에 발생·누락 → `collabStatus`가 `'connecting'`에 머물러 8초 폴백 발동
- **수정**: 리스너 부착 시 `provider.isConnected/isSynced/status`로 현재 상태를 동기 보정 + `'synced'` 이벤트도 청취. (`WikiEditor.tsx`)
- **DEV·PROD 반영 완료**: dev2 빌드+재시작, push(`c8c32a9`) → PROD pull+힙4GB 빌드+`pm2 restart thync-prod`. login 200 확인
- 영향 파일: `app/wiki/components/WikiEditor.tsx`

---

## 2026-06-30 | 위키 실시간 동시편집(Yjs) — 자체구축 협업 서버 (DEV PoC)

- **목표**: 위키를 여러 명이 동시에 편집하고, 다른 사람 변경·커서가 실시간으로 보이게. 데이터는 전부 자체 인프라에 유지(외부 협업 서비스 미사용)
- **아키텍처**: 기존 단일작성 자동저장(전체 덮어쓰기 PUT + `baseUpdatedAt` 409) → **CRDT(Yjs) 기반 실시간 협업**으로 전환. Next 앱과 **별도 프로세스**인 Hocuspocus WebSocket 서버를 추가(메인 앱은 협업 서버 import 안 함 — 위키 모듈 분리 원칙 유지)
- **협업 서버** (`collab-server/index.mts`, ESM, esbuild 번들 → `dist/index.mjs`, PM2 `thync-collab`, 포트 1234):
  - 인증: WS 업그레이드 헤더의 `auth-token`(httpOnly 쿠키)을 jose로 검증. VIEWER는 readOnly, 삭제 페이지는 연결 거부
  - `onLoadDocument`(Database extension fetch): 저장된 Y.Doc 있으면 반환, 없으면 기존 `content_json`을 server-util `blocksToYDoc`로 **1회 시딩**(기존 페이지 무손실 전환)
  - `onStoreDocument`(store, 디바운스): Y.Doc 바이너리를 `wiki.wiki_page_ydoc`에 upsert + Y.Doc→블록 변환으로 `content_json`/`plain_text`(검색·렌더 스냅샷)·백링크(`wiki_page_links`) 동기화
  - 번들: jsdom(런타임 동적 require)·@prisma/client는 external, 나머지(yjs/blocknote/hocuspocus)는 단일 번들로 yjs 중복 로드 방지
- **공유 스키마**: `lib/wiki/wikiSchema.tsx`로 BlockNote 커스텀 스키마(콜아웃·구분선·페이지링크·파일·멘션·멀티컬럼)를 추출 → 클라이언트(WikiEditor)와 협업 서버가 **동일 스키마** 사용(Y.Doc↔블록 변환 일치). WikiEditor는 이 모듈을 import하도록 리팩터
- **클라이언트**: `WikiEditor`에 협업 모드 추가 — `HocuspocusProvider`로 `ws://localhost:1234`(운영은 `/collab`) 연결, BlockNote `collaboration`(fragment `prosemirror` + awareness 커서/이름/색) 적용, 연결상태 인디케이터. 협업 모드에선 기존 자동저장/409 로직 비활성(본문은 협업 서버가 저장), 제목·메타만 PUT
- **항상 협업(기본 적용)**: 별도 토글 없이 **모든 위키 페이지가 실시간 협업**. 기존 페이지는 첫 진입 시 `content_json`에서 자동 시딩(무손실). 협업 서버에 8초 내 연결 못 하면 **스냅샷 기반 읽기전용으로 자동 폴백**(빈 화면/데이터 유실 방지) + 재연결 안내 배너. (`collab_enabled` 컬럼은 향후 페이지별 비활성 escape-hatch용으로 보존하되 현재 동작은 항상 협업)
- **DB**: 마이그레이션 `20260630000000_add_wiki_collab` — `wiki.wiki_page_ydoc(page_id PK→wiki_pages, state bytea, updated_at)` 신설 + `wiki_pages.collab_enabled boolean DEFAULT false`. schema.prisma `WikiPageYdoc` 모델 + `WikiPage.collabEnabled` 추가 + generate (dev2 로컬만 적용)
- **패키지 추가**: `@hocuspocus/server`, `@hocuspocus/extension-database`, `@hocuspocus/provider`(2.15.3). yjs는 기존 13.6.31 단일 인스턴스 유지
- **검증(dev2 자동 E2E)**: 인증(유효 쿠키 수락/무단 연결 거부) ✅, 실시간 중계(doc A→B 즉시 반영) ✅, 영속화(`wiki_page_ydoc` 저장) ✅, **materialize**(Y.Doc→`content_json`/`plain_text` 검색 스냅샷 동기화) ✅, 커스텀 블록 round-trip(callout props 보존) ✅. `tsc --noEmit`·Next 빌드 통과. **브라우저 두 창 동시편집·커서 최종 확인은 사용자 테스트 예정**. PROD 미반영(Nginx `/collab` WS 프록시 + PM2 `thync-collab` 추가 + 마이그레이션 필요)
- 영향 파일: `collab-server/{index.mts,build.mjs}`(신규), `lib/wiki/wikiSchema.tsx`(신규), `prisma/schema.prisma`, `prisma/migrations/20260630000000_add_wiki_collab/`, `app/wiki/components/WikiEditor.tsx`, `app/wiki/[id]/{WikiPageView,page}.tsx`, `app/api/wiki/pages/[id]/route.ts`, `package.json`, `.gitignore`

---

## 2026-06-30 | 위키 사이드바 — 삭제/이동 실시간 미반영 + tree API 필터 누락 수정

- **버그1 (사이드바 stale)**: 페이지 삭제 후 좌측 네비에서 사라지지 않음. 원인 — 사이드바는 `layout.tsx`(서버)의 `pages` prop으로 그려지는데, Next.js App Router는 같은 레이아웃을 공유하는 페이지 간 **클라이언트 내비게이션 시 레이아웃을 재렌더/재조회하지 않음** → `router.push('/wiki')` 후에도 prop이 삭제 전 그대로
- **수정1**: `WikiSidebar`가 **경로(pathname)가 바뀔 때마다 `/api/wiki/tree`를 직접 재조회**해 트리를 실시간 갱신(레이아웃 캐시 비의존). 추가·삭제·이동이 내비게이션 즉시 반영. 드래그/형제 계산도 `livePages` 기준
- **버그2 (tree API)**: `/api/wiki/tree`가 `where` 필터 없이 **삭제·템플릿 페이지까지 반환** → 이동 모달에 유령 페이지 노출
- **수정2**: `where: { isTemplate:false, deletedAt:null }` + 사이드바용 `icon` 필드 추가
- 삭제된 페이지 클릭 시 502는 현재 코드에선 `notFound()`로 404 처리됨(과거 빌드/캐시 잔재). 위 수정으로 삭제 페이지는 애초에 사이드바에서 즉시 사라져 클릭 대상이 안 됨
- 영향 파일: `app/wiki/components/WikiSidebar.tsx`, `app/api/wiki/tree/route.ts`

---

## 2026-06-30 | 위키 에디터 — heading(제목) 크기 미적용 버그 수정 (볼드만 되던 문제)

- **버그(PROD 발견)**: 위키 BlockNote 에디터에서 heading(H1/H2/H3) 적용 시 글자가 굵어지기만 하고 크기는 본문과 동일하게 유지됨
- **원인**: `wiki-theme.css`의 전역 규칙 `.bn-inline-content { font-size: 1rem }`이 heading 블록 내부 텍스트(`.bn-inline-content`)까지 1rem으로 강제. BlockNote는 heading 크기를 부모 컨테이너(`.bn-block-content[data-content-type=heading]`)의 `font-size: var(--level)`(3em/2em/1.3em…)로 주고 자식이 이를 상속하는 구조인데, 자식의 직접 지정(1rem)이 상속을 이겨 크기가 묶임. `font-weight:700`은 자식이 덮어쓰지 않아 그대로 상속 → 볼드만 적용되는 증상
- **수정**: 1rem 고정을 `[data-content-type="paragraph"] .bn-inline-content`로 스코프 축소. heading은 BlockNote의 em 스케일(`--level`) 복원, 단락 본문은 1rem 유지. 목록·인용 등 나머지 블록은 컨테이너 기본 16px(=1rem) 상속이라 무영향. CSS 단독 변경(DB·패키지 무변경)
- **DEV·PROD 모두 반영 완료**: dev2 힙4GB 빌드+`pm2 restart thync-dev`, git push → PROD pull → 힙4GB 빌드 + `pm2 restart thync-prod`
- 영향 파일: `app/wiki/wiki-theme.css`

---

## 2026-06-26 | 유지보수 방문일정 — 입력 UI를 캘린더 선택기로 교체

- **변경 배경**: 앞선 작업의 "시작일~종료일 반복 행" 입력 대신, 캘린더에서 날짜를 직접 클릭해 고르는 방식을 요청. 데이터 모델(`maintenance_visits`)·API·간트차트는 그대로 두고 **폼 입력 UI만 교체**
- **신규 컴포넌트** `app/maintenances/MaintenanceVisitPicker.tsx` (외부 라이브러리 없는 자체 월 달력):
  - "방문일 지정" 버튼 → 월 달력 모달. 날짜 클릭 토글로 **비연속 여러 날**(3일·7일·15일 등) 선택 → 각 단일일 방문 항목
  - **`장기일정` 체크박스**: 켜면 시작일·종료일을 클릭해 연속 기간 1건 등록(호버 미리보기). 끄면 단일일 토글 모드
  - 단일일 + 기간 **혼합 가능**, 기간 **여러 개** 가능. 새 기간에 포함되는 단일일은 자동 정리, 동일 기간 중복 방지
  - 선택 결과는 칩(단일일 `YYYY-MM-DD` / 기간 `시작 ~ 종료`)으로 표시, × 개별 삭제. 월 네비게이션·주말 색·오늘 강조
- **연동 변경**: `MaintenanceForm`의 반복 행 입력/핸들러 제거 → `<MaintenanceVisitPicker>`로 교체(`visits` 상태·제출 페이로드 동일). 상세(`[id]/page.tsx`) initialData는 단일일을 `endDate=startDate`로 채워 전달(피커가 start=end로 단일일 판별)
- 데이터 형식 `{startDate,endDate}` 불변 → 목록·간트·API 무변경. `npx tsc --noEmit` 통과
- **DEV·PROD 모두 반영 완료** (방문일 다건화 + 캘린더 선택기를 commit `3d31414`로 함께 배포): dev2 빌드+`pm2 restart thync-dev`, git push → PROD pull → `thync_ops`에 마이그레이션 `20260626000000` 단일 트랜잭션 적용(기존 159건 visit_date 이관, 본체 calendar_event_id 해제) + migrate resolve + generate + 힙4GB 빌드 + `pm2 restart thync-prod`. 양쪽 login 200·보호라우트 307·`ops.seersthync.com` 307 검증, PROD 인증 상태 `/api/maintenances` LIST·DETAIL 200(visits 정상), 신규 에러 없음
- 영향 파일: `app/maintenances/MaintenanceVisitPicker.tsx`(신규), `app/maintenances/MaintenanceForm.tsx`, `app/maintenances/[id]/page.tsx`

---

## 2026-06-26 | 유지보수 방문일 — 단일일 → 다건(기간·비연속) 확장

- **요구**: 유지보수 방문일을 하루만 입력하던 것을 (1) 기간(시작~종료) 설정 + (2) 비연속 여러 날(예: 3일·7일·15일) 입력 가능하도록 개선
- **모델**: 두 요구를 한 번에 담기 위해 방문일정을 자식 테이블로 분리. `maintenance.visit_date`(단일) → `maintenance_visits`(N건, 각 항목 `start_date`~`end_date`). 단일일은 start=end, 기간은 start≠end, 비연속은 항목 여러 개. 기존 `visit_date`/`calendar_event_id` 컬럼은 보존(deprecated)
- **DB** (dev2 로컬만 적용, 마이그레이션 `20260626000000_add_maintenance_visits`): `maintenance_visits` 신설(maintenanceId, startDate, endDate, calendarEventId?, sortOrder, createdAt, `(maintenanceId)` 인덱스, FK Cascade). 기존 `visit_date` 보유 건(125건)을 방문 항목 1건(start=end)으로 이관 + 캘린더 이벤트ID 승계, 본체 `calendar_event_id`는 중복 해제(NULL). schema.prisma `MaintenanceVisit` 모델 추가 + `prisma generate`
- **Google Calendar**: 방문 항목당 all-day 이벤트 1개(이벤트ID를 항목별 저장). 단일일은 1일, 기간은 start~end. PUT은 (시작,종료) 키로 reconcile — 삭제 항목 이벤트 제거, 신규 항목 이벤트 생성, 유지 항목은 제목/담당자 변경 시에만 갱신
- **API**: POST/PUT body가 `visitDate` 대신 `visits:[{startDate,endDate}]` 수신. `lib/maintenanceVisit.ts` 신설(`normalizeVisits` 입력 정규화·중복제거·정렬, `visitEventPayload` 캘린더 페이로드, `ymd`/`visitKey`). GET 목록·상세 include에 `visits` 추가. DELETE는 방문 항목별 캘린더 이벤트까지 정리
- **UI**: 등록/수정 폼의 단일 날짜 입력을 "방문일정" 반복 입력으로 교체(항목별 시작일 ~ 종료일(선택), + 추가/× 삭제, 종료일 비우면 단일일). 목록 방문일 컬럼은 `start~end` 다건을 `, ` 결합(3건↑ "외 N건"). 상세 진입 시 단일일(start=end)은 종료일 비워 표시
- **간트차트** (`/projects/calendar`): 유지보수 1건 → 방문 항목별 바 다수. 뷰 범위와 겹치는 항목만 렌더, 필터를 단일 날짜 비교 → 범위 교집합으로 변경. 기간 항목은 여러 날 바로 표시
- `npx tsc --noEmit` 통과. **DEV·PROD 모두 반영 완료** (위 캘린더 선택기 작업과 commit `3d31414`로 함께 배포 — 상단 항목 배포 기록 참조)
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260626000000_add_maintenance_visits/`, `lib/maintenanceVisit.ts`(신규), `app/api/maintenances/route.ts`, `app/api/maintenances/[id]/route.ts`, `app/maintenances/{MaintenanceForm,page,[id]/page}.tsx`, `app/projects/calendar/page.tsx`

---

## 2026-06-23 | 설치계획 삭제 실패 버그 수정 — 메일큐 연결 항목 FK 막힘

- **버그(PROD 발견)**: 메일큐에서 등록된 설치계획은 삭제가 실패. `install_plan_queue.install_plan_id` FK가 `onDelete: Cascade`가 아닌 `NO ACTION`이라, 큐가 연결된 설치계획 삭제 시 FK 제약 위반. (files·assignees는 Cascade라 정상) — PROD IP-202606-00016/00017(중복 건) 삭제 불가로 확인
- **수정**: `DELETE /api/install-plans/[id]`에서 삭제 전 연결된 큐 항목을 해제하도록 변경. 큐 항목 unlink(`installPlanId=null`) + `status='ignored'`(메일 원본 보존, 큐에 다시 노출 안 됨) → Task 삭제 → 설치계획 삭제를 **단일 트랜잭션**으로 처리. 스키마 FK 변경(PROD DDL) 없이 코드만으로 해결
- 삭제된 설치계획의 출처 메일은 '무시(ignored)' 처리되어 메일큐에 재노출되지 않음 (메일 원본 레코드는 유지)
- `npx tsc --noEmit` 통과
- 영향 파일: `app/api/install-plans/[id]/route.ts`

---

## 2026-06-23 | 답사 관리 목록 — 상단 동기화 가로 스크롤바 추가

- **불편**: 답사 목록(`/site-visits`)은 컬럼이 많아 좌우 스크롤이 생기는데, 가로 스크롤바가 테이블 맨 아래에 붙어 있어 행이 많으면 브라우저를 최하단까지 내려야 스크롤바가 보임
- **수정**: 테이블 위에 항상 보이는 동기화 가로 스크롤바를 추가. 페이지 로딩 즉시 보이고, 상단 바 ↔ 테이블 스크롤을 양방향 동기화(`syncFrom`, `requestAnimationFrame`으로 재귀 방지)
- 테이블 실제 `scrollWidth`를 측정해 상단 더미 바 폭에 반영, 데이터(`siteVisits`)·창 크기(`resize`) 변동 시 자동 재측정. 컬럼이 넘칠 때만 상단 바 노출, 기존 하단 스크롤바도 유지
- 대안 검토: 높이 고정+sticky 헤더(B안)도 시연했으나 사용자가 상단 스크롤바(A안) 선호 → A안 확정
- **DEV·PROD 모두 반영 완료**: dev2 빌드+`pm2 restart thync-dev`, git push(`67f224e`) → PROD pull → 힙4GB 빌드 + `pm2 restart thync-prod`(DB·패키지 변경 없음). PROD root 307·login 200·site-visits 307 검증
- 영향 파일: `app/site-visits/page.tsx`

---

## 2026-06-22 | 메일큐·답사큐 페이지 USER(일반) 접근 허용

- **버그**: 이전에 두 페이지를 일반 유저에게 허용 요청했으나 코드 미반영 — `mail-queue`/`site-visit-queue` 페이지·API가 여전히 `isAdminOrAbove`(SUPER_ADMIN/ADMIN)로 막혀 USER는 페이지 진입 시 `/`로 리다이렉트, API 403
- **수정**: VIEWER만 차단(=USER 이상 허용)으로 변경
  - `lib/auth.ts`에 `isUserOrAbove(role)` 헬퍼 추가 (VIEWER 제외)
  - 페이지 접근 게이트: `me.role !== 'VIEWER'`로 변경, 상태변수 `isAdmin`→`canAccess`
  - API 6개 `isAdminOrAbove`→`isUserOrAbove`: 목록·일괄삭제(`*/route.ts`), 등록·삭제(`*/[id]/route.ts`), 메일 sync(`*/sync/route.ts`)
- 진입점: 답사관리 "메일 확인" 버튼은 무게이트, 설치계획관리는 이미 `!VIEWER` 노출 — 변경 불필요
- `npx tsc --noEmit` 통과. **DEV·PROD 모두 반영 완료**: dev2 빌드+`pm2 restart thync-dev`, git push → PROD pull(DB 변경 없음) → 힙4GB 빌드 + `pm2 restart thync-prod`. 양쪽 login 200·큐 페이지 307·`ops.seersthync.com` 200 검증
- 영향 파일: `lib/auth.ts`, `app/mail-queue/page.tsx`, `app/site-visit-queue/page.tsx`, `app/api/mail-queue/{route,[id]/route,sync/route}.ts`, `app/api/site-visit-queue/{route,[id]/route,sync/route}.ts`

---

## 2026-06-22 | 차량 운행일지 + 반납 기능 (설계·구현)

- **요구**: 차량별 운행일지 관리. 최종 주행거리는 "반납" 절차로 입력. 예약(사용목적·행선지·운전자) 연동. 보드에서 반납완료/미반납 색 구분
- **DB** (dev2 로컬만 적용, 마이그레이션 `20260622010000_add_vehicle_logs_and_return`):
  - `vehicle_reservations.returned_at` 추가 (NULL=미반납, 값=반납완료 시각). status는 RESERVED 유지 → 보드 표시·충돌검사·EXCLUDE 제약 무영향
  - `vehicles.last_odometer` 추가 (최신 누적 주행거리 캐시)
  - `vehicle_logs` 신설: vehicleId, reservationId?(unique 1:1), driverId, startAt, endAt, purpose?, destination?, endOdometer, distanceKm?, note?, createdById. 인덱스 `(vehicleId,endAt)`,`(driverId,startAt)`
- **거리 계산**: 종료 주행거리만 입력받고, `distanceKm = endOdometer − 직전(같은 차량, endAt 더 이른 것 중 최신) 일지 endOdometer`. 일지 생성/수정/삭제 트랜잭션에서 `recalcVehicleLogs`로 차량 전체 재계산 + `lastOdometer` 갱신. `checkOdometerConsistency`로 앞/뒤 기록과 모순(역주행) 차단 (`lib/vehicleLog.ts`)
- **반납 동선**: 예약 칩 클릭 → 예약 상세 모달에 **반납** 버튼 → 최종 주행거리(+비고) 입력 → 한 트랜잭션으로 운행일지 생성 + `returnedAt` 갱신 + lastOdometer 갱신. 시작/종료/목적/행선지/운전자는 예약값 자동(운전자 변경은 ADMIN만). 반납완료 예약은 수정/취소 숨기고 반납 정보 표시, **반납취소(ADMIN)** = 일지 삭제 + returnedAt 해제
- **보드 색 구분**: 반납완료(회색 ✓) / 반납필요(종료시간 지난 미반납, 앰버 ⚠) / 내 예약(파랑) / 타인(회색). 범례 추가
- **운행일지 탭** (`/vehicle-reservations`): 현황 보드 | 내 예약 | **운행일지**. 차량·기간 필터 + 합계 주행거리, 직접 작성(예약 미연결)·수정·삭제
- **API**: `POST|DELETE /api/vehicle-reservations/[id]/return`(반납/반납취소), `GET|POST /api/vehicle-logs`, `GET|PUT|DELETE /api/vehicle-logs/[id]`. 권한: 조회=로그인 전체, 작성·수정·삭제=USER 이상 본인(운전자/작성자) 또는 ADMIN. audit `resource='vehicle_log'`/`'vehicle_reservation'`(반납)
- **DEV·PROD 모두 반영 완료**: `npx tsc --noEmit` 통과 → dev2 빌드+`pm2 restart thync-dev`, git push(`cf1cecc`) → PROD pull → `thync_ops`에 동일 마이그레이션 SQL 적용 + migrate resolve + generate + 힙4GB 빌드 + `pm2 restart thync-prod`. 양쪽 login 200·보호라우트 307·`ops.seersthync.com` 200 검증, 신규 에러 없음
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260622010000_add_vehicle_logs_and_return/`, `lib/vehicleLog.ts`(신규), `app/api/vehicle-reservations/route.ts`, `app/api/vehicle-reservations/[id]/return/route.ts`(신규), `app/api/vehicle-logs/route.ts`(신규), `app/api/vehicle-logs/[id]/route.ts`(신규), `app/api/vehicles/route.ts`, `app/vehicle-reservations/{page,ReservationModal,VehicleLogsPanel}.tsx`

---

## 2026-06-22 | 차량예약 — 계정별 사용 제한 기능 (계정관리에서 제어)

- **요구**: 특정 사용자가 차량예약 기능을 사용하지 못하도록 계정관리에서 지정. 역할(VIEWER)과 별개로, USER/ADMIN 계정도 개별 차단 가능
- **DB**: `public.users`에 `vehicle_reservation_blocked boolean NOT NULL DEFAULT false` 컬럼 추가 (마이그레이션 `20260622000000_add_vehicle_reservation_blocked`, dev2 로컬만 적용·PROD 미반영). schema.prisma `User.vehicleReservationBlocked` 반영 + `prisma generate`
- **제어 지점**: 계정관리(`/users`) → "다른 계정 수정" 모달(SUPER_ADMIN)에 "차량예약 사용 제한" 체크박스 추가. 목록에 `예약제한` 앰버 뱃지 노출. 변경 권한은 역할/소속과 동일하게 API에서 ADMIN 이상으로 게이트
- **서버 강제**: 차량예약 `POST`/`PUT`/`DELETE` 진입 시 actor의 `vehicleReservationBlocked`를 DB 조회 → true면 403 "차량예약 사용이 제한된 계정입니다." (JWT(7일)에 의존하지 않고 실시간 차단). 차단 계정은 등록·수정·취소 모두 불가, 조회만 가능 (필요 시 관리자가 대신 취소)
- **클라이언트**: `/api/auth/me`·`/api/users`·`/api/users/[id]` select에 필드 추가. 차량예약 페이지 `canReserve`/`canEdit`에 차단 반영 + 상단 안내 배너 노출
- `npx tsc --noEmit` 통과. **DEV·PROD 모두 반영 완료**: dev2 빌드+`pm2 restart thync-dev`, git push(`81b5775`) → PROD pull → `thync_ops`에 동일 컬럼 ALTER + migrate resolve + generate + 힙4GB 빌드 + `pm2 restart thync-prod`. 양쪽 login 200·vehicle 307·`ops.seersthync.com` 200 검증, 신규 에러 없음
- 영향 파일: `prisma/schema.prisma`, `prisma/migrations/20260622000000_add_vehicle_reservation_blocked/`, `app/api/auth/me/route.ts`, `app/api/users/route.ts`, `app/api/users/[id]/route.ts`, `app/api/vehicle-reservations/route.ts`, `app/api/vehicle-reservations/[id]/route.ts`, `app/users/page.tsx`, `app/vehicle-reservations/page.tsx`

---

## 2026-06-16 | 위키 — 페이지 제목 수정 시 상위 페이지 링크 라벨 미갱신 버그 수정

- **버그**: `wikiPageLink` 블록은 대상 페이지 제목을 블록 prop(`title`) 문자열로 박아두고 렌더 시 그대로 표시. 페이지 제목을 수정해도, 그 페이지를 링크한 다른(상위) 페이지 본문의 링크 명칭이 옛 제목 그대로 남았음
- **수정**: 제목 변경 시(`title !== existing.title`) 이 페이지를 링크한 소스 페이지들을 찾아, 본문 내 해당 `wikiPageLink` 블록의 `title` prop을 새 제목으로 동기화. 검색 일관성 위해 소스 페이지 `plainText`도 재추출. 모두 제목 변경 트랜잭션 안에서 처리
- **소스 페이지 탐색은 본문 직접 스캔** (`content_json::text LIKE '%pageId%'`): 백링크 테이블(`wiki_page_links`)은 Phase 12 이후 재저장된 페이지만 인덱싱해 누락이 많음(PROD 진단: 백링크 1행 vs wikiPageLink 보유 페이지 3개)을 확인해, 테이블 의존을 버리고 본문 스캔으로 전환. `updatePageLinkTitles`가 매칭 블록만 교체하고 `changed`로 불필요 쓰기 방지하므로 LIKE 오탐 후보는 안전하게 무시됨
- `lib/wiki/blockText.ts`에 `updatePageLinkTitles(blocks, targetPageId, newTitle)` 헬퍼 추가 (매칭 블록만 교체, 변경 여부 반환 → 불필요한 쓰기 방지)
- 렌더링은 블록 prop을 그대로 쓰므로 클라이언트 변경 불필요. `npx tsc --noEmit` 통과
- 영향 파일: `lib/wiki/blockText.ts`, `app/api/wiki/pages/[id]/route.ts`

---

## 2026-06-16 | 차량예약 보드 — 예약 있는 셀에도 항상 신규 예약 클릭 여백 추가 (PROD 반영)

- 주간 현황 보드에서 예약 칩이 채워진 셀은 빈 공간이 거의 없어 "그 차량·그 날짜 추가 예약" 진입이 발견하기 어려웠던 문제 해결
- 각 요일 셀 칩 목록 하단에 hover 시 `+`가 떠오르는 신규 예약 여백 추가 (칩 있으면 min-h 20px, 빈 셀이면 64px). 별도 onClick 없이 기존 `<td>` 클릭 핸들러(`openCreate`)로 버블링 처리 → 중복 호출 없음. `canReserve`(USER 이상)일 때만 노출
- 프론트 단독, DB·패키지 변경 없음. `npx tsc --noEmit` 통과
- 영향 파일: `app/vehicle-reservations/page.tsx`

---

## 2026-06-16 | 위키 고도화 PROD 반영 + 에디터 SSR 크래시 핫픽스

- **PROD 반영**: Phase 9~13 + 멀티컬럼 + Pretendard를 PROD(`thync-prod`)에 배포. 절차: git pull → `npm install`(신규 의존성 `@blocknote/xl-multi-column`) → 마이그레이션 M1~M6 `thync_ops` 적용(사용자 승인) → `prisma generate` → 빌드(heap 4GB) → `pm2 restart thync-prod`. 폰트 200·스키마(4컬럼+2테이블) 실재·외부 도메인 307 검증
- **핫픽스 — 에디터 SSR 크래시**: BlockNote(멀티컬럼 포함)가 렌더 중 `window` 참조 → `/wiki/[id]`·`/wiki/new` 상세 SSR에서 500(`ReferenceError: window is not defined`). `WikiEditor`를 `next/dynamic`의 `ssr:false`로 클라이언트 전용 로드하여 해결. dev2·PROD 모두 인증 상태 상세페이지 200 확인
  - 교훈: 위키 검증 시 `/wiki`(홈)는 미인증 307만 확인했을 뿐, **인증된 상세페이지 SSR을 안 찔러봐서** 누락. 이후 JWT 발급해 200 검증하는 절차 추가
- 영향 파일: `app/wiki/[id]/WikiPageView.tsx`, `app/wiki/new/page.tsx`

---

## 2026-06-16 | 위키 — 멀티컬럼 블록 추가 + 개발 범위 확정

- **멀티컬럼 블록 추가**: `@blocknote/xl-multi-column@^0.51.4` 도입. 블록을 좌우로 나란히 배치(2단/3단 칼럼). `withMultiColumn`으로 에디터 스키마 확장, `multiColumnDropCursor`(블록을 다른 블록 옆으로 드래그 시 칼럼 생성), 슬래시 메뉴에 `getMultiColumnSlashMenuItems` 추가, 다국어 사전 `multi_column: ko` 적용
- **개발 목록에서 영구 제외(보류 아님)**: 인라인(텍스트선택) 댓글, 토글 리스트, 사용자 @멘션 알림 — 향후에도 진행하지 않음. 기존 페이지 댓글·병원/프로젝트 멘션은 그대로 유지
- 영향 파일: `app/wiki/components/WikiEditor.tsx`, `package.json`. `npx tsc --noEmit` 통과

---

## 2026-06-16 | 위키 고도화 Phase 10~13 — 편집경험·블록·협업·운영 기능

> 설계: `wiki_enhancement_design.md`. 제외(보류): C1 실시간협업, C2 DB뷰, 멀티컬럼, 인라인(텍스트선택) 댓글. DB 마이그레이션은 dev2 로컬에만 적용(PROD 미반영).

**Phase 10 — 편집경험(A1) + 아이콘/커버(A2)**
- **자동 저장**: 편집/저장 모드 토글 제거 → 진입 즉시 편집, 본문/제목 변경 시 debounce 1.5초 자동 PUT. 헤더에 저장 상태 인디케이터(저장 중/저장됨/실패/충돌). VIEWER는 읽기 전용
- **충돌 감지**: 클라이언트가 진입 시점 `baseUpdatedAt`을 PUT에 동봉 → 서버가 현재 updatedAt과 비교, 더 최신이면 409 + "새로고침" 배너 (실시간 협업 대신 lost-update 방지)
- **버전 스냅샷 throttle**: 자동저장으로 버전이 폭증하지 않도록, 마지막 스냅샷이 2분 이상 지난 경우에만 wiki_versions 기록
- **에디터 인라인 저장 정리**: 하위페이지/링크 삽입의 개별 PUT을 부모 `onSaveNow` 콜백으로 위임
- **페이지 아이콘(이모지) + 커버 이미지**: `wiki.wiki_pages`에 `icon`/`cover_url`/`cover_offset_y` 추가(M1). 경량 EmojiPicker(외부 패키지 없음), 커버 업로드는 기존 `/api/wiki/upload` 재사용. 아이콘은 사이드바·홈·검색·휴지통에도 노출

**Phase 11 — 블록 확장 + 목차 + 홈 대시보드**
- **커스텀 블록**: 콜아웃(💡 아이콘+배경색 박스), 구분선 — 슬래시 메뉴에 추가. 기존 contentJson 호환
- **목차(TOC)**: 본문 heading 블록을 추출해 넓은 화면(xl+) 우측에 floating, 클릭 시 스크롤. 본문 변경 시 실시간 갱신
- **홈 대시보드**: "최근 수정 20개" → 즐겨찾기 / 최근 본 / 최근 수정 3섹션
- (멀티컬럼은 패키지 도입 리스크로 보류)

**Phase 12 — 백링크 + 템플릿**
- **백링크**: `wiki.wiki_page_links`(source/target, M3) 신설. 본문 저장 시 wikiPageLink 블록을 파싱해 인덱스 갱신(실존 페이지만), 상세 하단에 "이 페이지를 링크한 페이지" 패널
- **템플릿**: `wiki.wiki_pages.is_template`(M2). 페이지 상세 ⋯ "템플릿으로 저장"(복제 후 템플릿 표시), 신규 작성 화면에 "빈 페이지 + 템플릿 갤러리" 시작 선택. 템플릿은 트리/홈/검색에서 제외
- (인라인 텍스트선택 댓글은 앵커 보존 난이도로 후속 분리, 기존 페이지 댓글 유지)

**Phase 13 — 휴지통 + 검색 고도화 + 알림**
- **휴지통(soft delete)**: `wiki.wiki_pages.deleted_at`(M4). 삭제 → 휴지통(하위 동반), `/wiki/trash`에서 복구(부모 삭제 시 루트 승격)/영구삭제. **모든 조회 경로에 `deleted_at IS NULL` 필터 적용**(트리/홈/검색/상세/백링크/참조 역검색/recent/favorites). 영구삭제는 `DELETE ?permanent=1` + S3 정리
- **검색 고도화**: 작성자·기간 필터 추가, 삭제/템플릿 제외, pg_trgm GIN 인덱스(title/plain_text, M6)로 ILIKE 가속
- **알림(B7)**: `wiki.wiki_notifications`(M5). 댓글 작성 시 페이지 작성자+최근수정자에게 알림(본인 제외), 사이드바 헤더 🔔 벨(미읽음 뱃지, 60초 폴링, 클릭 시 읽음 처리·이동). (사용자 @멘션 알림은 후속)

**공통 UI(Phase 9 연장)**: 모든 신규 화면 토큰 적용, alert→토스트, 빈 상태→EmptyState, 모달→WikiModal

- 마이그레이션: M1~M6 (`wiki` 스키마 한정). `npx tsc --noEmit` 통과, 빌드·`pm2 restart thync-dev` 검증(클린 부팅, 307 정상). git push·PROD 반영 미실행
- 영향 파일: `app/api/wiki/pages/route.ts`, `app/api/wiki/pages/[id]/route.ts`, `app/api/wiki/pages/[id]/restore/route.ts`(신규), `app/api/wiki/pages/[id]/comments/route.ts`, `app/api/wiki/notifications/route.ts`(신규), `app/api/wiki/search/route.ts`, `lib/wiki/blockText.ts`, `app/wiki/[id]/{page,WikiPageView,TableOfContents}.tsx`, `app/wiki/{page,new,search,recent,favorites,trash}/page.tsx`, `app/wiki/components/{WikiEditor,WikiSidebar,NotificationBell}.tsx`, `app/wiki/components/ui/{EmojiPicker,OverflowMenu,...}.tsx`, `prisma/schema.prisma`

---

## 2026-06-16 | 위키 고도화 Phase 9 — 디자인 시스템 기반 (UI 완성도)

- 위키를 상용 제품 수준으로 끌어올리기 위한 고도화 1단계. 기능 변화 없이 **룩앤필 통일**에 집중. 상세 설계는 `wiki_enhancement_design.md` 참고 (범위: C1 실시간협업·C2 DB뷰 제외)
- **디자인 토큰 도입** (`app/wiki/wiki-theme.css`): 웜 그레이 팔레트(순흑/순백 대비 제거), 타이포 스케일, 간격·라운드·그림자·모션 토큰. 모두 `.wiki-root` 스코프 → 앱 나머지 무영향. BlockNote(ariakit) CSS 변수 오버라이드로 에디터 톤 통일
- **공통 컴포넌트 신설** (`app/wiki/components/ui/`): `Toast`(+Provider, `alert()` 대체), `WikiModal`(오버레이 블러·ESC·진입 트랜지션), `Skeleton`/`PageSkeleton`/`ListSkeleton`, `EmptyState`(아이콘+CTA), `OverflowMenu`(⋯ 메뉴)
- **레이아웃 full-bleed화**: 에디터를 `border rounded p-4` 박스에서 꺼내 `wiki-content`(max-w 900) 읽기 폭으로. 페이지 제목 `wiki-page-title`(2.25rem/800). 댓글 영역 구분선 추가
- **상단 액션바 정리**: 버튼 6개 나열 → `편집` + `+ 하위 페이지` + `⋯`(버전/이동/복제/삭제) 오버플로 메뉴로 통합. 복제 모달을 `WikiModal`로 교체
- **사이드바 리프레시 + 상태 유지(A4)**: 토큰 기반 재스타일, 폭 접기(« ») localStorage 유지, 펼침/접힘 상태 localStorage 유지 + 현재 페이지 조상 자동 펼침, alert→토스트. DnD 이동 로직은 그대로 보존
- **홈 페이지**: 토큰 적용 + 빈 상태를 `EmptyState`로 교체
- 데이터 모델·API·패키지 변경 없음 (프론트 단독, 기존 contentJson 100% 호환). `npx tsc --noEmit` 통과
- 영향 파일: `app/wiki/wiki-theme.css`(신규), `app/wiki/components/ui/*`(신규 5종), `app/wiki/layout.tsx`, `app/wiki/components/WikiSidebar.tsx`, `app/wiki/[id]/WikiPageView.tsx`, `app/wiki/page.tsx`
- 빌드·PM2 재시작·git push는 미실행 (사용자 명시 요청 대기)

---

## 2026-06-15 | 위키 — 기존 페이지 링크 삽입 기능 추가

- 기존엔 본문에서 다른 페이지를 거는 방법이 `/` 슬래시 "하위 페이지 추가"(항상 신규 생성)뿐이었음. 이미 사이드바에 있는 페이지를 신규 생성 없이 본문에 링크하는 경로가 없었던 문제 해결
- `/` 슬래시 메뉴에 **"기존 페이지 링크"** 항목 추가 → 검색 모달(`WikiPageLinkPicker`)에서 `/api/wiki/search`(기존 API)로 제목·본문 검색 후 선택 시 `wikiPageLink` 블록 삽입 (신규 페이지 생성 없음)
- 삽입 위치는 슬래시 클릭 시점의 커서 블록을 ref로 고정(모달 상호작용 중 커서 소실 방지). 하위 페이지 추가와 동일하게 `pageId` 있으면 본문 즉시 PUT 저장 + `router.refresh()`로 유실 방지
- 백엔드·DB·패키지 변경 없음 (프론트 단독). 검색 디바운스 250ms, ESC·바깥 클릭 닫기
- 영향 파일: `app/wiki/components/WikiEditor.tsx`

---

## 2026-06-12 | 위키 파일 첨부 카드 렌더링 — PROD 반영 완료

- **커밋 `bbdbd43`** (2파일, +128/-1) push → PROD pull (fast-forward)
- 신규 패키지·DB 변경 없음
- 힙 4GB 빌드 + `pm2 restart thync-prod` → online, Ready in 1.2s
- smoke test: `/login` 200, `/wiki` 미인증 307 정상, 에러 로그 없음

---

## 2026-06-12 | 위키 — 파일 첨부 블록 카드 스타일 렌더링

- 기본 `file` 블록의 조악한 렌더를 커스텀 카드로 교체 (`createReactBlockSpec`, type·propSchema 동일 → 기존 저장 데이터 마이그레이션 없이 호환)
- 확장자별 아이콘 배지: Word(W·파랑), Excel/CSV(X·초록), PPT(P·주황), PDF(빨강), HWP(하늘), ZIP(노랑), TXT/MD(회색), 기타(📄)
- 파일명 볼드·파란색·hover 밑줄, 확장자 표기, hover 시 다운로드 아이콘, 새 탭 열기
- 빈 블록(업로드 전) 상태: 편집 중엔 점선 "파일 업로드" 버튼(`editor.uploadFile` 직접 호출), 읽기 모드엔 안내 문구
- 영향 파일: `app/wiki/components/WikiEditor.tsx`

---

## 2026-06-12 | 위키 하위페이지 링크 유실 수정 — PROD 반영 완료

- **커밋 `8f233dc`** (3파일, +26/-1) push → PROD pull (fast-forward)
- DB 변경 없음 (마이그레이션 불필요)
- 힙 4GB 빌드 + `pm2 restart thync-prod` → online, Ready in 1.2s
- smoke test: `/login` 200, `/wiki` 미인증 307 정상, 에러 로그 없음

---

## 2026-06-12 | 위키 — 하위페이지 링크 블록 유실 버그 수정

- **버그**: 편집 중 슬래시 메뉴 "하위 페이지 추가"로 삽입된 `wikiPageLink` 블록이 에디터 메모리에만 존재 → 저장 전 링크 클릭(일반 `<a>` 전체 네비게이션)으로 이탈하면 부모 본문에서 링크가 유실됨
- **수정 1 (핵심)**: 하위페이지 생성·블록 삽입 직후 부모 본문을 `PUT /api/wiki/pages/{parentId}`로 즉시 자동 저장 → 이탈해도 링크 보존 (`WikiEditor.tsx`)
- **수정 2 (사이드바)**: 하위페이지 생성 직후 `router.refresh()` 호출 → 사이드바 트리에 새 페이지 즉시 반영 (`WikiEditor.tsx`)
- **수정 3 (잠재버그)**: `WikiPageView`의 `content` state가 `[]`로 초기화되어 편집 진입 후 무변경 저장 시 본문이 빈 배열로 덮이는 위험 → `initialContent`로 초기화
- 영향 파일: `app/wiki/components/WikiEditor.tsx`, `app/wiki/[id]/WikiPageView.tsx`

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
