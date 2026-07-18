/**
 * 위키 HTML 문서 페이지용 유틸.
 * - sanitizeHtmlDocument: 저장 전 위험 요소 제거 (script, 이벤트 핸들러, javascript: URL)
 * - extractPlainTextFromHtml: 검색(plain_text)·AI 어시스턴트 참조용 텍스트 추출
 *
 * 렌더링은 sandbox iframe(스크립트 실행 차단)에서 하므로 sanitize는 이중 방어 목적.
 */

/** HTML 문서 페이지 본문 크기 상한 (2MB) */
export const HTML_DOC_MAX_BYTES = 2 * 1024 * 1024

/** 저장 전 HTML 정화 — 문서 구조(스타일 포함)는 보존하고 실행 가능 요소만 제거 */
export function sanitizeHtmlDocument(html: string): string {
  let out = html
  // script 블록 통째로 제거 (내용 포함)
  out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  // 닫히지 않은 script 태그 방어
  out = out.replace(/<script\b[^>]*>/gi, '')
  // on* 인라인 이벤트 핸들러 속성 제거 (onclick="..." / onload='...' / onerror=x)
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // javascript: URL 무력화
  out = out.replace(/(href|src|action)\s*=\s*(["']?)\s*javascript:[^"'>\s]*/gi, '$1=$2#')
  // 외부 문서 임베드 차단 (iframe/object/embed) — 위키 문서는 자체 완결 HTML만 허용
  out = out.replace(/<(iframe|object|embed)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '')
  out = out.replace(/<(iframe|object|embed)\b[^>]*\/?>/gi, '')
  return out
}

/** HTML에서 검색용 plain text 추출 — 태그·스타일·스크립트 제거 후 공백 정리 */
export function extractPlainTextFromHtml(html: string): string {
  let text = html
  // head의 style/script/title 외 메타 제거를 위해 script/style 블록부터 삭제
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
  // 주석 제거
  text = text.replace(/<!--[\s\S]*?-->/g, ' ')
  // 블록 경계가 붙지 않도록 태그를 공백으로 치환
  text = text.replace(/<[^>]+>/g, ' ')
  // 주요 HTML 엔티티 디코드
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&middot;/gi, '·')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = parseInt(code, 10)
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : ' '
    })
  return text.replace(/\s+/g, ' ').trim()
}

/** HTML 문서에서 <title> 텍스트 추출 (업로드 시 제목 자동 채움용) */
export function extractHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return null
  const t = extractPlainTextFromHtml(m[1])
  return t || null
}
