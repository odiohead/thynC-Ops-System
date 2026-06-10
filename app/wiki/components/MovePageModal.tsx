'use client'

import { useEffect, useMemo, useState } from 'react'

type FlatPage = {
  id: string
  parentId: string | null
  title: string
  sortOrder: number
}

type TreeNode = FlatPage & { children: TreeNode[] }

type Props = {
  pageId: string
  currentParentId: string | null
  onClose: () => void
  onMoved: () => void
}

function buildTree(pages: FlatPage[]): TreeNode[] {
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

function collectDescendants(pages: FlatPage[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const p of pages) {
    if (p.parentId) {
      const arr = childrenOf.get(p.parentId) ?? []
      arr.push(p.id)
      childrenOf.set(p.parentId, arr)
    }
  }
  const result = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const k of childrenOf.get(cur) ?? []) {
      if (!result.has(k)) {
        result.add(k)
        queue.push(k)
      }
    }
  }
  return result
}

export default function MovePageModal({ pageId, currentParentId, onClose, onMoved }: Props) {
  const [pages, setPages] = useState<FlatPage[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/wiki/tree')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setPages(data.pages ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : '목록 조회 실패'))
      .finally(() => setLoading(false))
  }, [])

  const tree = useMemo(() => buildTree(pages), [pages])
  const blocked = useMemo(() => {
    const set = collectDescendants(pages, pageId)
    set.add(pageId)
    return set
  }, [pages, pageId])

  const moveTo = async (newParentId: string | null) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/wiki/pages/${pageId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: newParentId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `이동 실패 (${res.status})`)
      }
      onMoved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '이동 실패')
      setBusy(false)
    }
  }

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isBlocked = blocked.has(node.id)
    const isCurrent = node.id === currentParentId
    return (
      <div key={node.id}>
        <button
          onClick={() => moveTo(node.id)}
          disabled={busy || isBlocked || isCurrent}
          className={`w-full text-left px-2 py-1 rounded text-sm truncate ${
            isBlocked
              ? 'text-gray-300 cursor-not-allowed'
              : isCurrent
                ? 'text-gray-400 cursor-default'
                : 'hover:bg-blue-50 text-gray-800'
          }`}
          style={{ paddingLeft: depth * 16 + 8 }}
          title={isBlocked ? '자기 자신/하위로는 이동할 수 없습니다' : node.title}
        >
          {node.title}
          {isCurrent && <span className="ml-2 text-xs text-gray-400">(현재 위치)</span>}
        </button>
        {node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-h-[70vh] bg-white rounded-lg shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">페이지 이동 — 새 위치 선택</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            ×
          </button>
        </div>

        <div className="p-3 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-sm text-gray-400 text-center py-6">불러오는 중...</div>
          ) : (
            <>
              <button
                onClick={() => moveTo(null)}
                disabled={busy || currentParentId === null}
                className={`w-full text-left px-2 py-1 mb-1 rounded text-sm font-medium ${
                  currentParentId === null
                    ? 'text-gray-400 cursor-default'
                    : 'hover:bg-blue-50 text-gray-800'
                }`}
              >
                📂 최상위 (루트)
                {currentParentId === null && (
                  <span className="ml-2 text-xs font-normal text-gray-400">(현재 위치)</span>
                )}
              </button>
              <div className="border-t pt-1">{tree.map((n) => renderNode(n, 0))}</div>
            </>
          )}
        </div>

        {error && (
          <div className="px-4 py-2 border-t text-sm text-red-600 bg-red-50">{error}</div>
        )}
      </div>
    </div>
  )
}
