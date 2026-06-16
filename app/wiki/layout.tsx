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
      <div className="wiki-root flex h-[calc(100vh-64px)] bg-[var(--wiki-bg)]">
        <WikiSidebar pages={pages} />
        <main className="wiki-scroll flex-1 overflow-y-auto">{children}</main>
      </div>
    </ToastProvider>
  )
}
