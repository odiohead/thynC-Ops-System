-- RBAC Lite (projects/rbac_design.md §4) — 역할·권한·멤버십 3테이블
-- 역할은 가산 전용(additive-only): 기존 등급(User.role)·풀 체계 위에 얹는다

-- 역할 정의
CREATE TABLE "app_roles" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "app_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_roles_code_key" ON "app_roles"("code");

-- 역할 ↔ 권한 키 (키 자체는 lib/permissions.ts 카탈로그가 단일 소스)
CREATE TABLE "app_role_permissions" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "perm_key" VARCHAR(100) NOT NULL,
    CONSTRAINT "app_role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_role_permissions_role_id_perm_key_key" ON "app_role_permissions"("role_id", "perm_key");

ALTER TABLE "app_role_permissions" ADD CONSTRAINT "app_role_permissions_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "app_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 사용자 ↔ 역할
CREATE TABLE "app_user_roles" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_user_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_user_roles_user_id_role_id_key" ON "app_user_roles"("user_id", "role_id");

ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "app_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
