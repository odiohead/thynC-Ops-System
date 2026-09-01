'use client'

/**
 * /devices 전용 경량 토스트 — 위키 Toast는 모듈 경계상 import 불가(CLAUDE.md 규칙 7)라 페이지 로컬로 둔다.
 * DevicesClient가 <DevicesToastProvider>로 감싸고, 하위 컴포넌트는 `const notify = useDevicesToast()` 후
 * `notify('교체 기록: …')` / `notify(msg, 'error')`. 색은 시맨틱 토큰만(다크 모드 대응).
 *
 * P3-0 스켈레톤 소유 파일.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastOptions {
  /** 보조 문구(서버 warnings[] 등) */
  details?: string[]
  /** ms, 기본 success/info 4000 · error 7000 */
  duration?: number
}

export type NotifyFn = (message: string, kind?: ToastKind, opts?: ToastOptions) => void

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  details: string[]
}

const ToastContext = createContext<NotifyFn>(() => {})

export function useDevicesToast(): NotifyFn {
  return useContext(ToastContext)
}

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'border-success/40 bg-success-subtle text-success-subtle-foreground',
  error: 'border-destructive/40 bg-destructive-subtle text-destructive-subtle-foreground',
  info: 'border-border bg-card text-foreground',
}

export function DevicesToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), [])

  const notify = useCallback<NotifyFn>(
    (message, kind = 'success', opts) => {
      const id = ++seq.current
      setItems((prev) => [...prev.slice(-3), { id, message, kind, details: opts?.details ?? [] }])
      const duration = opts?.duration ?? (kind === 'error' ? 7000 : 4000)
      window.setTimeout(() => dismiss(id), duration)
    },
    [dismiss]
  )

  const value = useMemo(() => notify, [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {items.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6"
          aria-live="polite"
        >
          {items.map((t) => (
            <div
              key={t.id}
              role="status"
              className={cn('pointer-events-auto w-full max-w-md rounded-md border px-4 py-3 text-sm shadow-lg', KIND_CLASS[t.kind])}
              onClick={() => dismiss(t.id)}
            >
              <div className="font-medium">{t.message}</div>
              {t.details.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs opacity-90">
                  {t.details.slice(0, 5).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                  {t.details.length > 5 && <li>외 {t.details.length - 5}건</li>}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}
