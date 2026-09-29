-- 병원 태그 마스터 시드 (2026-09-28, idempotent) — 초기 3종. 마스터는 엄격 정의(사용자 결정), 사용자는 체크만
-- PROD 최초 반영·데이터 동기화 후 재실행 가능. 이름·설명·색은 갱신, 키·시스템 여부는 유지
INSERT INTO hospital_tags (key, name, description, effect_note, color, is_system, sort_order) VALUES
  ('PRE_REPLACE_DEFAULT', '선교체 기본', 'AS 접수 시 기본적으로 선교체로 처리하는 병원', 'AS접수 등록 시 선교체 태그 자동 체크 (연동 예정)', '#F59E0B', true, 10),
  ('NO_REMOTE_ACCESS',    '원격접속불가', '보안 정책 등으로 원격 접속·원격 지원이 불가한 병원', '유지보수·VOC·상담 화면에 경고 표시 (연동 예정)', '#EF4444', true, 20),
  ('KEY_ACCOUNT',         '주요병원', '영업·운영상 우선 대응이 필요한 주요 고객사', NULL, '#3B82F6', true, 30)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, effect_note = EXCLUDED.effect_note, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order, updated_at = now();

SELECT key, name, is_system FROM hospital_tags ORDER BY sort_order;
