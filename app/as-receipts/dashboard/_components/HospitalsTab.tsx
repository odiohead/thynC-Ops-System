'use client'

/**
 * AS 대시보드 ③ 병원별 — "어느 병원에서 많이 발생하나, 한도는 괜찮은가"
 * 병원 미선택: 기간 내 접수 병원 표(정렬·검색·한도 초과/미완료 필터·CSV). 병원 선택: 그 병원의 한도 현황·병동별 대수·기간 내 접수 목록.
 * 한도(분실 10%·라이트 교체 100%)와 미완료·배치 기기는 기간과 무관한 조회 시점/누적 값이다.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { AsDashHospitals, AsDashHospitalRow, AsDashHospitalDetail } from '@/lib/asDashboard'
import { AS_LOST_QUOTA_PCT, AS_LITE_REPLACE_QUOTA_PCT } from '@/lib/asReceiptShared'
import { Section, StatStrip, asListHref, CATEGORY_LABEL, CATEGORY_BADGE, num, days, pct, th, thR, td, tdR, EmptyRow, type DashQuery } from './parts'

type SortKey = 'name' | 'receipts' | 'devices' | 'faultDevices' | 'lostDevices' | 'ecg' | 'spo2' | 'replaced' | 'leadMedian' | 'openNow' | 'deployed' | 'ratio' | 'quota'
const PAGE_SIZE = 25

/** 한도 정렬값 — 분실·라이트 중 더 높은 사용률(%) */
const quotaScore = (r: AsDashHospitalRow) => Math.max(-1, ...(r.lost?.groups.map((g) => g.pct ?? -1) ?? []), ...(r.lite?.groups.map((g) => g.pct ?? -1) ?? []))
const sortValue = (r: AsDashHospitalRow, k: SortKey): number | string | null => (k === 'quota' ? quotaScore(r) : k === 'name' ? r.name : r[k])

