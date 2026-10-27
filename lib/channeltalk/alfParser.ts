/**
 * 채널톡 ALF 봇 "AS 접수 확인문" 규칙 파서 (L1) — projects/as_channeltalk_intake_design.md §4.3
 *
 * ALF(LLM)가 고객과 대화를 마치고 보내는 확인문은 문장은 흔들리지만 필드 라벨은 안정적이다:
 *   병원 : … / 병동 : … / 기기종류 : … / 시리얼번호 : … / 접수사유 : … / 발송지 정보 : … / 받으실 분 : … / 연락처 :
 * 실측 변형(2026-10-27 리플레이): 라벨 앞 '- ' 불릿, 전각 콜론, 라벨 내 공백, '시리얼번호 및 접수사유'·'시리얼번호 / 접수사유' 결합 라벨,
 * 값이 다음 줄부터 여러 줄, 시리얼 구분(쉼표·슬래시·개행), 시리얼 란 안의 인라인 증상('P021237 / 느낌표'), 병동 접두('122병동: P019650 / …'),
 * 병동 섹션 헤더('[1. 58병동 - 산소포화도 9대]' + '---' 구분), 여러 시리얼이 한 증상을 공유('P008247, P005730 / 측정안됨'), 'A~B' 범위, '동일',
 * 시리얼 없는 공통 증상, 괄호 병동/증상('P013798(72W)').
 * 순차 상태기계로 읽는다(섹션 라벨 + 병동 컨텍스트). 순수 함수(DB·네트워크 없음) — 리플레이 스크립트·운영 인입 모듈 공용.
 */

export interface AlfLine { serial: string; ward: string | null; symptom: string | null }

export interface AlfConfirmation {
  hospitalNameRaw: string | null
  wards: string[] // '병동 :' + 섹션 헤더 병동
  deviceKindText: string | null
  serials: string[] // 정규화(대문자·공백 제거) — 형식 검사는 호출부(AS_SERIAL_RE)
  invalidTokens: string[] // 시리얼 란에서 시리얼처럼 보이지만 형식이 어긋난 토큰(예: 'PO15051')
  lines: AlfLine[] // 시리얼별 병동·증상
  commonSymptom: string | null // 시리얼 표기 없는 전체 공통 증상
  destLines: string[] // 발송/회수 관련 원문 줄(라벨 포함) — resolveDest 입력
  extraRequest: string | null // '추가 요청 :'
  preReplace: boolean // 확인문에 '선교체' 언급 (호출부는 상담 전체 언급·병원 태그와 OR)
  lostHint: boolean // '분실 접수' 문구(분류 참고 — 운영은 태그가 단일 소스)
  labels: string[] // 발견된 섹션
}

type Section = 'hospital' | 'hospitalWard' | 'ward' | 'kind' | 'serial' | 'symptom' | 'dest' | 'extra'

/** 라벨 정규화 키(공백 제거·대문자) → 섹션. 결합 라벨은 serial로 보내고 줄 안에서 증상을 같이 읽는다 */
const LABEL_MAP: Record<string, Section> = {
  병원: 'hospital', 병원명: 'hospital', '병원/병동': 'hospitalWard', '병원/병동명': 'hospitalWard',
  병동: 'ward', 병동명: 'ward',
  기기종류: 'kind', 제품명: 'kind', 기기: 'kind', 고장또는파손된제품명: 'kind', 제품: 'kind',
  시리얼번호: 'serial', 시리얼: 'serial', 시리얼NO: 'serial', SERIAL: 'serial', 시리얼넘버: 'serial', 시리얼번호목록: 'serial',
  시리얼번호및접수사유: 'serial', 시리얼번호및증상: 'serial', '시리얼번호/접수사유': 'serial', '시리얼/접수사유': 'serial', '시리얼번호/증상': 'serial',
  접수사유: 'symptom', 현상: 'symptom', 증상: 'symptom', 고장증상: 'symptom', 사유: 'symptom', 고장현상: 'symptom', 분실사유: 'symptom',
  발송지정보: 'dest', 발송지: 'dest', 수령지: 'dest', 수령지정보: 'dest', 배송지: 'dest', 배송지정보: 'dest', 수리품발송지: 'dest',
  회수지: 'dest', 회수지정보: 'dest', 회수지주소: 'dest', 수거지: 'dest',
  받으실분: 'dest', 받는분: 'dest', 성함: 'dest', 수령인: 'dest', 수취인: 'dest', 수거자및수취인: 'dest', 수거자: 'dest', 회수자: 'dest', 회수자명: 'dest', '회수자명/연락처': 'dest',
  연락처: 'dest', 전화번호: 'dest', 담당자: 'dest', 수령자: 'dest',
  추가요청: 'extra', 추가요청사항: 'extra', 기타: 'extra', 추가: 'extra',
}
/** 발송 구획에서 라벨을 떼고 값만 쓰는 라벨 */
const DEST_VALUE_LABELS = /^(받으실분|받는분|성함|수령인|수취인|연락처|전화번호|담당자|수령자|회수자|회수자명|수거자|수거자및수취인|회수자명\/연락처)$/
const DEST_PICKUP_LABELS = /^(회수지|회수지정보|회수지주소|수거지|회수자|회수자명|수거자|회수자명\/연락처)$/
const DEST_SHIP_LABELS = /^(발송지|발송지정보|수령지|수령지정보|배송지|배송지정보|수리품발송지)$/

