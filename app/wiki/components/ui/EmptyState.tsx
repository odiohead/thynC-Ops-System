import Link from 'next/link'

type Props = {
  icon?: string
  title: string
  description?: string
  cta?: { label: string; href: string }
}

/**
 * 위키 빈 상태. 텍스트만 있던 자리를 아이콘 + 안내 + CTA로 교체.
 */
export default function EmptyState({ icon = '📄', title, description, cta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--wiki-border-strong)] bg-[var(--wiki-bg-subtle)] px-6 py-14 text-center">
      <div className="mb-3 text-4xl opacity-80">{icon}</div>
      <div className="text-[15px] font-semibold text-[var(--wiki-text)]">{title}</div>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-[var(--wiki-text-soft)]">{description}</p>
      )}
      {cta && (
        <Link
          href={cta.href}
          className="mt-5 rounded-[6px] bg-[var(--wiki-accent)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-95"
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}
