-- 공사업체 비활성화 (2026-11-03) — 더 이상 이용하지 않는 업체는 삭제 대신 비활성: 이력(연결 프로젝트) 보존, 프로젝트 등록·수정 셀렉트에서 숨김
ALTER TABLE public.constructors ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
