'use client'

/**
 * AS 등록대기 상세 (as_channeltalk_intake_design.md §5) — 좌: AS 접수 폼(추출값 프리필, 빈칸 강조) / 우: 상담 원문 타임라인.
 * [Claude 도움요청] = 빈칸만 채움(자동 등록 없음) · [등록] = 수동 등록과 같은 경로(source INTAKE_QUEUE) · [기존 접수에 연결] · [AS 아님]
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import ChatTimeline, { type TimelineMsg } from '@/app/voc/_components/ChatTimeline'
import { channeltalkDeskChatUrl } from '@/lib/channeltalk/shared'
import { AS_INTAKE_IGNORE_LABEL, AS_INTAKE_IGNORE_REASONS, type AsExtract, type AsIntakeIgnoreReason } from '@/lib/channeltalk/asIntakeShared'
import { AS_CATEGORY_LABELS, AS_PICKUP_METHOD_LABELS, AS_PICKUP_METHODS, AS_DEST_TYPE_LABELS, AS_DEST_TYPES, AS_SERIAL_RE, type AsCategory, type AsPickupMethod, type AsDestType } from '@/lib/asReceiptShared'

interface Detail {
  link: { id: number; chatId: string; state: string; failClass: string | null; failLabel: string | null; failNote: string | null; extractLayer: string; createdAt: string; decidedAt: string | null; decidedBy: string | null; ignoreReason: string | null; aiRequestedAt: string | null; aiRequestedBy: string | null; receipt: { id: number; asCode: string } | null }
  extracted: AsExtract | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  existing: { id: number; asCode: string } | null
  chat: { id: string; channelId: string | null; name: string | null; state: string; tags: string[]; createdAtCt: string | null; firstUserMessageAt: string | null; assigneeName: string | null; hospital: { hospitalCode: string; hospitalName: string } | null; user: { name: string | null; mobileNumber: string | null; landlineNumber: string | null; opsCode: string | null; hospitalNameRaw: string | null; ward: string | null } | null; vocLink: { voc: { id: number; vocCode: string; title: string } } | null }
  messages: TimelineMsg[]
  managerNames: Record<string, string>
}
interface HospitalOpt { hospitalCode: string; hospitalName: string }
interface LineForm { serial: string; ward: string; symptom: string }

const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')

export default function AsIntakeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [canWrite, setCanWrite] = useState(false)
  // 폼
  const [hospital, setHospital] = useState<HospitalOpt | null>(null)
  const [hospitalQ, setHospitalQ] = useState('')
  const [hospitalOpts, setHospitalOpts] = useState<HospitalOpt[]>([])
  const [category, setCategory] = useState<AsCategory>('FAULT')
  const [receiptDate, setReceiptDate] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [pickupMethod, setPickupMethod] = useState<string>('PARCEL')
  const [pickedUpAt, setPickedUpAt] = useState('')
  const [preReplace, setPreReplace] = useState(false)
  const [destType, setDestType] = useState<string>('')
  const [destInfo, setDestInfo] = useState('')
  const [pickupDestDiffers, setPickupDestDiffers] = useState(false)
  const [pickupDestInfo, setPickupDestInfo] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<LineForm[]>([])
  const [ignoreReason, setIgnoreReason] = useState<AsIntakeIgnoreReason>('OTHER')
  const [showIgnore, setShowIgnore] = useState(false)

  const fill = useCallback((e: AsExtract | null, hosp: HospitalOpt | null) => {
    setHospital(hosp)
    setCategory(e?.category ?? 'FAULT')
    const rd = e?.receiptDate ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
    setReceiptDate(rd)
    setReporterName(e?.reporterName ?? '')
    const lost = e?.category === 'LOST'
    setPickupMethod(lost ? 'NONE' : 'PARCEL')
    setPickedUpAt(lost ? '' : new Date(new Date(`${rd}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10))
    setPreReplace(!!e?.preReplace)
    setDestType(e?.destInfo ? 'HOSPITAL' : '')
    setDestInfo(e?.destInfo ?? '')
    setPickupDestDiffers(!!e?.pickupDestDiffers)
    setPickupDestInfo(e?.pickupDestInfo ?? '')
    setLines((e?.lines ?? []).map((l) => ({ serial: l.serial, ward: l.ward ?? '', symptom: l.symptom ?? '' })))
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/as-receipts/intake/${id}`, { cache: 'no-store' })
    if (!res.ok) { setError('등록대기 항목을 찾을 수 없습니다.'); return }
    const data: Detail = await res.json()
    setD(data)
    fill(data.extracted, data.hospital ?? (data.extracted?.hospitalCode ? null : data.chat.hospital))
  }, [id, fill])
  useEffect(() => { void load(); fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((me) => me && setCanWrite(me.role !== 'VIEWER')) }, [load])

  async function searchHospitals() {
    if (!hospitalQ.trim()) return
    const res = await fetch(`/api/hospitals?search=${encodeURIComponent(hospitalQ)}&limit=20`)
    const j = res.ok ? await res.json() : { hospitals: [] }
    setHospitalOpts((j.hospitals ?? j.data ?? []).map((h: HospitalOpt) => ({ hospitalCode: h.hospitalCode, hospitalName: h.hospitalName })))
  }

  const currentExtract = (): AsExtract | null => d?.extracted ? { ...d.extracted, hospitalCode: hospital?.hospitalCode ?? null, category, receiptDate, reporterName: reporterName || null, preReplace, destInfo: destInfo || null, pickupDestInfo: pickupDestInfo || null, pickupDestDiffers, lines: lines.map((l) => ({ serial: l.serial, ward: l.ward || null, symptom: l.symptom || null })) } : null

  async function askAi() {
    setBusy('ai'); setError(null)
    const res = await fetch(`/api/as-receipts/intake/${id}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: currentExtract() }) })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(j.error ?? 'AI 추출에 실패했습니다.'); return }
    const e: AsExtract = j.extracted
    let hosp = hospital
    if (!hosp && e.hospitalCode) { const r = await fetch(`/api/hospitals?search=${encodeURIComponent(e.hospitalCode)}&limit=1`); const jj = r.ok ? await r.json() : null; const h = (jj?.hospitals ?? jj?.data ?? []).find((x: HospitalOpt) => x.hospitalCode === e.hospitalCode); if (h) hosp = { hospitalCode: h.hospitalCode, hospitalName: h.hospitalName } }
    fill(e, hosp)
    if (j.ai?.notes) setNote((n) => (n ? `${n}\n` : '') + `[AI 참고] ${j.ai.notes}`)
  }

  async function register() {
    if (!hospital) { setError('병원을 선택하세요.'); return }
    if (!lines.length) { setError('기기 시리얼을 1개 이상 입력하세요.'); return }
    const bad = lines.filter((l) => !AS_SERIAL_RE.test(l.serial.trim().toUpperCase()))
    if (bad.length) { setError(`시리얼 형식 오류: ${bad.map((l) => l.serial).join(', ')} (영문 A/P + 숫자 6자리)`); return }
    setBusy('register'); setError(null)
    const res = await fetch(`/api/as-receipts/intake/${id}/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hospitalCode: hospital.hospitalCode, category, receiptDate, reporterName: reporterName || null, pickupMethod: pickupMethod || null, pickedUpAt: pickedUpAt || null, preReplace, destType: destType || null, destInfo: destInfo || null, pickupDestDiffers, pickupDestInfo: pickupDestInfo || null, note: note || null, items: lines.map((l) => ({ serial: l.serial.trim().toUpperCase(), wardName: l.ward || null, symptom: l.symptom || null })) }),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(j.error ?? '등록에 실패했습니다.'); return }
    router.refresh()
    router.push(`/as-receipts/${j.id}`) // 경고(원장 미등록 등)는 상세의 라인 태그로 확인
  }

  async function linkExisting(receiptId: number) {
    setBusy('link'); setError(null)
    const res = await fetch(`/api/as-receipts/intake/${id}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receiptId }) })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(j.error ?? '연결에 실패했습니다.'); return }
    router.refresh(); router.push(`/as-receipts/${receiptId}`)
  }

  async function ignore(undo = false) {
    setBusy('ignore'); setError(null)
    const res = await fetch(`/api/as-receipts/intake/${id}/ignore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(undo ? { undo: true } : { reason: ignoreReason }) })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(j.error ?? '처리에 실패했습니다.'); return }
    router.refresh(); setShowIgnore(false); await load()
  }

  if (error && !d) return <div className="p-8 text-sm text-red-600">{error}</div>
  if (!d) return <div className="p-8 text-sm text-gray-400">불러오는 중...</div>

  const pending = d.link.state === 'PENDING'
  const label = 'text-xs font-medium text-gray-500'
  const input = (empty: boolean) => `mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm ${empty ? 'border-amber-300 bg-amber-50/40' : 'border-gray-300'}`
  const customerPhone = d.chat.user?.mobileNumber ?? d.chat.user?.landlineNumber ?? null

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400"><Link href="/as-receipts" className="hover:text-gray-600">AS업무</Link><span className="text-gray-300">/</span><Link href="/as-receipts/intake" className="hover:text-gray-600">등록대기</Link><span className="text-gray-300">/</span><span className="font-mono text-gray-500">#{d.link.id}</span></div>
          <h1 className="mt-1 text-xl font-bold text-gray-900">{d.chat.name ?? d.chat.user?.name ?? '(상담)'} <span className="font-normal text-gray-400">· {kst(d.chat.firstUserMessageAt ?? d.chat.createdAtCt)} · {d.chat.state === 'closed' ? '종료' : '진행중'}{d.chat.assigneeName ? ` · 담당 ${d.chat.assigneeName}` : ''}</span></h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {d.chat.tags.filter((t) => t.startsWith('f_')).map((t) => <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{t}</span>)}
            {d.chat.vocLink && <Link href={`/voc/${d.chat.vocLink.voc.id}`} className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-indigo-700 hover:underline">{d.chat.vocLink.voc.vocCode}</Link>}
            <a href={channeltalkDeskChatUrl(d.chat.channelId, d.chat.id)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">채널톡에서 열기 ↗</a>
            {d.link.extractLayer === 'L2' && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700" title={`${d.link.aiRequestedBy ?? ''} ${kst(d.link.aiRequestedAt)}`}>Claude 보조</span>}
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          {pending ? (
            <p><span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">{d.link.failLabel ?? '등록대기'}</span>{d.link.failNote && <span className="ml-1.5 text-gray-500">{d.link.failNote}</span>}</p>
          ) : d.link.state === 'LINKED' ? (
            <p>처리됨 → {d.link.receipt ? <Link href={`/as-receipts/${d.link.receipt.id}`} className="font-mono text-blue-600 hover:underline">{d.link.receipt.asCode}</Link> : '-'}{d.link.decidedBy ? ` · ${d.link.decidedBy} ${kst(d.link.decidedAt)}` : ''}</p>
          ) : (
            <p>AS 아님 ({d.link.ignoreReason ? AS_INTAKE_IGNORE_LABEL[d.link.ignoreReason as AsIntakeIgnoreReason] ?? d.link.ignoreReason : '-'}) · {d.link.decidedBy} {kst(d.link.decidedAt)} {canWrite && <button type="button" onClick={() => ignore(true)} disabled={!!busy} className="ml-2 text-blue-600 hover:underline">되돌리기</button>}</p>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {pending && d.existing && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span>같은 병원·접수일·시리얼의 접수 <Link href={`/as-receipts/${d.existing.id}`} className="font-mono underline">{d.existing.asCode}</Link>가 이미 있습니다. 새로 만들지 않고 연결할 수 있습니다.</span>
          {canWrite && <button type="button" onClick={() => linkExisting(d.existing!.id)} disabled={!!busy} className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">기존 접수에 연결</button>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 좌 — AS 접수 폼 */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">AS 접수 정보 <span className="ml-1 text-xs font-normal text-gray-400">식별된 값은 채워져 있고, 노란 칸은 비어 있습니다</span></h2>
            {pending && canWrite && <button type="button" onClick={askAi} disabled={!!busy} className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50">{busy === 'ai' ? 'Claude 분석 중...' : 'Claude 도움요청'}</button>}
          </div>
          <fieldset disabled={!pending || !canWrite} className="space-y-3 disabled:opacity-80">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className={label}>병원 *</span>
                {hospital ? (
                  <div className="mt-1 flex items-center gap-2 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"><span className="font-medium">{hospital.hospitalName}</span><span className="font-mono text-xs text-gray-400">{hospital.hospitalCode}</span>{pending && <button type="button" onClick={() => setHospital(null)} className="ml-auto text-xs text-gray-400 hover:text-red-600">변경</button>}</div>
                ) : (
                  <div className="mt-1">
                    <div className="flex gap-1"><input value={hospitalQ} onChange={(e) => setHospitalQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchHospitals())} placeholder={d.extracted?.hospitalNameRaw ? `원문: ${d.extracted.hospitalNameRaw}` : '병원명 검색'} className={input(true)} /><button type="button" onClick={searchHospitals} className="mt-1 rounded-md border border-gray-300 px-2 text-xs">검색</button></div>
                    {hospitalOpts.length > 0 && <ul className="mt-1 max-h-40 overflow-auto rounded-md border border-gray-200 text-sm">{hospitalOpts.map((h) => <li key={h.hospitalCode}><button type="button" onClick={() => { setHospital(h); setHospitalOpts([]) }} className="w-full px-2.5 py-1 text-left hover:bg-blue-50">{h.hospitalName} <span className="font-mono text-xs text-gray-400">{h.hospitalCode}</span></button></li>)}</ul>}
                    {d.chat.user?.opsCode && <p className="mt-1 text-xs text-gray-400">고객 OpsCode {d.chat.user.opsCode}{d.chat.hospital ? ` (${d.chat.hospital.hospitalName})` : ''}</p>}
                  </div>
                )}
              </div>
              <div><span className={label}>구분 *</span><select value={category} onChange={(e) => setCategory(e.target.value as AsCategory)} className={input(false)}>{(['FAULT', 'LOST'] as const).map((c) => <option key={c} value={c}>{AS_CATEGORY_LABELS[c]}</option>)}</select></div>
              <div><span className={label}>접수일 *</span><input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className={input(!receiptDate)} /></div>
              <div><span className={label}>접수자</span><input value={reporterName} onChange={(e) => setReporterName(e.target.value)} className={input(!reporterName)} placeholder={customerPhone ? `고객 ${d.chat.user?.name ?? ''} ${customerPhone}` : ''} /></div>
              <div><span className={label}>수거방법</span><select value={pickupMethod} onChange={(e) => setPickupMethod(e.target.value)} className={input(false)}><option value="">-</option>{AS_PICKUP_METHODS.map((m) => <option key={m} value={m}>{AS_PICKUP_METHOD_LABELS[m as AsPickupMethod]}</option>)}</select></div>
              <div><span className={label}>수거일</span><input type="date" value={pickedUpAt} onChange={(e) => setPickedUpAt(e.target.value)} className={input(false)} /></div>
              <div><span className={label}>발송지 구분</span><select value={destType} onChange={(e) => setDestType(e.target.value)} className={input(false)}><option value="">-</option>{AS_DEST_TYPES.map((t) => <option key={t} value={t}>{AS_DEST_TYPE_LABELS[t as AsDestType]}</option>)}</select></div>
              <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={preReplace} onChange={(e) => setPreReplace(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />선교체요청{d.extracted?.preReplaceSource && <span className="text-xs text-gray-400">({{ confirmation: '확인문', chat: '상담 언급', hospital_tag: '병원 태그' }[d.extracted.preReplaceSource]})</span>}</label>
            </div>
            <div><span className={label}>발송지 정보</span><textarea value={destInfo} onChange={(e) => setDestInfo(e.target.value)} rows={2} className={input(!destInfo)} /></div>
            <div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pickupDestDiffers} onChange={(e) => setPickupDestDiffers(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />회수지 상이</label>
              {pickupDestDiffers && <textarea value={pickupDestInfo} onChange={(e) => setPickupDestInfo(e.target.value)} rows={2} placeholder="회수지 정보" className={input(!pickupDestInfo)} />}
            </div>
            <div>
              <div className="flex items-center justify-between"><span className={label}>기기 라인 * <span className="font-normal text-gray-400">(시리얼 / 병동 / 증상)</span></span>{pending && canWrite && <button type="button" onClick={() => setLines((ls) => [...ls, { serial: '', ward: d.extracted?.wards[0] ?? '', symptom: '' }])} className="text-xs text-blue-600 hover:underline">+ 라인</button>}</div>
              <div className="mt-1 space-y-1">
                {lines.map((l, i) => {
                  const bad = l.serial.trim() !== '' && !AS_SERIAL_RE.test(l.serial.trim().toUpperCase())
                  const unknown = d.extracted?.unknownSerials.includes(l.serial.trim().toUpperCase())
                  return (
                    <div key={i} className="flex items-center gap-1">
                      <input value={l.serial} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, serial: e.target.value } : x)))} placeholder="P012345" className={`w-28 rounded-md border px-2 py-1 font-mono text-sm ${bad ? 'border-red-400 bg-red-50' : unknown ? 'border-amber-400 bg-amber-50' : l.serial ? 'border-gray-300' : 'border-amber-300 bg-amber-50/40'}`} title={bad ? '형식 오류' : unknown ? '기기 원장에 없음' : ''} />
                      <input value={l.ward} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ward: e.target.value } : x)))} placeholder="병동" className={`w-28 rounded-md border px-2 py-1 text-sm ${l.ward ? 'border-gray-300' : 'border-amber-300 bg-amber-50/40'}`} />
                      <input value={l.symptom} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, symptom: e.target.value } : x)))} placeholder="증상" className={`flex-1 rounded-md border px-2 py-1 text-sm ${l.symptom ? 'border-gray-300' : 'border-amber-300 bg-amber-50/40'}`} />
                      {pending && canWrite && <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="px-1 text-xs text-gray-400 hover:text-red-600">✕</button>}
                    </div>
                  )
                })}
                {lines.length === 0 && <p className="rounded-md border border-dashed border-amber-300 bg-amber-50/40 px-3 py-2 text-xs text-amber-700">시리얼을 읽지 못했습니다 — 원문을 보고 라인을 추가하세요.</p>}
              </div>
            </div>
            <div><span className={label}>비고</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={input(false)} /></div>
          </fieldset>
          {pending && canWrite && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              <button type="button" onClick={register} disabled={!!busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy === 'register' ? '등록 중...' : 'AS 접수 등록'}</button>
              {!showIgnore ? (
                <button type="button" onClick={() => setShowIgnore(true)} disabled={!!busy} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">AS 아님</button>
              ) : (
                <span className="flex items-center gap-1 text-sm"><select value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value as AsIntakeIgnoreReason)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">{AS_INTAKE_IGNORE_REASONS.map((r) => <option key={r} value={r}>{AS_INTAKE_IGNORE_LABEL[r]}</option>)}</select><button type="button" onClick={() => ignore(false)} disabled={!!busy} className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-white">제외 확정</button><button type="button" onClick={() => setShowIgnore(false)} className="text-xs text-gray-500">취소</button></span>
              )}
            </div>
          )}
        </div>

        {/* 우 — 상담 원문 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-700">상담 원문 <span className="text-xs font-normal text-gray-400">{d.messages.length}건</span></h2>{d.chat.user && <span className="text-xs text-gray-500">{d.chat.user.name}{customerPhone ? ` · ${customerPhone}` : ''}{d.chat.user.ward ? ` · ${d.chat.user.ward}` : ''}</span>}</div>
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <ChatTimeline messages={d.messages} managerNames={d.managerNames} customerName={d.chat.user?.name ?? d.chat.name} />
          </div>
        </div>
      </div>
    </div>
  )
}
