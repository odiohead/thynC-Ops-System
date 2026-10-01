/**
 * AS접수 목록 열 카탈로그 + 사용자 열 설정 (2026-10-01, 클라이언트 안전)
 * - 고정 3열(접수번호·병원명·접수일)은 항상 맨 앞·숨김/이동 불가 (폭 조절만 가능)
 * - 나머지는 사용자가 표시 여부·순서(헤더 드래그)·폭(헤더 경계 드래그)을 바꾸고 [저장] → user_view_prefs('as_receipts_list')
 */
export type AsListSortKey = 'asCode' | 'hospital' | 'category' | 'status' | 'receiptDate' | 'receivedAt' | 'shippedAt'

export interface AsListColumnDef {
  key: string
  label: string
  /** 기본 폭(px) */
  width: number
  /** 최소 폭(px) — 셀 좌우 패딩 24px 포함. 날짜 열은 yyyy-mm-dd(+n/m)가 온전히 보이는 값(116/148/160). 리사이즈·저장값 정규화 모두 이 아래로 못 줄임 */
  minWidth?: number
  sort?: AsListSortKey
  /** 맨 앞 고정 — 숨김·이동 불가 */
  fixed?: boolean
  /** 기본 표시 여부 (fixed는 항상 true) */
  defaultVisible?: boolean
  /** 열 설정 패널 묶음 */
  group: '기본' | '접수정보' | '진행·처리' | '관리'
}

export const AS_LIST_VIEW_KEY = 'as_receipts_list'
export const AS_LIST_COL_MIN = 56

export const AS_LIST_COLUMNS: AsListColumnDef[] = [
  // ── 고정 3열 ──
  { key: 'asCode', label: '접수번호', width: 136, sort: 'asCode', fixed: true, group: '기본' },
  { key: 'hospital', label: '병원명', width: 180, sort: 'hospital', fixed: true, group: '기본' },
  { key: 'receiptDate', label: '접수일', width: 116, minWidth: 116, sort: 'receiptDate', fixed: true, group: '기본' }, // 날짜 열은 yyyy-mm-dd가 온전히 보이는 최소 폭 — 늘리기만 가능 (2026-10-01)
  // ── 기본 프리셋(종전 목록 순서) ──
  { key: 'ward', label: '병동', width: 120, defaultVisible: true, group: '기본' },
  { key: 'deviceState', label: '접수 기기상태', width: 110, defaultVisible: true, group: '기본' },
  { key: 'category', label: '구분', width: 64, sort: 'category', defaultVisible: true, group: '기본' },
  { key: 'devices', label: '기기', width: 170, defaultVisible: true, group: '기본' },
  { key: 'productType', label: '유형', width: 80, defaultVisible: true, group: '기본' },
  { key: 'status', label: '상태', width: 96, sort: 'status', defaultVisible: true, group: '기본' },
  { key: 'receivedAt', label: '입고일', width: 148, minWidth: 148, sort: 'receivedAt', defaultVisible: true, group: '기본' }, // '(n/m)' 병기 폭 포함
  { key: 'shippedAt', label: '발송일', width: 148, minWidth: 148, sort: 'shippedAt', defaultVisible: true, group: '기본' },
  { key: 'shipTrackingNo', label: '발송 송장번호', width: 160, defaultVisible: true, group: '기본' },
  { key: 'tags', label: '태그', width: 300, defaultVisible: true, group: '기본' },
  // ── 접수정보 (상세 2번 카드) ──
  { key: 'reporterName', label: '고객명', width: 120, group: '접수정보' },
  { key: 'pickupMethod', label: '수거방법', width: 90, group: '접수정보' },
  { key: 'pickedUpAt', label: '수거일', width: 116, minWidth: 116, group: '접수정보' },
  { key: 'pickupTrackingNo', label: '수거송장번호', width: 150, group: '접수정보' },
  { key: 'pickupDestDiffers', label: '회수지 상이', width: 80, group: '접수정보' },
  { key: 'pickupDestInfo', label: '회수지 정보', width: 200, group: '접수정보' },
  { key: 'destType', label: '발송지 구분', width: 100, group: '접수정보' },
  { key: 'destInfo', label: '발송지 정보', width: 200, group: '접수정보' },
  { key: 'expectedShipDate', label: '발송예정일', width: 116, minWidth: 116, group: '접수정보' },
  { key: 'note', label: '비고', width: 220, group: '접수정보' },
  { key: 'tagPreReplace', label: '선교체', width: 64, group: '접수정보' },
  { key: 'tagPriorityRepair', label: '우선수리', width: 72, group: '접수정보' },
  { key: 'tagFirmwareUpdate', label: '펌웨어 업데이트', width: 110, group: '접수정보' },
  { key: 'tagAccessory', label: '부속품 동봉', width: 90, group: '접수정보' },
  { key: 'tagCombinedPack', label: '합포장', width: 64, group: '접수정보' },
  // ── 진행·처리 (상세 3번 카드 집계) ──
  { key: 'checkedAt', label: '확인일', width: 116, minWidth: 116, group: '진행·처리' },
  { key: 'itemCount', label: '기기 수', width: 72, group: '진행·처리' },
  { key: 'closedCount', label: '종결 수', width: 72, group: '진행·처리' },
  { key: 'repairProgress', label: '수리완료', width: 90, group: '진행·처리' },
  { key: 'intakeIssues', label: '입고 대조 이슈', width: 100, group: '진행·처리' },
  { key: 'serials', label: '시리얼', width: 220, group: '진행·처리' },
  { key: 'newSerials', label: '교체기 시리얼', width: 180, group: '진행·처리' },
  { key: 'symptoms', label: '접수사유', width: 260, group: '진행·처리' },
  { key: 'outcomes', label: '처리방법', width: 160, group: '진행·처리' },
  { key: 'shipMethod', label: '발송방법', width: 90, group: '진행·처리' },
  { key: 'sheetDoneSynced', label: '시트 완료여부', width: 100, group: '진행·처리' },
  // ── 관리 ──
  { key: 'owner', label: '담당(티켓)', width: 100, group: '관리' },
  { key: 'ticketCode', label: '티켓번호', width: 136, group: '관리' },
  { key: 'ticketStatus', label: '티켓 상태', width: 100, group: '관리' },
  { key: 'createdBy', label: '등록자', width: 90, group: '관리' },
  { key: 'createdAt', label: '등록 일시', width: 160, minWidth: 160, group: '관리' },
  { key: 'statusChangedAt', label: '상태 변경일', width: 160, minWidth: 160, group: '관리' },
  { key: 'resolvedAt', label: '완료일', width: 116, minWidth: 116, group: '관리' },
]
export const AS_LIST_COLUMN_MAP: Record<string, AsListColumnDef> = Object.fromEntries(AS_LIST_COLUMNS.map((c) => [c.key, c]))
export const AS_LIST_FIXED_KEYS = AS_LIST_COLUMNS.filter((c) => c.fixed).map((c) => c.key)
export const AS_LIST_COLUMN_GROUPS = ['기본', '접수정보', '진행·처리', '관리'] as const

