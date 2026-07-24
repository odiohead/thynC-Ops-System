-- P9 프로젝트 편입: projects.ticket_id (ticket_dev_schedule.md P9 상세 설계)

ALTER TABLE "projects" ADD COLUMN "ticket_id" INTEGER;
ALTER TABLE "projects" ADD CONSTRAINT "projects_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "projects_ticket_id_key" ON "projects"("ticket_id");
