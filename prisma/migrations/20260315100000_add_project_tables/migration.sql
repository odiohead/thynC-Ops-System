-- CreateTable: device_info
CREATE TABLE "device_info" (
    "id" SERIAL NOT NULL,
    "device_model" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable: projects
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "project_code" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "hospital_code" TEXT NOT NULL,
    "order_number" INTEGER NOT NULL,
    "contract_date" TIMESTAMP(3),
    "ward_count" INTEGER,
    "bed_count" INTEGER,
    "gateway_count" INTEGER,
    "has_survey" BOOLEAN NOT NULL DEFAULT false,
    "has_order" BOOLEAN NOT NULL DEFAULT false,
    "builder_user_id" TEXT,
    "builder_name_manual" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date_expected" TIMESTAMP(3),
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "issue_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable: project_devices
CREATE TABLE "project_devices" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "device_info_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable: project_files
CREATE TABLE "project_files" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "file_category" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "drive_url" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_info_device_model_key" ON "device_info"("device_model");

-- CreateIndex
CREATE UNIQUE INDEX "projects_project_code_key" ON "projects"("project_code");

-- CreateIndex
CREATE UNIQUE INDEX "project_devices_project_id_device_info_id_key" ON "project_devices"("project_id", "device_info_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_hospital_code_fkey" FOREIGN KEY ("hospital_code") REFERENCES "hospitals"("hospital_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_builder_user_id_fkey" FOREIGN KEY ("builder_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_devices" ADD CONSTRAINT "project_devices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_devices" ADD CONSTRAINT "project_devices_device_info_id_fkey" FOREIGN KEY ("device_info_id") REFERENCES "device_info"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
