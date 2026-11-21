'use client'

/**
 * 회원가입 신청 (2026-11-13) — 공개 화면. 자동 가입이 아니라 신청만 접수하고, 관리자 승인 후 로그인할 수 있다.
 * 접수 API `POST /api/auth/signup`, 소속 선택지 `GET /api/auth/signup`. 로그인 화면과 같은 밝은 고정 톤(테마 토큰 미사용 — 비로그인 화면).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

const PASSWORD_MIN = 8

export default function SignupPage() {
  const [orgs, setOrgs] = useState<{ id: number; name: string }[]>([])
  const [form, setForm] = useState({ name: '', email: '', password: '', password2: '', phone: '', organizationId: '', memo: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch('/api/auth/signup', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOrgs(d?.organizations ?? []))
      .catch(() => {})
  }, [])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const mismatch = form.password2 !== '' && form.password !== form.password2

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (form.password.length < PASSWORD_MIN) { setError(`비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`); return }
    if (form.password !== form.password2) { setError('비밀번호와 비밀번호 확인이 다릅니다.'); return }
    if (!form.organizationId) { setError('소속을 선택하세요.'); return }
    setBusy(true)
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, email: form.email, password: form.password, phone: form.phone, organizationId: Number(form.organizationId), memo: form.memo }),
    }).catch(() => null)
    setBusy(false)
    if (!res) { setError('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); return }
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '가입 신청에 실패했습니다.'); return }
    setDone(true)
  }

  const label = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-600'
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20'

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="h-[3px] bg-gradient-to-r from-[#2C5CE5] to-[#4B7BFF]" />
        <div className="p-7 sm:p-8">
          <p className="text-xs font-medium text-slate-400">thynC Operations System</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">회원가입 신청</h1>

          {done ? (
            <div className="mt-6" data-testid="signup-done">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <p className="font-semibold">가입 신청이 접수되었습니다.</p>
                <p className="mt-1">관리자가 승인하면 신청한 이메일과 비밀번호로 로그인할 수 있습니다.</p>
              </div>
              <Link href="/login" className="mt-5 flex h-11 w-full items-center justify-center rounded-lg bg-[#0B2E5A] text-sm font-semibold text-white hover:bg-[#1246A0]">로그인 화면으로</Link>
            </div>
          ) : (
            <>
              <p className="mt-1.5 text-[13px] text-slate-500">신청 후 관리자 승인을 거쳐야 로그인할 수 있습니다.</p>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label className={label} htmlFor="su-name">이름 *</label>
                  <input id="su-name" className={input} value={form.name} onChange={set('name')} required maxLength={50} autoComplete="name" placeholder="홍길동" />
                </div>
                <div>
                  <label className={label} htmlFor="su-email">이메일 (로그인 아이디) *</label>
                  <input id="su-email" className={input} type="email" value={form.email} onChange={set('email')} required autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@company.com" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={label} htmlFor="su-pw">비밀번호 *</label>
                    <input id="su-pw" className={input} type="password" value={form.password} onChange={set('password')} required minLength={PASSWORD_MIN} maxLength={72} autoComplete="new-password" placeholder={`${PASSWORD_MIN}자 이상`} />
                  </div>
                  <div>
                    <label className={label} htmlFor="su-pw2">비밀번호 확인 *</label>
                    <input id="su-pw2" className={`${input} ${mismatch ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : ''}`} type="password" value={form.password2} onChange={set('password2')} required autoComplete="new-password" placeholder="한 번 더 입력" />
                  </div>
                </div>
                {mismatch && <p className="-mt-2 text-xs text-red-600">비밀번호가 서로 다릅니다.</p>}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={label} htmlFor="su-phone">연락처 *</label>
                    <input id="su-phone" className={input} type="tel" value={form.phone} onChange={set('phone')} required maxLength={30} autoComplete="tel" placeholder="010-0000-0000" />
                  </div>
                  <div>
                    <label className={label} htmlFor="su-org">소속 *</label>
                    <select id="su-org" className={input} value={form.organizationId} onChange={set('organizationId')} required>
                      <option value="">선택</option>
                      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={label} htmlFor="su-memo">신청 메모 <span className="font-normal normal-case tracking-normal text-slate-400">(선택 — 부서·담당 업무 등)</span></label>
                  <textarea id="su-memo" className={input} value={form.memo} onChange={set('memo')} rows={2} maxLength={500} placeholder="관리자가 승인할 때 참고합니다" />
                </div>

                {error && <div className="rounded-md bg-[#FEE9E9] px-3.5 py-2.5 text-[13px] text-[#C0392B]" role="alert">{error}</div>}

                <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center rounded-lg bg-[#0B2E5A] text-sm font-semibold text-white transition-colors hover:bg-[#1246A0] disabled:cursor-not-allowed disabled:opacity-70">
                  {busy ? '신청 중...' : '가입 신청'}
                </button>
              </form>
              <p className="mt-5 text-center text-[13px] text-slate-500">
                이미 계정이 있으신가요? <Link href="/login" className="font-medium text-[#2C5CE5] hover:underline">로그인</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
