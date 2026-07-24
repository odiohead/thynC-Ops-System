-- P7 답사 편입: site_visits.ticket_id (ticket_dev_schedule.md P7 상세 설계)

ALTER TABLE "site_visits" ADD COLUMN "ticket_id" INTEGER;
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "site_visits_ticket_id_key" ON "site_visits"("ticket_id");
