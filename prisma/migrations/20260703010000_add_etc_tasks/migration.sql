-- 기타업무(EtcTask): 여러 병원을 커버하거나 유지보수가 아닌 주요 업무 관리 모듈
-- 본체 + 담당자 N:M + 병원 N:M(선택 다중 연결) + 업무기간(visits, 단일일/기간 다건) + 첨부파일

CREATE TABLE "public"."etc_tasks" (
    "id" SERIAL NOT NULL,
    "etc_task_code" TEXT,
    "title" TEXT NOT NULL,
    "status_id" INTEGER,
    "priority" TEXT NOT NULL DEFAULT '보통',
    "reported_at" DATE,
    "resolved_at" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "etc_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etc_tasks_etc_task_code_key" ON "public"."etc_tasks"("etc_task_code");

ALTER TABLE "public"."etc_tasks"
    ADD CONSTRAINT "etc_tasks_status_id_fkey"
    FOREIGN KEY ("status_id") REFERENCES "public"."status_codes"("id");

CREATE TABLE "public"."etc_task_assignees" (
    "id" SERIAL NOT NULL,
    "etc_task_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "etc_task_assignees_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etc_task_assignees_etc_task_id_user_id_key" ON "public"."etc_task_assignees"("etc_task_id", "user_id");

ALTER TABLE "public"."etc_task_assignees"
    ADD CONSTRAINT "etc_task_assignees_etc_task_id_fkey"
    FOREIGN KEY ("etc_task_id") REFERENCES "public"."etc_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."etc_task_assignees"
    ADD CONSTRAINT "etc_task_assignees_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."etc_task_hospitals" (
    "id" SERIAL NOT NULL,
    "etc_task_id" INTEGER NOT NULL,
    "hospital_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "etc_task_hospitals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etc_task_hospitals_etc_task_id_hospital_code_key" ON "public"."etc_task_hospitals"("etc_task_id", "hospital_code");
CREATE INDEX "etc_task_hospitals_hospital_code_idx" ON "public"."etc_task_hospitals"("hospital_code");

ALTER TABLE "public"."etc_task_hospitals"
    ADD CONSTRAINT "etc_task_hospitals_etc_task_id_fkey"
    FOREIGN KEY ("etc_task_id") REFERENCES "public"."etc_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."etc_task_hospitals"
    ADD CONSTRAINT "etc_task_hospitals_hospital_code_fkey"
    FOREIGN KEY ("hospital_code") REFERENCES "public"."hospitals"("hospital_code");

CREATE TABLE "public"."etc_task_visits" (
    "id" SERIAL NOT NULL,
    "etc_task_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "calendar_event_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "etc_task_visits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "etc_task_visits_etc_task_id_idx" ON "public"."etc_task_visits"("etc_task_id");

ALTER TABLE "public"."etc_task_visits"
    ADD CONSTRAINT "etc_task_visits_etc_task_id_fkey"
    FOREIGN KEY ("etc_task_id") REFERENCES "public"."etc_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."etc_task_files" (
    "id" SERIAL NOT NULL,
    "etc_task_id" INTEGER NOT NULL,
    "file_category" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "etc_task_files_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."etc_task_files"
    ADD CONSTRAINT "etc_task_files_etc_task_id_fkey"
    FOREIGN KEY ("etc_task_id") REFERENCES "public"."etc_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 기타업무 상태코드 시드 (유지보수 상태와 동일한 기본 구성·색상)
INSERT INTO "public"."status_codes" ("name", "order", "color", "category") VALUES
    ('접수', 0, '#3B82F6', 'ETC_TASK_STATUS'),
    ('처리중', 1, '#F59E0B', 'ETC_TASK_STATUS'),
    ('완료', 2, '#10B981', 'ETC_TASK_STATUS'),
    ('보류', 3, '#6B7280', 'ETC_TASK_STATUS')
ON CONFLICT ("name", "category") DO NOTHING;

-- 네비게이션 메뉴: 유지보수(45)와 간트차트(50) 사이. 기타업무는 SEERS 내부 업무라 SEERS 소속만 노출(메뉴 관리에서 변경 가능)
INSERT INTO "public"."nav_menu_items" ("menu_key", "label", "href", "icon_key", "parent_key", "allowed_roles", "allowed_org_codes", "is_active", "sort_order") VALUES
    ('etc-tasks', '기타업무', '/etc-tasks', 'briefcase', NULL, '{}', '{SEERS}', true, 47),
    ('settings/etc-task-status', '기타업무 상태 관리', '/settings/etc-task-status', NULL, 'settings', '{}', '{}', true, 155)
ON CONFLICT ("menu_key") DO NOTHING;
