'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import MovePageModal from './MovePageModal'

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

function collectDescendants(pages: SidebarPage[], rootId: string): Set<string> {
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

export default function WikiSidebar({ pages }: Props) {
  const tree = useMemo(() => buildTree(pages), [pages])
  const pathname = usePathname()
  const router = useRouter()
  const currentId = pathname.startsWith('/wiki/') && pathname !== '/wiki/new'
    ? pathname.replace('/wiki/', '')
    : null

  const [activeId, setActiveId] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<SidebarPage | null>(null)
  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages])
  const activeNode = activeId ? byId.get(activeId) : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // 시각적 트리와 동일한 정렬의 형제 목록 (position 계산용)
  const visualSiblings = (parentId: string | null): SidebarPage[] =>
    pages
      .filter((p) => (p.parentId ?? null) === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))

  const applyMove = async (
    pageId: string,
    payload: { parentId: string | null; position?: number },
  ) => {
    const res = await fetch(`/api/wiki/pages/${pageId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error || '이동 실패')
    } else {
      router.refresh()
    }
  }

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    const draggedId = String(e.active.id)
    setActiveId(null)
    const over = e.over
    if (!over) return
    const overId = String(over.id)

    const blocked = collectDescendants(pages, draggedId)
    blocked.add(draggedId)

    if (overId === 'root-end') {
      const dragged = byId.get(draggedId)
      if (dragged && dragged.parentId === null) {
        // 이미 루트 → 루트 최하단으로 재배치
        const sibs = visualSiblings(null).filter((s) => s.id !== draggedId)
        await applyMove(draggedId, { parentId: null, position: sibs.length })
      } else {
        await applyMove(draggedId, { parentId: null })
      }
      return
    }

    if (overId.startsWith('into:')) {
      const targetId = overId.slice('into:'.length)
      if (blocked.has(targetId)) return
      await applyMove(draggedId, { parentId: targetId })
      return
    }

    if (overId.startsWith('before:')) {
      const gapNodeId = overId.slice('before:'.length)
      const gapNode = byId.get(gapNodeId)
      if (!gapNode) return
      const newParentId = gapNode.parentId ?? null
      // 새 부모가 드래그 중인 페이지 본인/후손이면 순환 → 차단
      if (newParentId !== null && blocked.has(newParentId)) return
      if (gapNodeId === draggedId) return
      const sibs = visualSiblings(newParentId).filter((s) => s.id !== draggedId)
      const position = sibs.findIndex((s) => s.id === gapNodeId)
      if (position === -1) return
      await applyMove(draggedId, { parentId: newParentId, position })
      return
    }
  }

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
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <ul className="space-y-0">
            {tree.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                depth={0}
                currentId={currentId}
                dragging={activeId !== null}
                onMoveModal={(p) => setMoveTarget(p)}
              />
            ))}
          </ul>
          <RootEndZone visible={activeId !== null} />
          <DragOverlay dropAnimation={null}>
            {activeNode ? (
              <div className="px-2 py-1 bg-white border border-blue-300 rounded shadow text-sm text-gray-800 opacity-90">
                {activeNode.title}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {moveTarget && (
        <MovePageModal
          pageId={moveTarget.id}
          currentParentId={moveTarget.parentId}
          onClose={() => setMoveTarget(null)}
          onMoved={() => router.refresh()}
        />
      )}
    </aside>
  )
}

function GapDropZone({ nodeId, depth, visible }: { nodeId: string; depth: number; visible: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: `before:${nodeId}` })
  return (
    <div
      ref={setNodeRef}
      className={visible ? 'h-2 -my-1 relative z-10' : 'h-0'}
      style={{ marginLeft: depth * 12 + 4 }}
    >
      {visible && isOver && <div className="h-0.5 mt-0.5 bg-blue-500 rounded" />}
    </div>
  )
}

function RootEndZone({ visible }: { visible: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: 'root-end' })
  if (!visible) return null
  return (
    <div
      ref={setNodeRef}
      className={`mt-1 px-2 py-2 text-[11px] text-center border border-dashed rounded ${
        isOver ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-400'
      }`}
    >
      여기에 놓으면 최상위로 이동
    </div>
  )
}

function TreeRow({
  node,
  depth,
  currentId,
  dragging,
  onMoveModal,
}: {
  node: TreeNode
  depth: number
  currentId: string | null
  dragging: boolean
  onMoveModal: (p: SidebarPage) => void
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(true)
  const [busy, setBusy] = useState(false)
  const hasChildren = node.children.length > 0
  const isCurrent = currentId === node.id

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: node.id })
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: `into:${node.id}` })

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
    <li className={isDragging ? 'opacity-40' : ''}>
      <GapDropZone nodeId={node.id} depth={depth} visible={dragging} />
      <div
        ref={setDropRef}
        className={`group flex items-center gap-1 px-1 py-1 rounded text-sm ${
          isCurrent ? 'bg-blue-100 text-blue-900' : 'hover:bg-gray-200 text-gray-800'
        } ${dragging && isOver ? 'ring-2 ring-blue-400 bg-blue-50' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <span
          ref={setDragRef}
          {...attributes}
          {...listeners}
          className="w-3 shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-600 opacity-0 group-hover:opacity-100 select-none"
          title="드래그하여 이동"
        >
          ⠿
        </span>

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
            onClick={() => onMoveModal(node)}
            className="text-xs text-gray-500 hover:text-gray-900 px-1"
            title="다른 위치로 이동"
          >
            📂
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
        <ul className="space-y-0">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              currentId={currentId}
              dragging={dragging}
              onMoveModal={onMoveModal}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