/** '기본' 프리셋 = 종전 목록 13열(고정 3 + defaultVisible) 원 순서·기본 폭 — 언제든 [기본으로]로 복원 */
/** 저장 형식 — 표시 열을 순서대로, 폭 포함 */
export interface AsListPrefs {
  version: 1
  columns: { key: string; width: number }[]
}

export function defaultAsListPrefs(): AsListPrefs {
  return { version: 1, columns: AS_LIST_COLUMNS.filter((c) => c.fixed || c.defaultVisible).map((c) => ({ key: c.key, width: c.width })) }
}

/** 저장값 정규화 — 알 수 없는 키 제거, 고정 3열을 카탈로그 순서로 맨 앞에 강제, 폭 범위 보정. 파손이면 기본값 */
export function normalizeAsListPrefs(raw: unknown): AsListPrefs {
  const def = defaultAsListPrefs()
  if (!raw || typeof raw !== 'object') return def
  const cols = (raw as { columns?: unknown }).columns
  if (!Array.isArray(cols)) return def
  const seen = new Set<string>()
  const rest: { key: string; width: number }[] = []
  const widthOf = new Map<string, number>()
  for (const c of cols) {
    if (!c || typeof c !== 'object') continue
    const key = (c as { key?: unknown }).key
    if (typeof key !== 'string' || !AS_LIST_COLUMN_MAP[key] || seen.has(key)) continue
    seen.add(key)
    const w = (c as { width?: unknown }).width
    const def_ = AS_LIST_COLUMN_MAP[key]
    const width = typeof w === 'number' && Number.isFinite(w) ? Math.min(2000, Math.max(def_.minWidth ?? AS_LIST_COL_MIN, Math.round(w))) : def_.width
    widthOf.set(key, width)
    if (!def_.fixed) rest.push({ key, width })
  }
  const fixed = AS_LIST_FIXED_KEYS.map((key) => ({ key, width: widthOf.get(key) ?? AS_LIST_COLUMN_MAP[key].width }))
  return { version: 1, columns: [...fixed, ...rest] }
}

export function samePrefs(a: AsListPrefs, b: AsListPrefs) {
  return a.columns.length === b.columns.length && a.columns.every((c, i) => c.key === b.columns[i].key && c.width === b.columns[i].width)
}
