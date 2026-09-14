import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { checkWikiAccess } from '@/lib/wiki/access'
import WikiSidebar from './components/WikiSidebar'
import { ToastProvider } from './components/ui/Toast'
import './wiki-theme.css'

export const dynamic = 'force-dynamic'

export default async function WikiLayout({ children }: { children: React.ReactNode }) {
  // 소속 게이트 (2026-09-12 A-6) — nav 숨김만으로는 URL 직접 진입을 막지 못한다. API·협업 서버도 같은 규칙.
  const token = cookies().get('auth-token')?.value
  const jwt = token ? await verifyToken(token) : null
  const denial = jwt ? await checkWikiAccess(jwt) : { status: 401, error: '로그인이 필요합니다.' }
  if (denial) {
    return (
      <div className="wiki-root flex h-[calc(100dvh-3.5rem)] items-center justify-center bg-[var(--wiki-bg)] lg:h-[calc(100vh-64px)]">
        <div className="max-w-md px-6 text-center">
          <div className="mb-3 text-4xl">🔒</div>
          <h1 className="mb-2 text-lg font-semibold text-[var(--wiki-text)]">사내 위키에 접근할 수 없습니다</h1>
          <p className="text-sm text-[var(--wiki-text-soft)]">{denial.error}</p>
          <p className="mt-3 text-xs text-[var(--wiki-text-muted)]">
            접근이 필요하면 관리자에게 소속 확인 또는 &lsquo;위키 접근&rsquo; 권한 부여를 요청하세요.
          </p>
        </div>
      </div>
    )
  }

  const pages = await prisma.wikiPage.findMany({
    where: { isTemplate: false, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      parentId: true,
      title: true,
      sortOrder: true,
      icon: true,
    },
  })

  return (
    <ToastProvider>
      {/* 모바일: 글로벌 헤더 h-14(56px) + 주소창 대응 dvh / 데스크탑: 기존 64px 기준 유지 */}
      <div className="wiki-root flex h-[calc(100dvh-3.5rem)] bg-[var(--wiki-bg)] lg:h-[calc(100vh-64px)]">
        <WikiSidebar pages={pages} />
        <main className="wiki-scroll flex-1 overflow-y-auto">{children}</main>
      </div>
    </ToastProvider>
  )
}
