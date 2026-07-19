-- 유지보수 처리 기록 타임라인 (C안) — 구 비고(notes) 대체, 원인(cause)은 조치 요약(resolution)에 병합
-- cause·notes 컬럼은 백업용 보존 (deprecated — 앱에서 더 이상 read/write 하지 않음)

-- 1) 처리 기록 테이블
CREATE TABLE public.maintenance_logs (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER NOT NULL REFERENCES public.maintenances(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX maintenance_logs_maintenance_id_created_at_idx
  ON public.maintenance_logs(maintenance_id, created_at DESC);

-- 2) 기존 비고(notes) → 처리 기록 1건 이관 (작성자 미상 NULL, 시각=해당 건 updated_at) — 멱등
INSERT INTO public.maintenance_logs (maintenance_id, author_id, content, created_at, updated_at)
SELECT m.id, NULL, m.notes, m.updated_at, m.updated_at
FROM public.maintenances m
WHERE m.notes IS NOT NULL
  AND btrim(regexp_replace(m.notes, '<[^>]*>|&nbsp;', '', 'g')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.maintenance_logs l
    WHERE l.maintenance_id = m.id AND l.content = m.notes
  );

-- 3) 원인(cause, 평문) → 조치 요약(resolution, HTML) 상단에 병합 — HTML 이스케이프, 멱등 가드
UPDATE public.maintenances
SET resolution = '<p><strong>원인: </strong>'
  || replace(replace(replace(replace(replace(cause, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\r', ''), E'\n', '<br>')
  || '</p>' || coalesce(resolution, '')
WHERE cause IS NOT NULL
  AND btrim(cause) <> ''
  AND (resolution IS NULL OR resolution NOT LIKE '<p><strong>원인: </strong>%');
