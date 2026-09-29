-- 채널톡 상담 first_user_message_at · manager_initiated 백필 (2026-09-28 마이그 20260928190000 이전 적재분)
-- lib/channeltalk/vocSync.ts syncMessages와 동일 규칙: 고객(user) 첫 텍스트 메시지 시각 / 첫 메시지가 manager면 담당자 발신. idempotent
UPDATE channeltalk_user_chats c SET first_user_message_at = f.at
FROM (SELECT chat_id, min(created_at_ct) AS at FROM channeltalk_messages WHERE person_type = 'user' AND plain_text IS NOT NULL GROUP BY chat_id) f
WHERE f.chat_id = c.id AND c.first_user_message_at IS DISTINCT FROM f.at;

UPDATE channeltalk_user_chats c SET manager_initiated = (m.person_type = 'manager')
FROM (SELECT DISTINCT ON (chat_id) chat_id, person_type FROM channeltalk_messages ORDER BY chat_id, created_at_ct ASC, id ASC) m
WHERE m.chat_id = c.id AND c.manager_initiated IS DISTINCT FROM (m.person_type = 'manager');

SELECT count(*) FILTER (WHERE first_user_message_at IS NOT NULL) AS with_first_ask,
       count(*) FILTER (WHERE manager_initiated) AS manager_initiated, count(*) AS chats
FROM channeltalk_user_chats;
