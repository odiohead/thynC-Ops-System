-- VOC 대표 분류 수동 지정 플래그 (2026-11-05) — true면 채널톡 태그 변경 시 대표 분류(voc_type_id)를 자동 추종하지 않음(사람이 VOC 화면에서 직접 고른 건 보존)
ALTER TABLE public.voc_receipts ADD COLUMN voc_type_manual BOOLEAN NOT NULL DEFAULT false;
-- 수동 등록(MANUAL)·시트 적재(SHEET) VOC는 사람이 정한 분류 → 보존 표시
UPDATE public.voc_receipts SET voc_type_manual = true WHERE source <> 'CHANNELTALK' AND voc_type_id IS NOT NULL;
