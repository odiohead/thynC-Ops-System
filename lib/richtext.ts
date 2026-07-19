/**
 * 메인 모듈 리치텍스트(Tiptap HTML) 공용 유틸.
 * sanitize 로직은 lib/wiki/htmlText.ts와 동일 규칙이지만, 모듈 경계(메인 → 위키 import 금지) 때문에 별도 구현.
 */

/** 저장 전 정화 — script·인라인 이벤트 핸들러·javascript: URL·외부 임베드 제거 */
export function sanitizeRichTextHtml(html: string): string {
  let out = html
  out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  out = out.replace(/<script\b[^>]*>/gi, '')
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  out = out.replace(/(href|src|action)\s*=\s*(["']?)\s*javascript:[^"'>\s]*/gi, '$1=$2#')
  out = out.replace(/<(iframe|object|embed)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '')
  out = out.replace(/<(iframe|object|embed)\b[^>]*\/?>/gi, '')
  return out
}

/** Tiptap HTML에서 실제 내용 유무 판단 (태그·nbsp 제거 후 공백뿐이면 빈 것) */
export function isEmptyRichText(html: string): boolean {
  return html.replace(/<[^>]*>|&nbsp;/g, '').trim() === ''
}
