'use client'

/**
 * 헤더 [Excel] (§6.1 Excel) — GROUP A
 * href는 활성 탭 기준으로 orchestrator가 계산(exportUnitsUrl / exportEventsUrl / exportCoverageUrl). null이면 비활성(병동·임포트 탭).
 * `downloadXlsx`(fetch → blob)로 받아 400('필터를 좁혀 …')·401·500을 토스트 오류로 보여준다 — `window.location.href` 직행은
 * 오류 응답(JSON)을 파일로 저장해 버려 원인 확인이 불가하므로 쓰지 않는다. 파일명은 Content-Disposition에서 복원.
 * 모바일은 '데스크톱 권장' 문구(§6.1 모바일).
 */
import { useState } from 'react'
import Button from '@/app/components/ui/Button'
import { cn } from '@/lib/cn'
import { downloadXlsx, errorMessage } from './api'
import { useDevicesToast } from './toast'

export interface ExcelButtonProps {
  href: string | null
  /** 기본 'Excel' */
  label?: string
  /** Content-Disposition 없을 때 파일명 */
  fallbackName?: string
  size?: 'sm' | 'md'
  className?: string
}

function ExcelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className={cn('shrink-0', className)}>
      <path fill="currentColor" d="M9.5 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5L9.5 1Zm0 1.4L11.6 4.5H9.5V2.4ZM4 2h4.5v3H12v9H4V2Z" />
      <path fill="currentColor" d="M5.6 7h1.3l1.1 1.9L9.1 7h1.3L8.7 9.7l1.8 2.8H9.2L8 10.5l-1.2 2H5.5l1.8-2.8L5.6 7Z" />
    </svg>
  )
}

export function ExcelButton({ href, label = 'Excel', fallbackName = '디바이스원장.xlsx', size = 'sm', className }: ExcelButtonProps) {
  const notify = useDevicesToast()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!href || busy) return
    setBusy(true)
    try {
      await downloadXlsx(href, fallbackName)
    } catch (e) {
      notify(errorMessage(e, 'Excel 내보내기에 실패했습니다.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Button
        variant="outline"
        size={size}
        disabled={!href || busy}
        aria-busy={busy || undefined}
        title={href ? '활성 탭 기준 Excel 내보내기 (기기 목록·이력 10,000행 / 커버리지 1,000행 이하)' : '이 탭은 Excel 내보내기가 없습니다'}
        onClick={run}
      >
        <ExcelIcon className={busy ? 'animate-pulse' : undefined} />
        {busy ? '내보내는 중…' : label}
      </Button>
      {href && <span className="text-[10px] leading-none text-muted-foreground md:hidden">데스크톱 권장</span>}
    </span>
  )
}

export default ExcelButton
