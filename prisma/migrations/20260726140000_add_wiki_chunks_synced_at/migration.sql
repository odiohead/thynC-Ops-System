-- 위키 청크 인덱스 동기화 시각 — 주기 갱신 스케줄러의 stale 판정 기준
--
-- 본문 저장 주체가 협업 서버(Y.Doc)라 REST 훅만으로는 청크 재생성이 누락된다.
-- "무슨 경로로 바뀌었든 updated_at이 앞서면 다시 만든다"로 구조를 바꾼다.
ALTER TABLE "wiki"."wiki_pages" ADD COLUMN IF NOT EXISTS "chunks_synced_at" TIMESTAMP(3);

-- 백필: 청크가 페이지보다 확실히 최신인 경우에만 '동기화됨'으로 표시한다.
-- (wiki_chunks.created_at은 timestamptz, wiki_pages.updated_at은 Prisma가 UTC로 쓰는 naive timestamp)
-- 판정이 애매한 페이지는 NULL로 남겨 스케줄러가 1회 재생성하게 한다.
UPDATE "wiki"."wiki_pages" p
   SET "chunks_synced_at" = p."updated_at"
 WHERE EXISTS (SELECT 1 FROM "wiki"."wiki_chunks" c WHERE c."page_id" = p."id")
   AND p."updated_at" <= timezone('UTC', (
         SELECT max(c2."created_at") FROM "wiki"."wiki_chunks" c2 WHERE c2."page_id" = p."id"
       ));
