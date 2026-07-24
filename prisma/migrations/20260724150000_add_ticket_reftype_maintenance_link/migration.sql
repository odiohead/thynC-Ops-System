-- P5 유지보수 편입: tickets.ref_type + maintenances.ticket_id (ticket_dev_schedule.md P5 상세 설계)

ALTER TABLE "tickets" ADD COLUMN "ref_type" TEXT;
CREATE INDEX "tickets_ref_type_idx" ON "tickets"("ref_type");

ALTER TABLE "maintenances" ADD COLUMN "ticket_id" INTEGER;
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "maintenances_ticket_id_key" ON "maintenances"("ticket_id");
