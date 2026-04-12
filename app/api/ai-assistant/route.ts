import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { question, sessionId } = await request.json()

  if (!question || typeof question !== 'string' || !question.trim()) {
    return NextResponse.json({ error: '질문을 입력해주세요.' }, { status: 400 })
  }

  const apiHost = process.env.FLOWISE_API_HOST
  const chatflowId = process.env.FLOWISE_CHATFLOW_ID

  if (!apiHost || !chatflowId) {
    return NextResponse.json({ error: 'AI 어시스턴트 설정이 되어 있지 않습니다.' }, { status: 500 })
  }

  try {
    const body: Record<string, unknown> = { question: question.trim() }
    if (sessionId) body.overrideConfig = { sessionId }

    const res = await fetch(`${apiHost}/api/v1/prediction/${chatflowId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('Flowise API error:', res.status, errText)
      return NextResponse.json({ error: 'AI 응답을 가져오지 못했습니다.' }, { status: 502 })
    }

    const data = await res.json()
    return NextResponse.json({ answer: data.text ?? '' })
  } catch (err) {
    console.error('Flowise API call failed:', err)
    return NextResponse.json({ error: 'AI 서버에 연결할 수 없습니다.' }, { status: 502 })
  }
}
