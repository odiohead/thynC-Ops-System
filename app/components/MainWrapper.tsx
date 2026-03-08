'use client'

import { usePathname } from 'next/navigation'

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login') return <>{children}</>

  return (
    <div className="lg:pl-60">
      <div className="pt-14 lg:pt-0">
        {children}
      </div>
    </div>
  )
}
