import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { hospitalCode, consultationTypeId, documentTypeId, conclusion, chatHistory, aiSummary } = await request.json()

  try {
    const record = await prisma.consultationQueue.create({
      data: {
        hospitalCode: hospitalCode || null,
        consultationTypeId: consultationTypeId ? parseInt(consultationTypeId) : null,
        documentTypeId: documentTypeId ? parseInt(documentTypeId) : null,
        conclusion: conclusion || null,
        chatHistory: Array.isArray(chatHistory) ? chatHistory : [],
        aiSummary: aiSummary || null,
        status: 'PENDING',
        consultedById: authUser.userId,
      },
    })

    return NextResponse.json({ consultation: record }, { status: 201 })
  } catch (err) {
    console.error('Consultation save error:', err)
    return NextResponse.json({ error: '상담이력 저장에 실패했습니다.' }, { status: 500 })
  }
}
