import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  const res = NextResponse.json({ ok: true })
  res.cookies.delete('auth-token')

  if (user) {
    await logAudit({
      req,
      actor: auditActorFromJWT(user),
      action: 'LOGOUT',
      resource: 'auth',
      resourceId: user.userId,
      resourceLabel: `${user.name} (${user.email})`,
    })
  }

  return res
}
