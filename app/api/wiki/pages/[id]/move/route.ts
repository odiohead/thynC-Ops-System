import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import {
  getIssuePageProtection,
  getIssueNoteRootSetting,
} from '@/lib/wiki/projectIssueNote'

type Ctx = { params: { id: string } }

/**
 * 페이지 이동/정렬 — 네 가지 모드 지원
 * - { direction: 'up' | 'down' }            같은 부모 안에서 인접 형제와 sortOrder 교환
 * - { parentId: string | null }             새 부모로 이동 (sortOrder는 새 부모 자식 최하단)
 * - { parentId, position: number }          새 부모의 자식 중 position 인덱스에 삽입 (형제 전체 sortOrder 재부여)
 * - { sortOrder: number }                   명시적 위치 지정
 *
 * 순환 참조 방지: 새 부모가 본인이거나 본인의 후손이면 400
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { direction, parentId, sortOrder, position } = body as {
    direction?: 'up' | 'down'
    parentId?: string | null
    sortOrder?: number
    position?: number
  }

  const target = await prisma.wikiPage.findUnique({
    where: { id: params.id },
    select: { id: true, parentId: true, sortOrder: true },
  })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── 모드 1: 인접 형제와 sortOrder 교환 ─────────────
  if (direction === 'up' || direction === 'down') {
    const siblings = await prisma.wikiPage.findMany({
      where: { parentId: target.parentId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, sortOrder: true },
    })
    const idx = siblings.findIndex((s) => s.id === target.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= siblings.length) {
      return NextResponse.json({ error: 'Cannot move further' }, { status: 400 })
    }
    const neighbor = siblings[swapIdx]
    await prisma.$transaction([
      prisma.wikiPage.update({
        where: { id: target.id },
        data: { sortOrder: neighbor.sortOrder },
      }),
      prisma.wikiPage.update({
        where: { id: neighbor.id },
        data: { sortOrder: target.sortOrder },
      }),
    ])
    return NextResponse.json({ ok: true })
  }

  // ── 모드 2/3: parentId 변경 또는 sortOrder 명시 ───
  if (parentId !== undefined) {
    if (parentId === target.id) {
      return NextResponse.json({ error: 'Cannot set self as parent' }, { status: 400 })
    }
    // 프로젝트 이슈노트 보호: 부모가 실제로 바뀌는 이동만 차단 (같은 부모 내 정렬은 허용)
    if (parentId !== target.parentId) {
      const protection = await getIssuePageProtection(target.id)
      if (protection === 'root') {
        return NextResponse.json(
          { error: '시스템 카테고리(프로젝트 이슈노트)는 이동할 수 없습니다.' },
          { status: 400 },
        )
      }
      if (protection === 'issue') {
        return NextResponse.json(
          { error: '프로젝트 이슈노트 페이지는 카테고리 밖으로 이동할 수 없습니다.' },
          { status: 400 },
        )
      }
      // 일반 페이지를 이슈노트 카테고리 안으로 넣는 것도 차단 (카테고리 순수성 유지)
      if (parentId !== null) {
        const rootId = await getIssueNoteRootSetting()
        if (rootId && parentId === rootId) {
          return NextResponse.json(
            { error: '프로젝트 이슈노트 카테고리에는 프로젝트 상세에서만 페이지를 추가할 수 있습니다.' },
            { status: 400 },
          )
        }
      }
    }
    if (parentId !== null) {
      // 순환 참조 방지: 새 부모가 target의 후손인지 검사
      const allPages = await prisma.wikiPage.findMany({
        select: { id: true, parentId: true },
      })
      const childrenOf = new Map<string, string[]>()
      for (const p of allPages) {
        if (p.parentId) {
          const arr = childrenOf.get(p.parentId) ?? []
          arr.push(p.id)
          childrenOf.set(p.parentId, arr)
        }
      }
      // BFS: target에서 후손 집합 수집
      const descendants = new Set<string>()
      const queue = [target.id]
      while (queue.length > 0) {
        const cur = queue.shift()!
        const kids = childrenOf.get(cur) ?? []
        for (const k of kids) {
          if (!descendants.has(k)) {
            descendants.add(k)
            queue.push(k)
          }
        }
      }
      if (descendants.has(parentId)) {
        return NextResponse.json(
          { error: 'Cannot move under own descendant' },
          { status: 400 },
        )
      }
      // 새 부모 존재 확인
      const newParent = await prisma.wikiPage.findUnique({
        where: { id: parentId },
        select: { id: true },
      })
      if (!newParent) {
        return NextResponse.json({ error: 'Parent not found' }, { status: 404 })
      }
    }

    // position 모드: 새 부모의 자식 목록(본인 제외) position 인덱스에 삽입, 전체 sortOrder 0..n 재부여
    if (position !== undefined) {
      const siblings = await prisma.wikiPage.findMany({
        where: { parentId, id: { not: target.id } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
      const clamped = Math.max(0, Math.min(position, siblings.length))
      const orderedIds = [
        ...siblings.slice(0, clamped).map((s) => s.id),
        target.id,
        ...siblings.slice(clamped).map((s) => s.id),
      ]
      await prisma.$transaction([
        prisma.wikiPage.update({ where: { id: target.id }, data: { parentId } }),
        ...orderedIds.map((pid, i) =>
          prisma.wikiPage.update({ where: { id: pid }, data: { sortOrder: i } }),
        ),
      ])
      return NextResponse.json({ ok: true })
    }

    let nextSortOrder = sortOrder
    if (nextSortOrder === undefined) {
      // 새 부모의 자식 중 최대 sortOrder + 1
      const last = await prisma.wikiPage.findFirst({
        where: { parentId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })
      nextSortOrder = (last?.sortOrder ?? -1) + 1
    }

    await prisma.wikiPage.update({
      where: { id: target.id },
      data: { parentId, sortOrder: nextSortOrder },
    })
    return NextResponse.json({ ok: true })
  }

  if (sortOrder !== undefined) {
    await prisma.wikiPage.update({
      where: { id: target.id },
      data: { sortOrder },
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'No move parameters provided' }, { status: 400 })
}
