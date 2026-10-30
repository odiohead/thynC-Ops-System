'use client'

/**
 * VOC 등록대기 상세 (projects/voc_sheet_import_design.md §4) — 좌: VOC 등록 폼(초안 프리필, 빈칸 강조) / 우: 원문(채널톡 타임라인 또는 시트 원본 열).
 * [VOC 등록] = 수동 등록과 같은 검증 + 접수·완료 시각 보정(lib/vocImport) · [VOC 아님] = 제외(되돌리기 가능)
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import ChatTimeline, { type TimelineMsg } from '@/app/voc/_components/ChatTimeline'
import { channeltalkDeskChatUrl } from '@/lib/channeltalk/shared'
import { VOC_INTAKE_IGNORE_LABEL, VOC_INTAKE_IGNORE_REASONS, type VocIntakeDraft, type VocIntakeIgnoreReason } from '@/lib/vocIntakeShared'

interface CodeRef { id: number; name: string; value?: string | null; color?: string | null }
interface Detail {
  item: { id: number; source: 'SHEET' | 'CHANNELTALK'; chatId: string | null; sourceRef: string | null; state: string; failClass: string | null; failLabel: string | null; failNote: string | null; createdAt: string; decidedAt: string | null; decidedBy: string | null; ignoreReason: string | null; voc: { id: number; vocCode: string; title: string } | null }
  draft: VocIntakeDraft | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  chat: { id: string; channelId: string | null; name: string | null; state: string; tags: string[]; createdAtCt: string | null; firstUserMessageAt: string | null; assigneeName: string | null; hospital: { hospitalCode: string; hospitalName: string } | null; user: { name: string | null; mobileNumber: string | null; landlineNumber: string | null; opsCode: string | null; hospitalNameRaw: string | null; ward: string | null } | null; vocLink: { voc: { id: number; vocCode: string; title: string } } | null } | null
  messages: TimelineMsg[]
  managerNames: Record<string, string>
}
interface HospitalOpt { hospitalCode: string; hospitalName: string }

const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')
/** ISO → datetime-local 값(KST) */
const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16).replace(' ', 'T') : '')

