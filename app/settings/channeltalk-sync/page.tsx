'use client'

/**
 * 채널톡 상담 원천 적재 설정 (voc_channeltalk_intake_design.md §5.1) — mail-sync 설정 패턴
 * 주기 저장 · 지금 실행(incremental) · 백필 시작/이어서 · 백필 커서 초기화 · 최근 실행 로그 · DB 현황
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CHANNELTALK_VOC_INTERVALS, type BackfillState } from '@/lib/channeltalk/shared'

const INTERVAL_LABEL: Record<string, string> = { off: 'OFF', '1m': '1분', '5m': '5분', '10m': '10분' }

interface Run {
  id: number; mode: string; startedAt: string; endedAt: string | null
  scannedChats: number; upsertedChats: number; fetchedMessages: number; apiCalls: number; rateLimited: number
  error: string | null; stats: { newChats?: number; budgetExceeded?: boolean; backfillDone?: boolean | null } | null
}
interface Data {
  interval: string; activeInterval: string; maxCalls: number; configured: boolean; running: boolean
  backfill: BackfillState; runs: Run[]
  stats: { chats: Record<string, number>; messages: number; users: number; lastSyncedAt: string | null }
}

const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')

export default function ChanneltalkSyncSettingsPage() {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [interval, setIntervalValue] = useState('off')
  const [maxCalls, setMaxCalls] = useState(200)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/channeltalk-sync')
    if (!res.ok) return
    const d: Data = await res.json()
    setData(d); setIntervalValue(d.interval); setMaxCalls(d.maxCalls)
  }, [])

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((me) => {
      const admin = me?.role === 'SUPER_ADMIN' || me?.role === 'ADMIN'
      setAuthChecked(true)
      if (!admin) router.push('/'); else void load()
    })
  }, [router, load])

  const flash = (ok: boolean, text: string) => { setMessage({ ok, text }); setTimeout(() => setMessage(null), 5000) }

  async function save() {
    setBusy('save')
    try {
      const res = await fetch('/api/settings/channeltalk-sync', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval, maxCalls }) })
      const d = await res.json()
      flash(res.ok, res.ok ? d.message : d.error)
      router.refresh(); await load()
    } finally { setBusy(null) }
  }
  async function run(mode: 'incremental' | 'backfill') {
    setBusy(mode)
    try {
      const res = await fetch('/api/settings/channeltalk-sync/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
      const d = await res.json()
      if (!res.ok) flash(false, d.error ?? '실패')
      else flash(true, `${mode === 'backfill' ? '백필' : '동기화'} 완료 — 스캔 ${d.scannedChats} · 갱신 ${d.upsertedChats}(신규 ${d.newChats}) · 메시지 ${d.fetchedMessages} · 호출 ${d.apiCalls}${d.budgetExceeded ? ' · 호출 상한 도달(이어서 실행 필요)' : ''}${d.backfillDone ? ' · 백필 완료' : ''}`)
      router.refresh(); await load()
    } finally { setBusy(null) }
  }
  async function resetBackfill() {
    if (!confirm('백필 커서를 초기화합니다. 적재된 데이터는 삭제되지 않으며 다음 백필이 처음부터 다시 훑습니다. 진행할까요?')) return
    setBusy('reset')
    try {
      const res = await fetch('/api/settings/channeltalk-sync/backfill-reset', { method: 'POST' })
      const d = await res.json()
      flash(res.ok, res.ok ? '백필 커서를 초기화했습니다' : d.error)
      router.refresh(); await load()
    } finally { setBusy(null) }
  }

  if (!authChecked || !data) return null
  const bf = data.backfill
  const bfLabel = bf.done ? `완료 (${bf.processed.toLocaleString()}건, ${kst(bf.finishedAt)})` : bf.startedAt ? `진행 중 — ${bf.processed.toLocaleString()}건 처리, 시작 ${kst(bf.startedAt)}` : '시작 전'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">채널톡 상담 적재 설정</h1>
          <Link href="/voc/inbox" className="text-sm text-blue-600 hover:underline">채널톡 상담 보기 →</Link>
        </div>

        {!data.configured && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            API 키가 설정되지 않았습니다. 서버 <code>.env</code>에 <code>CHANNELTALK_ACCESS_KEY</code> / <code>CHANNELTALK_ACCESS_SECRET</code>를 넣고 재시작하세요.
          </div>
        )}

        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-500">현재 상태</span>
            {data.activeInterval === 'off'
              ? <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">OFF</span>
              : <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">{INTERVAL_LABEL[data.activeInterval]} 간격으로 실행 중</span>}
            {data.running && <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">동기화 진행 중</span>}
            <span className="text-gray-500">마지막 적재 {kst(data.stats.lastSyncedAt)}</span>
          </div>
          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">폴링 주기</label>
            <div className="flex flex-wrap gap-2">
              {CHANNELTALK_VOC_INTERVALS.map((v) => (
                <button key={v} type="button" onClick={() => setIntervalValue(v)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${interval === v ? (v === 'off' ? 'bg-gray-800 text-white' : 'bg-blue-600 text-white') : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                  {INTERVAL_LABEL[v]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-400">설정한 주기마다 채널톡 Open API에서 활성 상담 전량과 최근 종료 상담을 가져옵니다. 백필이 진행 중이면 틱마다 이어서 진행합니다.</p>
          </div>
          <div className="mb-5 flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">틱당 API 호출 상한</label>
            <input type="number" min={10} max={5000} value={maxCalls} onChange={(e) => setMaxCalls(Number(e.target.value))} className="w-24 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
            <span className="text-xs text-gray-400">채널톡 레이트리밋 1,000회/윈도. 기본 200</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={!!busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy === 'save' ? '저장 중...' : '저장'}</button>
            <button type="button" onClick={() => run('incremental')} disabled={!!busy || !data.configured} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy === 'incremental' ? '실행 중...' : '지금 실행'}</button>
            <button type="button" onClick={() => run('backfill')} disabled={!!busy || !data.configured || bf.done} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy === 'backfill' ? '백필 중...' : bf.startedAt ? '백필 이어서' : '백필 시작'}</button>
            <button type="button" onClick={resetBackfill} disabled={!!busy} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-red-600 disabled:opacity-50">백필 초기화</button>
            {message && <span className={`text-sm ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</span>}
          </div>
          <p className="mt-3 text-xs text-gray-500">백필: {bfLabel}. 백필은 종료 상담을 오래된 순으로 전량 훑으며, 호출 상한에 닿으면 커서를 저장하고 멈춥니다(주기가 켜져 있으면 자동으로 이어감).</p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['활성 상담', ((data.stats.chats.opened ?? 0) + (data.stats.chats.snoozed ?? 0)).toLocaleString()],
            ['종료 상담', (data.stats.chats.closed ?? 0).toLocaleString()],
            ['메시지', data.stats.messages.toLocaleString()],
            ['고객', data.stats.users.toLocaleString()],
          ].map(([l, v]) => (
            <div key={l} className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm"><p className="text-xs text-gray-500">{l}</p><p className="text-lg font-semibold text-gray-900">{v}</p></div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">최근 실행 (10건)</div>
          {data.runs.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">실행 기록이 없습니다.</p> : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50"><tr>{['시작', '모드', '스캔', '갱신', '신규', '메시지', '호출', '429', '결과'].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">{kst(r.startedAt)}</td>
                    <td className="px-3 py-1.5">{r.mode}</td>
                    <td className="px-3 py-1.5">{r.scannedChats}</td><td className="px-3 py-1.5">{r.upsertedChats}</td><td className="px-3 py-1.5">{r.stats?.newChats ?? '-'}</td>
                    <td className="px-3 py-1.5">{r.fetchedMessages}</td><td className="px-3 py-1.5">{r.apiCalls}</td><td className="px-3 py-1.5">{r.rateLimited}</td>
                    <td className="px-3 py-1.5">{r.error ? <span className="text-red-600" title={r.error}>실패</span> : !r.endedAt ? <span className="text-blue-600">진행 중</span> : r.stats?.budgetExceeded ? <span className="text-amber-600">상한 이월</span> : <span className="text-green-600">완료</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
