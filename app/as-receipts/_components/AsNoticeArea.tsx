'use client'

/**
 * AS 접수 상세 — 상단 알림 영역 (2026-11-02, as_deal_quota_design.md §9)
 * 두 성격의 알림을 한 컴포넌트에서 분기해 그린다. 둘 다 "처음 나타날 때 페이지 안 모달 1회 → 닫으면 배너"로 동작이 같고, 색·제목·닫기 가능 여부만 다르다.
 *  - alerts  : **상시 정책 알림**(예: 라이트 교체 한도 초과) — red. 조건이 참인 동안 항상 보이는 배너(닫기 없음).
 *              같은 키는 컴포넌트가 살아 있는 동안 모달을 다시 띄우지 않는다(작업 후 재조회에도 재등장 없음). 키에 수치를 넣어 상태가 바뀌면 다시 1회.
 *  - warnings: **일회성 작업 결과 경고**(입고처리·확정·시리얼 보정 결과 등) — amber. 새 결과가 올 때마다 모달 1회, 배너는 [닫기]로 사라짐.
 *  - panels  : **조치형 확인 알림**(예: 채널톡 변경 감지 — 반영/분리/무시 버튼 보유) — 패널 컴포넌트 자체를 배너 자리와 모달 안에 그대로 그린다(모달에서 바로 조치 가능).
 *              키가 처음 나타날 때 모달 1회, 조치로 패널이 사라지면 모달도 닫힌다. 모달 헤더 톤: 정책(red) > 조치형(orange) > 작업 결과(amber)
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface AsPolicyAlert {
  /** 같은 알림의 모달 1회 표시 판정 키 — 상태가 바뀌면 키도 바꿔 다시 띄운다 (예: `lite-over:after:산소포화도=2/30`) */
  key: string
  title: string
  lines: ReactNode[]
}

export interface AsActionPanel {
  /** 모달 1회 판정 키 (예: `chat-change:${linkId}:${changeDetectedAt}`) */
  key: string
  title: string
  node: ReactNode
}

interface ModalState { alerts: AsPolicyAlert[]; warnings: string[]; panels: AsActionPanel[] }

