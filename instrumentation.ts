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

    // Slack 지연 감지 스케줄러 (function_notification.md Phase 3)
    try {
      const { startNotifyScheduler } = await import('@/lib/notify-scheduler')
      const ds = await prisma.appSetting.findUnique({
        where: { key: 'notify_delay_interval' },
      })
      startNotifyScheduler(ds?.value || 'off')
    } catch (err) {
      console.error('[instrumentation] 지연 감지 스케줄러 초기화 실패:', err)
    }
  }
}
