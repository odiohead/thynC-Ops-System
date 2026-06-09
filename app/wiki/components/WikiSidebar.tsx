'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

export type SidebarPage = {
  id: string
  parentId: string | null
  title: string
  sortOrder: number
}

type Props = {
  pages: SidebarPage[]
}

type TreeNode = SidebarPage & { children: TreeNode[] }

function buildTree(pages: SidebarPage[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  for (const p of pages) map.set(p.id, { ...p, children: [] })
  const roots: TreeNode[] = []
  Array.from(map.values()).forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

export default function WikiSidebar({ pages }: Props) {
  const tree = useMemo(() => buildTree(pages), [pages])
  const pathname = usePathname()
  const currentId = pathname.startsWith('/wiki/') && pathname !== '/wiki/new'
    ? pathname.replace('/wiki/', '')
    : null

  return (
    <aside className="w-72 shrink-0 border-r bg-gray-50 overflow-y-auto p-3">
      <div className="flex items-center justify-between mb-2">
        <Link href="/wiki" className="text-sm font-bold text-gray-700 hover:text-gray-900">
          사내 위키
        </Link>
        <Link
          href="/wiki/new"
          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + 새 페이지
        </Link>
      </div>

      <nav className="mb-3 grid grid-cols-3 gap-1 text-[11px]">
        <Link
          href="/wiki/search"
          className={`text-center py-1 rounded border border-gray-200 hover:bg-gray-100 ${pathname === '/wiki/search' ? 'bg-gray-200' : 'bg-white'}`}
        >
          🔍 검색
        </Link>
        <Link
          href="/wiki/favorites"
          className={`text-center py-1 rounded border border-gray-200 hover:bg-gray-100 ${pathname === '/wiki/favorites' ? 'bg-gray-200' : 'bg-white'}`}
        >
          ⭐ 즐겨찾기
        </Link>
        <Link
          href="/wiki/recent"
          className={`text-center py-1 rounded border border-gray-200 hover:bg-gray-100 ${pathname === '/wiki/recent' ? 'bg-gray-200' : 'bg-white'}`}
        >
          🕐 최근
        </Link>
      </nav>

      {tree.length === 0 ? (
        <div className="text-xs text-gray-400 px-2 py-4 text-center">아직 페이지가 없습니다</div>
      ) : (
        <ul className="space-y-0.5">
          {tree.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              depth={0}
              currentId={currentId}
            />
          ))}
        </ul>
      )}
    </aside>
  )
}

function TreeRow({
  node,
  depth,
  currentId,
}: {
  node: TreeNode
  depth: number
  currentId: string | null
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(true)
  const [busy, setBusy] = useState(false)
  const hasChildren = node.children.length > 0
  const isCurrent = currentId === node.id

  const move = async (direction: 'up' | 'down') => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/wiki/pages/${node.id}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || '이동 실패')
      } else {
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const addChild = () => {
    router.push(`/wiki/new?parentId=${node.id}`)
  }

  return (
    <li>
      <div
        className={`group flex items-center gap-1 px-1 py-1 rounded text-sm ${
          isCurrent ? 'bg-blue-100 text-blue-900' : 'hover:bg-gray-200 text-gray-800'
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          onClick={() => hasChildren && setExpanded(!expanded)}
          className={`w-4 h-4 flex items-center justify-center text-gray-500 ${
            hasChildren ? 'hover:text-gray-800' : 'invisible'
          }`}
          aria-label={expanded ? 'collapse' : 'expand'}
        >
          {hasChildren ? (expanded ? '▼' : '▶') : ''}
        </button>

        <Link href={`/wiki/${node.id}`} className="flex-1 truncate">
          {node.title}
        </Link>

        <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
          <button
            onClick={() => move('up')}
            disabled={busy}
            className="text-xs text-gray-500 hover:text-gray-900 px-1"
            title="위로"
          >
            ↑
          </button>
          <button
            onClick={() => move('down')}
            disabled={busy}
            className="text-xs text-gray-500 hover:text-gray-900 px-1"
            title="아래로"
          >
            ↓
          </button>
          <button
            onClick={addChild}
            className="text-xs text-gray-500 hover:text-gray-900 px-1"
            title="하위 페이지 추가"
          >
            +
          </button>
        </div>
      </div>

      {hasChildren && expanded && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} currentId={currentId} />
          ))}
        </ul>
      )}
    </li>
  )
}
