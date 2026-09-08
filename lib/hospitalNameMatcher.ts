/**
 * 병원명 자유 표기 → hospitalCode 매처 (2026-09-07)
 *
 * AS이력 마이그(scripts/migrate-thync-as-history.mts)에서 3,600행으로 검증된 별칭 매칭을 lib로 승격.
 * - NFC 정규화 (macOS/시트 NFD 표기 함정 — drive-korean-filename-nfd)
 * - 법인 접두 제거·학교 축약·괄호 별칭 전개, 정규화가 전부 소거되면 원명 폴백
 * - 별칭 유일 매칭 → 확정, 실패 시 부분 포함(4자 이상)으로 유일 후보만 확정
 * 사용처: 채널톡 AS접수 폴링(lib/channeltalkAsSync). 후보 풀은 고객사(프로젝트·기기·딜 보유 병원).
 */
import { prisma } from '@/lib/prisma'

export interface HospitalMatcher {
  /** 유일 매칭 시 hospitalCode, 아니면 null */
  match(rawName: string): string | null
  /** 실패 진단용 — 부분 포함 후보 코드 목록 */
  candidates(rawName: string): string[]
  nameOf(code: string): string | undefined
}

const norm = (x: string) =>
  x.replace(/^\d{8}[_ ]?/, '').replace(/[_ ]?\d+차$/, '').replace(/\(.*?\)/g, '')
    .replace(/^(의료법인|재단법인|사회복지법인|학교법인)\S*재단/, '').replace(/^\(의\)|^\(재\)|^\(의료\)/, '')
    .replace(/\s+/g, '').toUpperCase() // 영문 대소문자 표기 흔들림 대응 (하남S/하남s — 2026-09-08)

const aliases = (rawName0: string): string[] => {
  const rawName = rawName0.normalize('NFC')
  const out = new Set<string>()
  const b = norm(rawName)
  if (b) out.add(b)
  else out.add(rawName.replace(/\s+/g, '').toUpperCase()) // 법인명 전체가 병원명(예: 의료법인한양의료재단) — 정규화가 전부 소거되면 원명 사용
  const sh = b.replace(/학교|의과대학|대학\s*교/g, '')
  if (sh) out.add(sh)
  const parens = rawName.match(/\(([^)]+)\)/g) ?? []
  for (let i = 0; i < parens.length; i++) {
    const inner = parens[i].slice(1, -1).replace(/\s+/g, '').toUpperCase()
    if (inner.length >= 3 && /병원|의료원|센터/.test(inner)) { out.add(inner); out.add(inner.replace(/학교|의과대학/g, '')) }
  }
  return Array.from(out)
}

export function buildHospitalMatcher(hospitals: { hospitalCode: string; hospitalName: string }[]): HospitalMatcher {
  const byAlias = new Map<string, string[]>()
  for (const h of hospitals) for (const k of aliases(h.hospitalName)) {
    const arr = byAlias.get(k) ?? []
    if (!arr.includes(h.hospitalCode)) arr.push(h.hospitalCode)
    byAlias.set(k, arr)
  }
  const nameMap = new Map(hospitals.map((h) => [h.hospitalCode, h.hospitalName] as [string, string]))
  const cache = new Map<string, string | null>()

  const partialCands = (keys: string[]): Set<string> => {
    const cands = new Set<string>()
    byAlias.forEach((arr, ak) => {
      for (const k of keys) {
        if (k.length < 4 || ak.length < 4) continue
        if (ak.includes(k) || k.includes(ak)) arr.forEach((c) => cands.add(c))
      }
    })
    return cands
  }

  return {
    match(rawName0: string): string | null {
      const rawName = rawName0.normalize('NFC')
      if (cache.has(rawName)) return cache.get(rawName)!
      let code: string | null = null
      const keys = aliases(rawName)
      for (const k of keys) { const arr = byAlias.get(k) ?? []; if (arr.length === 1) { code = arr[0]; break } }
      if (!code) {
        const cands = partialCands(keys)
        if (cands.size === 1) code = Array.from(cands)[0]
      }
      cache.set(rawName, code)
      return code
    },
    candidates(rawName0: string): string[] {
      const keys = aliases(rawName0.normalize('NFC'))
      const cands = partialCands(keys)
      for (const k of keys) (byAlias.get(k) ?? []).forEach((c) => cands.add(c))
      return Array.from(cands)
    },
    nameOf: (code) => nameMap.get(code),
  }
}

/** 고객사 풀(프로젝트·기기 배치·딜 중 하나라도 보유)로 매처 생성 */
export async function loadHospitalMatcher(): Promise<HospitalMatcher> {
  const hospitals = await prisma.hospital.findMany({
    where: { OR: [{ projects: { some: {} } }, { hospitalDevices: { some: {} } }, { salesDeals: { some: {} } }] },
    select: { hospitalCode: true, hospitalName: true },
  })
  return buildHospitalMatcher(hospitals)
}
