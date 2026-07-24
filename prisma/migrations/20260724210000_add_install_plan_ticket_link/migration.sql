-- P8 설치계획 편입: install_plans.ticket_id (ticket_dev_schedule.md P8 상세 설계)

ALTER TABLE "install_plans" ADD COLUMN "ticket_id" INTEGER;
ALTER TABLE "install_plans" ADD CONSTRAINT "install_plans_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "install_plans_ticket_id_key" ON "install_plans"("ticket_id");
