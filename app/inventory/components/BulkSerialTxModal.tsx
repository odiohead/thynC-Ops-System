'use client'

import { useState, useEffect, useMemo } from 'react'

interface Inventory { id: number; name: string; isActive: boolean }
interface Warehouse { id: number; name: string; inventoryId: number; isActive: boolean }
interface Reason { id: number; name: string }

interface BulkRow {
  row: number
  name: string
  serial: string
  lot: string
  status: 'ok' | 'error'
  message?: string
  itemCode?: string
}
interface Summary { total: number; ok: number; errors: number; items: number }
interface PreviewResult { rows: BulkRow[]; summary: Summary }

export default function BulkSerialTxModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [inReasons, setInReasons] = useState<Reason[]>([])
  const [outReasons, setOutReasons] = useState<Reason[]>([])

  const [txType, setTxType] = useState<'IN' | 'OUT'>('IN')
  const [inventoryId, setInventoryId] = useState<number | null>(null)
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [reasonId, setReasonId] = useState<number | null>(null)
  const [destination, setDestination] = useState('')
  const [requester, setRequester] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/inventories').then(async (r) => { if (r.ok) setInventories(((await r.json()).inventories ?? []).filter((i: Inventory) => i.isActive)) })
    fetch('/api/settings/warehouses').then(async (r) => { if (r.ok) setWarehouses((await r.json()).warehouses ?? []) })
    fetch('/api/settings/stock-in-type').then(async (r) => { if (r.ok) setInReasons((await r.json()).statusCodes ?? []) })
    fetch('/api/settings/stock-out-type').then(async (r) => { if (r.ok) setOutReasons((await r.json()).statusCodes ?? []) })
  }, [])

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.isActive && w.inventoryId === inventoryId),
    [warehouses, inventoryId],
  )
  const reasons = txType === 'IN' ? inReasons : outReasons
  const ready = !!file && !!inventoryId && !!warehouseId && !!reasonId && (txType !== 'OUT' || !!requester.trim())

  function resetPreview() { setPreview(null); setError(null); setDoneMsg(null) }

  function buildForm(): FormData {
    const fd = new FormData()
    fd.append('file', file!)
    fd.append('txType', txType)
    fd.append('warehouseId', String(warehouseId))
    fd.append('reasonId', String(reasonId))
    if (txType === 'OUT' && destination.trim()) fd.append('destination', destination.trim())
    if (requester.trim()) fd.append('requester', requester.trim())
    return fd
  }

  async function handlePreview() {
    if (!ready) return
    setBusy(true); setError(null)
    const res = await fetch('/api/inventory/transactions/bulk-serial?preview=true', { method: 'POST', body: buildForm() })
    const data = await res.json()
    if (res.ok) { setPreview(data); setErrorsOnly(data.summary.errors > 0) }
    else setError(data.error ?? '미리보기 실패')
    setBusy(false)
  }

  async function handleExecute() {
    if (!ready || !preview || preview.summary.errors > 0) return
    setBusy(true); setError(null)
    const res = await fetch('/api/inventory/transactions/bulk-serial', { method: 'POST', body: buildForm() })
    const data = await res.json()
    if (res.ok) {
      setDoneMsg(`전표 ${data.created.length}건 생성 완료 (품목 ${data.created.length}종, 시리얼 ${data.totalUnits}개)`)
      setPreview(null)
      setFile(null)
      onDone()
    } else {
      setError(data.error ?? '실행 실패')
      if (data.rows) setPreview({ rows: data.rows, summary: data.summary })
    }
    setBusy(false)
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const shownRows = preview ? preview.rows.filter((r) => !errorsOnly || r.status === 'error').slice(0, 300) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Excel 일괄 입출고 (시리얼 품목)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          A열=품목명, B열=시리얼번호, C열=LOT번호 (1행은 헤더로 무시) · <b>시리얼 관리 품목만</b> 처리됩니다 ·
          품목명은 선택한 인벤토리의 품목과 정확히 일치해야 하며, 품목별로 전표가 1건씩 생성됩니다. 오류가 1건이라도 있으면 전체가 실행되지 않습니다.
          C열은 <b>LOT 관리 품목의 입고 시 필수</b>이고, 출고 시에는 값이 있으면 개체의 LOT과 대조 검증합니다.
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">구분</label>
            <div className="flex gap-1">
              {(['IN', 'OUT'] as const).map((t) => (
                <button key={t} onClick={() => { setTxType(t); setReasonId(null); resetPreview() }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${txType === t ? (t === 'IN' ? 'border-green-600 bg-green-50 text-green-700' : 'border-red-600 bg-red-50 text-red-700') : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                  {t === 'IN' ? '입고' : '출고'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">{txType === 'IN' ? '입고' : '출고'} 유형</label>
            <select value={reasonId ?? ''} onChange={(e) => { setReasonId(e.target.value ? parseInt(e.target.value) : null); resetPreview() }} className={inputCls}>
              <option value="">선택</option>
              {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">인벤토리</label>
            <select value={inventoryId ?? ''} onChange={(e) => { setInventoryId(e.target.value ? parseInt(e.target.value) : null); setWarehouseId(null); resetPreview() }} className={inputCls}>
              <option value="">선택</option>
              {inventories.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">위치</label>
            <select value={warehouseId ?? ''} onChange={(e) => { setWarehouseId(e.target.value ? parseInt(e.target.value) : null); resetPreview() }} className={inputCls} disabled={!inventoryId}>
              <option value="">선택</option>
              {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className={txType === 'OUT' ? '' : 'col-span-2'}>
            <label className="mb-1 block text-xs font-medium text-gray-500">요청자 {txType === 'OUT' ? '(필수)' : '(선택)'}</label>
            <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder={txType === 'OUT' ? '예: 대웅 홍길동, 자체 처리' : '요청자가 있으면 입력'} className={inputCls} />
          </div>
          {txType === 'OUT' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">출고처 (선택)</label>
              <input value={destination} onChange={(e) => { setDestination(e.target.value) }} placeholder="예: OO병원, 유관부서" className={inputCls} />
            </div>
          )}
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-500">Excel 파일 (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); resetPreview() }}
              className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
        </div>

        {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {doneMsg && <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{doneMsg}</div>}

        {preview && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <div>
                총 <b>{preview.summary.total}</b>행 · 정상 <b className="text-blue-600">{preview.summary.ok}</b>행 (품목 {preview.summary.items}종) ·
                오류 <b className={preview.summary.errors > 0 ? 'text-red-600' : 'text-gray-500'}>{preview.summary.errors}</b>행
              </div>
              {preview.summary.errors > 0 && (
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> 오류 행만 보기
                </label>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2">행</th>
                    <th className="px-3 py-2">품목명</th>
                    <th className="px-3 py-2">시리얼번호</th>
                    <th className="px-3 py-2">LOT</th>
                    <th className="px-3 py-2">결과</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shownRows.map((r) => (
                    <tr key={r.row} className={r.status === 'error' ? 'bg-red-50' : ''}>
                      <td className="px-3 py-1.5 text-gray-400">{r.row}</td>
                      <td className="px-3 py-1.5">{r.name}{r.itemCode && <span className="ml-1 text-xs text-gray-400">{r.itemCode}</span>}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.serial}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{r.lot || '-'}</td>
                      <td className="px-3 py-1.5">
                        {r.status === 'ok' ? <span className="text-green-600">정상</span> : <span className="text-red-600">{r.message}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shownRows.length === 300 && <div className="px-3 py-2 text-center text-xs text-gray-400">최대 300행까지 표시</div>}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">닫기</button>
          {!preview ? (
            <button onClick={handlePreview} disabled={!ready || busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? '분석 중...' : '미리보기'}
            </button>
          ) : (
            <button onClick={handleExecute} disabled={busy || preview.summary.errors > 0 || preview.summary.ok === 0}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${txType === 'IN' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
              {busy ? '처리 중...' : `${preview.summary.ok}건 ${txType === 'IN' ? '입고' : '출고'} 실행`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
