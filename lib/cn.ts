/**
 * cn — 조건부 className 병합 헬퍼 (의존성 없음)
 * 문자열/객체/배열/falsy 값을 받아 공백으로 join.
 *   cn('a', cond && 'b', { c: isC }, ['d', 'e'])
 */
type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | null | undefined>

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []
  for (const input of inputs) {
    if (!input) continue
    if (typeof input === "string" || typeof input === "number") {
      out.push(String(input))
    } else if (Array.isArray(input)) {
      const inner = cn(...input)
      if (inner) out.push(inner)
    } else if (typeof input === "object") {
      for (const key in input) {
        if (input[key]) out.push(key)
      }
    }
  }
  return out.join(" ")
}
