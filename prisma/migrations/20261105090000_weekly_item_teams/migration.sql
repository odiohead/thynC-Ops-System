-- 주간업무 항목 담당 팀 다중 선택 (2026-11-05, 사용자 요청) — 항목 × 부서 N:M. owner_team_id는 첫 팀으로 동기 유지(호환·정렬용)
CREATE TABLE public.weekly_item_teams (
  item_id  INTEGER NOT NULL REFERENCES public.weekly_items(id) ON DELETE CASCADE,
  team_id  INTEGER NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, team_id)
);
CREATE INDEX weekly_item_teams_team_idx ON public.weekly_item_teams(team_id);
-- 기존 단일 담당 팀 백필
INSERT INTO public.weekly_item_teams (item_id, team_id, sort_order)
SELECT id, owner_team_id, 0 FROM public.weekly_items WHERE owner_team_id IS NOT NULL
ON CONFLICT DO NOTHING;
