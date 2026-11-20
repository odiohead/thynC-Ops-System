'use client'

/**
 * 사용량 — 에이전트 관리 (projects/usage_agent_enroll_design.md)
 * 위에서 아래로: 제목·[병원 등록] → 요약 한 줄(운영 중인 병원 중 수집 중) → 설치 명령 → 병원 표(서버별 수집 상태)
 * 병원을 등록하고 서버 대수를 적으면 그만큼 설치 자리가 열리고, 병원 서버에서 설치 명령을 실행해 병원코드를 넣으면 등록된다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Copy, Plus } from 'lucide-react'
import PageHeader from '@/app/components/ui/PageHeader'
import Badge from '@/app/components/ui/Badge'
import Modal from '@/app/components/ui/Modal'
import { Card } from '@/app/components/ui/Card'
import type { AgentHospital, AgentHospitalState, AgentOverview, AgentServer } from '@/lib/usage/agents'

type Filter = 'all' | AgentHospitalState
const STATE: Record<AgentHospitalState, { label: string; variant: 'success' | 'warning' | 'destructive' | 'default'; title: string }> = {
  collecting: { label: '수집 중', variant: 'success', title: '등록한 서버가 모두 수집 중입니다' },
  partial: { label: '일부 수집', variant: 'warning', title: '등록한 서버 대수보다 수집 중인 서버가 적습니다' },
  stopped: { label: '수신 끊김', variant: 'destructive', title: '받은 적이 있는데 지금 수집 중인 서버가 없습니다' },
  waiting: { label: '설치 대기', variant: 'default', title: '설치한 서버가 없거나, 등록만 하고 아직 한 번도 받지 못했습니다' },
}
const INSTALL_PATH = '/api/usage-ingest/agent/install.sh'

const stamp = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16) : '—')

type SearchHospital = { hospitalCode: string; hospitalName: string; status: string }

export default function AgentsClient({ canManage }: { canManage: boolean }) {
  const router = useRouter()
  const [data, setData] = useState<AgentOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [editing, setEditing] = useState<AgentHospital | null>(null)
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => setOrigin(window.location.origin), [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/usage/agents', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? '에이전트 현황을 불러오지 못했습니다.')
        setData(null)
      } else {
        setError(null)
        setData(body as AgentOverview)
      }
    } catch {
      setError('에이전트 현황을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  /** 바꾸는 요청 공통 — 성공하면 목록을 다시 읽는다 */
  const mutate = useCallback(
    async (url: string, method: string, body: unknown, done: string): Promise<boolean> => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
        const out = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(out.error ?? '요청을 처리하지 못했습니다.')
          return false
        }
        setError(null)
        setNotice(done)
        router.refresh()
        await load()
        return true
      } catch {
        setError('요청을 처리하지 못했습니다.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [load, router],
  )

  const serverAction = (h: AgentHospital, s: AgentServer, action: 'block' | 'unblock' | 'allow_reenroll' | 'cancel_reenroll') => {
    const ask: Record<typeof action, string> = {
      block: `${h.hospitalName}의 서버 '${s.serverId}'를 차단할까요?\n이 서버에서 보내는 기록을 더 받지 않고, 서버 자리 하나가 다시 열립니다. 받은 기록은 지우지 않습니다.`,
      unblock: `서버 '${s.serverId}'의 차단을 풀까요?`,
      allow_reenroll: `서버 '${s.serverId}'의 재등록을 허용할까요?\n이 서버에서 설치 스크립트를 다시 실행하면 같은 이름으로 키를 새로 받습니다(이전 키는 못 쓰게 됩니다). 서버를 새로 설치했을 때 씁니다.`,
      cancel_reenroll: `서버 '${s.serverId}'의 재등록 허용을 취소할까요?`,
    }
    if (!window.confirm(ask[action])) return
    const done: Record<typeof action, string> = { block: '차단했습니다.', unblock: '차단을 풀었습니다.', allow_reenroll: '재등록을 허용했습니다.', cancel_reenroll: '재등록 허용을 취소했습니다.' }
    void mutate(`/api/usage/agents/servers/${s.id}`, 'POST', { action }, `${s.serverId} — ${done[action]}`)
  }

  const removeHospital = (h: AgentHospital) => {
    if (!window.confirm(`${h.hospitalName}의 수집 등록을 해제할까요?\n설치한 서버가 없는 병원만 해제할 수 있습니다.`)) return
    void mutate(`/api/usage/agents/${h.hospitalCode}`, 'DELETE', undefined, `${h.hospitalName} — 등록을 해제했습니다.`)
  }

  const hospitals = useMemo(() => data?.hospitals ?? [], [data])
  const visible = useMemo(() => (filter === 'all' ? hospitals : hospitals.filter((h) => h.state === filter)), [hospitals, filter])
  const s = data?.summary
  const command = `wget -qO install.sh ${origin || 'https://<운영관리시스템 주소>'}${INSTALL_PATH} && sudo bash install.sh`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 복사가 막힌 환경 — 명령은 화면에 그대로 보인다
    }
  }
  const FILTERS: { key: Filter; label: string; count: number | undefined }[] = [
    { key: 'all', label: '전체', count: s?.registered },
    { key: 'partial', label: '일부 수집', count: s?.partial },
    { key: 'stopped', label: '수신 끊김', count: s?.stopped },
    { key: 'waiting', label: '설치 대기', count: s?.waiting },
    { key: 'collecting', label: '수집 중', count: s?.collecting },
  ]

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <PageHeader
        title="에이전트 관리"
        description="사용량을 수집할 병원을 등록하고, 병원 서버의 수집 Agent 설치와 수신 상태를 봅니다."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link href="/usage" className="flex h-9 items-center gap-1 rounded-md border border-border bg-card pl-2 pr-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <ChevronLeft size={15} aria-hidden />
              사용량
            </Link>
            {canManage && (
              <button type="button" data-testid="agent-register" onClick={() => setRegisterOpen(true)} className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                <Plus size={15} aria-hidden />
                병원 등록
              </button>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-5">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" data-testid="agent-error">
            {error}
          </div>
        )}
        {notice && !error && <div className="rounded-lg border border-border bg-muted px-4 py-2.5 text-sm text-foreground">{notice}</div>}

        {/* 요약 한 줄 */}
        <Card className="flex flex-wrap" data-testid="agent-summary">
          <div className="flex min-w-[320px] flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-1 px-5 py-3.5">
            <span className="text-[13px] text-muted-foreground">운영 중인 병원</span>
            <span className="text-xl font-bold tabular-nums">{s ? s.operating.toLocaleString() : '—'}</span>
            <span className="text-[13px] text-muted-foreground">곳 중 수집 중</span>
            <span className="text-xl font-bold tabular-nums">{s ? s.operatingCollecting.toLocaleString() : '—'}</span>
            <span className="text-[13px] text-muted-foreground">곳</span>
            {s && s.operating > 0 && <span className="text-xs text-muted-foreground tabular-nums">({Math.round((s.operatingCollecting / s.operating) * 100)}%)</span>}
            {s && s.otherCollecting > 0 && (
              <span className="text-xs text-muted-foreground" title="병원 상태가 '운영'이 아닌데 수집 중인 병원">
                · 운영 상태가 아닌 병원 {s.otherCollecting}곳도 수집 중
              </span>
            )}
          </div>
          <div className="flex min-w-[320px] flex-1 flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border px-5 py-3.5 text-[13px] md:border-l md:border-t-0">
            <Count label="등록" value={s?.registered} />
            <Count label="일부 수집" value={s?.partial} tone="warn" />
            <Count label="수신 끊김" value={s?.stopped} tone="bad" />
            <Count label="설치 대기" value={s?.waiting} />
          </div>
        </Card>

        {/* 설치 명령 */}
        <Card className="flex flex-col gap-2 px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-sm font-semibold">병원 서버에서 실행하는 설치 명령</h2>
            <span className="text-xs text-muted-foreground" data-testid="agent-package">
              {data ? (data.package ? `설치 묶음 ${data.package.version}` : '설치 묶음이 수신 서버에 없습니다 — 배포 때 복사해야 합니다') : ''}
            </span>
          </div>
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-[12.5px] text-foreground" data-testid="agent-command">
              {command}
            </code>
            <button type="button" onClick={copy} className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Copy size={14} aria-hidden />
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            실행하면 병원코드와 서버 이름(기본값 = 호스트명)만 묻습니다. 아래에 등록된 병원이고 서버 자리가 남아 있어야 설치가 끝납니다. 서버가 여러 대인 병원은 서버마다 같은 병원코드로 설치합니다.
          </p>
        </Card>

        {/* 병원 표 */}
        <Card>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-3.5" role="group" aria-label="상태 필터">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                data-testid={`agent-filter-${f.key}`}
                onClick={() => setFilter(f.key)}
                className={`h-7 rounded-full border px-3 text-xs font-medium tabular-nums transition-colors ${
                  filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {f.label} {f.count ?? ''}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="agent-table">
              <thead className="bg-muted">
                <tr className="text-left text-xs font-medium text-muted-foreground">
                  <th scope="col" className="whitespace-nowrap px-5 py-2.5">병원</th>
                  <th scope="col" className="whitespace-nowrap px-3.5 py-2.5" title={`수집 중인 서버 / 등록한 서버 대수 — 수집 중 = 최근 ${data?.collectingHours ?? 24}시간 안에 수신 성공`}>
                    서버 (수집 / 대수)
                  </th>
                  <th scope="col" className="px-3.5 py-2.5">서버별 상태</th>
                  {canManage && <th scope="col" className="whitespace-nowrap px-5 py-2.5 text-right">관리</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 4 : 3} className="px-5 py-10 text-center text-sm text-muted-foreground">
                      {loading ? '불러오는 중...' : hospitals.length === 0 ? '등록한 병원이 없습니다. [병원 등록]으로 수집할 병원을 추가하세요.' : '해당하는 병원이 없습니다.'}
                    </td>
                  </tr>
                )}
                {visible.map((h) => (
                  <tr key={h.hospitalCode} data-testid={`agent-row-${h.hospitalCode}`} className="align-top">
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={`/usage?hospital=${h.hospitalCode}`} className="font-medium text-foreground hover:underline">
                          {h.hospitalName}
                        </Link>
                        <Badge variant={STATE[h.state].variant} title={STATE[h.state].title}>
                          {STATE[h.state].label}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {h.hospitalCode}
                        {h.hospitalStatus && h.hospitalStatus !== '운영' ? ` · 병원 상태 ${h.hospitalStatus}` : ''}
                        {h.hospitalStatus === null ? ' · 병원 목록에 없는 코드' : ''}
                      </div>
                      {h.note && <div className="mt-1 text-xs text-muted-foreground">{h.note}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-3 tabular-nums">
                      <span className={`text-base font-bold ${h.state === 'partial' ? 'text-warning-subtle-foreground' : h.state === 'stopped' ? 'text-destructive' : ''}`}>{h.collectingServers}</span>
                      <span className="text-muted-foreground"> / {h.expectedServers ?? '—'}</span>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {h.expectedServers === null
                          ? '등록 안 됨 (병원 토큰)'
                          : h.registeredServers < h.expectedServers
                            ? `설치 ${h.registeredServers}대 · 남은 자리 ${h.expectedServers - h.registeredServers}`
                            : h.registeredServers > h.expectedServers
                              ? `설치 ${h.registeredServers}대 (대수 초과)`
                              : `설치 ${h.registeredServers}대`}
                      </div>
                    </td>
                    <td className="px-3.5 py-3">
                      {h.servers.length === 0 ? (
                        <span className="text-[13px] text-muted-foreground">설치한 서버가 없습니다</span>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {h.servers.map((sv) => (
                            <li key={sv.id} data-testid={`agent-server-${sv.id}`} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
                              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${sv.blocked ? 'bg-gray-400' : sv.collecting ? 'bg-success' : 'bg-destructive'}`} />
                              <span className={`font-medium ${sv.blocked ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{sv.serverId}</span>
                              <span className="text-muted-foreground tabular-nums" title="마지막 수신 성공">
                                {sv.lastSuccessAt ? `수신 ${stamp(sv.lastSuccessAt)}` : '수신 기록 없음'}
                              </span>
                              {sv.agentVersion && <span className="text-xs text-muted-foreground tabular-nums">v{sv.agentVersion}</span>}
                              {sv.blocked && <Badge variant="default">차단</Badge>}
                              {!sv.blocked && !sv.collecting && sv.lastSuccessAt && <Badge variant="destructive">수신 끊김</Badge>}
                              {!sv.blocked && !sv.lastSuccessAt && <Badge variant="warning">첫 수신 전</Badge>}
                              {sv.reenrollAllowed && <Badge variant="warning">재등록 대기</Badge>}
                              {sv.auth === 'token' && (
                                <Badge variant="outline" title="등록 전에 사람이 발급한 병원 토큰으로 접속하는 서버">
                                  병원 토큰
                                </Badge>
                              )}
                              {sv.lastRun?.status === 'failed' && (
                                <span className="text-xs text-destructive" title={sv.lastRun.error ?? undefined}>
                                  마지막 실행 실패
                                </span>
                              )}
                              {canManage && (
                                <span className="ml-auto flex gap-2.5 text-xs">
                                  {sv.blocked ? (
                                    <button type="button" disabled={busy} onClick={() => serverAction(h, sv, 'unblock')} className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50">
                                      차단 해제
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => serverAction(h, sv, sv.reenrollAllowed ? 'cancel_reenroll' : 'allow_reenroll')}
                                        className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                                      >
                                        {sv.reenrollAllowed ? '재등록 허용 취소' : '재등록 허용'}
                                      </button>
                                      <button type="button" disabled={busy} onClick={() => serverAction(h, sv, 'block')} className="text-muted-foreground hover:text-destructive hover:underline disabled:opacity-50">
                                        차단
                                      </button>
                                    </>
                                  )}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap px-5 py-3 text-right text-xs">
                        <button type="button" disabled={busy} data-testid={`agent-edit-${h.hospitalCode}`} onClick={() => setEditing(h)} className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50">
                          {h.expectedServers === null ? '등록' : '대수 수정'}
                        </button>
                        {h.servers.length === 0 && h.expectedServers !== null && (
                          <button type="button" disabled={busy} onClick={() => removeHospital(h)} className="ml-3 text-muted-foreground hover:text-destructive hover:underline disabled:opacity-50">
                            등록 해제
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {registerOpen && (
        <RegisterModal
          busy={busy}
          onClose={() => setRegisterOpen(false)}
          onSubmit={async (h, expected, note) => {
            if (await mutate('/api/usage/agents', 'POST', { hospitalCode: h.hospitalCode, expectedServers: expected, note }, `${h.hospitalName} — 등록했습니다. 병원 서버에서 설치 명령을 실행하세요.`)) setRegisterOpen(false)
          }}
        />
      )}
      {editing && (
        <EditModal
          hospital={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSubmit={async (expected, note) => {
            if (await mutate(`/api/usage/agents/${editing.hospitalCode}`, 'PATCH', { expectedServers: expected, note }, `${editing.hospitalName} — 저장했습니다.`)) setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function Count({ label, value, tone }: { label: string; value: number | undefined; tone?: 'warn' | 'bad' }) {
  const color = !value ? 'text-muted-foreground' : tone === 'warn' ? 'text-warning-subtle-foreground' : tone === 'bad' ? 'text-destructive' : 'text-foreground'
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-base font-bold tabular-nums ${color}`}>{value ?? '—'}</span>
      <span className="text-xs text-muted-foreground">곳</span>
    </span>
  )
}

