/**
 * 채널톡 상담 원천 적재 폴링 스케줄러 (channeltalk-as-scheduler 패턴 — projects/voc_channeltalk_intake_design.md §4.1)
 * 주기는 AppSetting channeltalk_voc_interval (off/1m/5m/10m, 기본 off). 재진입 가드 포함.
 * 백필이 미완료(AppSetting channeltalk_voc_backfill.done=false)이고 시작된 상태면 틱마다 backfill 모드로 이어가고, 완료되면 incremental.
 */
import { runChanneltalkVocSync, getChanneltalkBackfillState, isChanneltalkVocSyncRunning } from '@/lib/channeltalk/vocSync'
import { ChanneltalkClient } from '@/lib/channeltalk/client'

const INTERVAL_MAP: Record<string, number> = { '1m': 60_000, '5m': 300_000, '10m': 600_000 }

let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = 'off'

async function tick() {
  if (isChanneltalkVocSyncRunning()) { console.warn('[channeltalk-voc] 이전 틱 진행 중 — 스킵'); return }
  if (!ChanneltalkClient.isConfigured()) { console.warn('[channeltalk-voc] API 키 미설정 — 스킵'); return }
  try {
    const bf = await getChanneltalkBackfillState()
    const mode = bf.startedAt && !bf.done ? 'backfill' : 'incremental'
    const r = await runChanneltalkVocSync(mode)
    if (r.upsertedChats || r.fetchedMessages || r.error || r.budgetExceeded) {
      console.log(`[channeltalk-voc] 틱 완료 (mode=${r.mode}, scanned=${r.scannedChats}, upserted=${r.upsertedChats}, new=${r.newChats}, messages=${r.fetchedMessages}, calls=${r.apiCalls}, rateLimited=${r.rateLimited}${r.budgetExceeded ? ', budgetExceeded' : ''}${r.error ? `, error=${r.error}` : ''})`)
    }
  } catch (err) {
    console.error('[channeltalk-voc] 틱 실패:', err)
  }
}

export function startChanneltalkVocScheduler(interval: string) {
  stopChanneltalkVocScheduler()
  currentInterval = interval
  if (interval === 'off' || !INTERVAL_MAP[interval]) { console.log('[channeltalk-voc] 스케줄러 OFF'); return }
  timer = setInterval(tick, INTERVAL_MAP[interval])
  console.log(`[channeltalk-voc] 스케줄러 시작: ${interval} 간격`)
}

export function stopChanneltalkVocScheduler() {
  if (timer) { clearInterval(timer); timer = null }
}

export function getChanneltalkVocInterval() { return currentInterval }