const LABEL_RE = /^[\s\-•·*▪]*([가-힣A-Za-z][가-힣A-Za-z/.\s]{0,18}?)\s*[:：]\s*(.*)$/
const TRAILER_RE = /위 내용으로|마지막 확인 메시지|동의 표현|답변해 주시면|진행할까요|확인 부탁드립니다|알려주세요|알려주시|접수가 완료되었습니다|정보가 다르면|접수를 진행하겠습니다|접수 진행하겠습니다/
const SECTION_HEADER_RE = /^[\s\-]*[\[【(]?\s*(?:\d+\s*[.)]\s*)?([^\]\n【】()\-–—:：/]{1,20}?)\s*[-–—]\s*[^\]\n]*[\]】)]?\s*$/
const SERIAL_TOKEN = '[A-Za-z]{1,2}\\s?[0-9OIl]{5,7}'
const SERIAL_SCAN_RE = new RegExp(`(${SERIAL_TOKEN})(?:\\s*[~\\-–]\\s*(${SERIAL_TOKEN}))?`, 'g')
const WARD_RE = /(병동|병실|중환자실|수술실|치료실|간호사실|간호과|간호부|ICU|NICU|응급실|외래|센터|^\d{1,3}층$|^[A-Za-z]?\d{1,3}[A-Za-z]?$|^\d{1,3}[A-Za-z]?\s?병동$)/i
const WARD_PREFIX_RE = /^[\s\-•·*]*([^:：/\-–]{1,16}?(?:병동|병실|층|ICU|NICU|중환자실|수술실|실|과|호|동))\s*[:：\-–]\s*(.*)$/ // '122병동: P0…' · '본관6층병동 - P0…'
const SAME_RE = /^(동일|상동|위와\s*동일|같음|동일함)$/

const normLabel = (s: string) => s.replace(/\s+/g, '').toUpperCase().replace(/시리얼NO\.?/i, '시리얼NO')
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const normSerial = (s: string) => s.replace(/\s+/g, '').toUpperCase()
const splitList = (s: string) => s.split(/[,，/／\n]+/).map(clean).filter(Boolean)

/** 확인문 판정: 병원 라벨 + 시리얼 라벨이 모두 있는 메시지 */
export function isAlfConfirmation(text: string): boolean {
  let hosp = false, serial = false
  for (const line of text.split(/\r?\n/)) {
    const m = LABEL_RE.exec(line)
    if (!m) continue
    const sec = LABEL_MAP[normLabel(m[1])]
    if (sec === 'hospital' || sec === 'hospitalWard') hosp = true
    if (sec === 'serial') serial = true
  }
  return hosp && serial
}
/** 접수 완료 안내 판정 — 봇 템플릿 또는 담당자가 같은 문구를 직접 보낸 경우. 확인문의 '완료됩니다'와 구분 */
export function isAlfCompletion(text: string): boolean {
  return /접수가 완료되었습니다|접수 도와드렸습니다|접수 완료되었습니다/.test(text)
}

