-- Schema drift 정합화
--
-- 1) daewoong_staff: 과거 site_visits FK 마이그레이션이 참조했으나 CREATE TABLE이 어떤
--    마이그레이션에도 존재하지 않는 잔재 테이블. 현재 행 0건, 코드 참조 없음. 제거하여
--    schema.prisma(미정의)와 DB를 일치시킴.
DROP TABLE IF EXISTS "daewoong_staff";

-- 2) install_plans.created_at / updated_at: 최초 생성 마이그레이션에서 NOT NULL 누락.
--    schema.prisma는 required(DateTime)로 정의되어 있어 클라이언트 가정과 DB 제약을
--    일치시킴. 기본값 NOW()는 유지.
ALTER TABLE "install_plans"
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL;
