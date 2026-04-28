import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGOUT";

export interface AuditActor {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
}

/** JWT 페이로드를 AuditActor로 변환 */
export function auditActorFromJWT(jwt: {
  userId: string;
  email: string;
  name: string;
  role: string;
}): AuditActor {
  return {
    id: jwt.userId,
    email: jwt.email,
    name: jwt.name,
    role: jwt.role,
  };
}

export interface AuditLogInput {
  req?: Request | null;
  actor?: AuditActor | null;
  action: AuditAction;
  resource: string;
  resourceId?: string | number | null;
  resourceLabel?: string | null;
  before?: unknown;
  after?: unknown;
}

const SENSITIVE_KEYS = new Set(["password", "passwordHash", "hashedPassword"]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

function getRequestMeta(req?: Request | null) {
  if (!req) return { ipAddress: null as string | null, userAgent: null as string | null };
  const headers = req.headers;
  const forwarded = headers.get("x-forwarded-for");
  const ipAddress =
    (forwarded ? forwarded.split(",")[0]?.trim() : null) ||
    headers.get("x-real-ip") ||
    null;
  const userAgent = headers.get("user-agent") || null;
  return { ipAddress, userAgent };
}

/**
 * 감사 로그를 기록한다.
 * 로그 기록 실패가 본 작업을 차단하지 않도록 try-catch로 감싼다.
 * mutation API 핸들러의 성공 경로 마지막에 호출하면 된다.
 */
export async function logAudit(input: AuditLogInput): Promise<void> {
  try {
    const { ipAddress, userAgent } = getRequestMeta(input.req ?? null);

    const before =
      input.before === undefined
        ? Prisma.JsonNull
        : (redact(input.before) as Prisma.InputJsonValue);
    const after =
      input.after === undefined
        ? Prisma.JsonNull
        : (redact(input.after) as Prisma.InputJsonValue);

    await prisma.auditLog.create({
      data: {
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.email ?? null,
        actorName: input.actor?.name ?? "시스템",
        actorRole: input.actor?.role ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId != null ? String(input.resourceId) : null,
        resourceLabel: input.resourceLabel ?? null,
        before,
        after,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    console.error("[audit] logAudit failed:", err);
  }
}
