-- CreateTable
CREATE TABLE "hira_hospitals" (
    "id" SERIAL NOT NULL,
    "hira_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type_code" TEXT NOT NULL,
    "type_name" TEXT NOT NULL,
    "sido_code" TEXT NOT NULL,
    "sido_name" TEXT NOT NULL,
    "sigungu_code" TEXT NOT NULL,
    "sigungu_name" TEXT NOT NULL,
    "eupmyeondong" TEXT,
    "postal_code" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "total_doctors" INTEGER,
    "opened_at" TEXT,
    "coordinate_x" TEXT,
    "coordinate_y" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hira_hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitals" (
    "id" SERIAL NOT NULL,
    "hospital_code" TEXT NOT NULL,
    "hira_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sido_code" TEXT,
    "sido_name" TEXT,
    "sigungu_code" TEXT,
    "sigungu_name" TEXT,
    "eupmyeondong" TEXT,
    "postal_code" TEXT,
    "address" TEXT,
    "coordinate_x" TEXT,
    "coordinate_y" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_codes" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hira_hospitals_hira_id_key" ON "hira_hospitals"("hira_id");

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_hospital_code_key" ON "hospitals"("hospital_code");

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_hira_id_key" ON "hospitals"("hira_id");

-- CreateIndex
CREATE UNIQUE INDEX "status_codes_name_key" ON "status_codes"("name");

-- AddForeignKey
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_hira_id_fkey" FOREIGN KEY ("hira_id") REFERENCES "hira_hospitals"("hira_id") ON DELETE SET NULL ON UPDATE CASCADE;
