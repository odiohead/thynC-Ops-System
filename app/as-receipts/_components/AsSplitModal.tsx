'use client'

/**
 * AS접수 분할 모달 (2026-11-07 — projects/as_receipt_split_design.md §9.1)
 * 축 2개 고정: 병동별(라인을 병동으로 자동 그룹핑 → 원본에 남길 그룹 1개 + 분리할 그룹 체크 + 그룹별 발송지) / 구분별(반대 구분으로 보낼 라인 체크).
 * 미종결 라인(outcome NULL)만 대상 — 처리 확정 라인은 원본에 남는다(D4). 서버 `POST /api/as-receipts/[id]/split`.
 */
import { useMemo, useState } from 'react'
import { AS_CATEGORY_LABELS, type AsCategory } from '@/lib/asReceiptShared'

export interface SplitLine {
  id: number
  serialNo: string
  wardName: string | null
  outcome: string | null
  draftOutcome: string | null
  symptom: string | null
  deviceName: string | null
  /** 원장 배치 병동 — 있으면 병동 키로 우선 */
  placementWard: string | null
}

export interface SplitResultChild { id: number; asCode: string; category: string; key: string; count: number }

const UNASSIGNED = '(병동 미지정)'

interface WardGroup { key: string; lines: SplitLine[] }

function groupByWard(lines: SplitLine[]): WardGroup[] {
  const map = new Map<string, SplitLine[]>()
  for (const l of lines) {
    const key = (l.placementWard ?? l.wardName ?? '').trim() || UNASSIGNED
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(l)
  }
  const groups = Array.from(map, ([key, ls]) => ({ key, lines: ls }))
  // 라인 수 내림차순, 동률은 등장 순 — 첫 그룹이 '원본에 남김' 기본(D1). 미지정은 맨 뒤
  return groups.sort((a, b) => (a.key === UNASSIGNED ? 1 : b.key === UNASSIGNED ? -1 : b.lines.length - a.lines.length))
}

