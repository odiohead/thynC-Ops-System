-- CreateTable
CREATE TABLE "hospital_meta" (
    "id" SERIAL NOT NULL,
    "hospital_code" TEXT NOT NULL,
    "drive_project_folder_id" TEXT,
    "drive_status_file_id" TEXT,
    "drive_install_plan_file_id" TEXT,
    "remote_access_url" TEXT,
    "remote_control_url" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hospital_meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hospital_meta_hospital_code_key" ON "hospital_meta"("hospital_code");

-- AddForeignKey
ALTER TABLE "hospital_meta" ADD CONSTRAINT "hospital_meta_hospital_code_fkey" FOREIGN KEY ("hospital_code") REFERENCES "hospitals"("hospital_code") ON DELETE RESTRICT ON UPDATE CASCADE;
