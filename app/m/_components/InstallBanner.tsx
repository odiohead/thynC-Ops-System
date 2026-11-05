'use client'

import { useEffect, useState } from 'react'
import { Share, PlusSquare, X, Download } from 'lucide-react'
import { MButton, safeStorage } from './ui'

const DISMISS_KEY = 'm.installBanner.dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** 홈 화면 설치 안내 — 이미 앱(standalone)으로 실행 중이거나 닫은 적 있으면 숨김 */
export default function InstallBanner() {
  const [mode, setMode] = useState<'hidden' | 'android' | 'ios'>('hidden')
  const [promptEvt, setPromptEvt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone || safeStorage.get(DISMISS_KEY) === '1') return
    const ua = navigator.userAgent
    const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
    if (isIos) setMode('ios')
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPromptEvt(e as BeforeInstallPromptEvent)
      setMode('android')
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (mode === 'hidden') return null

  const dismiss = () => {
    safeStorage.set(DISMISS_KEY, '1')
    setMode('hidden')
  }

  return (
    <div className="relative rounded-2xl border border-primary/20 bg-primary-subtle p-4">
      <button type="button" aria-label="닫기" onClick={dismiss} className="absolute right-2 top-2 rounded-lg p-1.5 text-muted-foreground">
        <X size={18} />
      </button>
      <p className="pr-6 text-sm font-semibold text-foreground">홈 화면에 앱으로 설치하세요</p>
      {mode === 'android' ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">아이콘을 눌러 바로 열 수 있습니다.</p>
          <MButton
            className="mt-3 w-full"
            onClick={async () => {
              if (!promptEvt) return
              await promptEvt.prompt()
              const { outcome } = await promptEvt.userChoice
              if (outcome === 'accepted') setMode('hidden')
            }}
          >
            <Download size={18} /> 설치
          </MButton>
        </>
      ) : (
        <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-center gap-1.5">1. Safari 하단의 <Share size={16} className="text-primary" /> 공유 버튼</li>
          <li className="flex items-center gap-1.5">2. <PlusSquare size={16} className="text-primary" /> 홈 화면에 추가</li>
        </ol>
      )}
    </div>
  )
}
