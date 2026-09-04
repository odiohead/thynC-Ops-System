'use client'

/**
 * AS접수 등록·수정 모달 (as_work_design.md §8)
 * 병원 검색(VOC 폼 패턴) → 구분·접수일·수거방법 → 시리얼 여러 줄 입력 + [매칭 확인](원장 미리보기 — 미등록 경고)
 * → 라인별 증상·기기종류 입력 → 등록. 수정 모드는 종결 라인 제거 불가(서버 400).
 */
import { useState, useEffect } from 'react'
import {
  AS_CATEGORIES, AS_CATEGORY_LABELS, AS_METHODS, AS_PICKUP_METHOD_LABELS,
  AS_DEVICE_KINDS, parseSerialTextarea, type AsCategory,
} from '@/lib/asReceiptShared'

interface HospitalOpt { hospitalCode: string; hospitalName: string; hiraHospitalName: string | null }

export interface LineRow {
  serial: string
  /** 매칭 상태 — ACTIVE_HERE/ACTIVE_OTHER/RECOVERED/NONE, null=미확인 */
  state: string | null
  modelName: string | null
  warning: string | null
  wardName: string
  deviceKind: string
  symptom: string
  /** 수정 모드 — 종결된 라인(제거·시리얼 변경 불가) */
  outcome: string | null
}

export interface AsEditTarget {
  id: number
  asCode: string
  hospitalCode: string
  hospitalName: string
  category: string
  receiptDate: string // YYYY-MM-DD
  reporterName: string | null
  pickupMethod: string | null
  pickupTrackingNo: string | null
  preReplace: boolean
  note: string | null
  items: { serialNo: string; wardName: string | null; deviceKind: string | null; symptom: string | null; outcome: string | null; deviceId: number | null; modelName: string | null }[]
}

function todayKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

const STATE_BADGES: Record<string, { label: string; cls: string }> = {
  ACTIVE_HERE: { label: '원장 연결', cls: 'bg-emerald-50 text-emerald-700' },
  ACTIVE_OTHER: { label: '타 병원', cls: 'bg-red-50 text-red-600' },
  RECOVERED: { label: '회수 상태', cls: 'bg-amber-50 text-amber-700' },
  NONE: { label: '미등록', cls: 'bg-gray-100 text-gray-500' },
}

