'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface LedgerModel {
  modelName: string
  ledgerName: string
  productClass: string | null
  materialNo: string | null
  packUnit: string
  udiList: string[]
  itemIds: number[]
  itemCount: number
  inventoryNames: string[]
  hasConflict: boolean
}

interface LedgerRow {
  txId: number
  txCode: string
  date: string
  udi: string
  productName: string
  lotNo: string
  quantity: number
  counterpart: string
  note: string
  checked: boolean
}

interface StockRow {
  udi: string
  lotNo: string
  remain: number
}

interface Ledger {
  model: LedgerModel
  header: { modelName: string; productClass: string; materialNo: string }
  inRows: LedgerRow[]
  outRows: LedgerRow[]
  inTotal: number
  outTotal: number
  stockRows: StockRow[]
  currentStock: number
  itemIds: number[]
  inventoryNames: string[]
}

interface Inventory {
  id: number
  name: string
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function UdiLedgerPage() {
  const [models, setModels] = useState<LedgerModel[]>([])
  const [inventories, setInventories] = useState<Inventory[]>([])

  const [modelName, setModelName] = useState('')
  const [invIds, setInvIds] = useState<number[]>([])

  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invQuery = invIds.length ? `&inventoryIds=${invIds.join(',')}` : ''

  useEffect(() => {
    ;(async () => {
      const [mRes, iRes] = await Promise.all([
        fetch('/api/inventory/ledger'),
        fetch('/api/settings/inventories'),
      ])
      if (!mRes.ok) {
        setError((await mRes.json()).error ?? '조회 권한이 없습니다.')
        setLoading(false)
        return
      }
      setModels((await mRes.json()).models ?? [])
      if (iRes.ok) setInventories((await iRes.json()).inventories ?? [])
      setLoading(false)
    })()
  }, [])

  const loadLedger = useCallback(async (model: string, query: string) => {
    if (!model) { setLedger(null); return }
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/inventory/ledger?modelName=${encodeURIComponent(model)}${query}`)
    const data = await res.json()
    if (res.ok) setLedger(data.ledger)
    else { setLedger(null); setError(data.error) }
    setBusy(false)
  }, [])

  // 모델·인벤토리 필터가 바뀌면 다시 조회
  useEffect(() => {
    if (modelName) loadLedger(modelName, invQuery)
  }, [modelName, invQuery, loadLedger])

  async function toggleCheck(row: LedgerRow) {
    setBusy(true)
    const res = await fetch('/api/inventory/ledger/check', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: row.txId, lotNo: row.lotNo, checked: !row.checked }),
    })
    if (res.ok) {
      setLedger((l) =>
        l && {
          ...l,
          inRows: l.inRows.map((r) =>
            r.txId === row.txId && r.lotNo === row.lotNo ? { ...r, checked: !r.checked } : r,
          ),
        },
      )
    } else {
      setError((await res.json()).error)
    }
    setBusy(false)
  }

  const downloadUrl = ledger
    ? `/api/inventory/ledger/docx?modelName=${encodeURIComponent(ledger.model.modelName)}${invQuery}`
    : '#'

  function toggleInv(id: number) {
    setInvIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">입출고대장</h1>
          <p className="mt-1 text-sm text-gray-500">
            모델별 1부로 관리하는 GMP 품질기록(F707-1)입니다. 문서 안의 각 행은 UDI · LOT 단위로 구분됩니다.
          </p>
        </div>
        <Link href="/inventory" className="text-sm text-gray-500 no-underline hover:text-gray-800">
          ← 자재 현황
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* 조회 조건 */}
      <div className="mb-5 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label className="mb-1 block text-xs font-medium text-gray-700">모델</label>
        <select value={modelName} onChange={(e) => setModelName(e.target.value)} className={inputCls} disabled={loading}>
          <option value="">선택하세요</option>
          {models.map((m) => (
            <option key={m.modelName} value={m.modelName}>
              {m.ledgerName}
              {m.ledgerName !== m.modelName ? ` (${m.modelName})` : ''} — UDI {m.udiList.length}종 · 품목 {m.itemCount}개
            </option>
          ))}
        </select>
        {models.length === 0 && !loading && (
          <p className="mt-1 text-xs text-amber-600">
            UDI가 등록된 품목이 없습니다. 자재관리 &gt; 품목 관리에서 품목에 UDI-DI를 입력하세요.
          </p>
        )}

        {inventories.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <span className="mb-2 block text-xs font-medium text-gray-700">
              인벤토리 필터 <span className="font-normal text-gray-400">(미선택 = 전체 합산)</span>
            </span>
            <div className="flex flex-wrap gap-3">
              {inventories.map((inv) => (
                <label key={inv.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={invIds.includes(inv.id)}
                    onChange={() => toggleInv(inv.id)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {inv.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {busy && !ledger && <p className="py-10 text-center text-sm text-gray-400">불러오는 중...</p>}

      {ledger && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-600">
              <span className="font-medium text-gray-900">{ledger.header.modelName}</span>
              <span className="mx-1.5 text-gray-300">·</span>
              UDI {ledger.model.udiList.length}종
              {ledger.inventoryNames.length > 0 && (
                <span className="ml-1.5 text-xs text-gray-400">({ledger.inventoryNames.join(', ')})</span>
              )}
            </div>
            <a
              href={downloadUrl}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white no-underline transition-colors hover:bg-blue-700"
            >
              docx 다운로드
            </a>
          </div>

          {ledger.model.hasConflict && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
              이 모델에 묶인 품목들의 대장 표기 정보(표기명·품명 구분·원자재식별 NO)가 서로 다릅니다. UDI 정보는 품목마다
              입력하므로 인벤토리별로 값이 어긋날 수 있습니다 — 품목 관리에서 맞춰주세요. 문서에는 첫 번째 값이 사용됩니다.
            </p>
          )}

          {/* 헤더 표 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <th className="w-32 bg-gray-50 px-4 py-2 text-left text-xs font-medium text-gray-500">모델명</th>
                  <td className="px-4 py-2 text-gray-900">{ledger.header.modelName}</td>
                </tr>
                <tr>
                  <th className="bg-gray-50 px-4 py-2 text-left text-xs font-medium text-gray-500">품 명</th>
                  <td className="px-4 py-2 text-gray-900">
                    {ledger.header.productClass || <span className="text-gray-400">미지정</span>}
                  </td>
                </tr>
                <tr>
                  <th className="bg-gray-50 px-4 py-2 text-left text-xs font-medium text-gray-500">원자재식별 NO</th>
                  <td className="px-4 py-2 text-gray-900">{ledger.header.materialNo}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <LedgerTable
            title="입고정보"
            total={ledger.inTotal}
            columns={['입고일자', 'UDI', '상품명', 'LOT NO', '입고수량', '발송처정보', '동일 LOT NO 제품 출고완료']}
            rows={ledger.inRows}
            renderLast={(row) => (
              <label className="flex items-center justify-center gap-1.5">
                <input
                  type="checkbox"
                  checked={row.checked}
                  onChange={() => toggleCheck(row)}
                  disabled={busy}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-500">{row.checked ? '확인' : ''}</span>
              </label>
            )}
          />

          <LedgerTable
            title="출고정보"
            total={ledger.outTotal}
            columns={['출고일자', 'UDI', '상품명', 'LOT NO', '출고수량', '입고처정보', '비고']}
            rows={ledger.outRows}
            renderLast={(row) => <span className="text-xs text-gray-500">{row.note}</span>}
          />

          {/* 현재고 — 문서에는 총합만 인쇄되고, 화면에서는 UDI×LOT 소계를 함께 보여준다 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
              <h2 className="text-sm font-semibold text-gray-800">비고 — 현재고</h2>
              <span className="text-sm font-medium text-gray-900">{ledger.currentStock.toLocaleString()}개</span>
            </div>
            {ledger.stockRows.length > 0 && (
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">UDI</th>
                    <th className="px-3 py-2 text-left font-medium">LOT NO</th>
                    <th className="px-3 py-2 text-right font-medium">잔량</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ledger.stockRows.map((s) => (
                    <tr key={`${s.udi}-${s.lotNo}`}>
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-600">{s.udi}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-600">{s.lotNo || '(LOT 없음)'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-900">{s.remain.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-xs text-gray-400">
            입고 {ledger.inTotal.toLocaleString()} − 출고 {ledger.outTotal.toLocaleString()} ={' '}
            {(ledger.inTotal - ledger.outTotal).toLocaleString()}
            {ledger.inTotal - ledger.outTotal !== ledger.currentStock && (
              <span className="ml-1 text-amber-600">
                — 현재고({ledger.currentStock.toLocaleString()})와 다릅니다. 시스템 등록 이전 이력이 있는 LOT이거나 기간
                필터가 적용된 경우입니다.
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

function LedgerTable({
  title,
  columns,
  rows,
  total,
  renderLast,
}: {
  title: string
  columns: string[]
  rows: LedgerRow[]
  total: number
  renderLast: (row: LedgerRow) => React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        <span className="text-xs text-gray-500">
          {rows.length}건 · 합계 {total.toLocaleString()}
        </span>
      </div>
      <div className="max-h-[28rem] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
            <tr>
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 text-left font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-sm text-gray-400">
                  내역이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.txId}-${row.lotNo}`} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-700">{row.date}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                    {row.udi || <span className="text-gray-300">미등록</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-900">{row.productName}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">{row.lotNo || '-'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                    {row.quantity.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {row.counterpart || <span className="text-gray-300">-</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center">{renderLast(row)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
