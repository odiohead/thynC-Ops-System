-- 티켓 큐 멤버십 (AWS resolver group 재현 — ticket_system_design.md §2.4 보강 2026-07-24)

CREATE TABLE "ticket_queue_members" (
    "id" SERIAL PRIMARY KEY,
    "queue_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_queue_members_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "ticket_queues"("id") ON DELETE CASCADE,
    CONSTRAINT "ticket_queue_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ticket_queue_members_queue_id_user_id_key" ON "ticket_queue_members"("queue_id", "user_id");
CREATE INDEX "ticket_queue_members_user_id_idx" ON "ticket_queue_members"("user_id");
