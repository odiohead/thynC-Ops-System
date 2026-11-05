-- 출고요청 영업 유형(평가용·판매용·오산영업소) — 모바일 출고요청 (2026-11-05, projects/stock_out_sales_request_design.md)
-- 업무 구분(purpose)에 3유형 추가: 설정 > 출고 품목 관리 유형별 탭 = 노출 품목(= 출고 인벤토리) 지정
ALTER TABLE public.stock_out_item_purposes DROP CONSTRAINT stock_out_item_purposes_purpose_check;
ALTER TABLE public.stock_out_item_purposes ADD CONSTRAINT stock_out_item_purposes_purpose_check
  CHECK (purpose IN ('BUILD','MAINTENANCE','BUSINESS','EVALUATION','SALES','OSAN_OFFICE'));

ALTER TABLE public.stock_out_requests DROP CONSTRAINT stock_out_requests_purpose_check;
ALTER TABLE public.stock_out_requests ADD CONSTRAINT stock_out_requests_purpose_check
  CHECK (purpose IN ('BUILD','MAINTENANCE','BUSINESS','EVALUATION','SALES','OSAN_OFFICE'));

-- 영업 유형은 프로젝트 없이 납품처(병원/기타)·수령지·수취인으로 요청
ALTER TABLE public.stock_out_requests ALTER COLUMN project_code DROP NOT NULL;
ALTER TABLE public.stock_out_requests
  ADD COLUMN sub_purpose        VARCHAR(24),
  ADD COLUMN dest_type          VARCHAR(16),
  ADD COLUMN dest_hospital_code TEXT REFERENCES public.hospitals(hospital_code),
  ADD COLUMN dest_text          VARCHAR(200),
  ADD COLUMN ship_address       TEXT,
  ADD COLUMN recipient          VARCHAR(100);

ALTER TABLE public.stock_out_requests ADD CONSTRAINT stock_out_requests_kind_check CHECK (
  CASE WHEN purpose IN ('EVALUATION','SALES','OSAN_OFFICE')
    THEN project_code IS NULL AND sub_purpose IS NOT NULL AND dest_type IS NOT NULL
    ELSE project_code IS NOT NULL END
);
ALTER TABLE public.stock_out_requests ADD CONSTRAINT stock_out_requests_dest_check CHECK (
  dest_type IS NULL
  OR (dest_type = 'HOSPITAL' AND dest_hospital_code IS NOT NULL)
  OR (dest_type = 'OTHER' AND dest_text IS NOT NULL)
);
CREATE INDEX stock_out_requests_dest_hospital_idx ON public.stock_out_requests(dest_hospital_code);
