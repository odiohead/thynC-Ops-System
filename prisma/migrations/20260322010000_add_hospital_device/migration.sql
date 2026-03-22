-- CreateTable
CREATE TABLE "hospital_devices" (
    "id" SERIAL NOT NULL,
    "hospital_code" TEXT NOT NULL,
    "device_info_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hospital_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hospital_devices_hospital_code_device_info_id_key" ON "hospital_devices"("hospital_code", "device_info_id");

-- AddForeignKey
ALTER TABLE "hospital_devices" ADD CONSTRAINT "hospital_devices_hospital_code_fkey" FOREIGN KEY ("hospital_code") REFERENCES "hospitals"("hospital_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospital_devices" ADD CONSTRAINT "hospital_devices_device_info_id_fkey" FOREIGN KEY ("device_info_id") REFERENCES "device_info"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
