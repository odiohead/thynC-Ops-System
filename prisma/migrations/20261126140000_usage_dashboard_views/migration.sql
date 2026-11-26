-- 사용량 대시보드 — 저장된 보기 (2026-11-26, projects/usage_dashboard_filter_design.md §4.3)
-- 조건 묶음(기기 · 판매모델 · 종별 · 병원 지정 · 추이 기간)에 이름을 붙여 저장한다. is_shared 가 켜진 보기는 사용량을 볼 수 있는 모두의 목록에 나온다.
CREATE TABLE "usage_dashboard_views" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "owner_id" TEXT NOT NULL,
  "is_shared" BOOLEAN NOT NULL DEFAULT false,
  "filters" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_dashboard_views_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "usage_dashboard_views_owner_id_name_key" ON "usage_dashboard_views"("owner_id", "name");
CREATE INDEX "usage_dashboard_views_is_shared_idx" ON "usage_dashboard_views"("is_shared");
ALTER TABLE "usage_dashboard_views" ADD CONSTRAINT "usage_dashboard_views_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
