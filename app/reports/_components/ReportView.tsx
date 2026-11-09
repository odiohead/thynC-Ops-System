'use client'

import type { ReportBlock, ReportDoc } from '@/lib/report/doc'

/**
 * 레포트 웹 미리보기 — Word(lib/report/docx.ts)와 같은 ReportDoc을 사내 양식 모양으로 그린다.
 * 종이(A4 세로 폭) 영역은 출력물 미리보기라 테마와 무관하게 흰 바탕·검은 글자로 고정한다.
 * 양식: 머리글(문서번호·SEERS) / 결재란(보고서·작성·검토·승인) / 제목·작성일자·작성부서·작성자
 *       / 요약(번호 없음) / 목차 1. → 하위 1) / 출처 / 바닥글(F401-5)
 * 본문 표 서식: 머리 E8EDF5 + 남색 굵게, 표 위·아래 남색 선, 항목 열·합계 행 F2F2F2 굵게 (docx와 동일)
 */

const HEAD = 'bg-[#D9D9D9] text-[#0F4290] font-semibold' // 결재란 머리 칸
const TH = 'border border-[#BFBFBF] bg-[#E8EDF5] px-1.5 py-1 text-center font-semibold text-[#0F4290]'
const TD = 'whitespace-pre-line break-words border border-[#BFBFBF] px-1.5 py-1 align-middle'
const KEY = 'bg-[#F2F2F2] font-semibold'
const TABLE = 'w-full table-fixed border-collapse border-y-2 border-y-[#0F4290] text-[12px] leading-snug'

