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

    // 심평원 연동 잡 고아 정리 — 연동은 서버 프로세스 내 백그라운드라 재시작 시 강제 종료됨.
    // running으로 남은 잡을 중단 처리해야 새 연동 시작(409 배타)이 풀린다. 재실행하면 미연동 병원부터 이어서 진행
    try {
      const stale = await prisma.hiraSyncJob.findMany({ where: { status: 'running' }, select: { id: true } })
      for (const job of stale) {
        await prisma.hiraSyncJob.update({
          where: { id: job.id },
          data: { status: 'error', endedAt: new Date() },
        })
        await prisma.hiraSyncLog.create({
          data: {
            jobId: job.id,
            type: 'error',
            message: '서버 재시작으로 연동이 중단되었습니다. 다시 실행하면 미연동 병원부터 이어서 진행됩니다.',
            stats: { fatal: true, interruptedByRestart: true },
          },
        })
        console.warn(`[instrumentation] 심평원 연동 잡 #${job.id} 중단 처리 (서버 재시작 고아 잡)`)
      }
    } catch (err) {
      console.error('[instrumentation] 심평원 연동 고아 잡 정리 실패:', err)
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
