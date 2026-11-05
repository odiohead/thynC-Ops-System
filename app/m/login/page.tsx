'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MButton, MInput, Notice } from '../_components/ui'

/**
 * 모바일 앱 로그인 — 앱 범위(/m/) 안에 둔다 (iOS 홈 화면 앱이 범위 밖 /login 으로 나가면 쿠키가 분리될 수 있음).
 * 서버는 기존 POST /api/auth/login 그대로, client='mobile' → 세션 90일 (mobile_pwa_design.md D-1).
 */
function safeNext(v: string | null): string {
  // 오픈 리다이렉트 방지 — 앱 범위 경로만
  if (!v || !v.startsWith('/m/') || v.startsWith('//') || v.startsWith('/m/login')) return '/m/home'
  return v
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, client: 'mobile' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.')
        return
      }
      router.refresh()
      router.replace(safeNext(params.get('next')))
    } catch {
      setError('서버에 연결할 수 없습니다. 네트워크를 확인하세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <MInput
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        placeholder="이메일"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <MInput
        type="password"
        autoComplete="current-password"
        placeholder="비밀번호"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <Notice tone="error">{error}</Notice>}
      <MButton type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? '로그인 중…' : '로그인'}
      </MButton>
      <p className="pt-1 text-center text-xs text-muted-foreground">이 기기에서 90일 동안 로그인이 유지됩니다.</p>
    </form>
  )
}

export default function MobileLoginPage() {
  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="h-16 w-16 rounded-2xl shadow-md" />
          <div className="text-center">
            <p className="text-xl font-bold">thynC Ops</p>
            <p className="text-sm text-muted-foreground">운영관리 모바일</p>
          </div>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
