-- 출고 처리 입력 내용 임시 저장 (2026-11-18) — 처리 화면을 닫았다가 다시 열어도(다른 PC·브라우저 포함) 입력한 시리얼·LOT·계약 선택이 남도록
-- fulfill_draft: 화면 입력 상태(JSON — 품목별 시리얼/LOT/기록·확인 여부·계약·출고일 등), 출고 실행 시 비움
ALTER TABLE "public"."stock_out_requests" ADD COLUMN "fulfill_draft" JSONB;
ALTER TABLE "public"."stock_out_requests" ADD COLUMN "fulfill_draft_at" TIMESTAMP(3);
