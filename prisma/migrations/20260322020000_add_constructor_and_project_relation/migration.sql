-- CreateTable
CREATE TABLE "constructors" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "biz_reg_number" TEXT,
    "manager_name" TEXT,
    "manager_phone" TEXT,
    "manager_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "constructors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "constructors_code_key" ON "constructors"("code");

-- AlterTable: Add constructor_id to projects
ALTER TABLE "projects" ADD COLUMN "constructor_id" INTEGER;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_constructor_id_fkey" FOREIGN KEY ("constructor_id") REFERENCES "constructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