const inputClass = 'h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground'

function ServerCountField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">서버 대수</span>
      <input type="number" min={1} max={50} value={value} onChange={(e) => onChange(e.target.value)} data-testid="agent-expected" className={`${inputClass} w-28 tabular-nums`} />
      <span className="text-xs text-muted-foreground">이 병원에서 수집 Agent를 설치할 thynC 서버 수입니다. 이 수만큼만 설치할 수 있고, 나중에 바꿀 수 있습니다.</span>
    </label>
  )
}

function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">메모 (선택)</span>
      <input type="text" value={value} maxLength={500} onChange={(e) => onChange(e.target.value)} className={inputClass} placeholder="예: 본관·별관 서버 각각 1대" />
    </label>
  )
}

function ModalButtons({ busy, disabled, submitLabel, onClose }: { busy: boolean; disabled: boolean; submitLabel: string; onClose: () => void }) {
  return (
    <div className="mt-1 flex justify-end gap-2">
      <button type="button" onClick={onClose} className="h-9 rounded-md border border-border bg-card px-3.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
        취소
      </button>
      <button type="submit" disabled={busy || disabled} data-testid="agent-submit" className="h-9 rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {busy ? '처리 중...' : submitLabel}
      </button>
    </div>
  )
}

const validCount = (v: string) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 50
}

