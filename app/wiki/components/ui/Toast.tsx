'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'

type ToastKind = 'success' | 'error' | 'info'
type ToastItem = { id: number; kind: ToastKind; message: string }

type ToastApi = {
  toast: (message: string, kind?: ToastKind) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/**
 * 위키 전역 토스트. layout에서 children을 감싸 마운트한다.
 * 기존 alert() 호출을 이 토스트로 대체한다.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++seq.current
      setItems((prev) => [...prev, { id, kind, message }])
      window.setTimeout(() => remove(id), 3500)
    },
    [remove],
  )

  const api: ToastApi = {
    toast,
    success: (m) => toast(m, 'success'),
    error: (m) => toast(m, 'error'),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {items.map((t) => (
          <button
            key={t.id}
            onClick={() => remove(t.id)}
            className="wiki-toast-enter pointer-events-auto flex min-w-[240px] max-w-sm items-start gap-2.5 rounded-[8px] border px-3.5 py-2.5 text-left text-sm shadow-[var(--wiki-shadow-md)] transition"
            style={{
              background: 'var(--wiki-bg)',
              borderColor: 'var(--wiki-border)',
              color: 'var(--wiki-text)',
            }}
          >
            <span className="mt-0.5 shrink-0">
              {t.kind === 'success' ? '✅' : t.kind === 'error' ? '⚠️' : '💬'}
            </span>
            <span className="leading-snug">{t.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Provider 밖에서 호출돼도 앱이 죽지 않도록 콘솔 폴백
    return {
      toast: (m) => console.warn('[toast]', m),
      success: (m) => console.warn('[toast]', m),
      error: (m) => console.warn('[toast]', m),
    }
  }
  return ctx
}
