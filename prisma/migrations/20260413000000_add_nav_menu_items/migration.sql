-- CreateTable
CREATE TABLE IF NOT EXISTS "nav_menu_items" (
  "id" SERIAL PRIMARY KEY,
  "menu_key" VARCHAR(100) NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "href" VARCHAR(200) NOT NULL,
  "icon_key" VARCHAR(50),
  "parent_key" VARCHAR(100),
  "allowed_roles" TEXT[] NOT NULL DEFAULT '{}',
  "allowed_org_codes" TEXT[] NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "nav_menu_items_menu_key_key" ON "nav_menu_items"("menu_key");
CREATE INDEX "nav_menu_items_parent_key_idx" ON "nav_menu_items"("parent_key");
CREATE INDEX "nav_menu_items_sort_order_idx" ON "nav_menu_items"("sort_order");

-- Seed: 기존 하드코딩 메뉴 항목 이관
INSERT INTO "nav_menu_items" ("menu_key", "label", "href", "icon_key", "parent_key", "allowed_roles", "allowed_org_codes", "is_active", "sort_order") VALUES
-- 메인 메뉴
('hira-hospitals',    '심평원 병원목록',         '/hira-hospitals',   'hira',       NULL,       '{"SUPER_ADMIN","ADMIN"}',              '{}', true,  10),
('hospitals',         '병원 목록',               '/hospitals',        'hospital',   NULL,       '{}',                                   '{}', true,  20),
('projects',          '프로젝트 관리',            '/projects',         'project',    NULL,       '{}',                                   '{}', true,  30),
('install-plans',     '설치계획(가안) 관리',       '/install-plans',    'file-text',  NULL,       '{}',                                   '{}', true,  40),
('site-visits',       '답사 관리',               '/site-visits',      'site-visit', NULL,       '{}',                                   '{}', true,  50),
('ai-assistant',      'AI 어시스턴트',            '/ai-assistant',     'bot',        NULL,       '{}',                                   '{}', true,  60),
('settings',          '설정',                    '/settings',         'settings',   NULL,       '{}',                                   '{}', true,  70),
('users',             '계정 관리',               '/users',            'users',      NULL,       '{}',                                   '{}', true,  80),
-- 설정 하위 메뉴
('settings/nav-menus',         '메뉴 관리',             '/settings/nav-menus',         NULL,    'settings', '{"SUPER_ADMIN"}',                       '{}', true,   5),
('settings/organizations',     '소속 관리',             '/settings/organizations',     NULL,    'settings', '{"SUPER_ADMIN"}',                       '{}', true,  10),
('settings/field-engineers',   '필드 엔지니어 리스트',    '/settings/field-engineers',    'users', 'settings', '{"SUPER_ADMIN","ADMIN"}',               '{}', true,  20),
('settings/hira-sync',         '심평원 연동 관리',       '/settings/hira-sync',          NULL,    'settings', '{"SUPER_ADMIN"}',                       '{}', true,  30),
('settings/mail-sync',         '메일 동기화',            '/settings/mail-sync',          NULL,    'settings', '{"SUPER_ADMIN","ADMIN"}',               '{}', true,  40),
('settings/profile',           '내 프로필',              '/settings/profile',            NULL,    'settings', '{}',                                    '{}', true,  50),
('settings/status',            '병원 상태코드 관리',      '/settings/status',             NULL,    'settings', '{"SUPER_ADMIN","ADMIN","USER"}',        '{}', true,  60),
('settings/consultation-type', '상담유형 관리',          '/settings/consultation-type',  NULL,    'settings', '{"SUPER_ADMIN","ADMIN","USER"}',        '{}', true,  70),
('settings/document-type',     '문서유형 관리',          '/settings/document-type',      NULL,    'settings', '{"SUPER_ADMIN","ADMIN","USER"}',        '{}', true,  80),
('settings/build-status',      '구축상태 관리',          '/settings/build-status',       NULL,    'settings', '{"SUPER_ADMIN","ADMIN","USER"}',        '{}', true,  90),
('settings/devices',           '기기 관리',              '/settings/devices',            NULL,    'settings', '{"SUPER_ADMIN","ADMIN","USER"}',        '{}', true, 100),
('settings/constructors',      '공사업체 관리',          '/settings/constructors',       NULL,    'settings', '{"SUPER_ADMIN","ADMIN","USER"}',        '{}', true, 110),
('settings/intro-type',        '도입형태 관리',          '/settings/intro-type',         NULL,    'settings', '{"SUPER_ADMIN","ADMIN","USER"}',        '{}', true, 120),
('settings/site-visit-status', '답사 상태 관리',         '/settings/site-visit-status',  NULL,    'settings', '{"SUPER_ADMIN","ADMIN"}',               '{}', true, 130)
ON CONFLICT ("menu_key") DO NOTHING;