export default function AsSplitModal({ open, onClose, receipt, onDone }: {
  open: boolean
  onClose: () => void
  receipt: { id: number; asCode: string; category: string; destInfo: string | null; items: SplitLine[] }
  onDone: (result: { children: SplitResultChild[]; warnings: string[] }) => void
}) {
  const [mode, setMode] = useState<'WARD' | 'CATEGORY'>('WARD')
  const openLines = useMemo(() => receipt.items.filter((i) => !i.outcome), [receipt.items])
  const wardGroups = useMemo(() => groupByWard(openLines), [openLines])
  const [keepKey, setKeepKey] = useState<string | null>(null)
  const [checked, setChecked] = useState<Record<string, boolean> | null>(null)
  const [dest, setDest] = useState<Record<string, string>>({})
  const [catSel, setCatSel] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveKeep = keepKey ?? wardGroups[0]?.key ?? null
  const effectiveChecked = (key: string) => checked?.[key] ?? (key !== effectiveKeep && key !== UNASSIGNED)
  const otherCategory: AsCategory = receipt.category === 'LOST' ? 'FAULT' : 'LOST'
  const otherLabel = AS_CATEGORY_LABELS[otherCategory]

  if (!open) return null

  const wardSelected = wardGroups.filter((g) => g.key !== effectiveKeep && effectiveChecked(g.key))
  const remainingWard = openLines.length - wardSelected.reduce((n, g) => n + g.lines.length, 0)
  const canSubmit = mode === 'WARD' ? wardSelected.length > 0 && remainingWard >= 1 : catSel.size > 0 && catSel.size < openLines.length

  async function submit() {
    if (!canSubmit || busy) return
    const groups = mode === 'WARD'
      ? wardSelected.map((g) => ({ key: g.key, itemIds: g.lines.map((l) => l.id), destInfo: (dest[g.key] ?? receipt.destInfo ?? '') || null }))
      : [{ key: otherLabel, itemIds: Array.from(catSel), destInfo: (dest.__cat ?? receipt.destInfo ?? '') || null, category: otherCategory }]
    const summary = mode === 'WARD'
      ? `${receipt.asCode}를 병동별로 분할합니다.\n${groups.map((g) => `· ${g.key} ${g.itemIds.length}대 → 새 접수`).join('\n')}\n· 원본 잔류 ${remainingWard}대 (${effectiveKeep ?? '-'})`
      : `${receipt.asCode}에서 ${catSel.size}대를 ${otherLabel} 접수로 분리합니다.\n· 원본 잔류 ${openLines.length - catSel.size}대`
    if (!confirm(`${summary}\n\n새 접수마다 티켓이 생성되고 상태·수거·태그·담당자·채널톡 연결을 승계합니다. 계속할까요?`)) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/as-receipts/${receipt.id}/split`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, groups }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? '분할에 실패했습니다.'); return }
    onDone({ children: d.children ?? [], warnings: d.warnings ?? [] })
  }

  const label = 'text-xs font-medium text-gray-500'
  const inputCls = 'w-full rounded-md border border-gray-300 px-2 py-1 text-xs'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6" onClick={(e) => e.stopPropagation()} data-testid="as-split-modal">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900">접수 분할 — {receipt.asCode}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">✕</button>
        </div>
        <p className="mb-3 text-xs text-gray-500">미종결 기기 {openLines.length}대를 새 접수(+티켓)로 나눕니다. 처리 확정된 라인은 원본에 남고, 기기현황의 AS 연결은 새 접수 코드로 옮겨집니다.</p>

        <div className="mb-4 flex gap-4 text-sm">
          <label className="inline-flex items-center gap-1.5"><input type="radio" name="split-mode" checked={mode === 'WARD'} onChange={() => setMode('WARD')} /> 병동별</label>
          <label className="inline-flex items-center gap-1.5"><input type="radio" name="split-mode" checked={mode === 'CATEGORY'} onChange={() => setMode('CATEGORY')} /> 구분별 ({AS_CATEGORY_LABELS[receipt.category as AsCategory] ?? receipt.category} → {otherLabel})</label>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}

        {mode === 'WARD' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-1.5 pr-2">병동</th><th className="py-1.5 pr-2">기기</th><th className="py-1.5 pr-2 text-center">원본에 남김</th><th className="py-1.5 pr-2 text-center">분리</th><th className="py-1.5">발송지 (새 접수)</th></tr></thead>
              <tbody>
                {wardGroups.map((g) => {
                  const isKeep = g.key === effectiveKeep
                  const on = !isKeep && effectiveChecked(g.key)
                  return (
                    <tr key={g.key} className={`border-b align-top ${isKeep ? 'bg-gray-50' : on ? 'bg-blue-50/40' : ''}`} data-testid={`split-ward-${g.key}`}>
                      <td className="py-2 pr-2 font-medium text-gray-800">{g.key}</td>
                      <td className="py-2 pr-2 text-xs text-gray-600"><span className="font-medium text-gray-800">{g.lines.length}대</span> <span className="font-mono">{g.lines.map((l) => l.serialNo).join(' ')}</span></td>
                      <td className="py-2 pr-2 text-center"><input type="radio" name="split-keep" checked={isKeep} onChange={() => setKeepKey(g.key)} /></td>
                      <td className="py-2 pr-2 text-center"><input type="checkbox" disabled={isKeep} checked={on} onChange={(e) => setChecked((p) => ({ ...(p ?? {}), [g.key]: e.target.checked }))} /></td>
                      <td className="py-2">
                        {isKeep ? <span className="text-xs text-gray-400">(원본 유지)</span> : (
                          <textarea rows={2} disabled={!on} value={dest[g.key] ?? receipt.destInfo ?? ''} onChange={(e) => setDest((p) => ({ ...p, [g.key]: e.target.value }))} className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-400`} placeholder="발송지 주소·수취인·연락처" />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {wardGroups.length < 2 && <p className="mt-2 text-xs text-amber-700">병동이 1개뿐이라 병동별 분할 대상이 없습니다. 라인 병동을 먼저 정리하거나 구분별 분할을 쓰세요.</p>}
          </div>
        ) : (
          <div>
            <p className={`${label} mb-1`}>체크한 라인 → <span className="font-semibold text-gray-800">{otherLabel}</span> 접수{otherCategory === 'LOST' ? ' (수거없음·수거 송장 없음)' : ''}</p>
            <div className="max-h-72 overflow-y-auto rounded-md border border-gray-200">
              {openLines.map((l) => {
                const draftWarn = otherCategory === 'LOST' && l.draftOutcome === 'REPAIR_RETURN'
                return (
                  <label key={l.id} className="flex cursor-pointer items-center gap-2 border-b px-2.5 py-1.5 text-sm last:border-b-0 hover:bg-gray-50" data-testid={`split-line-${l.serialNo}`}>
                    <input type="checkbox" checked={catSel.has(l.id)} onChange={(e) => setCatSel((p) => { const n = new Set(p); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n })} />
                    <span className="font-mono text-gray-800">{l.serialNo}</span>
                    <span className="text-xs text-gray-500">{l.deviceName ?? ''}{(l.placementWard ?? l.wardName) ? ` · ${l.placementWard ?? l.wardName}` : ''}{l.symptom ? ` · ${l.symptom}` : ''}</span>
                    {draftWarn && <span className="ml-auto text-xs text-amber-600" title="분실 접수는 수리반환을 선택할 수 없어 초안이 해제됩니다">초안 해제됨</span>}
                  </label>
                )
              })}
            </div>
            <div className="mt-2">
              <label className={label}>발송지 (새 접수)</label>
              <textarea rows={2} value={dest.__cat ?? receipt.destInfo ?? ''} onChange={(e) => setDest((p) => ({ ...p, __cat: e.target.value }))} className={`mt-1 ${inputCls}`} />
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            {mode === 'WARD'
              ? `새 접수 ${wardSelected.length}건 (${wardSelected.map((g) => `${g.lines.length}대`).join('·') || '-'}) · 원본 잔류 ${remainingWard}대`
              : `새 ${otherLabel} 접수 1건 ${catSel.size}대 · 원본 잔류 ${openLines.length - catSel.size}대`}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
            <button type="button" onClick={submit} disabled={!canSubmit || busy} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" data-testid="split-submit">
              {busy ? '분할 중…' : mode === 'WARD' ? `${wardSelected.length}건으로 분할` : `${otherLabel}로 분리`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
