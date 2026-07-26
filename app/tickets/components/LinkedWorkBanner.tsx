import Link from 'next/link'
import { TICKET_REF_TYPE_META } from './TicketRefTypeBadge'

interface Props {
  /** MAINTENANCE | ETC | SITE_VISIT | INSTALL_PLAN | PROJECT */
  refType: string
  /** 도메인 레코드 코드 (MNT-… / ETC-… 등) */
  code: string
  /** 부가정보 한 줄 (' · ' 로 이어붙인 요약) */
  meta: string
  href: string
  linkLabel: string
}

/**
 * 티켓 상세 상단의 연결 업무(도메인 레코드) 배너
 * 유형별로 색만 다른 5개 블록이 중복돼 있던 것을 단일 컴포넌트로 통합했다.
 * 모바일에서는 부가정보가 줄바꿈되고 CTA가 전폭 버튼이 된다.
 */
export default function LinkedWorkBanner({ refType, code, meta, href, linkLabel }: Props) {
  const tone = TICKET_REF_TYPE_META[refType]
  if (!tone) return null

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-4 py-3 text-sm ${tone.bannerClass}`}>
      <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.badgeClass}`}>
        {tone.label}
      </span>
      <span className="font-mono text-xs">{code}</span>
      <span className={`text-xs ${tone.metaClass}`}>{meta}</span>
      <Link
        href={href}
        className={`w-full shrink-0 rounded-md border bg-white px-2.5 py-2 text-center text-xs font-medium transition-colors dark:bg-transparent sm:ml-auto sm:w-auto sm:py-1 ${tone.linkClass}`}
      >
        {linkLabel}
      </Link>
    </div>
  )
}
