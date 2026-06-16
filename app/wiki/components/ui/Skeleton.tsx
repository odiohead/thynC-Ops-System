/**
 * 위키 로딩 스켈레톤. 페이지 전환/검색/트리 로드 시 깜빡임 대신 사용.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`wiki-skeleton rounded-[6px] ${className}`} />
}

/** 페이지 본문 로딩용 프리셋 */
export function PageSkeleton() {
  return (
    <div className="wiki-content py-10">
      <Skeleton className="mb-6 h-10 w-2/3" />
      <Skeleton className="mb-3 h-4 w-full" />
      <Skeleton className="mb-3 h-4 w-11/12" />
      <Skeleton className="mb-3 h-4 w-3/4" />
      <Skeleton className="mb-6 h-4 w-5/6" />
      <Skeleton className="mb-3 h-4 w-full" />
      <Skeleton className="mb-3 h-4 w-2/3" />
    </div>
  )
}

/** 리스트(홈/검색 결과)용 프리셋 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-[8px] border border-[var(--wiki-border)] p-3">
          <Skeleton className="mb-2 h-4 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      ))}
    </div>
  )
}