function Block({ b }: { b: ReportBlock }) {
  switch (b.type) {
    case 'para':
      return (
        <p className={`whitespace-pre-line text-justify leading-relaxed ${b.tone === 'muted' ? 'text-neutral-500' : b.tone === 'warn' ? 'text-red-700' : ''}`}>
          {b.text}
        </p>
      )
    case 'note':
      return <p className="text-[11px] leading-snug text-[#595959]">{b.text}</p>
    case 'bullets':
      return (
        <ul className="space-y-1 pl-4">
          {b.items.map((t, i) => (
            <li key={i} className="flex gap-2 leading-relaxed">
              <span className="shrink-0">-</span>
              <span className="text-justify">
                {typeof t === 'string' ? t : (<><b className="font-semibold">{t.lead}</b> — {t.text}</>)}
              </span>
            </li>
          ))}
        </ul>
      )
    case 'table': {
      const sum = b.columns.reduce((a, c) => a + c.width, 0)
      const align = (a?: string) => (a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left')
      return (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <colgroup>
              {b.columns.map((c, i) => <col key={i} style={{ width: `${(c.width / sum) * 100}%` }} />)}
            </colgroup>
            <thead>
              <tr>{b.columns.map((c, i) => <th key={i} className={TH}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => {
                const total = b.totalRow && ri === b.rows.length - 1
                return (
                  <tr key={ri}>
                    {r.map((t, i) => (
                      <td key={i} className={`${TD} ${align(b.columns[i]?.align)} ${total || (b.keyColumn && i === 0) ? KEY : ''}`}>{t}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    }
    case 'kv':
      return (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <colgroup>
              <col style={{ width: '15%' }} /><col style={{ width: '35%' }} /><col style={{ width: '15%' }} /><col style={{ width: '35%' }} />
            </colgroup>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  <td className={`${TD} ${KEY}`}>{r[0]}</td>
                  {r.length >= 4 ? (
                    <>
                      <td className={TD}>{r[1]}</td>
                      <td className={`${TD} ${KEY}`}>{r[2]}</td>
                      <td className={TD}>{r[3]}</td>
                    </>
                  ) : (
                    <td colSpan={3} className={TD}>{r[1]}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'kpi':
      return (
        <table className={`${TABLE} text-center`}>
          <tbody>
            <tr>{b.items.map((x, i) => <th key={i} className={TH}>{x.label}</th>)}</tr>
            <tr>{b.items.map((x, i) => <td key={i} className={`${TD} text-center font-bold`}>{x.value}</td>)}</tr>
            <tr>{b.items.map((x, i) => <td key={i} className={`${TD} text-center`}>{x.sub}</td>)}</tr>
          </tbody>
        </table>
      )
  }
}

export default function ReportView({ doc }: { doc: ReportDoc }) {
  const h = doc.header
  return (
    <div className="mx-auto w-full max-w-[860px] bg-white px-5 py-6 text-[13px] text-black shadow-sm ring-1 ring-black/10 sm:px-12 sm:py-10">
      {/* 머리글 */}
      <div className="mb-1 flex items-end justify-between border-b border-black pb-1 text-[11px]">
        <span>문서번호: {h.docNumber}</span>
        <span className="text-base font-black tracking-[0.2em]">SEERS</span>
      </div>

      {/* 결재란 */}
      <table className="mb-5 w-full table-fixed border-collapse text-[10px] sm:text-[12px] [&_td]:break-all sm:[&_td]:break-normal">
        <colgroup>
          <col style={{ width: '14%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '24%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={3} rowSpan={2} className="border-t-2 border-[#0F4290] text-center text-xl font-bold tracking-[0.3em] sm:text-3xl sm:tracking-[0.5em]">보고서</td>
            <td className={`border border-white border-t-2 border-t-[#0F4290] py-0.5 text-center sm:tracking-[0.4em] ${HEAD}`}>작성</td>
            <td className={`border border-white border-t-2 border-t-[#0F4290] py-0.5 text-center sm:tracking-[0.4em] ${HEAD}`}>검토</td>
            <td className={`border border-white border-t-2 border-t-[#0F4290] py-0.5 text-center sm:tracking-[0.4em] ${HEAD}`}>승인</td>
          </tr>
          <tr className="h-14">
            <td className="border border-[#D9D9D9]" />
            <td className="border border-[#D9D9D9]" />
            <td className="border border-[#D9D9D9]" />
          </tr>
          <tr>
            <td className={`border-t-2 border-[#0F4290] py-1 text-center sm:tracking-[0.4em] ${HEAD}`}>제목</td>
            <td colSpan={5} className="border-t-2 border-[#0F4290] py-1 text-center">{h.title}</td>
          </tr>
          <tr>
            <td className={`py-1 text-center ${HEAD}`}>작성일자</td>
            <td className="py-1 text-center">{h.date}</td>
            <td className={`py-1 text-center ${HEAD}`}>작성부서</td>
            <td className="py-1 text-center">{h.dept}</td>
            <td className={`py-1 text-center ${HEAD}`}>작성자</td>
            <td className="py-1 text-center">{h.author}</td>
          </tr>
        </tbody>
      </table>

      {/* 요약 — 번호 없음 */}
      {doc.intro.length > 0 && (
        <div className="mb-5 space-y-2">
          {doc.intro.map((b, i) => <Block key={i} b={b} />)}
        </div>
      )}

      {/* 본문 — 목차 1. / 하위 1) */}
      <div className="space-y-5">
        {doc.sections.map((s, si) => {
          let sub = 0
          return (
            <section key={si}>
              <h2 className="mb-1.5 flex gap-3 font-bold">
                <span className="w-4 shrink-0 text-right">{si + 1}.</span>
                <span>{s.title}</span>
              </h2>
              <div className="space-y-3 pl-7">
                {s.items.map((it, ii) => (
                  <div key={ii}>
                    {it.title && (
                      <h3 className="mb-1.5 flex gap-3 font-bold">
                        <span className="w-4 shrink-0 text-right">{++sub})</span>
                        <span>{it.title}</span>
                      </h3>
                    )}
                    <div className="space-y-2">
                      {it.blocks.map((b, bi) => <Block key={bi} b={b} />)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {/* 출처 */}
      {doc.outro.length > 0 && (
        <div className="mt-4 space-y-1 pl-7">
          {doc.outro.map((b, i) => <Block key={i} b={b} />)}
        </div>
      )}

      {/* 바닥글 */}
      <div className="mt-10 flex justify-between border-t border-neutral-400 pt-1 text-[10px] text-neutral-600">
        <span>F401-5(rev.0)</span>
        <span>㈜씨어스</span>
        <span>웹 미리보기</span>
      </div>
    </div>
  )
}
