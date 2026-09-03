# projects/ — 기능개발 설계 문서

기능 단위 설계안·개발 일정 문서를 모아두는 디렉토리입니다. (2026-07-26 신설 — 이전에는 루트에 산재)

## 규칙

- 새 기능 설계 문서는 **이 디렉토리에** 생성 (`<기능>_design.md`, 필요하면 같은 이름의 `.html` 열람용 사본)
- 문서 상단에 **상태**를 명시: `설계 검토 대기 — 미착수` / `설계 확정 — 구현 중(Phase N)` / `완료(배포일)` / `보류` 중 하나
- 설계안은 사용자 검토·착수 승인 후에만 구현 시작 (CLAUDE.md 설계 게이트)

## 문서 목록

| 문서 | 대상 | 상태 |
|---|---|---|
| [notification_v1.1_design.md](notification_v1.1_design.md) · [HTML](notification_v1.1_design.html) | 1.1 알림체계 개선 (SLA 세분화·채널 라우팅·내부 알림·첫 화면 개인화) | **P1~P6 구현 완료 / P7 지표·PROD 배포 대기** |
| [sales_crm_design.md](sales_crm_design.md) · [HTML](sales_crm_design.html) | 영업/CRM 모듈 v4 — 병원 축·차수 축 2데이터셋 (인적정보/전원 이력·딜 확장·`/sales` 도입 현황 목록, P1~P5) | **v4 P1~P3 구현 완료 (dev2, 2026-07-29) — P4 실데이터 검증 대기** |
| [daewoong_deal_migration_design.md](daewoong_deal_migration_design.md) | 대웅 원장(thynC_status.xlsx) 딜 전면 재적재 + 대웅 축 필드 분리·'대웅제약' 카드 | **검토 대기 (착수 승인 전)** |
| [ops_system_2.0_plan.html](ops_system_2.0_plan.html) | **2.0 기획안** (설계안 아님) — 6테마 18항목 고도화 지도 (설치 기반·반복 매출·고객 경험·현장 운영·인텔리전스·기반), 실측 데이터 진단 + Wave 우선순위 — A1은 디바이스 원장으로 구현(2026-09) | **기획 검토 대기** |
| [rbac_design.md](rbac_design.md) | 기능 역할(Role) 권한 체계 — RBAC Lite (등급 위에 가산 전용 역할·권한 카탈로그·`hasPermission`, 파일럿 자재관리, 2.0 테마 F 연계) | **Phase 1·2·3 구현 완료 (2026-08-04, dev2) — 선택 후속만 승인 대기** |
| [notification_v2_design.md](notification_v2_design.md) | 알림 v2 — 티켓 단일 소스 재편 (delay-rules 폐기·그룹/SLA정책별 채널·CTI SLA·임박 배선·전역 요약, P1~P5) | **완료 (PROD 배포 2026-08-03)** |
| [inventory_udi_ledger_design.md](inventory_udi_ledger_design.md) | 자재관리 UDI 입출고대장 — GMP 양식 F707-1(rev.4) docx 자동 생성 (device_info 모델 마스터 승격·LOT 해석 이원화 해소·문서 메타 편집, P0~P5) | **P0~P5 구현 완료 (dev2, 2026-08-04) — PROD 미반영** |
| [cs_ticket_workflow_design.md](cs_ticket_workflow_design.md) · [HTML](cs_ticket_workflow_design.html) | CS 티켓 워크플로 — 도메인 어댑터 레지스트리(편입 플러그인화)·신규 도메인 VOC접수(CS 마스터 티켓)·하위 도메인 티켓 생성 (P0~P3, 콜기록지는 2026-08-15 개정으로 제거) | **구현 완료 (dev2, 2026-08-15 개정 반영) — PROD 미반영** |
| [sales_dashboard_map_design.md](sales_dashboard_map_design.md) | 영업 대시보드(지도) — `/sales/dashboard_map` 7개 권역 지도(muted-earth 베이스맵)+표+드릴다운·종별 필터·막대 3모드, koreaGeo.ts 재생성 절차 포함 | **완료 (PROD 배포 2026-08-15)** |
| [hospitals_erd.html](hospitals_erd.html) | **참조 문서** (설계안 아님) — 병원(hospitals) 관련 테이블 ERD + 컬럼 상세 명세 (hira/meta/devices/intro_types/대웅배정/영업프로필 + 참조 업무 테이블 요약) | 참조용 (2026-08-16 작성, 스키마 변경 시 갱신) |
| [weekly_ops_design.md](weekly_ops_design.md) | 주간업무 관리툴 — `/weekly` (nav 미등록·URL 직접 진입) 사업본부 주간 리뷰: 지속 항목 + 주차별 진행 upsert(지난주\|금주 병렬 보드), 병원별 이슈 뷰, 완료 아카이브, 티켓 미편입 | **v1 완료 (PROD 배포 2026-08-19, 커밋 1fc2964)** |
| [hospital_device_registry_design.md](hospital_device_registry_design.md) | 병원별 웨어러블 디바이스 원장 — `/devices` 시리얼 개체(전역 1행) + append 이벤트 이력(등록·병동이동·회수·교체 쌍), 병원별 병동 마스터, 검토형 임포트, 딜 계약 수량 대조, 기존 `hospital_devices` 수량표 폐기(D1~D12, P0~P5). 2.0 기획 A1 구체화 | **완료 (PROD 배포 2026-09-02, 커밋 d6e54b1) — 데이터는 사용자 직접 입력 예정, 후속: 교체 허용량 규칙·WMS 편입·유지보수 패널(P6)** |
| [hospital_device_registry_brief.md](hospital_device_registry_brief.md) | **참조 문서** (설계안 아님) — 위 설계의 조사 원문: 기존 기기 수량 계층·WMS 시리얼 개체·AS 기록 실태·온프렘 `device_register`/API 검증·플랫폼 규약·데이터 규모 | 참조용 (2026-09-01 작성) |
| [stock_out_request_design.md](stock_out_request_design.md) | 출고업무(출고요청) — 프로젝트 필수 연결 도메인 레코드(`SOR-`)+메인 티켓 자동 생성(7번째 도메인, refType `STOCK_OUT`), 품목 마스터 12종×수량 라인, 프로젝트 상세 팝업 등록, 상태 5종(요청·처리중·보류·완료·취소 — 완료·취소는 티켓 CLOSED 직행) | **P1·P2 구현 완료 (dev2, 2026-09-03) — PROD 미반영** (P2: 출고 처리·WMS 차감·기기현황 자동 등록 §13) |

## 루트에 남아 있는 1.0 문서

1.0 범위에서 작성된 아래 문서는 아직 루트에 있습니다(참조가 CLAUDE.md·README·DEV_HISTORY 여러 곳에 걸려 있어 일괄 이동은 별도 작업으로 분리).

`ticket_dev_schedule.md` · `ticket_system_design.md` · `ticket_design_plan.md` · `wiki_dev_schedule.md` · `wiki_enhancement_design.md` · `function_notification.md` · `function_wms.md` · `function_ai_assistant.html` · `function_gateway_planner.html` · `ai_assistant_v3_design.md` · `ai_assistant_optimization_design.md` · `consultation_history_design.md` · `vehicle_dev_schedule.md` · `enhancement_analysis_202607.md`(보류)
