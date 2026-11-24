-- 심평원 요양기호 변경 대응 (2026-11-12): 목록 동기화가 마지막으로 받은 시각 + 대체 레코드 표시
ALTER TABLE "hira_hospitals" ADD COLUMN "last_seen_at" TIMESTAMP(3), ADD COLUMN "superseded_by_id" INTEGER;
ALTER TABLE "hira_hospitals" ADD CONSTRAINT "hira_hospitals_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "hira_hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
