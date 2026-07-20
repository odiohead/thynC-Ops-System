import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { runAgentChat, AI_MODEL } from '@/lib/ai/agent'

export const dynamic = 'force-dynamic'

/** 히스토리로 전달할 최근 메시지 수 (user+assistant 합산) */
const HISTORY_LIMIT = 30

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') {
    return NextResponse.json({ error: 'VIEWER는 어시스턴트를 사용할 수 없습니다.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { sessionId, message, hospitalCode } = body as {
    sessionId?: string
    message?: string
    hospitalCode?: string | null
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: '메시지를 입력하세요.' }, { status: 400 })
  }
  const question = message.trim()

  // 세션 로드/생성 (소유자 검증)
  let session
  if (sessionId) {
    session = await prisma.aiChatSession.findUnique({ where: { id: sessionId } })
    if (!session) return NextResponse.json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
    if (session.userId !== authUser.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (hospitalCode !== undefined && hospitalCode !== session.hospitalCode) {
      session = await prisma.aiChatSession.update({
        where: { id: session.id },
        data: { hospitalCode: hospitalCode || null },
      })
    }
  } else {
    session = await prisma.aiChatSession.create({
      data: {
        userId: authUser.userId,
        hospitalCode: hospitalCode || null,
        title: question.slice(0, 40),
      },
    })
  }

  // 병원 컨텍스트
  let hospitalContext: { code: string; name: string } | null = null
  if (session.hospitalCode) {
    const h = await prisma.hospital.findUnique({
      where: { hospitalCode: session.hospitalCode },
      select: { hospitalCode: true, hospitalName: true },
    })
    if (h) hospitalContext = { code: h.hospitalCode, name: h.hospitalName }
  }

  // user 메시지 저장 + 히스토리 로드 (이번 질문 포함)
  await prisma.aiChatMessage.create({
    data: { sessionId: session.id, role: 'user', content: question },
  })
  const recent = await prisma.aiChatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  })
  const history = recent
    .reverse()
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const currentSession = session
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 하트비트 — 프록시(read timeout) 대비 15초마다 주석 프레임 전송
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': ping\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 15000)
      try {
        const result = await runAgentChat({
          history,
          hospitalContext,
          onEvent: (e) => {
            if (e.type === 'text') controller.enqueue(sse('text', { delta: e.delta }))
            else controller.enqueue(sse('tool_start', { name: e.name, label: e.label }))
          },
        })

        const saved = await prisma.aiChatMessage.create({
          data: {
            sessionId: currentSession.id,
            role: 'assistant',
            content: result.text,
            toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
            usage: result.usage as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        })
        await prisma.aiChatSession.update({
          where: { id: currentSession.id },
          data: { updatedAt: new Date() },
        })

        // 사용량 원장 기록 — 대화 삭제와 무관하게 집계 보존 (실패해도 채팅 흐름은 유지)
        try {
          await prisma.aiUsageLog.create({
            data: {
              userId: authUser.userId,
              userName: authUser.name,
              userEmail: authUser.email,
              sessionId: currentSession.id,
              messageId: saved.id,
              hospitalCode: currentSession.hospitalCode,
              model: AI_MODEL,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              cacheReadTokens: result.usage.cacheReadTokens,
              cacheWriteTokens: result.usage.cacheWriteTokens,
            },
          })
        } catch (e) {
          console.error('[ai-chat] 사용량 원장 기록 실패:', e)
        }

        controller.enqueue(
          sse('done', { sessionId: currentSession.id, messageId: saved.id, usage: result.usage }),
        )
      } catch (e) {
        console.error('[ai-chat] agent 실행 실패:', e)
        controller.enqueue(
          sse('error', { message: 'AI 응답 생성에 실패했습니다. 잠시 후 다시 시도하세요.' }),
        )
      } finally {
        clearInterval(heartbeat)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