export default function VocIntakeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [canWrite, setCanWrite] = useState(false)
  const [types, setTypes] = useState<CodeRef[]>([])
  const [channels, setChannels] = useState<CodeRef[]>([])
  const [statuses, setStatuses] = useState<CodeRef[]>([])
  // 폼
  const [hospital, setHospital] = useState<HospitalOpt | null>(null)
  const [hospitalQ, setHospitalQ] = useState('')
  const [hospitalOpts, setHospitalOpts] = useState<HospitalOpt[]>([])
  const [hospitalNameRaw, setHospitalNameRaw] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [resolution, setResolution] = useState('')
  const [vocTypeId, setVocTypeId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [statusId, setStatusId] = useState('')
  const [receivedAt, setReceivedAt] = useState('')
  const [resolvedAt, setResolvedAt] = useState('')
  const [ignoreReason, setIgnoreReason] = useState<VocIntakeIgnoreReason>('NOT_VOC')
  const [showIgnore, setShowIgnore] = useState(false)

  const load = useCallback(async () => {
    const [res, t, c, s] = await Promise.all([
      fetch(`/api/voc-receipts/intake/${id}`, { cache: 'no-store' }),
      fetch('/api/settings/voc-type').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/voc-masters/channels').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/settings/voc-status').then((r) => (r.ok ? r.json() : null)),
    ])
    if (!res.ok) { setError('등록대기 항목을 찾을 수 없습니다.'); return }
    const data: Detail = await res.json()
    const typeList: CodeRef[] = t?.statusCodes ?? []
    const chanList: CodeRef[] = c?.channels ?? c?.statusCodes ?? []
    const statList: CodeRef[] = s?.statusCodes ?? []
    setTypes(typeList); setChannels(chanList); setStatuses(statList); setD(data)
    const dr = data.draft
    setHospital(data.hospital ?? data.chat?.hospital ?? null)
    setHospitalNameRaw(dr?.hospitalNameRaw ?? data.chat?.user?.hospitalNameRaw ?? '')
    setTitle(dr?.title ?? '')
    setContent(dr?.content ?? '')
    setResolution(dr?.resolution ?? '')
    setVocTypeId(dr?.tag ? String(typeList.find((x) => x.value === dr.tag)?.id ?? '') : '')
    setChannelId(dr?.channelName ? String(chanList.find((x) => x.name === dr.channelName)?.id ?? '') : '')
    setStatusId(dr?.statusName ? String(statList.find((x) => x.name === dr.statusName)?.id ?? '') : String(statList.find((x) => x.name === '접수')?.id ?? ''))
    setReceivedAt(toLocalInput(dr?.receivedAt ?? data.chat?.firstUserMessageAt ?? null))
    setResolvedAt(dr?.resolvedAt ?? '')
  }, [id])
  useEffect(() => { void load(); fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((me) => me && setCanWrite(me.role !== 'VIEWER')) }, [load])

  async function searchHospitals() {
    if (!hospitalQ.trim()) return
    const res = await fetch(`/api/hospitals?search=${encodeURIComponent(hospitalQ)}&limit=20`)
    const j = res.ok ? await res.json() : { hospitals: [] }
    setHospitalOpts((j.hospitals ?? j.data ?? []).map((h: HospitalOpt) => ({ hospitalCode: h.hospitalCode, hospitalName: h.hospitalName })))
  }

  async function register() {
    if (!title.trim()) { setError('제목을 입력하세요.'); return }
    if (!vocTypeId) { setError('VOC 분류를 선택하세요.'); return }
    if (!receivedAt) { setError('접수 일시를 입력하세요.'); return }
    setBusy('register'); setError(null)
    const res = await fetch(`/api/voc-receipts/intake/${id}/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hospitalCode: hospital?.hospitalCode ?? null, hospitalNameRaw: hospital ? null : hospitalNameRaw || null, title, content, resolution: resolution || null, vocTypeId: Number(vocTypeId), channelId: channelId ? Number(channelId) : null, statusId: statusId ? Number(statusId) : null, receivedAt: new Date(`${receivedAt}:00+09:00`).toISOString(), resolvedAt: resolvedAt ? new Date(`${resolvedAt}T18:00:00+09:00`).toISOString() : null }),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(j.error ?? '등록에 실패했습니다.'); return }
    router.refresh()
    router.push(`/voc/${j.id}`)
  }

  async function ignore(undo = false) {
    setBusy('ignore'); setError(null)
    const res = await fetch(`/api/voc-receipts/intake/${id}/ignore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(undo ? { undo: true } : { reason: ignoreReason }) })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(j.error ?? '처리에 실패했습니다.'); return }
    router.refresh(); setShowIgnore(false); await load()
  }

  if (error && !d) return <div className="p-8 text-sm text-red-600">{error}</div>
  if (!d) return <div className="p-8 text-sm text-gray-400">불러오는 중...</div>

  const pending = d.item.state === 'PENDING'
  const label = 'text-xs font-medium text-gray-500'
  const input = (empty: boolean) => `mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm ${empty ? 'border-amber-300 bg-amber-50/40' : 'border-gray-300'}`
  const sheet = d.draft?.sheet
  const heading = d.item.source === 'SHEET' ? `VOC현황 시트 r${sheet?.row ?? ''} · ${sheet?.date ?? ''}` : `${d.chat?.name ?? d.chat?.user?.name ?? '(상담)'} · ${kst(d.chat?.firstUserMessageAt ?? d.chat?.createdAtCt ?? null)} · ${d.chat?.state === 'closed' ? '종료' : '진행중'}${d.chat?.assigneeName ? ` · 담당 ${d.chat.assigneeName}` : ''}`

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Link href="/voc/intake" className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">← 등록대기 목록</Link>
            <Link href="/voc" className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">VOC 접수</Link>
            <span className="font-mono text-xs text-gray-400">#{d.item.id}</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">{heading}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {d.chat?.tags.map((t) => <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{t}</span>)}
            {sheet?.tag && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{sheet.tag}</span>}
            {d.chat?.vocLink && <Link href={`/voc/${d.chat.vocLink.voc.id}`} className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-indigo-700 hover:underline">{d.chat.vocLink.voc.vocCode}</Link>}
            {d.chat && <a href={channeltalkDeskChatUrl(d.chat.channelId, d.chat.id)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">채널톡에서 열기 ↗</a>}
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          {pending ? (
            <p><span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">{d.item.failLabel ?? '등록대기'}</span>{d.item.failNote && <span className="ml-1.5 text-gray-500">{d.item.failNote}</span>}</p>
          ) : d.item.state === 'REGISTERED' ? (
            <p>등록됨 → {d.item.voc ? <Link href={`/voc/${d.item.voc.id}`} className="font-mono text-blue-600 hover:underline">{d.item.voc.vocCode}</Link> : '-'}{d.item.decidedBy ? ` · ${d.item.decidedBy} ${kst(d.item.decidedAt)}` : ''}</p>
          ) : (
            <p>VOC 아님 ({d.item.ignoreReason ? VOC_INTAKE_IGNORE_LABEL[d.item.ignoreReason as VocIntakeIgnoreReason] ?? d.item.ignoreReason : '-'}) · {d.item.decidedBy} {kst(d.item.decidedAt)} {canWrite && <button type="button" onClick={() => ignore(true)} disabled={!!busy} className="ml-2 text-blue-600 hover:underline">되돌리기</button>}</p>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 좌 — VOC 등록 폼 */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">VOC 접수 정보 <span className="ml-1 text-xs font-normal text-gray-400">식별된 값은 채워져 있고, 노란 칸은 비어 있습니다</span></h2>
          <fieldset disabled={!pending || !canWrite} className="space-y-3 disabled:opacity-80">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className={label}>병원</span>
                {hospital ? (
                  <div className="mt-1 flex items-center gap-2 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"><span className="font-medium">{hospital.hospitalName}</span><span className="font-mono text-xs text-gray-400">{hospital.hospitalCode}</span>{pending && <button type="button" onClick={() => setHospital(null)} className="ml-auto text-xs text-gray-400 hover:text-red-600">변경</button>}</div>
                ) : (
                  <div className="mt-1">
                    <div className="flex gap-1"><input value={hospitalQ} onChange={(e) => setHospitalQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchHospitals())} placeholder={hospitalNameRaw ? `원문: ${hospitalNameRaw}` : '병원명 검색'} className={input(true)} /><button type="button" onClick={searchHospitals} className="mt-1 rounded-md border border-gray-300 px-2 text-xs">검색</button></div>
                    {hospitalOpts.length > 0 && <ul className="mt-1 max-h-40 overflow-auto rounded-md border border-gray-200 text-sm">{hospitalOpts.map((h) => <li key={h.hospitalCode}><button type="button" onClick={() => { setHospital(h); setHospitalOpts([]) }} className="w-full px-2.5 py-1 text-left hover:bg-blue-50">{h.hospitalName} <span className="font-mono text-xs text-gray-400">{h.hospitalCode}</span></button></li>)}</ul>}
                    <p className="mt-1 text-xs text-gray-400">병원을 못 찾으면 비워 두고 등록할 수 있습니다 (비고객 VOC — 원문 병원명 &apos;{hospitalNameRaw || '-'}&apos; 보존)</p>
                  </div>
                )}
              </div>
              <div><span className={label}>VOC 분류 *</span><select value={vocTypeId} onChange={(e) => setVocTypeId(e.target.value)} className={input(!vocTypeId)}><option value="">선택</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>{d.draft?.tagRaw && !d.draft.tag && <p className="mt-1 text-xs text-amber-700">원 태그 &apos;{d.draft.tagRaw}&apos;는 현 분류에 없음 — 가까운 분류를 고르세요</p>}</div>
              <div><span className={label}>접수 채널</span><select value={channelId} onChange={(e) => setChannelId(e.target.value)} className={input(false)}><option value="">-</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><span className={label}>상태</span><select value={statusId} onChange={(e) => setStatusId(e.target.value)} className={input(false)}>{statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><span className={label}>접수 일시 *</span><input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={input(!receivedAt)} /></div>
              <div><span className={label}>완료일</span><input type="date" value={resolvedAt} onChange={(e) => setResolvedAt(e.target.value)} className={input(false)} /></div>
            </div>
            <div><span className={label}>제목 *</span><input value={title} onChange={(e) => setTitle(e.target.value)} className={input(!title)} /></div>
            <div><span className={label}>내용</span><textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} className={input(!content)} /></div>
            <div><span className={label}>처리 결과</span><textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} className={input(false)} /></div>
          </fieldset>
          {pending && canWrite && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              <button type="button" onClick={register} disabled={!!busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy === 'register' ? '등록 중...' : 'VOC 등록'}</button>
              {!showIgnore ? (
                <button type="button" onClick={() => setShowIgnore(true)} disabled={!!busy} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">VOC 아님</button>
              ) : (
                <span className="flex items-center gap-1 text-sm"><select value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value as VocIntakeIgnoreReason)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">{VOC_INTAKE_IGNORE_REASONS.map((r) => <option key={r} value={r}>{VOC_INTAKE_IGNORE_LABEL[r]}</option>)}</select><button type="button" onClick={() => ignore(false)} disabled={!!busy} className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-white">제외 확정</button><button type="button" onClick={() => setShowIgnore(false)} className="text-xs text-gray-500">취소</button></span>
              )}
            </div>
          )}
        </div>

        {/* 우 — 원문 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
          {d.item.source === 'CHANNELTALK' && d.chat ? (
            <>
              <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-700">상담 원문 <span className="text-xs font-normal text-gray-400">{d.messages.length}건</span></h2>{d.chat.user && <span className="text-xs text-gray-500">{d.chat.user.name}{d.chat.user.mobileNumber ?? d.chat.user.landlineNumber ? ` · ${d.chat.user.mobileNumber ?? d.chat.user.landlineNumber}` : ''}{d.chat.user.ward ? ` · ${d.chat.user.ward}` : ''}</span>}</div>
              <div className="max-h-[75vh] overflow-y-auto pr-1">
                <ChatTimeline messages={d.messages} managerNames={d.managerNames} customerName={d.chat.user?.name ?? d.chat.name} chatId={d.chat.id} />
              </div>
            </>
          ) : sheet ? (
            <>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">시트 원본 <span className="text-xs font-normal text-gray-400">VOC현황_NEW r{sheet.row}</span></h2>
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
                {([
                  ['날짜', sheet.date], ['병원', sheet.hospital], ['병동명', sheet.ward], ['유선문의', sheet.phone ? 'TRUE' : 'FALSE'], ['등록자', sheet.registrant],
                  ['접수 내용', sheet.content], ['조치 내용', sheet.resolution], ['담당 부서', sheet.dept], ['확인 담당자', sheet.checker],
                  ['문의유형', [sheet.typeL, sheet.typeM, sheet.typeS].filter(Boolean).join(' > ')], ['반복문의', sheet.repeat],
                  ['1차 대응', [sheet.firstDone, sheet.firstDoneAt].filter(Boolean).join(' ')], ['접수시간', sheet.receivedTime], ['전체 완료', [sheet.allDone, sheet.allDoneAt].filter(Boolean).join(' ')],
                  ['채널톡 태그', sheet.tag], ['ALF 관여', sheet.alf],
                ] as [string, string | null][]).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-xs text-gray-500">{k}</dt><dd className={`whitespace-pre-wrap break-words ${v ? 'text-gray-800' : 'text-gray-300'}`}>{v || '-'}</dd></div>
                ))}
              </dl>
            </>
          ) : <p className="text-sm text-gray-400">원문이 없습니다.</p>}
        </div>
      </div>
    </div>
  )
}
