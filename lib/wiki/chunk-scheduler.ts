/**
 * 위키 청크 인덱스 주기 갱신 스케줄러
 *
 * 위키 본문의 저장 주체는 Next 앱이 아니라 **협업 서버(Hocuspocus, Y.Doc)** 다.
 * 그래서 생성·수정 라우트에 `rebuildPageChunks` 훅을 달아도 정작 가장 흔한 경로인
 * "본문 편집"이 빠진다(WikiPageView는 본문 변경 시 PUT을 보내지 않는다).
 * 훅을 경로마다 다는 방식은 새 저장 경로가 생길 때마다 또 누락되므로,
 * **"무슨 경로로 바뀌었든 updated_at이 chunks_synced_at보다 앞서면 다시 만든다"** 로 뒤집는다.
 *
 * 청크는 검색 가속 인덱스이지 원본이 아니므로(lib/wiki/chunk.ts) 몇 분의 지연은 허용된다.
 * 협업 저장 훅(즉시 반영) 대신 주기 배치를 택한 이유이기도 하다 — 편집 중 디바운스 저장마다
 * DELETE+INSERT를 도는 부하를 피한다.
 *
 * 주기는 AppSetting `wiki_chunk_interval`로 제어하고 instrumentation.ts에서 기동한다
 * (notify-scheduler.ts와 동일 패턴). 설정이 없으면 기본 10분 — 별도 UI가 없어
 * 'off' 기본값이면 아무도 켜지 않아 기능이 죽은 채로 남기 때문.
 */

import { prisma } from '@/lib/prisma'
import { rebuildPageChunks } from '@/lib/wiki/chunk'

const INTERVAL_MAP: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '10m': 10 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
}

/** 한 주기에 재생성할 최대 페이지 수 — 대량 백로그가 한 틱을 오래 잡지 않도록 */
const MAX_PER_RUN = 50

let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = 'off'
let running = false

/** 청크가 본문보다 오래된(또는 아예 없는) 페이지 — 삭제·템플릿 제외 */
async function findStalePageIds(limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p."id"
      FROM "wiki"."wiki_pages" p
     WHERE p."deleted_at" IS NULL
       AND p."is_template" = false
       AND (p."chunks_synced_at" IS NULL OR p."chunks_synced_at" < p."updated_at")
     ORDER BY p."updated_at" DESC
     LIMIT ${limit}
  `
  return rows.map((r) => r.id)
}

export async function runWikiChunkSync(limit = MAX_PER_RUN): Promise<{ pages: number; chunks: number }> {
  const ids = await findStalePageIds(limit)
  let chunks = 0
  for (const id of ids) {
    // rebuildPageChunks는 자체적으로 예외를 삼키고 0을 반환한다(실패 시 동기화 시각 미표시 → 다음 주기 재시도)
    chunks += await rebuildPageChunks(id)
  }
  return { pages: ids.length, chunks }
}

async function run() {
  if (running) return // 앞 주기가 아직 도는 중이면 건너뛴다 (대량 백로그 시 중첩 방지)
  running = true
  try {
    const { pages, chunks } = await runWikiChunkSync()
    // 갱신할 게 없으면 조용히 지나간다 — 10분마다 로그를 남기지 않기 위해
    if (pages > 0) {
      console.log(`[wiki-chunk-scheduler] ${pages}개 페이지 재색인 → ${chunks}청크`)
    }
  } catch (err) {
    console.error('[wiki-chunk-scheduler] 청크 동기화 실패:', err)
  } finally {
    running = false
  }
}

export function startWikiChunkScheduler(interval: string) {
  stopWikiChunkScheduler()
  currentInterval = interval

  if (interval === 'off' || !INTERVAL_MAP[interval]) {
    console.log('[wiki-chunk-scheduler] 청크 주기 갱신 OFF')
    return
  }

  timer = setInterval(run, INTERVAL_MAP[interval])
  console.log(`[wiki-chunk-scheduler] 청크 주기 갱신 시작: ${interval} 간격`)
}

export function stopWikiChunkScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getWikiChunkInterval() {
  return currentInterval
}