interface Entry { serial: string; ward: string | null; symptom: string | null; wardCtx: string | null; order: number }

/** 한 줄 안의 시리얼 토큰·범위와 토큰 사이 텍스트를 나눈다 */
function scanSerials(text: string, known: Set<string>): { serials: string[]; idx: number; end: number }[] {
  const out: { serials: string[]; idx: number; end: number }[] = []
  SERIAL_SCAN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SERIAL_SCAN_RE.exec(text))) {
    const a = normSerial(m[1])
    let serials = [a]
    if (m[2]) {
      const b = normSerial(m[2])
      const pa = /^([A-Z]+)(\d+)$/.exec(a), pb = /^([A-Z]+)(\d+)$/.exec(b)
      if (pa && pb && pa[1] === pb[1]) {
        const lo = Math.min(+pa[2], +pb[2]), hi = Math.max(+pa[2], +pb[2])
        const inRange = Array.from(known).filter((s) => { const p = /^([A-Z]+)(\d+)$/.exec(s); return !!p && p[1] === pa[1] && +p[2] >= lo && +p[2] <= hi })
        serials = inRange.length ? inRange : [a, b]
      } else serials = [a, b]
    }
    out.push({ serials, idx: m.index, end: m.index + m[0].length })
  }
  return out
}

function splitWardSymptom(seg: string, wardSet: Set<string>): { ward: string | null; symptom: string | null } {
  const s = seg.replace(/^[\s/·:：\-–,，]+/, '').replace(/[\s/·,，\-–]+$/, '').replace(/^\((.*)\)$/, '$1')
  if (!s) return { ward: null, symptom: null }
  const parts = s.split(/\s*\/\s*|\n/).map(clean).filter(Boolean)
  let ward: string | null = null
  const sym: string[] = []
  for (const p of parts) {
    const key = p.replace(/\s+/g, '')
    if (!ward && p.length <= 14 && (wardSet.has(key) || WARD_RE.test(p)) && !/분실|고장|파손|안됨|불량/.test(p)) ward = p
    else sym.push(p)
  }
  return { ward, symptom: sym.join(' / ') || null }
}

