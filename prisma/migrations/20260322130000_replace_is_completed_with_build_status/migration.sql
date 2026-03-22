-- CreateTable
CREATE TABLE "build_statuses" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "build_statuses_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "build_status_id" INTEGER;
ALTER TABLE "projects" DROP COLUMN "is_completed";

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_build_status_id_fkey"
    FOREIGN KEY ("build_status_id") REFERENCES "build_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
