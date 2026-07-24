-- 마스터-서브 티켓 (AWS SIM parent/child — ticket_system_design.md §2.1 보강 2026-07-24)

ALTER TABLE "tickets" ADD COLUMN "parent_id" INTEGER;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tickets"("id") ON DELETE SET NULL;
CREATE INDEX "tickets_parent_id_idx" ON "tickets"("parent_id");