export function parseAlfConfirmation(text: string): AlfConfirmation {
  const entries = new Map<string, Entry>()
  const wardsFromLabel: string[] = []
  const sectionWards: string[] = []
  const hospitalParts: string[] = []
  const hospitalWardParts: string[] = []
  const kindParts: string[] = []
  const symptomChunks: { wardCtx: string | null; text: string }[] = []
  const destLines: string[] = []
  const extraParts: string[] = []
  const invalidTokens: string[] = []
  const labels = new Set<Section>()
  let cur: Section | null = null
  let wardCtx: string | null = null
  let order = 0
  let lastSerialSymptom: string | null = null
  let preReplace = /선교체/.test(text)
  const known = new Set<string>()

  const addEntry = (serial: string, ward: string | null, symptom: string | null) => {
    const e = entries.get(serial)
    if (!e) { entries.set(serial, { serial, ward, symptom, wardCtx, order: order++ }); known.add(serial) }
    else { if (!e.symptom && symptom) e.symptom = symptom; if (!e.ward && ward) e.ward = ward }
  }

  /** 시리얼이 들어 있는 줄 처리 — 시리얼 란·결합 란·접수사유 란 공용 */
  const consumeSerialLine = (raw: string, treatAsSymptomBlock: boolean) => {
    let line = raw
    let lineWard: string | null = null
    const wp = WARD_PREFIX_RE.exec(line)
    if (wp) { lineWard = clean(wp[1]); line = wp[2]; if (!sectionWards.includes(lineWard)) sectionWards.push(lineWard) }
    const wardSet = new Set([...wardsFromLabel, ...sectionWards].map((w) => w.replace(/\s+/g, '')))
    const occ = scanSerials(line, known)
    if (!occ.length) {
      if (treatAsSymptomBlock && clean(line)) symptomChunks.push({ wardCtx: lineWard ?? wardCtx, text: clean(line) })
      else if (!treatAsSymptomBlock) for (const tok of line.split(/[\s,，/／]+/)) { const t = normSerial(tok); if (/^[A-Z]{1,2}[0-9OIl]{5,7}$/.test(t) && !/^[A-Z]{1,2}\d{5,7}$/.test(t)) invalidTokens.push(t) }
      return
    }
    const preamble = clean(line.slice(0, occ[0].idx).replace(/[\s/·:：\-–,，]+$/, ''))
    if (preamble && treatAsSymptomBlock) symptomChunks.push({ wardCtx: lineWard ?? wardCtx, text: preamble })
    // 토큰별 뒤 구간 → (병동, 증상). 빈 구간은 같은 줄 다음 비어 있지 않은 구간을 공유('P008247, P005730 / 측정안됨')
    const segs = occ.map((o, i) => line.slice(o.end, i + 1 < occ.length ? occ[i + 1].idx : line.length))
    const parsed = segs.map((s) => splitWardSymptom(s, wardSet))
    for (let i = 0; i < occ.length; i++) {
      let { ward, symptom } = parsed[i]
      if (!symptom && !ward) for (let j = i + 1; j < occ.length; j++) if (parsed[j].symptom || parsed[j].ward) { ward = parsed[j].ward; symptom = parsed[j].symptom; break }
      if (symptom && SAME_RE.test(symptom)) symptom = lastSerialSymptom
      for (const s of occ[i].serials) {
        if (!/^[A-Z]{1,2}\d{5,7}$/.test(s)) { invalidTokens.push(s); continue }
        addEntry(s, ward ?? lineWard, symptom)
      }
      if (symptom) lastSerialSymptom = symptom
    }
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^[-–—=_*]{3,}$/.test(trimmed)) { cur = null; continue }
    const lm = LABEL_RE.exec(line)
    const sec = lm ? LABEL_MAP[normLabel(lm[1])] : undefined
    if (!sec && TRAILER_RE.test(trimmed) && !(cur === 'dest' && /^[-•·]/.test(trimmed))) { cur = null; continue }
    // 병동 섹션 헤더 '[1. 58병동 - 산소포화도 9대]'
    const sh = !sec ? SECTION_HEADER_RE.exec(trimmed) : null
    // 시리얼이 있는 줄은 헤더가 아니라 병동 접두 시리얼 줄
    if (sh && WARD_RE.test(sh[1]) && !/[:：]/.test(trimmed) && !new RegExp(SERIAL_TOKEN).test(trimmed)) { wardCtx = clean(sh[1]); if (!sectionWards.includes(wardCtx)) sectionWards.push(wardCtx); cur = null; continue }
    if (sec) {
      labels.add(sec)
      cur = sec
      const val = lm![2]
      if (sec === 'dest') { destLines.push(trimmed.replace(/^[\s\-•·*▪]+/, '')); continue }
      if (!val.trim()) continue
      if (sec === 'hospital') hospitalParts.push(clean(val))
      else if (sec === 'hospitalWard') hospitalWardParts.push(clean(val))
      else if (sec === 'ward') wardsFromLabel.push(...splitList(val))
      else if (sec === 'kind') kindParts.push(clean(val))
      else if (sec === 'serial') consumeSerialLine(val, false)
      else if (sec === 'symptom') consumeSerialLine(val, true)
      else if (sec === 'extra') extraParts.push(clean(val))
      continue
    }
    if (!cur) continue
    const content = line.replace(/^[\s\-•·*▪]+(?=[A-Za-z0-9가-힣(\[])/, '')
    switch (cur) {
      case 'hospital': hospitalParts.push(clean(content)); break
      case 'hospitalWard': hospitalWardParts.push(clean(content)); break
      case 'ward': wardsFromLabel.push(...splitList(content)); break
      case 'kind': kindParts.push(clean(content)); break
      case 'serial': consumeSerialLine(content, false); break
      case 'symptom': consumeSerialLine(content, true); break
      case 'dest':
        if (/선교체/.test(content)) { preReplace = true; break }
        destLines.push(lm ? trimmed.replace(/^[\s\-•·*▪]+/, '') : clean(content))
        break
      case 'extra': extraParts.push(clean(content)); break
    }
  }

  // 병원/병동 결합 라벨 ("병원/병동: 광주한국병원 4병동")
  let hospitalNameRaw = clean(hospitalParts.join(' ')) || null
  if (!hospitalNameRaw && hospitalWardParts.length) {
    const v = clean(hospitalWardParts.join(' '))
    const mm = /^(.*?병원[^\s]*)\s+(.+)$/.exec(v)
    if (mm) { hospitalNameRaw = mm[1]; wardsFromLabel.push(...splitList(mm[2])) } else hospitalNameRaw = v
  }
  const wards = Array.from(new Set([...wardsFromLabel, ...sectionWards]))

  // 증상 보강: 시리얼 자체 증상 없음 → 같은 병동 섹션 공통 → 전체 공통
  const chunkText = (ctx: string | null) => clean(symptomChunks.filter((c) => c.wardCtx === ctx).map((c) => c.text).join(' / ')) || null
  const globalCommon = chunkText(null)
  const lines: AlfLine[] = Array.from(entries.values()).sort((a, b) => a.order - b.order).map((e) => ({
    serial: e.serial,
    ward: e.ward ?? e.wardCtx ?? null,
    symptom: e.symptom ?? (e.wardCtx ? chunkText(e.wardCtx) : null) ?? globalCommon,
  }))

  return {
    hospitalNameRaw, wards,
    deviceKindText: clean(kindParts.join(', ')) || null,
    serials: lines.map((l) => l.serial),
    invalidTokens: Array.from(new Set(invalidTokens)),
    lines, commonSymptom: globalCommon, destLines,
    extraRequest: clean(extraParts.join(' / ')) || null,
    preReplace,
    lostHint: /분실\s*접수/.test(text),
    labels: Array.from(labels),
  }
}

/**
 * 발송/회수 원문 줄 → 발송지·회수지 (시트 T열 분해 규칙과 호환 — channeltalkAsSync.parseDestCell 과 같은 의미)
 * '수령지'·'받으실 분'·'연락처'는 발송지 구획, '회수지'·'회수자'·'수거자'는 회수지 구획. 라벨은 떼고 값만 ' / '로 잇는다.
 */
export function resolveDest(destLines: string[]): { destInfo: string | null; pickupDestInfo: string | null; pickupDestDiffers: boolean } {
  const dest: string[] = [], pickup: string[] = [], plain: string[] = []
  let cur: 'dest' | 'pickup' | 'plain' = 'plain'
  for (const line0 of destLines) {
    for (const line1 of line0.split(/\r?\n/)) {
      const line = line1.replace(/^[\s\-•·*▪]+/, '').trim()
      if (!line) continue
      const m = LABEL_RE.exec(line)
      const key = m ? normLabel(m[1]) : ''
      let val = line
      if (m && DEST_PICKUP_LABELS.test(key)) { cur = key.includes('수취인') ? 'dest' : 'pickup'; val = m[2].trim() }
      else if (m && DEST_SHIP_LABELS.test(key)) { cur = 'dest'; val = m[2].trim() }
      else if (m && DEST_VALUE_LABELS.test(key)) { if (cur === 'plain') cur = 'dest'; val = m[2].trim() }
      else if (m && /^수령지/.test(key)) { cur = 'dest'; val = `${m[1].replace(/^수령지\s*/, '').trim()} ${m[2].trim()}`.trim() } // '수령지(81병동): …'
      if (/수리품 발송지는 회수지와 동일|회수지와 동일|발송지와 동일/.test(val)) continue
      if (!val) continue
      ;(cur === 'dest' ? dest : cur === 'pickup' ? pickup : plain).push(val)
    }
  }
  const join = (a: string[]) => (a.length ? a.join(' / ') : null)
  const destInfo = join(dest) ?? join(plain) ?? join(pickup)
  const pickupDestInfo = join(pickup) ?? destInfo
  const norm = (v: string | null) => (v ?? '').replace(/\s+/g, '')
  return { destInfo, pickupDestInfo, pickupDestDiffers: pickup.length > 0 && norm(pickupDestInfo) !== norm(destInfo) }
}
