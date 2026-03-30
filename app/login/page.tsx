'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DM_Sans, DM_Mono } from 'next/font/google'

const dmSans = DM_Sans({ subsets: ['latin'], weight: ['300', '400', '500', '600'] })
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'] })


export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [btnHover, setBtnHover] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.')
        return
      }
      router.push('/')
      router.refresh()
    } catch {
      setError('서버 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  /* ─────────────────────────────────────────────────────────── */
  /* Shared style atoms                                          */
  /* ─────────────────────────────────────────────────────────── */
  const monoFont = dmMono.style.fontFamily
  const sansFont = dmSans.style.fontFamily

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
        .lp-fadeup   { animation: fadeUp 0.6s ease both; }
        .lp-fadeup-1 { animation: fadeUp 0.5s 0.1s ease both; }
        .lp-fadeup-2 { animation: fadeUp 0.5s 0.2s ease both; }
        .lp-fadeup-3 { animation: fadeUp 0.5s 0.3s ease both; }
        .lp-pulse    { animation: pulseDot 2.5s ease-in-out infinite; }

        .lp-btn:active:not(:disabled) { transform: scale(0.99); }
        .lp-btn:hover .lp-arrow       { transform: translateX(3px); }
        .lp-arrow { display: inline-block; transition: transform 0.15s; }

        .lp-input {
          display: block; width: 100%; height: 44px;
          padding: 0 14px; border-radius: 8px;
          border: 1px solid #E2E8F0; background: #fff;
          font-size: 14px; color: #0F172A;
          outline: none; box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .lp-input::placeholder { color: #CBD5E1; }
        .lp-input:focus {
          border-color: #1A56DB;
          box-shadow: 0 0 0 3px rgba(26,86,219,0.1);
        }
      `}</style>

      <div
        className="flex min-h-screen overflow-hidden"
        style={{ fontFamily: sansFont }}
      >

        {/* ══════════════════════════════════════
            LEFT PANEL — Brand
        ══════════════════════════════════════ */}
        <div
          className="hidden md:flex flex-col justify-between"
          style={{
            width: '52%', minHeight: '100vh',
            background: '#0B2E5A',
            padding: '44px 48px',
            position: 'relative', overflow: 'hidden',
          }}
        >
          {/* Grid texture */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage: [
              'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
              'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
            ].join(', '),
            backgroundSize: '40px 40px',
          }} />

          {/* Radial glow */}
          <div style={{
            position: 'absolute', width: 320, height: 320,
            left: '50%', top: '44%', transform: 'translate(-50%, -50%)',
            background: 'radial-gradient(circle, rgba(26,86,219,0.18) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          {/* Top-right corner arc */}
          <div style={{
            position: 'absolute', top: 0, right: 0,
            width: 120, height: 120, borderBottomLeftRadius: 120,
            background: 'rgba(26,86,219,0.08)', pointerEvents: 'none',
          }} />

          {/* Bottom-left corner arc */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0,
            width: 80, height: 80, borderTopRightRadius: 80,
            background: 'rgba(26,86,219,0.06)', pointerEvents: 'none',
          }} />

          {/* ── Top: version tag ── */}
          <div style={{ position: 'relative', zIndex: 1 }}>
            <span style={{
              fontFamily: monoFont,
              fontSize: 10, color: 'rgba(255,255,255,0.35)',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              border: '1px solid rgba(255,255,255,0.12)',
              padding: '4px 10px', borderRadius: 4,
            }}>
              OPS SYSTEM v1.0
            </span>
          </div>

          {/* ── Center: logo + tagline ── */}
          <div className="lp-fadeup" style={{ position: 'relative', zIndex: 1 }}>
            {/* Logo — inline SVG so white fill renders on dark background */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 292 76" width={168} aria-label="thynC">
              <path fill="#fff" fillRule="evenodd" d="m288.21,19.71V5.58l-5.06,14.13h-4.22l-4.73-14.13v14.13h-3.87V0h5.97l4.75,15.57,5.06-15.57h5.9v19.71h-3.79Zm-26.17,0h-4.07V4.25h-6.12V0h16.5v4.25h-6.32v15.45Zm-62.56,35.95c-5.74-4.87-8.8-13.44-8.8-24.54,0-13.26,4.72-23.09,12.96-27.24,3.7-1.8,9.91-3.88,16.29-3.88h20.92v11.64h-19.35c-6.02,0-10.09,1.44-12.96,4.6-2.13,2.44-3.33,7.22-3.33,13.71,0,8.48,1.85,14.79,5.28,17.5,2.5,1.89,6.3,2.89,11.48,2.89h18.89v9.83h-21.48c-10.18,0-15.09-.45-19.91-4.51Z"/>
              <path fill="#fff" d="m169.66,60.17v-28.26c0-4.54-1.83-6.39-6.31-6.3h-10.6v34.56h-12.25V15.98h23.58c12.06-.56,17.82,5.09,17.82,17.31v26.87h-12.25Zm-56.64,15.83h-21.38v-9.37h21.38c5.91-.27,6.44-.82,6.71-6.29h-10.65c-12.35.27-18.16-6.2-17.45-19.6V15.04h11.99v24.51c0,9.21,1.07,11.12,6.26,11.3h9.84V15.04h11.99v44.38c0,11.58-5.99,16.58-18.7,16.57Zm-42.36-39.92c.18-7.49-1.63-9.56-8.6-9.56h-9.78v33.65h-12.14V0h12.14v17.14h12.41c12.77-.27,17.93,4.51,18.11,16.51v26.52h-12.14v-24.09ZM7.77,44.56v-18.04H0v-9.38h7.77V0h12.25v17.14h11.34v9.38h-11.34v15.97c-.18,7.31,1.01,8.93,6.49,9.2h4.85v9.38h-8.87c-10.52.09-15.09-4.96-14.72-16.51Z"/>
            </svg>

            <p style={{
              fontSize: 13,
              color: 'rgba(255,255,255,0.45)', lineHeight: 1.7,
              margin: '20px 0 0',
            }}>
              실시간 입원환자 모니터링 솔루션<br />운영 관리 시스템
            </p>
          </div>

          {/* ── Bottom: status indicator ── */}
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              className="lp-pulse"
              style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: '#10B981',
                boxShadow: '0 0 6px rgba(16,185,129,0.6)',
              }}
            />
            <span style={{
              fontFamily: monoFont,
              fontSize: 10, color: 'rgba(255,255,255,0.3)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              ALL SYSTEMS OPERATIONAL
            </span>
          </div>
        </div>

        {/* ══════════════════════════════════════
            DIVIDER
        ══════════════════════════════════════ */}
        <div
          className="hidden md:block flex-shrink-0"
          style={{
            width: 1,
            background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.12), transparent)',
          }}
        />

        {/* ══════════════════════════════════════
            RIGHT PANEL — Form
        ══════════════════════════════════════ */}
        <div
          className="flex-1 flex flex-col justify-center"
          style={{ background: '#F8FAFC', padding: '52px 48px', position: 'relative' }}
        >
          {/* Top accent line */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 3,
            background: 'linear-gradient(90deg, #1A56DB, #3B82F6)',
          }} />

          <div style={{ maxWidth: 360, width: '100%', margin: '0 auto' }}>

            {/* Form header */}
            <div className="lp-fadeup-1">
              <h1 style={{
                fontSize: 22, fontWeight: 600, color: '#0F172A',
                letterSpacing: '-0.02em', margin: 0,
              }}>
                로그인
              </h1>
              <p style={{ fontSize: 13, color: '#94A3B8', margin: '6px 0 0' }}>
                씨어스 임직원 전용 시스템입니다
              </p>
            </div>

            {/* Form body */}
            <form
              onSubmit={handleSubmit}
              className="lp-fadeup-2"
              style={{ marginTop: 28 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

                {/* 아이디 */}
                <div>
                  <label style={{
                    display: 'block', fontSize: 11, fontWeight: 600,
                    color: '#475569', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 6,
                  }}>
                    아이디
                  </label>
                  <input
                    className="lp-input"
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="아이디를 입력하세요"
                  />
                </div>

                {/* 비밀번호 */}
                <div>
                  <label style={{
                    display: 'block', fontSize: 11, fontWeight: 600,
                    color: '#475569', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 6,
                  }}>
                    비밀번호
                  </label>
                  <input
                    className="lp-input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="비밀번호를 입력하세요"
                  />
                </div>

                {/* Options row */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', marginTop: -4,
                }}>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 12, color: '#64748B', cursor: 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      style={{ width: 14, height: 14, accentColor: '#1A56DB' }}
                    />
                    로그인 상태 유지
                  </label>
                  <a href="#" style={{ fontSize: 12, color: '#1A56DB', textDecoration: 'none' }}>
                    비밀번호 찾기
                  </a>
                </div>

                {/* Error message */}
                {error && (
                  <div style={{
                    background: '#FEE9E9', color: '#C0392B',
                    borderRadius: 6, padding: '10px 14px', fontSize: 13,
                  }}>
                    {error}
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="lp-btn"
                  onMouseEnter={() => setBtnHover(true)}
                  onMouseLeave={() => setBtnHover(false)}
                  style={{
                    width: '100%', height: 48,
                    background: loading ? '#475569' : (btnHover ? '#1246A0' : '#0B2E5A'),
                    color: '#fff', borderRadius: 8,
                    fontSize: 14, fontWeight: 600,
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 6, fontFamily: sansFont,
                    transition: 'background 0.15s, transform 0.1s',
                    opacity: loading ? 0.8 : 1,
                  }}
                >
                  {loading
                    ? '로그인 중...'
                    : <><span>로그인</span><span className="lp-arrow">→</span></>
                  }
                </button>
              </div>
            </form>

            {/* Footer */}
            <div
              className="lp-fadeup-3"
              style={{
                marginTop: 28, paddingTop: 20,
                borderTop: '1px solid #F1F5F9',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ fontFamily: monoFont, fontSize: 11, color: '#CBD5E1' }}>
                © 2025 SEERS CO.,LTD
              </span>
              <span style={{ fontSize: 11, color: '#94A3B8' }}>
                Powered by <strong style={{ color: '#475569', fontWeight: 600 }}>Seers</strong>
              </span>
            </div>

          </div>
        </div>

      </div>
    </>
  )
}
