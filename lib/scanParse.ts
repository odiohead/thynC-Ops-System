/**
 * 바코드 스캔 원문 파서 (projects/mobile_pwa_design.md §6.2) — 클라이언트·서버 공용 순수 함수
 *
 * 입력 = 디코더 원문(raw). 카메라 스캐너(zxing, textMode Plain)는 GS1 바코드를 GS(\x1D) 구분 원소열로,
 * 블루투스·USB 리더나 사람 입력은 괄호 표기 `(01)…(21)…`로 줄 수 있어 두 형태를 모두 받는다.
 * 출력 = 조회에 쓸 시리얼 후보(우선순위 순) + GS1에서 뽑은 GTIN·LOT·날짜.
 *
 * ⚠️ 실제 라벨 형식은 M2-0 라벨 실측(/m/scan-test)으로 확정 — 규칙 변경 시 scripts/verify-scan-parse.mts 픽스처 동반 갱신
 */

export type ScanKind = 'GS1' | 'GW_COMPOSITE' | 'DEVICE_BARCODE' | 'PLAIN' | 'EMPTY'

export interface ScanParsed {
  raw: string
  kind: ScanKind
  /** 조회 후보 — 앞쪽이 우선. 비어 있으면 시리얼로 쓸 값이 없음 (예: GTIN만 있는 GS1) */
  serialCandidates: string[]
  gtin?: string
  lot?: string
  /** AI 17 유효기한 YYMMDD */
  expiry?: string
  /** AI 11 제조일 YYMMDD */
  prodDate?: string
}

const GS = '\x1D'

/** 고정 길이 AI (데이터 길이). 여기 없는 AI는 가변 길이로 보고 GS 또는 끝까지 읽는다 */
const FIXED_AI: Record<string, number> = {
  '00': 18, '01': 14, '02': 14,
  '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6,
  '20': 2,
}
/** 가변 길이 AI 최대 길이 (GS 없이 이어 붙은 경우 과독 방지) */
const VAR_AI_MAX: Record<string, number> = { '10': 20, '21': 20, '240': 30, '241': 30, '22': 20 }
/** 원소열에서 인식할 AI 접두 (2자리 우선, 240/241은 3자리) */
const KNOWN_AI = ['00', '01', '02', '10', '11', '12', '13', '15', '16', '17', '20', '21', '22', '240', '241']

function stripSymbologyId(s: string): string {
  // ]d2(GS1 DataMatrix) · ]Q3(GS1 QR) · ]C1(GS1-128) · ]e0 등 — 리더가 접두로 붙이는 경우
  return s.replace(/^\][A-Za-z][0-9]/, '')
}

/** 괄호 표기 `(01)08800096401536(10)L123(21)A1` → AI 맵 */
function parseParenGs1(s: string): Map<string, string> | null {
  if (!/^\(\d{2,4}\)/.test(s)) return null
  const out = new Map<string, string>()
  const re = /\((\d{2,4})\)([^(]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.set(m[1], m[2].trim())
  return out.size > 0 ? out : null
}

/** GS 구분 원소열 `0108800096401536` + `10L123` + GS + `21A1` → AI 맵 */
function parseElementString(s: string): Map<string, string> | null {
  // 선행 FNC1이 GS로 남는 디코더도 있어 제거
  const t = s.replace(new RegExp(`^${GS}+`), '')
  // GS1로 볼 조건: GS가 있거나, (01)+14자리로 시작
  if (!t.includes(GS) && !/^01\d{14}/.test(t)) return null
  const out = new Map<string, string>()
  let i = 0
  while (i < t.length) {
    if (t[i] === GS) { i++; continue }
    const ai = KNOWN_AI.find((a) => t.startsWith(a, i) && (a.length === 3 || !KNOWN_AI.some((b) => b.length === 3 && b.startsWith(a) && t.startsWith(b, i))))
    if (!ai) return out.size > 0 ? out : null // 모르는 AI — 그때까지 읽은 것만
    i += ai.length
    const fixed = FIXED_AI[ai]
    if (fixed) {
      out.set(ai, t.slice(i, i + fixed))
      i += fixed
    } else {
      const gsAt = t.indexOf(GS, i)
      const end = Math.min(gsAt === -1 ? t.length : gsAt, i + (VAR_AI_MAX[ai] ?? 30))
      out.set(ai, t.slice(i, end))
      i = end
    }
  }
  return out.size > 0 ? out : null
}

/** 게이트웨이 WMS 합성 시리얼 `GW2404-B005437` (WMS 저장 형식 그대로) */
const GW_COMPOSITE_RE = /^GW[0-9A-Z]{4}-(B\d{5,6})$/
/** 기기 바코드형 `XXX0000-A000000` → 접미 `A000000` (A/P/C/E 웨어러블 — deviceRegistryShared.normalizeSerial 과 동일) */
const DEVICE_BARCODE_RE = /^[A-Z0-9]+-([APCE]\d{6})$/

function compact(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase()
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)))
}

/** 시리얼 값 하나에 대해 형식별 후보 생성 (GS1 AI 21 값에도 같은 규칙 적용) */
function serialVariants(v: string): { kind: ScanKind; candidates: string[] } {
  const c = compact(v)
  if (!c) return { kind: 'EMPTY', candidates: [] }
  const gw = GW_COMPOSITE_RE.exec(c)
  if (gw) return { kind: 'GW_COMPOSITE', candidates: uniq([c, gw[1]]) }
  const bc = DEVICE_BARCODE_RE.exec(c)
  if (bc) return { kind: 'DEVICE_BARCODE', candidates: uniq([bc[1], c]) }
  return { kind: 'PLAIN', candidates: [c] }
}

export function parseScan(input: string | null | undefined): ScanParsed {
  const raw = (input ?? '').replace(/[\r\n]+$/g, '')
  const body = stripSymbologyId(raw.trim())
  if (!body) return { raw, kind: 'EMPTY', serialCandidates: [] }

  const ais = parseParenGs1(body) ?? parseElementString(body)
  if (ais) {
    const serial = ais.get('21')
    const r: ScanParsed = {
      raw,
      kind: 'GS1',
      serialCandidates: serial ? serialVariants(serial).candidates : [],
    }
    const gtin = ais.get('01')
    if (gtin && /^\d{14}$/.test(gtin)) r.gtin = gtin
    const lot = ais.get('10')?.trim()
    if (lot) r.lot = lot
    const exp = ais.get('17')
    if (exp && /^\d{6}$/.test(exp)) r.expiry = exp
    const prod = ais.get('11')
    if (prod && /^\d{6}$/.test(prod)) r.prodDate = prod
    return r
  }

  const v = serialVariants(body)
  return { raw, kind: v.kind, serialCandidates: v.candidates }
}

/** 화면 표시용 — 제어문자(GS 등)를 보이는 기호로 */
export function visibleRaw(raw: string): string {
  return raw.replace(/\x1D/g, '⟨GS⟩').replace(/[\x00-\x1C\x1E\x1F]/g, (ch) => `⟨${ch.charCodeAt(0).toString(16)}⟩`)
}
