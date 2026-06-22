-- 차량예약 반납 추적 (returned_at: NULL=미반납, 값=반납완료 시각)
ALTER TABLE public.vehicle_reservations ADD COLUMN IF NOT EXISTS returned_at timestamp(3) without time zone;

-- 차량 최신 누적 주행거리 캐시 (운행일지 종료거리로 갱신)
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS last_odometer integer;

-- 운행일지
CREATE TABLE IF NOT EXISTS public.vehicle_logs (
  id             SERIAL PRIMARY KEY,
  vehicle_id     integer NOT NULL,
  reservation_id integer,
  driver_id      text NOT NULL,
  start_at       timestamp(3) without time zone NOT NULL,
  end_at         timestamp(3) without time zone NOT NULL,
  purpose        text,
  destination    text,
  end_odometer   integer NOT NULL,
  distance_km    integer,
  note           text,
  created_by_id  text NOT NULL,
  created_at     timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vehicle_logs_reservation_id_key UNIQUE (reservation_id),
  CONSTRAINT vehicle_logs_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT vehicle_logs_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.vehicle_reservations(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT vehicle_logs_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT vehicle_logs_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS vehicle_logs_vehicle_id_end_at_idx ON public.vehicle_logs(vehicle_id, end_at);
CREATE INDEX IF NOT EXISTS vehicle_logs_driver_id_start_at_idx ON public.vehicle_logs(driver_id, start_at);
