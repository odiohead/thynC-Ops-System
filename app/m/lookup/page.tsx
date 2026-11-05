'use client'

import { useState } from 'react'
import { ScanLine, Search, ExternalLink } from 'lucide-react'
import MobileHeader from '../_components/MobileHeader'
import BarcodeScanner, { type ScanFeedback } from '../_components/BarcodeScanner'
import UnitCard from '../_components/UnitCard'
import { MButton, MInput, Notice, Section, errMsg } from '../_components/ui'
import { lookupCode, type LookupResult } from '../_components/stockApi'

/**
 * 시리얼 조회 (mobile_pwa_design.md §2-4) — 스캔 한 번으로 개체의 인벤토리·위치·상태 확인. 로그인 사용자 전원, 읽기 전용.
 * 스캐너는 1건 인식하면 닫고 결과를 보여준다.
 */
export default function MobileLookupPage() {
  const [scanOpen, setScanOpen] = useState(false)
  const [manual, setManual] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<LookupResult | null>(null)

  async function run(raw: string): Promise<ScanFeedback> {
    setLoading(true); setError('')
    try {
      const r = await lookupCode(raw)
      setResult(r)
      setScanOpen(false)
      return r.units.length > 0 ? { tone: 'ok', message: `${r.units.length}건 찾음` } : { tone: 'warn', message: '등록된 개체 없음' }
    } catch (e) {
      setError(errMsg(e))
      return { tone: 'error', message: errMsg(e) }
    } finally {
      setLoading(false)
    }
  }

  const p = result?.parsed

  return (
    <>
      <MobileHeader title="시리얼 조회" />
      <main className="mx-auto max-w-lg space-y-4 p-4">
        <MButton size="lg" className="w-full" onClick={() => setScanOpen(true)}>
          <ScanLine size={22} /> 바코드 스캔
        </MButton>
        <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) void run(manual.trim()) }} className="flex gap-2">
          <MInput value={manual} onChange={(e) => setManual(e.target.value)} placeholder="시리얼 직접 입력" autoCapitalize="characters" autoCorrect="off" className="font-mono" />
          <MButton type="submit" variant="outline" className="h-12 w-14 shrink-0 px-0" disabled={loading} aria-label="조회"><Search size={20} /></MButton>
        </form>

        {loading && <p className="px-1 text-sm text-muted-foreground">조회 중…</p>}
        {error && <Notice tone="error">{error}</Notice>}

        {result && p && (
          <>
            <Section title="인식 결과">
              <dl className="grid grid-cols-[4.5rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted-foreground">시리얼</dt><dd className="break-all font-mono">{p.serialCandidates[0] ?? '—'}</dd>
                {p.gtin && (<><dt className="text-muted-foreground">GTIN</dt><dd className="font-mono">{p.gtin}</dd></>)}
                {p.lot && (<><dt className="text-muted-foreground">LOT</dt><dd className="font-mono">{p.lot}</dd></>)}
                {p.expiry && (<><dt className="text-muted-foreground">유효기한</dt><dd className="font-mono">{p.expiry}</dd></>)}
              </dl>
            </Section>

            {result.units.length === 0 ? (
              <Notice tone="warning">자재관리에 등록된 개체가 없습니다.</Notice>
            ) : (
              <div className="space-y-2">
                {result.units.length > 1 && <p className="px-1 text-xs text-muted-foreground">같은 시리얼이 {result.units.length}개 품목에 있습니다 (인벤토리 간 이관 이력).</p>}
                {result.units.map((u) => (
                  <div key={u.id} className="space-y-1">
                    <UnitCard unit={u} />
                    <a href={`/inventory/${u.inventory.id}/items/${u.item.id}`} className="flex items-center justify-end gap-1 px-1 text-xs text-primary">
                      PC 화면에서 품목 보기 <ExternalLink size={12} />
                    </a>
                  </div>
                ))}
              </div>
            )}

            {result.gtinItems.length > 0 && (
              <Section title="이 GTIN(UDI-DI)의 품목">
                <ul className="space-y-1 text-sm">
                  {result.gtinItems.map((it) => (
                    <li key={it.id} className="flex justify-between gap-2"><span className="truncate">{it.name}</span><span className="shrink-0 text-muted-foreground">{it.inventory.name}</span></li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </main>

      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetect={run} title="시리얼 조회" />
    </>
  )
}
