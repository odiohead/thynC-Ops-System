-- P6 기타업무 편입: etc_tasks.ticket_id (ticket_dev_schedule.md P6 상세 설계)

ALTER TABLE "etc_tasks" ADD COLUMN "ticket_id" INTEGER;
ALTER TABLE "etc_tasks" ADD CONSTRAINT "etc_tasks_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "etc_tasks_ticket_id_key" ON "etc_tasks"("ticket_id");