export default function AsNoticeArea({ alerts, warnings, panels = [], onDismissWarnings }: {
  alerts: AsPolicyAlert[]
  warnings: string[]
  panels?: AsActionPanel[]
  onDismissWarnings: () => void
}) {
  const shownAlertKeys = useRef<Set<string>>(new Set())
  const shownPanelKeys = useRef<Set<string>>(new Set())
  const lastWarningsSig = useRef<string>('')
  const [modal, setModal] = useState<ModalState | null>(null)

  // 조치형 패널 — 새 키만 모달 대상. 조치로 사라진 키는 모달에서도 제거(마지막 항목이면 모달 닫힘)
  useEffect(() => {
    const fresh = panels.filter((p) => !shownPanelKeys.current.has(p.key))
    for (const k of Array.from(shownPanelKeys.current)) if (!panels.some((p) => p.key === k)) shownPanelKeys.current.delete(k)
    setModal((m) => {
      if (!m && fresh.length === 0) return m
      const kept = (m?.panels ?? []).filter((p) => panels.some((x) => x.key === p.key)).map((p) => panels.find((x) => x.key === p.key)!)
      const next = { alerts: m?.alerts ?? [], warnings: m?.warnings ?? [], panels: [...kept, ...fresh] }
      if (next.alerts.length + next.warnings.length + next.panels.length === 0) return null
      return next
    })
    fresh.forEach((p) => shownPanelKeys.current.add(p.key))
  }, [panels])

  // 정책 알림 — 새로 나타난 키만 모달 대상 (사라졌다 다시 나타나면 다시 띄움)
  useEffect(() => {
    const fresh = alerts.filter((a) => !shownAlertKeys.current.has(a.key))
    for (const k of Array.from(shownAlertKeys.current)) if (!alerts.some((a) => a.key === k)) shownAlertKeys.current.delete(k)
    if (fresh.length === 0) return
    fresh.forEach((a) => shownAlertKeys.current.add(a.key))
    setModal((m) => ({ alerts: [...(m?.alerts ?? []), ...fresh], warnings: m?.warnings ?? [], panels: m?.panels ?? [] }))
  }, [alerts])

  // 작업 결과 경고 — 내용이 바뀌어 비어 있지 않으면 모달 1회
  useEffect(() => {
    const sig = warnings.join('\n')
    if (sig === lastWarningsSig.current) return
    lastWarningsSig.current = sig
    if (warnings.length === 0) return
    setModal((m) => ({ alerts: m?.alerts ?? [], warnings, panels: m?.panels ?? [] }))
  }, [warnings])

  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModal(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

  const tone: 'red' | 'orange' | 'amber' = !modal ? 'amber' : modal.alerts.length > 0 ? 'red' : modal.panels.length > 0 ? 'orange' : 'amber'
  const toneCls = { red: 'bg-red-600', orange: 'bg-orange-600', amber: 'bg-amber-500' }[tone]
  const btnCls = { red: 'bg-red-600 hover:bg-red-700', orange: 'bg-orange-600 hover:bg-orange-700', amber: 'bg-amber-500 hover:bg-amber-600' }[tone]
  const modalTitle = !modal ? '' : tone === 'red' ? '정책 확인 필요' : tone === 'orange' ? `확인 필요 — ${modal.panels.map((p) => p.title).join(' · ')}` : `작업 결과 확인 — 경고 ${modal.warnings.length}건`

  return (
    <>
      {/* 상시 정책 알림 — red, 닫기 없음 */}
      {alerts.map((a) => (
        <div key={a.key} role="alert" className="mb-3 rounded-lg border-2 border-red-500 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <p className="font-semibold">{a.title}</p>
          {a.lines.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
              {a.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </div>
      ))}

      {/* 조치형 확인 알림 — 패널 컴포넌트 그대로 (자체 스타일·버튼) */}
      {panels.map((p) => <div key={p.key}>{p.node}</div>)}

      {/* 일회성 작업 결과 경고 — amber, 닫기 */}
      {warnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <div className="flex items-center justify-between">
            <p className="font-medium">경고 {warnings.length}건</p>
            <button type="button" className="text-xs text-amber-600 hover:underline" onClick={onDismissWarnings}>닫기</button>
          </div>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* 모달 — 페이지 안 오버레이, 처음 나타날 때 1회. 정책 알림 섞이면 red, 작업 결과만이면 amber */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)} role="dialog" aria-modal="true" aria-labelledby="as-notice-modal-title">
          <div className={`w-full overflow-hidden rounded-xl bg-white shadow-2xl ${modal.panels.length > 0 ? 'max-w-2xl' : 'max-w-md'}`} onClick={(e) => e.stopPropagation()}>
            <div className={`flex items-center gap-2 px-5 py-3 text-white ${toneCls}`}>
              <span aria-hidden className="text-lg">{tone === 'amber' ? 'ℹ' : '⚠'}</span>
              <h2 id="as-notice-modal-title" className="text-base font-semibold">{modalTitle}</h2>
            </div>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
              {modal.alerts.map((a) => (
                <div key={a.key}>
                  <p className="text-sm font-semibold text-red-800">{a.title}</p>
                  {a.lines.length > 0 && (
                    <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-sm text-gray-700">
                      {a.lines.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  )}
                </div>
              ))}
              {modal.panels.map((p) => <div key={p.key} className="[&>div]:mb-0">{p.node}</div>)}
              {modal.warnings.length > 0 && (
                <div>
                  {(modal.alerts.length > 0 || modal.panels.length > 0) && <p className="text-sm font-semibold text-amber-800">작업 결과 경고 {modal.warnings.length}건</p>}
                  <ul className={`${modal.alerts.length > 0 ? 'mt-1.5' : ''} list-inside list-disc space-y-0.5 text-sm text-gray-700`}>
                    {modal.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-xs text-gray-400">{modal.panels.length > 0 ? '여기서 바로 처리하거나, 확인을 누르면 창이 닫히고 상단 패널로 계속 표시됩니다.' : '확인을 누르면 창이 닫히고 상단 배너로 계속 표시됩니다.'}</p>
            </div>
            <div className="flex justify-end border-t border-gray-100 px-5 py-3">
              <button type="button" autoFocus onClick={() => setModal(null)} className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${btnCls}`}>확인</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
