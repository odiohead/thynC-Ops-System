import type { ReactNode } from 'react'

/**
 * 티켓 도메인 연결 유형(refType) 배지
 * 목록 테이블·모바일 카드·상세 헤더 3곳에서 같은 색·라벨을 써야 하므로 단일 소스로 둔다.
 * 클래스는 Tailwind JIT가 스캔할 수 있도록 전체 문자열로 보관 (동적 조립 금지).
 */
interface RefTypeMeta {
  label: string
  /** 배지 색 */
  badgeClass: string
  /** 상세 연결 업무 배너 컨테이너 색 (LinkedWorkBanner) */
  bannerClass: string
  /** 배너 부가정보 텍스트 색 */
  metaClass: string
  /** 배너 CTA 링크 색 */
  linkClass: string
}

export const TICKET_REF_TYPE_META: Record<string, RefTypeMeta> = {
  MAINTENANCE: {
    label: '유지보수',
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    bannerClass: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
    metaClass: 'text-amber-800 dark:text-amber-300',
    linkClass: 'border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40',
  },
  ETC: {
    label: '기타업무',
    badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    bannerClass: 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-200',
    metaClass: 'text-violet-800 dark:text-violet-300',
    linkClass: 'border-violet-300 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/40',
  },
  SITE_VISIT: {
    label: '답사',
    badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    bannerClass: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200',
    metaClass: 'text-sky-800 dark:text-sky-300',
    linkClass: 'border-sky-300 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/40',
  },
  INSTALL_PLAN: {
    label: '설치계획',
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    bannerClass: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
    metaClass: 'text-emerald-800 dark:text-emerald-300',
    linkClass: 'border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/40',
  },
  PROJECT: {
    label: '프로젝트',
    badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    bannerClass: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200',
    metaClass: 'text-rose-800 dark:text-rose-300',
    linkClass: 'border-rose-300 text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/40',
  },
}

interface Props {
  refType: string | null
  /** 순수 티켓(refType 없음)일 때 렌더할 대체 요소 — 미지정 시 아무것도 렌더하지 않음 */
  fallback?: ReactNode
}

export default function TicketRefTypeBadge({ refType, fallback = null }: Props) {
  const meta = refType ? TICKET_REF_TYPE_META[refType] : null
  if (!meta) return <>{fallback}</>
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${meta.badgeClass}`}>
      {meta.label}
    </span>
  )
}
