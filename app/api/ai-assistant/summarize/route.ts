import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { chatHistory, hospitalName, consultationType } = await request.json()

  if (!chatHistory || !Array.isArray(chatHistory) || chatHistory.length === 0) {
    return NextResponse.json({ error: '대화 내역이 없습니다.' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Anthropic API 키가 설정되지 않았습니다.' }, { status: 500 })
  }

  try {
    const conversationText = chatHistory
      .map((msg: { role: string; content: string }) =>
        `${msg.role === 'user' ? '직원' : 'AI'}: ${msg.content}`
      )
      .join('\n\n')

    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `다음 상담 대화 내용을 상담이력 마크다운 포맷으로 정리해줘.
병원명, 상담유형, 주요 문의내용, 결론 순서로 깔끔하게 작성해줘.

병원명: ${hospitalName || '전체/공통'}
상담유형: ${consultationType || '미지정'}

--- 대화 내용 ---
${conversationText}`,
        },
      ],
    })

    const textBlock = message.content.find((block) => block.type === 'text')
    const summary = textBlock ? textBlock.text : ''

    return NextResponse.json({ summary })
  } catch (err) {
    console.error('Anthropic API error:', err)
    return NextResponse.json({ error: 'AI 정제에 실패했습니다.' }, { status: 502 })
  }
}
