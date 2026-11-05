'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

/** 모바일 공용 프리미티브 — 터치 타깃 44px 이상, 시멘틱 토큰만 사용 */

type BtnVariant = 'primary' | 'outline' | 'ghost' | 'danger'
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-primary text-primary-foreground active:bg-primary-hover disabled:opacity-50',
  outline: 'border border-border bg-card text-foreground active:bg-accent disabled:opacity-50',
  ghost: 'text-foreground active:bg-accent disabled:opacity-50',
  danger: 'bg-destructive text-destructive-foreground disabled:opacity-50',
}

export const MButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'md' | 'lg' }>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:pointer-events-none',
        size === 'lg' ? 'h-14 px-5 text-base' : 'h-11 px-4 text-sm',
        BTN[variant],
        className
      )}
      {...props}
    />
  )
)
MButton.displayName = 'MButton'

export const MInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      // iOS 포커스 자동 확대 방지: 16px 이상
      'h-12 w-full rounded-xl border border-input bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60',
      className
    )}
    {...props}
  />
))
MInput.displayName = 'MInput'

export function MSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-12 w-full rounded-xl border border-input bg-card px-3 text-base text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60',
        className
      )}
      {...props}
    />
  )
}

export function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function Section({ title, right, children, className }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-border bg-card p-4', className)}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

/** 칩형 단일 선택 */
export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 rounded-xl bg-muted p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'h-10 flex-1 rounded-lg text-sm font-semibold transition-colors',
            value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'error'
const NOTICE: Record<NoticeTone, string> = {
  info: 'border-border bg-muted text-foreground',
  success: 'border-success/30 bg-success-subtle text-success',
  warning: 'border-warning/30 bg-warning-subtle text-warning',
  error: 'border-destructive/30 bg-destructive-subtle text-destructive',
}
export function Notice({ tone = 'info', children, className }: { tone?: NoticeTone; children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border px-3.5 py-3 text-sm leading-relaxed', NOTICE[tone], className)}>{children}</div>
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 브라우저 로컬(KST) 날짜 YYYY-MM-DD, offsetDays 만큼 이동 */
export function localDate(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** localStorage — 사생활 모드·차단 시 조용히 실패 (기기 로컬 편의 정보만 저장) */
export const safeStorage = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key) } catch { return null }
  },
  set(key: string, value: string) {
    try { window.localStorage.setItem(key, value) } catch { /* noop */ }
  },
}
