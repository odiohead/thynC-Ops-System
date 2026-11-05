'use client'

import { useEffect, useState } from 'react'
import { ScanLine, Copy, Trash2 } from 'lucide-react'
import MobileHeader from '../_components/MobileHeader'
import BarcodeScanner, { type ScanFeedback } from '../_components/BarcodeScanner'
import { MButton, Notice, safeStorage } from '../_components/ui'
import { parseScan, visibleRaw } from '@/lib/scanParse'
import { lookupCode } from '../_components/stockApi'

/**
 * 라벨 실측 도구 (mobile_pwa_design.md §8 M2-0 게이트) — nav·탭 미노출, URL 직접 진입(/m/scan-test)
 * 실제 라벨을 찍어 디코더 원문·형식·파서 결과·DB 일치 여부를 모으고 [전체 복사]로 전달 → 파서 규칙·픽스처 확정.
 */
interface Sample {
  at: string
  format: string
  raw: string
  kind: string
  candidates: string[]
  gtin?: string
  lot?: string
  match: string
}
const KEY = 'm.scanTest.samples'

export default function ScanTestPage() {
  const [open, setOpen] = useState(false)
  const [samples, setSamples] = useState<Sample[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try { setSamples(JSON.parse(safeStorage.get(KEY) ?? '[]')) } catch { setSamples([]) }
  }, [])

  function save(next: Sample[]) {
    setSamples(next)
    safeStorage.set(KEY, JSON.stringify(next.slice(0, 200)))
  }

  async function onDetect(raw: string, format: string): Promise<ScanFeedback> {
    const p = parseScan(raw)
    let match = '—'
    try {
      const r = await lookupCode(raw)
      match = r.units.length > 0 ? r.units.map((u) => `${u.item.name}(${u.inventory.name}·${u.status})`).join(' / ') : 'DB 없음'
    } catch (e) {
      match = `조회 오류: ${e instanceof Error ? e.message : ''}`
    }
    const s: Sample = { at: new Date().toLocaleTimeString('ko-KR', { hour12: false }), format, raw, kind: p.kind, candidates: p.serialCandidates, gtin: p.gtin, lot: p.lot, match }
    save([s, ...samples])
    return { tone: match === 'DB 없음' ? 'warn' : 'ok', message: `${format} · ${p.kind} · ${p.serialCandidates[0] ?? '시리얼 없음'}` }
  }

  async function copyAll() {
    const text = samples
      .map((s) => [s.at, s.format, s.kind, JSON.stringify(s.raw), `후보=${s.candidates.join('|')}`, s.gtin ? `GTIN=${s.gtin}` : '', s.lot ? `LOT=${s.lot}` : '', `DB=${s.match}`].filter(Boolean).join('\t'))
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('복사하세요', text)
    }
  }

  return (
    <>
      <MobileHeader title="라벨 스캔 테스트" back />
      <main className="mx-auto max-w-lg space-y-4 p-4">
        <Notice>
          기기·박스 라벨을 하나씩 찍어 주세요. 인식 원문과 해석 결과가 쌓입니다. 다 찍으면 <b>전체 복사</b>로 개발 담당에게 전달합니다.
        </Notice>
        <MButton size="lg" className="w-full" onClick={() => setOpen(true)}><ScanLine size={22} /> 스캔 시작</MButton>
        <div className="flex gap-2">
          <MButton variant="outline" className="flex-1" onClick={() => void copyAll()} disabled={samples.length === 0}><Copy size={16} /> {copied ? '복사됨' : `전체 복사 (${samples.length})`}</MButton>
          <MButton variant="outline" onClick={() => { if (window.confirm('기록을 모두 지울까요?')) save([]) }} disabled={samples.length === 0} aria-label="지우기"><Trash2 size={16} /></MButton>
        </div>
        <ul className="space-y-2">
          {samples.map((s, i) => (
            <li key={i} className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground"><span>{s.format} · {s.kind}</span><span>{s.at}</span></div>
              <p className="mt-1 break-all font-mono text-xs">{visibleRaw(s.raw)}</p>
              <p className="mt-1">후보 <span className="font-mono">{s.candidates.join(' | ') || '—'}</span>{s.gtin && <> · GTIN <span className="font-mono">{s.gtin}</span></>}{s.lot && <> · LOT <span className="font-mono">{s.lot}</span></>}</p>
              <p className="mt-0.5 text-muted-foreground">{s.match}</p>
            </li>
          ))}
        </ul>
      </main>
      <BarcodeScanner open={open} onClose={() => setOpen(false)} onDetect={onDetect} title="라벨 스캔 테스트" counter={`${samples.length}건`} />
    </>
  )
}