function QuotaCell({ row }: { row: AsDashHospitalRow }) {
  const parts: { key: string; text: string; over: boolean; title: string }[] = []
  if (row.lost) {
    const top = [...row.lost.groups].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))[0]
    parts.push({
      key: 'lost', over: row.lost.over,
      text: `분실 ${top.pct === null ? `${row.lost.provided}대` : `${top.pct}%`}`,
      title: `분실 기기 제공 누계 / 구매수량 (한도 ${AS_LOST_QUOTA_PCT}%)\n` + row.lost.groups.map((g) => `${g.group} ${g.provided} / ${g.purchased ?? '구매수량 미등록'}${g.pct !== null ? ` (${g.pct}%)` : ''}${g.over ? ' — 초과' : ''}`).join('\n'),
    })
  }
  if (row.lite) {
    const top = [...row.lite.groups].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))[0]
    parts.push({
      key: 'lite', over: row.lite.over,
      text: `라이트 ${top.pct === null ? `${row.lite.replaced}대` : `${top.pct}%`}`,
      title: `라이트형 고장 교체 누계 / 라이트 도입 수량 (한도 ${AS_LITE_REPLACE_QUOTA_PCT}%)\n` + row.lite.groups.map((g) => `${g.group} ${g.replaced} / ${g.introduced ?? '도입 수량 미등록'}${g.pct !== null ? ` (${g.pct}%)` : ''}${g.over ? ' — 초과' : ''}`).join('\n'),
    })
  }
  if (!parts.length) return <span className="text-gray-300">—</span>
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {parts.map((p) => (
        <span key={p.key} title={p.title} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${p.over ? 'bg-red-100 font-semibold text-red-700' : 'bg-gray-100 text-gray-600'}`}>{p.text}{p.over ? ' 초과' : ''}</span>
      ))}
    </span>
  )
}

function csvOf(rows: AsDashHospitalRow[], range: { from: string; to: string }): string {
  const head = ['병원코드', '병원', '접수(건)', '기기(대)', '고장(대)', '분실(대)', '심전계(대)', '산소포화도(대)', '교체(대)', '접수→발송 중앙값(일)', '미완료(건·조회 시점)', '배치 기기(대)', '배치 100대당 접수', '분실 제공 누계(대)', '분실 한도 초과', '라이트 교체 누계(대)', '라이트 한도 초과']
  const esc = (v: string | number | null) => { const s = v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = rows.map((r) => [r.hospitalCode, r.name, r.receipts, r.devices, r.faultDevices, r.lostDevices, r.ecg, r.spo2, r.replaced, r.leadMedian, r.openNow, r.deployed, r.ratio, r.lost?.provided ?? '', r.lost ? (r.lost.over ? 'Y' : 'N') : '', r.lite?.replaced ?? '', r.lite ? (r.lite.over ? 'Y' : 'N') : ''].map(esc).join(','))
  return `﻿# AS 병원별 현황 ${range.from}~${range.to}\n${head.join(',')}\n${lines.join('\n')}\n`
}

export default function HospitalsTab({ data, q, onPickHospital, onClearHospital }: {
  data: AsDashHospitals; q: DashQuery
  onPickHospital: (h: { hospitalCode: string; hospitalName: string }) => void
  onClearHospital: () => void
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'devices', dir: 'desc' })
  const [search, setSearch] = useState('')
  const [onlyOver, setOnlyOver] = useState(false)
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = data.rows.filter((r) => (!needle || r.name.toLowerCase().includes(needle)) && (!onlyOver || r.lost?.over || r.lite?.over) && (!onlyOpen || r.openNow > 0))
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sort.key); const bv = sortValue(b, sort.key)
      if (av === null && bv === null) return a.name.localeCompare(b.name, 'ko')
      if (av === null) return 1 // 값 없는 병원은 방향과 무관하게 뒤로
      if (bv === null) return -1
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv), 'ko') * dir
      return (av - bv) * dir || a.name.localeCompare(b.name, 'ko')
    })
  }, [data.rows, search, onlyOver, onlyOpen, sort])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, totalPages)
  const pageRows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)

  const header = (key: SortKey, label: string, right = true, title?: string) => (
    <th className={right ? thR : th} title={title} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="inline-flex items-center gap-0.5 hover:text-gray-900" onClick={() => { setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'name' ? 'asc' : 'desc' })); setPage(1) }}>
        {label}<span className="text-[10px] text-blue-600">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )
  const download = () => {
    const blob = new Blob([csvOf(filtered, data.range)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `AS_병원별_${data.range.from}_${data.range.to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (data.detail) return <HospitalDetail detail={data.detail} row={data.rows.find((r) => r.hospitalCode === data.detail!.hospitalCode) ?? null} data={data} q={q} onClear={onClearHospital} />

  const t = data.totals
  return (
    <div className="space-y-4">
      <StatStrip cells={[
        { label: '접수 병원', value: num(t.hospitals), unit: '곳', sub: `${data.range.from} ~ ${data.range.to}` },
        { label: '접수', value: num(t.receipts), unit: '건', sub: `기기 ${num(t.devices)}대 (고장 ${num(t.faultDevices)} · 분실 ${num(t.lostDevices)})` },
        { label: '교체 (고장)', value: num(t.replaced), unit: '대', sub: '기간 내 접수 기기 중 교체 확정' },
        { label: '미완료 (조회 시점)', value: num(t.openNow), unit: '건', sub: '완료·취소가 아닌 접수' },
        { label: '분실 한도 초과', value: num(t.lostOver), unit: '곳', sub: `분실 제공 누계 > 구매수량의 ${AS_LOST_QUOTA_PCT}%`, alert: t.lostOver > 0, title: '기간과 무관한 누적 기준 — AS 접수 상세·병원 상세와 같은 산식' },
        { label: '라이트 한도 초과', value: num(t.liteOver), unit: '곳', sub: `라이트 교체 누계 > 도입 수량의 ${AS_LITE_REPLACE_QUOTA_PCT}%`, alert: t.liteOver > 0, title: '기간과 무관한 누적 기준 — AS 접수 상세 "도입·AS 교체 현황"과 같은 산식' },
      ]} />

      <Section
        title="병원별 접수 현황"
        hint="병원명을 누르면 그 병원의 한도·병동별·접수 목록을 봅니다. 열 제목을 누르면 정렬됩니다. 한도·미완료·배치 기기는 기간과 무관한 현재 값입니다."
        right={<>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="병원명 검색" className="h-8 w-40 rounded-md border border-gray-300 px-2 text-sm" aria-label="병원명 검색" />
          <label className="inline-flex items-center gap-1 text-xs text-gray-700"><input type="checkbox" checked={onlyOver} onChange={(e) => { setOnlyOver(e.target.checked); setPage(1) }} />한도 초과만</label>
          <label className="inline-flex items-center gap-1 text-xs text-gray-700"><input type="checkbox" checked={onlyOpen} onChange={(e) => { setOnlyOpen(e.target.checked); setPage(1) }} />미완료 있는 병원만</label>
          <button type="button" onClick={download} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50" title="현재 조건·정렬 그대로 CSV(엑셀) 내려받기">CSV</button>
        </>}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead><tr className="border-b border-gray-200">
              {header('name', '병원', false)}
              {header('receipts', '접수(건)')}
              {header('devices', '기기(대)')}
              {header('faultDevices', '고장')}
              {header('lostDevices', '분실')}
              {header('ecg', '심전계')}
              {header('spo2', '산소포화도')}
              {header('replaced', '교체', true, '기간 내 고장 접수 기기 중 교체 확정 대수')}
              {header('leadMedian', '접수→발송', true, '기간 안에 발송된 기기의 접수일→발송일 중앙값(달력일)')}
              {header('openNow', '미완료', true, '조회 시점 기준 완료·취소가 아닌 접수 건수')}
              {header('deployed', '배치 기기', true, '기기현황의 현재 배치(ACTIVE) 대수')}
              {header('ratio', '100대당', true, '기간 내 접수 기기 ÷ 현재 배치 기기 × 100')}
              {header('quota', '한도', true, `분실 제공 한도 ${AS_LOST_QUOTA_PCT}% · 라이트 교체 한도 ${AS_LITE_REPLACE_QUOTA_PCT}% (누적)`)}
            </tr></thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.hospitalCode} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className={`${td} max-w-[16rem] truncate`}><button type="button" onClick={() => onPickHospital({ hospitalCode: r.hospitalCode, hospitalName: r.name })} className="text-left font-medium text-blue-600 hover:underline" title={r.name}>{r.name}</button></td>
                  <td className={tdR}>{num(r.receipts)}</td>
                  <td className={`${tdR} font-semibold text-gray-900`}>{num(r.devices)}</td>
                  <td className={tdR}>{num(r.faultDevices)}</td>
                  <td className={tdR}>{num(r.lostDevices)}</td>
                  <td className={tdR}>{num(r.ecg)}</td>
                  <td className={tdR}>{num(r.spo2)}</td>
                  <td className={tdR}>{num(r.replaced)}</td>
                  <td className={tdR} title={r.leadN ? `발송 기기 ${r.leadN}대` : undefined}>{days(r.leadMedian)}</td>
                  <td className={`${tdR} ${r.openNow > 0 ? '' : 'text-gray-400'}`}>{num(r.openNow)}</td>
                  <td className={`${tdR} text-gray-500`}>{num(r.deployed)}</td>
                  <td className={tdR} title={r.deployed > 0 && r.deployed < data.ratioMinDeployed ? `배치 ${data.ratioMinDeployed}대 미만 — 비율이 크게 흔들릴 수 있음` : undefined}>{r.deployed > 0 && r.devices > 0 ? <span className={r.deployed < data.ratioMinDeployed ? 'text-gray-400' : ''}>{r.ratio}</span> : <span className="text-gray-300">—</span>}</td>
                  <td className={tdR}><QuotaCell row={r} /></td>
                </tr>
              ))}
              {pageRows.length === 0 && <EmptyRow cols={13} text={data.rows.length ? '조건에 맞는 병원이 없습니다' : '기간 내 접수가 없습니다'} />}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>{num(filtered.length)}곳{filtered.length !== data.rows.length ? ` (전체 ${num(data.rows.length)}곳 중)` : ''} · 한도 초과 병원은 기간 내 접수가 없어도 표에 나옵니다</span>
          {totalPages > 1 && (
            <span className="inline-flex items-center gap-2">
              <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 disabled:opacity-40">이전</button>
              <span className="tabular-nums">{cur} / {totalPages}</span>
              <button type="button" disabled={cur >= totalPages} onClick={() => setPage(cur + 1)} className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 disabled:opacity-40">다음</button>
            </span>
          )}
        </div>
      </Section>
    </div>
  )
}

/** 병원 1곳 — 한도 현황 · 병동별 접수 대수 · 기간 내 접수 목록 */
function HospitalDetail({ detail, row, data, q, onClear }: { detail: AsDashHospitalDetail; row: AsDashHospitalRow | null; data: AsDashHospitals; q: DashQuery; onClear: () => void }) {
  const { lostQuota, dealQuota } = detail
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
        <p className="text-sm text-gray-900"><span className="font-semibold">{detail.name}</span> <span className="text-gray-600">· {data.range.from} ~ {data.range.to}</span></p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link prefetch={false} href={`/hospitals/${detail.hospitalCode}`} className="text-blue-700 hover:underline">병원 상세 →</Link>
          <Link prefetch={false} href={asListHref(q, { period: true, hospitalName: detail.name })} className="text-blue-700 hover:underline">AS 접수 목록 →</Link>
          <button type="button" onClick={onClear} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">← 전체 병원</button>
        </div>
      </div>

      <StatStrip cells={[
        { label: '접수', value: num(row?.receipts ?? 0), unit: '건', sub: `기기 ${num(row?.devices ?? 0)}대` },
        { label: '고장 / 분실', value: `${num(row?.faultDevices ?? 0)} / ${num(row?.lostDevices ?? 0)}`, unit: '대', sub: `심전계 ${num(row?.ecg ?? 0)} · 산소포화도 ${num(row?.spo2 ?? 0)}` },
        { label: '교체 (고장)', value: num(row?.replaced ?? 0), unit: '대', sub: '기간 내 접수 기기 중 교체 확정' },
        { label: '접수→발송', value: row?.leadMedian === null || row?.leadMedian === undefined ? '—' : String(row.leadMedian), unit: row?.leadMedian === null || row?.leadMedian === undefined ? undefined : '일', sub: row?.leadN ? `중앙값 · 발송 ${num(row.leadN)}대` : '기간 내 발송 없음' },
        { label: '미완료 (조회 시점)', value: num(row?.openNow ?? 0), unit: '건', sub: '완료·취소가 아닌 접수' },
        { label: '배치 기기', value: num(row?.deployed ?? 0), unit: '대', sub: row && row.deployed > 0 && row.devices > 0 ? `100대당 접수 ${row.ratio}대` : '기기현황 현재 배치' },
      ]} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="한도 현황 (누적)" hint="기간과 무관한 누적 값 — AS 접수 상세 '구분'·'도입·AS 교체 현황'과 같은 숫자입니다" className="overflow-x-auto">
          <p className="mb-1 text-xs font-medium text-gray-700">분실 기기 제공 — 구매수량의 {lostQuota.thresholdPct}%까지</p>
          <table className="mb-4 w-full min-w-[380px]">
            <thead><tr className="border-b border-gray-200"><th className={th}>기기군</th><th className={thR}>제공 누계</th><th className={thR}>구매수량</th><th className={thR}>사용률</th><th className={thR}>한도</th></tr></thead>
            <tbody>
              {lostQuota.groups.map((g) => (
                <tr key={g.group} className="border-b border-gray-100">
                  <td className={td}>{g.group}</td>
                  <td className={tdR}>{num(g.before)}대</td>
                  <td className={tdR}>{g.purchased === null ? <span className="text-gray-400">미등록</span> : `${num(g.purchased)}대`}</td>
                  <td className={`${tdR} ${g.overBefore ? 'font-semibold text-red-600' : ''}`}>{pct(g.pctBefore)}</td>
                  <td className={tdR}>{g.overBefore ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">초과</span> : g.purchased === null ? <span className="text-gray-300">—</span> : <span className="text-xs text-gray-500">이내</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mb-1 text-xs font-medium text-gray-700">고장 교체 누계 / 도입 수량 — 라이트형은 도입 수량의 {dealQuota.liteThresholdPct}%까지</p>
          <table className="w-full">
            <thead><tr className="border-b border-gray-200"><th className={th}>상품유형</th><th className={thR}>심전계</th><th className={thR}>산소포화도</th></tr></thead>
            <tbody>
              {dealQuota.rows.map((r) => (
                <tr key={r.productType} className="border-b border-gray-100">
                  <td className={td}>{r.productType}{!r.hasDeal && <span className="ml-1 text-xs text-gray-400">(계약완료 딜 없음)</span>}</td>
                  {(['심전계', '산소포화도'] as const).map((g) => {
                    const c = r.cells[g]
                    return <td key={g} className={`${tdR} ${c.overBefore ? 'font-semibold text-red-600' : ''}`}>{num(c.before)} / {c.introduced === null ? '—' : num(c.introduced)}{c.pctBefore !== null && <span className="ml-1 text-xs text-gray-500">({c.pctBefore}%)</span>}{c.overBefore && <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-xs font-semibold text-red-700">초과</span>}</td>
                  })}
                </tr>
              ))}
              {dealQuota.rows.length === 0 && <EmptyRow cols={3} text="계약완료 딜·고장 교체 이력이 없습니다" />}
            </tbody>
          </table>
        </Section>

        <Section title="병동별 접수 대수" hint="접수 때 적힌 병동 기준 (기기현황의 배치 병동과 다를 수 있음)">
          <div className="max-h-80 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-white"><tr className="border-b border-gray-200"><th className={th}>병동</th><th className={thR}>기기</th><th className={thR}>고장</th><th className={thR}>분실</th><th className={thR}>심전계</th><th className={thR}>산소포화도</th></tr></thead>
              <tbody>
                {detail.wards.map((w) => (
                  <tr key={w.ward} className="border-b border-gray-100">
                    <td className={td}>{w.ward}</td><td className={`${tdR} font-semibold text-gray-900`}>{num(w.devices)}</td><td className={tdR}>{num(w.fault)}</td><td className={tdR}>{num(w.lost)}</td><td className={tdR}>{num(w.ecg)}</td><td className={tdR}>{num(w.spo2)}</td>
                  </tr>
                ))}
                {detail.wards.length === 0 && <EmptyRow cols={6} text="기간 내 접수가 없습니다" />}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section title="기간 내 접수" hint={detail.receiptsTotal > detail.receipts.length ? `최근 ${detail.receipts.length}건 표시 (전체 ${num(detail.receiptsTotal)}건 — 나머지는 AS 접수 목록에서)` : `${num(detail.receiptsTotal)}건 · 취소 접수 제외`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-gray-200"><th className={th}>접수번호</th><th className={th}>접수일</th><th className={th}>구분</th><th className={th}>상태</th><th className={thR}>기기</th><th className={th}>처리 결과</th><th className={th}>최근 발송일</th></tr></thead>
            <tbody>
              {detail.receipts.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className={td}><Link prefetch={false} href={`/as-receipts/${r.id}`} className="font-medium text-blue-600 hover:underline">{r.asCode}</Link></td>
                  <td className={`${td} whitespace-nowrap`}>{r.receiptDate}</td>
                  <td className={td}><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CATEGORY_BADGE[r.category] ?? 'bg-gray-100 text-gray-700'}`}>{CATEGORY_LABEL[r.category] ?? r.category}</span></td>
                  <td className={td}><span className="inline-flex items-center gap-1 whitespace-nowrap"><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.statusColor ?? '#9CA3AF' }} />{r.statusName ?? '상태 없음'}</span></td>
                  <td className={tdR}>{num(r.devices)}</td>
                  <td className={`${td} text-xs text-gray-600`}>{r.summary || '—'}</td>
                  <td className={`${td} whitespace-nowrap`}>{r.lastShippedAt ?? <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
              {detail.receipts.length === 0 && <EmptyRow cols={7} text="기간 내 접수가 없습니다" />}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
