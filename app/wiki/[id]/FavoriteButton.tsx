'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function FavoriteButton({
  pageId,
  initialFavorited,
}: {
  pageId: string
  initialFavorited: boolean
}) {
  const router = useRouter()
  const [favorited, setFavorited] = useState(initialFavorited)
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/wiki/pages/${pageId}/favorite`, {
        method: favorited ? 'DELETE' : 'POST',
      })
      if (res.ok) {
        const data = await res.json()
        setFavorited(!!data.favorited)
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={favorited ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      className={`text-lg leading-none ${favorited ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'} disabled:opacity-50`}
      aria-pressed={favorited}
    >
      {favorited ? '★' : '☆'}
    </button>
  )
}