export default function AsReceiptFormModal({
  open,
  onClose,
  onSaved,
  editTarget,
}: {
  open: boolean
  onClose: () => void
  /** 저장 성공 콜백(경고 목록 전달) — 호출부가 목록 갱신·router.refresh 담당 */
  onSaved: (warnings: string[]) => void
  /** 지정 시 수정 모드 (PUT), 미지정이면 등록 (POST) */
  editTarget?: AsEditTarget | null
}) {
  const [hospital, setHospital] = useState<{ code: string; name: string } | null>(null)
  const [hospitalQ, setHospitalQ] = useState('')
  const [hospitalOpts, setHospitalOpts] = useState<HospitalOpt[]>([])
  const [searching, setSearching] = useState(false)

  const [category, setCategory] = useState<AsCategory>('FAULT')
  const [receiptDate, setReceiptDate] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [pickupMethod, setPickupMethod] = useState('')
  const [pickupTrackingNo, setPickupTrackingNo] = useState('')
  const [preReplace, setPreReplace] = useState(false)
  const [note, setNote] = useState('')

  const [serialText, setSerialText] = useState('')
  const [rows, setRows] = useState<LineRow[]>([])
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setHospitalQ('')
    setHospitalOpts([])
    setSerialText('')
    if (editTarget) {
      setHospital({ code: editTarget.hospitalCode, name: editTarget.hospitalName })
      setCategory((editTarget.category as AsCategory) ?? 'FAULT')
      setReceiptDate(editTarget.receiptDate)
      setReporterName(editTarget.reporterName ?? '')
      setPickupMethod(editTarget.pickupMethod ?? '')
      setPickupTrackingNo(editTarget.pickupTrackingNo ?? '')
      setPreReplace(editTarget.preReplace)
      setNote(editTarget.note ?? '')
      setRows(editTarget.items.map((i) => ({
        serial: i.serialNo,
        state: i.deviceId ? 'ACTIVE_HERE' : 'NONE',
        modelName: i.modelName,
        warning: null,
        wardName: i.wardName ?? '',
        deviceKind: i.deviceKind ?? '',
        symptom: i.symptom ?? '',
        outcome: i.outcome,
      })))
    } else {
      setHospital(null)
      setCategory('FAULT')
      setReceiptDate(todayKst())
      setReporterName('')
      setPickupMethod('')
      setPickupTrackingNo('')
      setPreReplace(false)
      setNote('')
      setRows([])
    }
  }, [open, editTarget])

  async function searchHospitals() {
    if (!hospitalQ.trim()) return
    setSearching(true)
    const res = await fetch(`/api/hospitals?search=${encodeURIComponent(hospitalQ)}&limit=20`)
    if (res.ok) {
      const d = await res.json()
      setHospitalOpts(d.hospitals ?? [])
    }
    setSearching(false)
  }

  /** 시리얼 textarea → 매칭 확인 후 라인 행 추가 */
  async function addSerials() {
    if (!hospital) { setError('병원을 먼저 선택하세요.'); return }
    const serials = parseSerialTextarea(serialText).filter((s) => !rows.some((r) => r.serial === s))
    if (!serials.length) { setError('추가할 시리얼이 없습니다 (중복 제외).'); return }
    setChecking(true)
    setError(null)
    const res = await fetch('/api/as-receipts/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hospitalCode: hospital.code, serials }),
    })
    const d = await res.json().catch(() => ({}))
    setChecking(false)
    if (!res.ok) { setError(d.error ?? '매칭 확인에 실패했습니다.'); return }
    const results: { serialNo: string; state: string; modelName: string | null; wardName: string | null; warning: string | null }[] = d.results ?? []
    setRows((prev) => [
      ...prev,
      ...results.map((m) => ({
        serial: m.serialNo,
        state: m.state,
        modelName: m.modelName,
        warning: m.warning,
        wardName: m.wardName ?? '',
        deviceKind: '',
        symptom: '',
        outcome: null,
      })),
    ])
    setSerialText('')
  }

  function updateRow(idx: number, patch: Partial<LineRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  async function submit() {
    if (!hospital) { setError('병원을 선택하세요.'); return }
    if (!receiptDate) { setError('접수일을 입력하세요.'); return }
    if (rows.length === 0) { setError('기기 시리얼을 1개 이상 추가하세요 ([매칭 확인]).'); return }
    setBusy(true)
    setError(null)
    const payload = {
      category,
      receiptDate,
      reporterName: reporterName || null,
      pickupMethod: pickupMethod || null,
      pickupTrackingNo: pickupTrackingNo || null,
      preReplace,
      note: note || null,
      items: rows.map((r) => ({
        serial: r.serial,
        symptom: r.symptom || null,
        wardName: r.wardName || null,
        deviceKind: r.deviceKind || null,
      })),
    }
    const res = editTarget
      ? await fetch(`/api/as-receipts/${editTarget.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/as-receipts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, hospitalCode: hospital.code }),
        })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? '저장에 실패했습니다.'); return }
    onSaved(d.warnings ?? [])
    onClose()
  }

  if (!open) return null

  const label = 'text-xs font-medium text-gray-500'
  const input = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900">{editTarget ? `AS접수 수정 — ${editTarget.asCode}` : 'AS접수 등록'}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">✕</button>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="space-y-4">
          {/* 병원 */}
          <div>
            <label className={label}>병원 *</label>
            {hospital ? (
              <div className="mt-1 flex items-center gap-2">
                <span className="rounded-md bg-blue-50 px-2.5 py-1.5 text-sm text-blue-800">{hospital.name}</span>
                {!editTarget && (
                  <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => { setHospital(null); setRows([]) }}>변경</button>
                )}
              </div>
            ) : (
              <>
                <div className="mt-1 flex gap-1.5">
                  <input
                    type="text"
                    value={hospitalQ}
                    onChange={(e) => setHospitalQ(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchHospitals())}
                    placeholder="병원명 검색"
                    className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                  />
                  <button type="button" onClick={searchHospitals} disabled={searching || !hospitalQ.trim()} className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">검색</button>
                </div>
                {hospitalOpts.length > 0 && (
                  <div className="mt-1 max-h-36 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                    {hospitalOpts.map((h) => (
                      <button
                        key={h.hospitalCode}
                        type="button"
                        className="block w-full px-2.5 py-1.5 text-left text-sm hover:bg-blue-50"
                        onClick={() => { setHospital({ code: h.hospitalCode, name: h.hospitalName || h.hiraHospitalName || h.hospitalCode }); setHospitalOpts([]) }}
                      >
                        {h.hospitalName || h.hiraHospitalName}
                        <span className="ml-1.5 font-mono text-xs text-gray-400">{h.hospitalCode}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={label}>구분 *</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as AsCategory)} className={input}>
                {AS_CATEGORIES.map((c) => <option key={c} value={c}>{AS_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>접수일 *</label>
              <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>수거방법</label>
              <select value={pickupMethod} onChange={(e) => setPickupMethod(e.target.value)} className={input}>
                <option value="">선택</option>
                {AS_METHODS.map((m) => <option key={m} value={m}>{AS_PICKUP_METHOD_LABELS[m]}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>수거 송장</label>
              <input type="text" value={pickupTrackingNo} onChange={(e) => setPickupTrackingNo(e.target.value)} className={input} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>고객명 (카카오채널명)</label>
              <input type="text" value={reporterName} onChange={(e) => setReporterName(e.target.value)} className={input} />
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={preReplace} onChange={(e) => setPreReplace(e.target.checked)} className="rounded border-gray-300" />
                선교체요청
              </label>
            </div>
          </div>

          {/* 기기 라인 */}
          <div>
            <div className="flex items-baseline justify-between">
              <label className={label}>기기 시리얼 * (줄당 1개)</label>
              <span className="text-xs text-gray-400">{rows.length}대</span>
            </div>
            <div className="mt-1 flex gap-1.5">
              <textarea
                value={serialText}
                onChange={(e) => setSerialText(e.target.value)}
                rows={2}
                placeholder={'P003324\nA080316'}
                disabled={!hospital}
                className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm disabled:bg-gray-50"
              />
              <button
                type="button"
                onClick={addSerials}
                disabled={checking || !hospital || !serialText.trim()}
                className="self-start rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {checking ? '확인 중...' : '매칭 확인'}
              </button>
            </div>

            {rows.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {rows.map((r, idx) => {
                  const badge = STATE_BADGES[r.state ?? 'NONE'] ?? STATE_BADGES.NONE
                  return (
                    <div key={r.serial} className="rounded-lg border border-gray-200 px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-gray-900">{r.serial}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
                        {r.modelName && <span className="text-xs text-gray-400">{r.modelName}</span>}
                        {r.wardName && <span className="text-xs text-gray-400">{r.wardName}</span>}
                        {r.outcome ? (
                          <span className="text-[11px] text-gray-400">종결 라인 — 제거 불가</span>
                        ) : (
                          <button type="button" onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))} className="ml-auto text-xs text-gray-400 hover:text-red-500">제거</button>
                        )}
                      </div>
                      {r.warning && <p className="mt-1 text-xs text-amber-600">⚠ {r.warning}</p>}
                      <div className="mt-1.5 flex gap-1.5">
                        {r.state === 'NONE' && (
                          <select
                            value={r.deviceKind}
                            onChange={(e) => updateRow(idx, { deviceKind: e.target.value })}
                            className="w-28 rounded-md border border-gray-300 px-1.5 py-1 text-xs"
                          >
                            <option value="">기기종류</option>
                            {AS_DEVICE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                        )}
                        <input
                          type="text"
                          value={r.symptom}
                          onChange={(e) => updateRow(idx, { symptom: e.target.value })}
                          placeholder="증상 (접수사유)"
                          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label className={label}>비고</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="후속 조치·특이사항 등" className={input} />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? '저장 중...' : editTarget ? '수정 저장' : 'AS접수 등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
