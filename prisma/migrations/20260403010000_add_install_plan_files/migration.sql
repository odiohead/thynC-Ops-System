CREATE TABLE "install_plan_files" (
    "id" SERIAL NOT NULL,
    "install_plan_id" INTEGER NOT NULL,
    "file_category" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "install_plan_files_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "install_plan_files" ADD CONSTRAINT "install_plan_files_install_plan_id_fkey" FOREIGN KEY ("install_plan_id") REFERENCES "install_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
