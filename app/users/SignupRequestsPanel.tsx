'use client'

/**
 * 가입 신청 패널 (2026-11-13) — 계정 관리 화면 상단, ADMIN 이상.
 * 대기 중인 가입 신청을 보여 주고 [승인](권한·소속·부서 지정 → 계정 생성) / [반려](사유)를 처리한다. 대기 0건이면 한 줄만 보인다.
 * API: GET /api/signup-requests(?status=DONE) · POST /api/signup-requests/[id] {action}
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Org { id: number; name: string; code: string }
interface Dept { id: number; name: string }
interface SignupRow {
  id: number
  email: string
  name: string
  phone: string
  memo: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectReason: string | null
  createdAt: string
  reviewedAt: string | null
  organization: Org | null
  reviewedBy: { name: string } | null
  user: { id: string; role: string } | null
}

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: '최고관리자', ADMIN: '관리자', USER: '일반', VIEWER: '뷰어' }
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-')
const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function SignupRequestsPanel({ organizations, isSuperAdmin, onApproved }: {
  organizations: Org[]
  isSuperAdmin: boolean
  /** 승인으로 계정이 생기면 호출 — 계정 목록 갱신 */
  onApproved: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState<SignupRow[]>([])
  const [done, setDone] = useState<SignupRow[] | null>(null) // null = 아직 안 펼침
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 승인 모달
  const [approving, setApproving] = useState<SignupRow | null>(null)
  const [role, setRole] = useState('USER')
  const [orgId, setOrgId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [depts, setDepts] = useState<Dept[]>([])
  // 반려 모달
  const [rejecting, setRejecting] = useState<SignupRow | null>(null)
  const [reason, setReason] = useState('')

  const loadPending = useCallback(async () => {
    const res = await fetch('/api/signup-requests', { cache: 'no-store' })
    if (res.ok) setPending((await res.json()).requests ?? [])
    setLoaded(true)
  }, [])
  const loadDone = useCallback(async () => {
    const res = await fetch('/api/signup-requests?status=DONE', { cache: 'no-store' })
    if (res.ok) setDone((await res.json()).requests ?? [])
  }, [])
  useEffect(() => { void loadPending() }, [loadPending])

  async function loadDepts(id: string) {
    setDepts([])
    if (!id) return
    const res = await fetch(`/api/settings/departments?organizationId=${id}`)
    if (res.ok) { const d = await res.json(); setDepts(d.departments ?? d ?? []) }
  }
  function openApprove(r: SignupRow) {
    setError(null)
    setApproving(r)
    setRole('USER')
    const id = r.organization ? String(r.organization.id) : ''
    setOrgId(id)
    setDeptId('')
    void loadDepts(id)
  }

  async function act(id: number, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/signup-requests/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '처리에 실패했습니다.'); void loadPending(); return false }
    router.refresh()
    await loadPending()
    if (done !== null) await loadDone()
    return true
  }
  async function approve() {
    if (!approving) return
    if (await act(approving.id, { action: 'approve', role, organizationId: orgId ? Number(orgId) : null, departmentId: deptId ? Number(deptId) : null })) {
      setApproving(null)
      onApproved()
    }
  }
  async function reject() {
    if (!rejecting) return
    if (await act(rejecting.id, { action: 'reject', reason })) { setRejecting(null); setReason('') }
  }

  if (!loaded) return null
  const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500'

  return (
    <section className={`mb-5 overflow-hidden rounded-lg border bg-white shadow-sm ${pending.length > 0 ? 'border-amber-300' : 'border-gray-200'}`} data-testid="signup-requests-panel">
      <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${pending.length > 0 ? 'border-b border-amber-200 bg-amber-50' : ''}`}>
        <h2 className="text-sm font-semibold text-gray-800">
          가입 신청
          {pending.length > 0
            ? <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white" data-testid="signup-pending-count">대기 {pending.length}</span>
            : <span className="ml-2 text-xs font-normal text-gray-400">대기 중인 신청이 없습니다</span>}
        </h2>
        <button type="button" onClick={() => (done === null ? void loadDone() : setDone(null))} className="text-xs text-gray-500 hover:text-gray-700 hover:underline">
          {done === null ? '처리 내역 보기' : '처리 내역 닫기'}
        </button>
      </div>

      {error && !approving && !rejecting && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {pending.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>신청일시</th><th className={th}>이름</th><th className={th}>이메일</th><th className={th}>연락처</th><th className={th}>소속</th><th className={th}>메모</th><th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pending.map((r) => (
                <tr key={r.id} data-testid={`signup-row-${r.id}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{fmt(r.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{r.name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">{r.email}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">{r.phone || '-'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">{r.organization?.name ?? '-'}</td>
                  <td className="max-w-[18rem] px-3 py-2 text-xs text-gray-600"><span className="line-clamp-2 whitespace-pre-wrap" title={r.memo ?? ''}>{r.memo || '-'}</span></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button type="button" onClick={() => openApprove(r)} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">승인</button>
                    <button type="button" onClick={() => { setError(null); setRejecting(r); setReason('') }} disabled={busy} className="ml-1.5 rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">반려</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {done !== null && (
        <div className="border-t border-gray-200">
          <p className="bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-500">처리 내역 (최근 30건)</p>
          {done.length === 0 ? (
            <p className="px-4 py-4 text-center text-sm text-gray-400">처리한 가입 신청이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm" data-testid="signup-done-table">
                <tbody className="divide-y divide-gray-100">
                  {done.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500">{fmt(r.reviewedAt)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${r.status === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{r.status === 'APPROVED' ? '승인' : '반려'}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-900">{r.name}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">{r.email}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-500">
                        {r.status === 'APPROVED' ? `${r.organization?.name ?? '소속 없음'} · ${r.user ? ROLE_LABEL[r.user.role] ?? r.user.role : '계정 삭제됨'}` : r.rejectReason || '사유 없음'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs text-gray-400">{r.reviewedBy?.name ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 승인 모달 — 권한·소속·부서를 정해 계정 생성 */}
      {approving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setApproving(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="가입 신청 승인">
            <h3 className="text-lg font-semibold text-gray-900">가입 신청 승인</h3>
            <p className="mt-1 text-sm text-gray-500">{approving.name} · {approving.email}</p>
            {approving.memo && <p className="mt-2 whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">{approving.memo}</p>}
            {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="sr-role">권한</label>
                <select id="sr-role" value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                  <option value="USER">일반 (USER)</option>
                  <option value="VIEWER">뷰어 (VIEWER)</option>
                  <option value="ADMIN">관리자 (ADMIN)</option>
                  {isSuperAdmin && <option value="SUPER_ADMIN">최고관리자 (SUPER_ADMIN)</option>}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="sr-org">소속 <span className="font-normal text-gray-400">(신청: {approving.organization?.name ?? '없음'})</span></label>
                <select id="sr-org" value={orgId} onChange={(e) => { setOrgId(e.target.value); setDeptId(''); void loadDepts(e.target.value) }} className={inputClass}>
                  <option value="">소속 없음</option>
                  {organizations.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="sr-dept">부서</label>
                <select id="sr-dept" value={deptId} onChange={(e) => setDeptId(e.target.value)} disabled={!orgId || depts.length === 0} className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400`}>
                  <option value="">{!orgId || depts.length === 0 ? '부서 없음' : '부서 선택'}</option>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-400">승인하면 신청자가 정한 비밀번호 그대로 계정이 만들어지고 바로 로그인할 수 있습니다.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setApproving(null)} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
              <button type="button" onClick={() => void approve()} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? '처리 중...' : '승인 · 계정 생성'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 반려 모달 */}
      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setRejecting(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="가입 신청 반려">
            <h3 className="text-lg font-semibold text-gray-900">가입 신청 반려</h3>
            <p className="mt-1 text-sm text-gray-500">{rejecting.name} · {rejecting.email}</p>
            {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <label className="mb-1 mt-4 block text-xs font-medium text-gray-600" htmlFor="sr-reason">반려 사유 <span className="font-normal text-gray-400">(선택 — 처리 내역에 남습니다)</span></label>
            <textarea id="sr-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className={inputClass} placeholder="예: 소속 확인 불가" />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRejecting(null)} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
              <button type="button" onClick={() => void reject()} disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{busy ? '처리 중...' : '반려'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
