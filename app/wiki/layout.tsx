import { prisma } from '@/lib/prisma'
import WikiSidebar from './components/WikiSidebar'
import { ToastProvider } from './components/ui/Toast'
import './wiki-theme.css'

export const dynamic = 'force-dynamic'

export default async function WikiLayout({ children }: { children: React.ReactNode }) {
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
