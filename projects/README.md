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

## 루트에 남아 있는 1.0 문서

1.0 범위에서 작성된 아래 문서는 아직 루트에 있습니다(참조가 CLAUDE.md·README·DEV_HISTORY 여러 곳에 걸려 있어 일괄 이동은 별도 작업으로 분리).

`ticket_dev_schedule.md` · `ticket_system_design.md` · `ticket_design_plan.md` · `wiki_dev_schedule.md` · `wiki_enhancement_design.md` · `function_notification.md` · `function_wms.md` · `function_ai_assistant.html` · `function_gateway_planner.html` · `ai_assistant_v3_design.md` · `ai_assistant_optimization_design.md` · `consultation_history_design.md` · `vehicle_dev_schedule.md` · `enhancement_analysis_202607.md`(보류)
