'use client'

import { useEffect, useState } from 'react'

export interface MobileMe {
  id: string
  name: string
  email: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'VIEWER'
  organization?: { id: number; name: string; code: string } | null
  /** RBAC 유효 권한 키 (SUPER_ADMIN은 카탈로그 전체) — 메뉴 노출용, 보안은 각 API가 다시 검사 */
  permissions?: string[]
}

// 셸(하단 탭)과 페이지가 같은 요청을 공유 — 로그인·로그아웃은 전체 새로고침이라 모듈 캐시로 충분
let mePromise: Promise<MobileMe | null> | null = null

function loadMe(): Promise<MobileMe | null> {
  if (!mePromise) {
    mePromise = fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          mePromise = null
          window.location.replace(`/m/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
          return null
        }
        const d = await r.json()
        return d?.role ? (d as MobileMe) : null
      })
      .catch(() => {
        mePromise = null
        return null
      })
  }
  return mePromise
}

/** 로그인 사용자 — /api/auth/me (DB 실시간). 세션 만료면 /m/login 으로. enabled=false면 조회 안 함(로그인 화면) */
export function useMobileMe(enabled = true) {
  const [me, setMe] = useState<MobileMe | null>(null)
  const [loading, setLoading] = useState(enabled)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    loadMe().then((m) => {
      if (!alive) return
      setMe(m)
      setLoading(false)
    })
    return () => { alive = false }
  }, [enabled])
  return { me, loading }
}

/**
 * 모바일 '자재관리' 메뉴 노출 — 역할 '재고담당'(inventory.manage)·'재고책임자'(inventory.admin) 보유자만.
 * 권한 키로 판정(역할명 하드코딩 금지 — RBAC 규칙). SUPER_ADMIN은 전권이라 포함.
 */
export function hasInventoryMenu(me: MobileMe | null): boolean {
  const p = me?.permissions ?? []
  return p.includes('inventory.manage') || p.includes('inventory.admin')
}

/** 재고 처리 권한 — /api/inventory/can-manage (서버가 전표 API에서 다시 검사) */
export function useCanManageStock() {
  const [canManage, setCanManage] = useState<boolean | null>(null)
  useEffect(() => {
    fetch('/api/inventory/can-manage', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { canManage: false }))
      .then((d) => setCanManage(!!d.canManage))
      .catch(() => setCanManage(false))
  }, [])
  return canManage
}
