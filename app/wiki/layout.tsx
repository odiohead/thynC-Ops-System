import { prisma } from '@/lib/prisma'
import WikiSidebar from './components/WikiSidebar'

export const dynamic = 'force-dynamic'

export default async function WikiLayout({ children }: { children: React.ReactNode }) {
  const pages = await prisma.wikiPage.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      parentId: true,
      title: true,
      sortOrder: true,
    },
  })

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <WikiSidebar pages={pages} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
