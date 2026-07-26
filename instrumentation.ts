export async function register() {
  // 서버 사이드에서만 실행
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('@/lib/prisma')
    const { startScheduler } = await import('@/lib/mail-scheduler')

    try {
      const setting = await prisma.appSetting.findUnique({
        where: { key: 'mail_sync_interval' },
      })
      const interval = setting?.value || 'off'
      startScheduler(interval)
    } catch (err) {
      console.error('[instrumentation] 메일 스케줄러 초기화 실패:', err)
    }

    // 알림 tick 스케줄러 (1.1 P4 — SLA 초과 즉시 알림 + 일일 요약 + 자동 종결)
    // 주기는 notify_tick_interval(기본 5m), 1.0에서 지연 감지를 꺼 뒀던 환경은 off로 시작
    try {
      const { startNotifyScheduler, resolveTickInterval } = await import('@/lib/notify-scheduler')
      startNotifyScheduler(await resolveTickInterval())
    } catch (err) {
      console.error('[instrumentation] 알림 tick 스케줄러 초기화 실패:', err)
    }

    // 위키 청크 인덱스 주기 갱신 (본문 저장은 협업 서버가 하므로 REST 훅만으로는 누락됨)
    // 다른 스케줄러와 달리 기본값이 '10m' — 설정 UI가 없어 'off' 기본이면 아무도 켜지 않는다
    try {
      const { startWikiChunkScheduler } = await import('@/lib/wiki/chunk-scheduler')
      const cs = await prisma.appSetting.findUnique({
        where: { key: 'wiki_chunk_interval' },
      })
      startWikiChunkScheduler(cs?.value || '10m')
    } catch (err) {
      console.error('[instrumentation] 위키 청크 스케줄러 초기화 실패:', err)
    }
  }
}
