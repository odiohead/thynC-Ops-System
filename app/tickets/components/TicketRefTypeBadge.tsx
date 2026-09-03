import type { ReactNode } from 'react'
import { DOMAIN_REF_TYPES, TICKET_DOMAIN_META, type DomainRefType } from '@/lib/ticket-domains/meta'

/**
 * 티켓 도메인 연결 유형(refType) 배지
 * 라벨은 lib/ticket-domains/meta.ts 단일 소스. 색상 클래스만 이 파일에 둔다 —
 * Tailwind content 글롭이 app/** 만 스캔하므로 lib/ 로 옮기면 JIT가 클래스를 놓친다.
 * 클래스는 Tailwind JIT가 스캔할 수 있도록 전체 문자열로 보관 (동적 조립 금지).
 * Record<DomainRefType, …> 타입이라 meta.ts에 도메인을 추가하면 여기 누락이 컴파일 오류가 된다.
 */
interface RefTypeTone {
  /** 배지 색 */
  badgeClass: string
  /** 상세 연결 업무 배너 컨테이너 색 (LinkedWorkBanner) */
  bannerClass: string
  /** 배너 부가정보 텍스트 색 */
  metaClass: string
  /** 배너 CTA 링크 색 */
  linkClass: string
}

const REF_TYPE_TONES: Record<DomainRefType, RefTypeTone> = {
  MAINTENANCE: {
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    bannerClass: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
    metaClass: 'text-amber-800 dark:text-amber-300',
    linkClass: 'border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40',
  },
  ETC: {
    badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    bannerClass: 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-200',
    metaClass: 'text-violet-800 dark:text-violet-300',
    linkClass: 'border-violet-300 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/40',
  },
  SITE_VISIT: {
    badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    bannerClass: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200',
    metaClass: 'text-sky-800 dark:text-sky-300',
    linkClass: 'border-sky-300 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/40',
  },
  INSTALL_PLAN: {
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    bannerClass: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
    metaClass: 'text-emerald-800 dark:text-emerald-300',
    linkClass: 'border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/40',
  },
  PROJECT: {
    badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    bannerClass: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200',
    metaClass: 'text-rose-800 dark:text-rose-300',
    linkClass: 'border-rose-300 text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/40',
  },
  VOC: {
    badgeClass: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    bannerClass: 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-200',
    metaClass: 'text-indigo-800 dark:text-indigo-300',
    linkClass: 'border-indigo-300 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-900/40',
  },
  STOCK_OUT: {
    badgeClass: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
    bannerClass: 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-200',
    metaClass: 'text-teal-800 dark:text-teal-300',
    linkClass: 'border-teal-300 text-teal-700 hover:bg-teal-100 dark:border-teal-700 dark:text-teal-300 dark:hover:bg-teal-900/40',
  },
}

interface RefTypeMeta extends RefTypeTone {
  label: string
}

/** refType → 라벨+색 (라벨은 meta.ts, 색은 REF_TYPE_TONES 병합) — LinkedWorkBanner 공유 */
export const TICKET_REF_TYPE_META: Record<string, RefTypeMeta> = Object.fromEntries(
  DOMAIN_REF_TYPES.map((rt) => [rt, { label: TICKET_DOMAIN_META[rt].label, ...REF_TYPE_TONES[rt] }])
)

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