/** 병원 등록 — 병원 목록에 있는 병원을 골라 서버 대수를 적는다 (병원명·병원코드는 입력하지 않는다) */
function RegisterModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (h: SearchHospital, expected: number, note: string) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchHospital[] | null>(null)
  const [picked, setPicked] = useState<SearchHospital | null>(null)
  const [expected, setExpected] = useState('1')
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      fetch(`/api/usage/agents/hospitals?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((b) => {
          if (alive) setResults((b.hospitals as SearchHospital[]) ?? [])
        })
        .catch(() => {
          if (alive) setResults([])
        })
    }, 200)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])

  return (
    <Modal open onClose={onClose} title="수집 병원 등록" widthClass="max-w-xl">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (picked && validCount(expected)) onSubmit(picked, Number(expected), note)
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">병원</span>
          {picked ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2 text-sm" data-testid="agent-picked">
              <span>
                <span className="font-medium text-foreground">{picked.hospitalName}</span> <span className="text-muted-foreground tabular-nums">{picked.hospitalCode}</span>
              </span>
              <button type="button" onClick={() => setPicked(null)} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                다시 선택
              </button>
            </div>
          ) : (
            <>
              <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="병원명 또는 병원코드로 찾기" data-testid="agent-search" className={inputClass} />
              <ul className="max-h-60 overflow-y-auto rounded-md border border-border" data-testid="agent-search-results">
                {results === null && <li className="px-3 py-2 text-[13px] text-muted-foreground">불러오는 중...</li>}
                {results?.length === 0 && <li className="px-3 py-2 text-[13px] text-muted-foreground">찾는 병원이 없습니다. 이미 등록한 병원은 나오지 않습니다.</li>}
                {results?.map((h) => (
                  <li key={h.hospitalCode} className="border-b border-border last:border-b-0">
                    <button type="button" onClick={() => setPicked(h)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent">
                      <span className="font-medium text-foreground">{h.hospitalName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {h.hospitalCode} · {h.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <span className="text-xs text-muted-foreground">병원 목록에 있는 병원만 등록할 수 있습니다. 검색어가 없으면 운영 중인 병원을 보여 줍니다.</span>
            </>
          )}
        </div>
        <ServerCountField value={expected} onChange={setExpected} />
        <NoteField value={note} onChange={setNote} />
        <ModalButtons busy={busy} disabled={!picked || !validCount(expected)} submitLabel="등록" onClose={onClose} />
      </form>
    </Modal>
  )
}

function EditModal({ hospital, busy, onClose, onSubmit }: { hospital: AgentHospital; busy: boolean; onClose: () => void; onSubmit: (expected: number, note: string) => void }) {
  const [expected, setExpected] = useState(String(hospital.expectedServers ?? Math.max(1, hospital.registeredServers)))
  const [note, setNote] = useState(hospital.note ?? '')
  return (
    <Modal open onClose={onClose} title={`${hospital.hospitalName} — 서버 대수`} widthClass="max-w-xl">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (validCount(expected)) onSubmit(Number(expected), note)
        }}
      >
        <p className="text-[13px] text-muted-foreground">
          지금 설치된 서버 {hospital.registeredServers}대{hospital.expectedServers !== null ? ` · 등록한 대수 ${hospital.expectedServers}대` : ' · 아직 등록하지 않은 병원'}. 대수를 늘리면 그만큼 설치 자리가 열립니다.
        </p>
        <ServerCountField value={expected} onChange={setExpected} />
        <NoteField value={note} onChange={setNote} />
        <ModalButtons busy={busy} disabled={!validCount(expected)} submitLabel="저장" onClose={onClose} />
      </form>
    </Modal>
  )
}
