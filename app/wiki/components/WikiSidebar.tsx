'use client'

import { useEffect, useMemo, useState } from 'react'
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
import NotificationBell from './NotificationBell'
import { useToast } from './ui/Toast'

export type SidebarPage = {
  id: string
  parentId: string | null
  title: string
  sortOrder: number
  icon?: string | null
}

type Props = {
  pages: SidebarPage[]
}

type TreeNode = SidebarPage & { children: TreeNode[] }

const COLLAPSED_KEY = 'wiki-sidebar-collapsed'
const COLLAPSED_IDS_KEY = 'wiki-sidebar-collapsed-ids'

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
  const pathname = usePathname()
  const router = useRouter()
  const toast = useToast()

  // 레이아웃(서버)은 /wiki 내 클라이언트 내비게이션 시 재렌더되지 않아 pages prop이 stale.
  // 페이지 추가·삭제·이동을 실시간 반영하기 위해 경로가 바뀔 때마다 트리를 직접 재조회한다.
  const [livePages, setLivePages] = useState<SidebarPage[]>(pages)
  useEffect(() => {
    setLivePages(pages)
  }, [pages])
  useEffect(() => {
    let cancelled = false
    fetch('/api/wiki/tree')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.pages)) setLivePages(d.pages as SidebarPage[])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pathname])

  const tree = useMemo(() => buildTree(livePages), [livePages])
  const currentId =
    pathname.startsWith('/wiki/') && pathname !== '/wiki/new'
      ? pathname.replace('/wiki/', '')
      : null

  const byId = useMemo(() => new Map(livePages.map((p) => [p.id, p])), [livePages])

  // ── 사이드바 폭 접기 (localStorage 유지) ───────────────────
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1')
  }, [])
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  // ── 펼침/접힘 상태 (collapsed = 접힌 id 집합, 기본은 모두 펼침) ──
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_IDS_KEY)
      if (raw) setCollapsedIds(new Set(JSON.parse(raw)))
    } catch {
      /* ignore */
    }
  }, [])

  // 현재 페이지의 조상은 항상 펼쳐 보이도록 (자동 노출)
  useEffect(() => {
    if (!currentId) return
    const ancestors: string[] = []
    let cur = byId.get(currentId)?.parentId ?? null
    const guard = new Set<string>()
    while (cur && !guard.has(cur)) {
      guard.add(cur)
      ancestors.push(cur)
      cur = byId.get(cur)?.parentId ?? null
    }
    if (ancestors.length === 0) return
    setCollapsedIds((prev) => {
      if (!ancestors.some((a) => prev.has(a))) return prev
      const next = new Set(prev)
      ancestors.forEach((a) => next.delete(a))
      localStorage.setItem(COLLAPSED_IDS_KEY, JSON.stringify(Array.from(next)))
      return next
    })
  }, [currentId, byId])

  const toggleExpand = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(COLLAPSED_IDS_KEY, JSON.stringify(Array.from(next)))
      return next
    })
  }

  const [activeId, setActiveId] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<SidebarPage | null>(null)
  const activeNode = activeId ? byId.get(activeId) : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const visualSiblings = (parentId: string | null): SidebarPage[] =>
    livePages
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
      toast.error(err.error || '이동 실패')
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

    const blocked = collectDescendants(livePages, draggedId)
    blocked.add(draggedId)

    if (overId === 'root-end') {
      const dragged = byId.get(draggedId)
      if (dragged && dragged.parentId === null) {
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
      if (newParentId !== null && blocked.has(newParentId)) return
      if (gapNodeId === draggedId) return
      const sibs = visualSiblings(newParentId).filter((s) => s.id !== draggedId)
      const position = sibs.findIndex((s) => s.id === gapNodeId)
      if (position === -1) return
      await applyMove(draggedId, { parentId: newParentId, position })
      return
    }
  }

  if (collapsed) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-[var(--wiki-border)] bg-[var(--wiki-bg-subtle)] py-3">
        <button
          onClick={toggleCollapsed}
          title="사이드바 펼치기"
          className="rounded-[6px] px-2 py-1 text-[var(--wiki-text-soft)] transition hover:bg-[var(--wiki-hover)]"
        >
          »
        </button>
        <Link
          href="/wiki/new"
          title="새 페이지"
          className="rounded-[6px] px-2 py-1 text-[var(--wiki-accent)] transition hover:bg-[var(--wiki-accent-soft)]"
        >
          ＋
        </Link>
        <Link
          href="/wiki/search"
          title="검색"
          className="rounded-[6px] px-2 py-1 text-[var(--wiki-text-soft)] transition hover:bg-[var(--wiki-hover)]"
        >
          🔍
        </Link>
      </aside>
    )
  }

  return (
    <aside className="wiki-scroll flex w-72 shrink-0 flex-col overflow-y-auto border-r border-[var(--wiki-border)] bg-[var(--wiki-bg-subtle)]">
      <div className="sticky top-0 z-10 bg-[var(--wiki-bg-subtle)] px-3 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <Link
            href="/wiki"
            className="text-sm font-bold text-[var(--wiki-text)] transition hover:opacity-70"
          >
            사내 위키
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Link
              href="/wiki/new"
              className="rounded-[6px] bg-[var(--wiki-accent)] px-2 py-1 text-xs font-medium text-white transition hover:brightness-95"
            >
              + 새 페이지
            </Link>
            <button
              onClick={toggleCollapsed}
              title="사이드바 접기"
              className="rounded-[6px] px-1.5 py-1 text-[var(--wiki-text-muted)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
            >
              «
            </button>
          </div>
        </div>

        <nav className="mb-3 grid grid-cols-2 gap-1 text-[11px]">
          {[
            { href: '/wiki/search', label: '🔍 검색' },
            { href: '/wiki/favorites', label: '⭐ 즐겨찾기' },
            { href: '/wiki/recent', label: '🕐 최근' },
            { href: '/wiki/trash', label: '🗑 휴지통' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-[6px] border py-1 text-center transition ${
                pathname === item.href
                  ? 'border-[var(--wiki-border-strong)] bg-[var(--wiki-active)] text-[var(--wiki-text)]'
                  : 'border-[var(--wiki-border)] bg-[var(--wiki-bg)] text-[var(--wiki-text-soft)] hover:bg-[var(--wiki-hover)]'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex-1 px-3 pb-4">
        {tree.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--wiki-text-muted)]">
            아직 페이지가 없습니다
          </div>
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
                  collapsedIds={collapsedIds}
                  onToggleExpand={toggleExpand}
                  onMoveModal={(p) => setMoveTarget(p)}
                />
              ))}
            </ul>
            <RootEndZone visible={activeId !== null} />
            <DragOverlay dropAnimation={null}>
              {activeNode ? (
                <div className="rounded-[6px] border border-[var(--wiki-accent)] bg-[var(--wiki-bg)] px-2 py-1 text-sm text-[var(--wiki-text)] opacity-90 shadow-[var(--wiki-shadow-md)]">
                  {activeNode.title}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

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

function GapDropZone({
  nodeId,
  depth,
  visible,
}: {
  nodeId: string
  depth: number
  visible: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `before:${nodeId}` })
  return (
    <div
      ref={setNodeRef}
      className={visible ? 'relative z-10 -my-1 h-2' : 'h-0'}
      style={{ marginLeft: depth * 14 + 4 }}
    >
      {visible && isOver && (
        <div className="mt-0.5 h-0.5 rounded bg-[var(--wiki-accent)]" />
      )}
    </div>
  )
}

function RootEndZone({ visible }: { visible: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: 'root-end' })
  if (!visible) return null
  return (
    <div
      ref={setNodeRef}
      className={`mt-1 rounded-[6px] border border-dashed px-2 py-2 text-center text-[11px] transition ${
        isOver
          ? 'border-[var(--wiki-accent)] bg-[var(--wiki-accent-soft)] text-[var(--wiki-accent)]'
          : 'border-[var(--wiki-border-strong)] text-[var(--wiki-text-muted)]'
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
  collapsedIds,
  onToggleExpand,
  onMoveModal,
}: {
  node: TreeNode
  depth: number
  currentId: string | null
  dragging: boolean
  collapsedIds: Set<string>
  onToggleExpand: (id: string) => void
  onMoveModal: (p: SidebarPage) => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const hasChildren = node.children.length > 0
  const expanded = !collapsedIds.has(node.id)
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
        toast.error(err.error || '이동 실패')
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
        className={`group flex items-center gap-1 rounded-[6px] px-1 py-1 text-sm transition ${
          isCurrent
            ? 'bg-[var(--wiki-selected)] font-medium text-[var(--wiki-text)]'
            : 'text-[var(--wiki-text-soft)] hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]'
        } ${dragging && isOver ? 'ring-2 ring-[var(--wiki-accent)] ring-inset' : ''}`}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        <span
          ref={setDragRef}
          {...attributes}
          {...listeners}
          className="w-3 shrink-0 cursor-grab select-none text-[var(--wiki-text-muted)] opacity-0 transition hover:text-[var(--wiki-text-soft)] active:cursor-grabbing group-hover:opacity-100"
          title="드래그하여 이동"
        >
          ⠿
        </span>

        <button
          onClick={() => hasChildren && onToggleExpand(node.id)}
          className={`flex h-4 w-4 items-center justify-center text-[10px] text-[var(--wiki-text-muted)] transition ${
            hasChildren ? 'hover:text-[var(--wiki-text)]' : 'invisible'
          }`}
          aria-label={expanded ? 'collapse' : 'expand'}
        >
          {hasChildren ? (expanded ? '▼' : '▶') : ''}
        </button>

        <Link href={`/wiki/${node.id}`} className="flex flex-1 items-center gap-1.5 truncate">
          <span className="shrink-0 text-[13px] leading-none opacity-90">
            {node.icon || '📄'}
          </span>
          <span className="truncate">{node.title || '제목 없음'}</span>
        </Link>

        <div className="ml-1 hidden items-center gap-0.5 group-hover:flex">
          <button
            onClick={() => move('up')}
            disabled={busy}
            className="rounded px-1 text-xs text-[var(--wiki-text-muted)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
            title="위로"
          >
            ↑
          </button>
          <button
            onClick={() => move('down')}
            disabled={busy}
            className="rounded px-1 text-xs text-[var(--wiki-text-muted)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
            title="아래로"
          >
            ↓
          </button>
          <button
            onClick={() => onMoveModal(node)}
            className="rounded px-1 text-xs text-[var(--wiki-text-muted)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
            title="다른 위치로 이동"
          >
            📂
          </button>
          <button
            onClick={addChild}
            className="rounded px-1 text-xs text-[var(--wiki-text-muted)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
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
              collapsedIds={collapsedIds}
              onToggleExpand={onToggleExpand}
              onMoveModal={onMoveModal}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
