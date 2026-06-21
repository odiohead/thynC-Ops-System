-- 차량예약 사용 제한 플래그 (true=해당 사용자 차량예약 생성/수정/취소 불가)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS vehicle_reservation_blocked boolean NOT NULL DEFAULT false;
