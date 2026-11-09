import { prisma } from '@/lib/prisma'
import type { HospitalReportFacts, KindCount, VocItem } from './types'

/**
 * 병원 운영 이력 보고서 — 데이터 수집 (projects/hospital_report_design.md §6)
 * DB 읽기 전용. 수치·표는 전부 여기서 만든다 (AI는 숫자를 만들지 않는다 — §3).
 */

const q = <T>(sql: string, ...params: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...params)

/** 기기명 → 기종 축 (device_info.device_name 기준) */
export function kindOf(name: string | null | undefined): keyof KindCount {
  const n = name ?? ''
  if (n.includes('산소')) return 'spo2'
  if (n.includes('심전')) return 'ecg'
  return 'other'
}
const zero = (): KindCount => ({ spo2: 0, ecg: 0, other: 0 })

export function stripHtml(v: string | null | undefined, max = 2000): string {
  if (!v) return ''
  const t = v
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function quarterLabel(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number)
  return `${y}년 ${Math.floor((m - 1) / 3) + 1}분기`
}
function quarterKey(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number)
  return `${y}-${Math.floor((m - 1) / 3) + 1}`
}
function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const round1 = (n: number) => Math.round(n * 10) / 10

/** 수리 판정 소견 키워드 (process_note) — 중복 집계 */
const REPAIR_FINDINGS: { label: string; re: RegExp }[] = [
  { label: '내부 케이블 단선', re: /케이블\s*단선/ },
  { label: '포고핀 브라켓 마모·인식 불량', re: /포고핀/ },
  { label: '인식 불량', re: /인식\s*불량/ },
  { label: '액정 표시 이상', re: /액정/ },
  { label: '사출 파손', re: /사출/ },
  { label: '배터리·배터리 커버', re: /배터리/ },
  { label: '스트랩 파손', re: /스트랩/ },
]

export async function collectHospitalFacts(hospitalCode: string): Promise<HospitalReportFacts> {
  // ── 기본
  const [h] = await q<{
    code: string; name: string | null; hira_name: string | null; type: string | null; address: string | null; status: string | null
    intro_type: string | null; intro_beds: number | null; contract_date: string | null; intro_types: string | null
  }>(
    `select h.hospital_code code, h.hospital_name name, h.hira_hospital_name hira_name, h.type, h.address, h.status, h.intro_type, h.intro_beds,
            to_char(h.contract_date at time zone 'Asia/Seoul','YYYY-MM-DD') contract_date,
            (select string_agg(sc.name, ', ') from hospital_intro_types hit join status_codes sc on sc.id = hit.status_code_id where hit.hospital_id = h.id) intro_types
       from hospitals h where h.hospital_code = $1`, hospitalCode)
  if (!h) throw new Error('병원을 찾을 수 없습니다')

  const [meta] = await q<{ as_memo: string | null; as_memo_updated_at: string | null; ra: boolean }>(
    `select as_memo, to_char(as_memo_updated_at at time zone 'Asia/Seoul','YYYY-MM-DD') as_memo_updated_at,
            (remote_access_url is not null or remote_control_url is not null) ra
       from hospital_meta where hospital_code = $1`, hospitalCode)
  const tags = await q<{ name: string; description: string | null; assigned_at: string | null }>(
    `select t.name, t.description, to_char(a.assigned_at at time zone 'Asia/Seoul','YYYY-MM-DD') assigned_at
       from hospital_tag_assignments a join hospital_tags t on t.id = a.tag_id where a.hospital_code = $1 order by a.assigned_at`, hospitalCode)
  const contacts = await q<{ name: string; department: string | null; title: string | null; note: string | null }>(
    `select p.name, a.department, a.title, a.note from person_affiliations a join persons p on p.id = a.person_id
      where a.hospital_code = $1 and a.is_current and p.is_active order by a.is_primary desc, a.id limit 8`, hospitalCode)
  const [infra] = await q<{ servers: number; emr: number }>(
    `select (select count(*)::int from hospital_servers where hospital_code = $1) servers,
            (select count(*)::int from hospital_emr_info where hospital_code = $1) emr`, hospitalCode)

  // ── 계약·구축
  const dealRows = await q<{
    id: number; code: string; round_no: number | null; status: string | null; contract_date: string | null; ward_count: number | null; bed_count: number | null
    wards_text: string | null; product_type: string | null; project_code: string | null; total: string | null; product: string | null; construction: string | null
    actual: string | null; tax: string | null; settle: string | null; office: string | null; division: string | null; manager: string | null; remark: string | null
    client_code: string | null
  }>(
    `select d.id, d.deal_code code, d.round_no, sc.name status, to_char(d.contract_date,'YYYY-MM-DD') contract_date, d.ward_count, d.bed_count, d.wards_text,
            d.product_type, d.project_code, d.daewoong_amount_total::text total, d.daewoong_amount_product::text product,
            d.daewoong_amount_construction::text construction, d.daewoong_amount_actual::text actual, d.daewoong_tax_invoice tax, d.daewoong_settlement settle,
            d.daewoong_office office, d.daewoong_division division, d.daewoong_manager manager, d.remark, d.daewoong_client_code client_code
       from sales_deals d left join status_codes sc on sc.id = d.status_id where d.hospital_code = $1 order by d.round_no nulls last, d.contract_date`, hospitalCode)
  const dealDevices = await q<{ deal_id: number; name: string; qty: number }>(
    `select sd.deal_id, di.device_name name, sd.quantity qty from sales_deal_devices sd join device_info di on di.id = sd.device_info_id
       join sales_deals d on d.id = sd.deal_id where d.hospital_code = $1 order by di.sort_order`, hospitalCode)
  const num = (v: string | null) => (v == null ? null : Number(v))
  const deals = dealRows.map((d) => ({
    code: d.code, roundNo: d.round_no, status: d.status, contractDate: d.contract_date, wardCount: d.ward_count, bedCount: d.bed_count,
    wardsText: d.wards_text, productType: d.product_type, projectCode: d.project_code,
    devices: dealDevices.filter((x) => x.deal_id === d.id).map((x) => ({ name: x.name, qty: x.qty })),
    amountTotal: num(d.total), amountProduct: num(d.product), amountConstruction: num(d.construction), amountActual: num(d.actual),
    taxInvoice: d.tax, settlement: d.settle, daewoongOffice: d.office, daewoongDivision: d.division, daewoongManager: d.manager, remark: d.remark,
  }))

  const projectRows = await q<{
    code: string; name: string; build_status: string | null; constructor: string | null; contract_type: string | null; ward_count: number | null
    bed_count: number | null; gateway_count: number | null; start_date: string | null; end_date: string | null; edu: string | null; assignees: number
  }>(
    `select p.project_code code, p.project_name name, bs.label build_status, coalesce(c.name, p.builder_name_manual) constructor, p.contract_type,
            p.ward_count, p.bed_count, p.gateway_count,
            to_char(p.start_date at time zone 'Asia/Seoul','YYYY-MM-DD') start_date, to_char(p.end_date_expected at time zone 'Asia/Seoul','YYYY-MM-DD') end_date,
            to_char(p.education_date at time zone 'Asia/Seoul','YYYY-MM-DD') edu,
            (select count(*)::int from project_assignees pa where pa.project_code = p.project_code) assignees
       from projects p left join build_statuses bs on bs.id = p.build_status_id left join constructors c on c.id = p.constructor_id
      where p.hospital_code = $1 order by p.order_number nulls last, p.project_code`, hospitalCode)
  const projects = projectRows.map((p) => ({
    code: p.code, name: p.name, buildStatus: p.build_status, constructor: p.constructor, contractType: p.contract_type, wardCount: p.ward_count,
    bedCount: p.bed_count, gatewayCount: p.gateway_count, startDate: p.start_date, endDateExpected: p.end_date, educationDate: p.edu, assigneeCount: p.assignees,
  }))

  // ── 기기 원장
  const contracted = zero()
  for (const d of deals) if (d.status === '계약완료') for (const x of d.devices) contracted[kindOf(x.name)] += x.qty
  const activeRows = await q<{ ward: string | null; name: string; n: number; first: string | null }>(
    `select w.name ward, di.device_name name, count(*)::int n, to_char(min(hd.placed_on),'YYYY-MM-DD') first
       from hospital_devices hd join device_units du on du.id = hd.device_id join device_info di on di.id = du.device_info_id
       left join hospital_wards w on w.id = hd.ward_id
      where hd.hospital_code = $1 and hd.status = 'ACTIVE' group by 1, 2`, hospitalCode)
  const active = zero()
  const wardMap = new Map<string, { name: string; spo2: number; ecg: number; other: number }>()
  let noWard = 0
  let firstPlacedOn: string | null = null
  for (const r of activeRows) {
    const k = kindOf(r.name)
    active[k] += r.n
    if (!r.ward) noWard += r.n
    else {
      const w = wardMap.get(r.ward) ?? { name: r.ward, spo2: 0, ecg: 0, other: 0 }
      w[k] += r.n
      wardMap.set(r.ward, w)
    }
    if (r.first && (!firstPlacedOn || r.first < firstPlacedOn)) firstPlacedOn = r.first
  }
  const wards = Array.from(wardMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))

  // ── AS
  const asLines = await q<{
    id: number; code: string; receipt_date: string; status: string | null; category: string | null; source: string | null; resolved_at: string | null
    picked_up_at: string | null; received_at: string | null; serial: string; kind_name: string | null; ward: string | null; outcome: string | null
    repair_result: string | null; process_note: string | null; ledger_other: string | null
  }>(
    `select r.id, r.as_code code, to_char(r.receipt_date,'YYYY-MM-DD') receipt_date, sc.name status, r.category, r.source,
            to_char(r.resolved_at,'YYYY-MM-DD') resolved_at, to_char(r.picked_up_at,'YYYY-MM-DD') picked_up_at, to_char(r.received_at,'YYYY-MM-DD') received_at,
            i.serial_no serial, coalesce(di.device_name, i.device_kind) kind_name, nullif(trim(i.ward_name),'') ward, i.outcome, i.repair_result, i.process_note,
            (select h2.hospital_name from hospital_devices hd join hospitals h2 on h2.hospital_code = hd.hospital_code
              where hd.device_id = i.device_id and hd.status = 'ACTIVE' and hd.hospital_code <> r.hospital_code limit 1) ledger_other
       from as_receipts r left join status_codes sc on sc.id = r.status_id
       left join as_receipt_items i on i.receipt_id = r.id
       left join device_units du on du.id = i.device_id left join device_info di on di.id = du.device_info_id
      where r.hospital_code = $1 order by r.receipt_date, r.as_code, i.id`, hospitalCode)

  type Receipt = HospitalReportFacts['as']['receipts'][number]
  const receiptMap = new Map<string, Receipt>()
  const serialCount = new Map<string, number>()
  const distinctByKindSets = { spo2: new Set<string>(), ecg: new Set<string>(), other: new Set<string>() }
  let wardMissing = 0
  const repairByKind = new Map<string, { repaired: number; noFault: number }>()
  const findingCount = new Map<string, number>()
  let judged = 0
  const otherHospitalSerials: HospitalReportFacts['as']['otherHospitalSerials'] = []
  for (const l of asLines) {
    let rc = receiptMap.get(l.code)
    if (!rc) {
      const lead = l.resolved_at ? Math.round((Date.parse(l.resolved_at) - Date.parse(l.receipt_date)) / 86400000) : null
      rc = {
        code: l.code, receiptDate: l.receipt_date, status: l.status, category: l.category, source: l.source, resolvedAt: l.resolved_at, leadDays: lead,
        lines: 0, kind: zero(), outcome: { replace: 0, repairReturn: 0, canceled: 0, undecided: 0 }, pickedUpAt: l.picked_up_at, receivedAt: l.received_at,
        repaired: 0, noFault: 0,
      }
      receiptMap.set(l.code, rc)
    }
    if (!l.serial) continue
    rc.lines++
    const k = kindOf(l.kind_name ?? (l.serial.startsWith('A') ? '심전계' : l.serial.startsWith('P') ? '산소포화도' : null))
    rc.kind[k]++
    if (l.outcome === 'REPLACE') rc.outcome.replace++
    else if (l.outcome === 'REPAIR_RETURN') rc.outcome.repairReturn++
    else if (l.outcome === 'CANCELED') rc.outcome.canceled++
    else rc.outcome.undecided++
    serialCount.set(l.serial, (serialCount.get(l.serial) ?? 0) + 1)
    distinctByKindSets[k].add(l.serial)
    if (!l.ward) wardMissing++
    if (l.repair_result) {
      judged++
      const label = k === 'spo2' ? '산소포화도' : k === 'ecg' ? '심전계' : '기타'
      const b = repairByKind.get(label) ?? { repaired: 0, noFault: 0 }
      if (l.repair_result === 'NO_FAULT') { b.noFault++; rc.noFault++ } else { b.repaired++; rc.repaired++ }
      repairByKind.set(label, b)
      for (const f of REPAIR_FINDINGS) if (f.re.test(l.process_note ?? '')) findingCount.set(f.label, (findingCount.get(f.label) ?? 0) + 1)
    }
    if (!l.resolved_at && l.ledger_other) otherHospitalSerials.push({ asCode: l.code, serial: l.serial, hospitalName: l.ledger_other })
  }
  const receipts = Array.from(receiptMap.values())
  const kindSum = (rs: Receipt[]) => rs.reduce((a, r) => ({ spo2: a.spo2 + r.kind.spo2, ecg: a.ecg + r.kind.ecg, other: a.other + r.kind.other }), zero())
  const qMap = new Map<string, Receipt[]>()
  for (const r of receipts) qMap.set(quarterKey(r.receiptDate), [...(qMap.get(quarterKey(r.receiptDate)) ?? []), r])
  const quarters = Array.from(qMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, rs]) => {
    const kind = kindSum(rs)
    return { label: quarterLabel(rs[0].receiptDate), receipts: rs.length, kind, total: kind.spo2 + kind.ecg + kind.other }
  })
  const mMap = new Map<string, { receipts: number; lines: number }>()
  for (const r of receipts) {
    const m = r.receiptDate.slice(0, 7)
    const v = mMap.get(m) ?? { receipts: 0, lines: 0 }
    v.receipts++
    v.lines += r.lines
    mMap.set(m, v)
  }
  const peak = Array.from(mMap.entries()).sort((a, b) => b[1].lines - a[1].lines)[0]
  const done = receipts.filter((r) => r.resolvedAt)
  const leads = done.map((r) => r.leadDays!).filter((x) => x != null)
  const outcome = receipts.reduce(
    (a, r) => ({ replace: a.replace + r.outcome.replace, repairReturn: a.repairReturn + r.outcome.repairReturn, canceled: a.canceled + r.outcome.canceled, undecided: a.undecided + r.outcome.undecided }),
    { replace: 0, repairReturn: 0, canceled: 0, undecided: 0 })
  const repeatDist = new Map<number, number>()
  for (const c of Array.from(serialCount.values())) repeatDist.set(c, (repeatDist.get(c) ?? 0) + 1)
  const totalKind = kindSum(receipts)

  // ── VOC
  const vocRows = await q<{
    code: string; received_at: string; type: string | null; status: string | null; source: string | null; title: string | null; content: string | null
    resolution: string | null; channel: string | null; status_changed: string | null
  }>(
    `select v.voc_code code, to_char(v.received_at at time zone 'Asia/Seoul','YYYY-MM-DD') received_at, t.name type, s.name status, v.source,
            v.title, v.content, v.resolution, ch.name channel, to_char(v.status_changed_at at time zone 'Asia/Seoul','YYYY-MM-DD') status_changed
       from voc_receipts v left join status_codes t on t.id = v.voc_type_id left join status_codes s on s.id = v.status_id
       left join status_codes ch on ch.id = v.channel_id
      where v.hospital_code = $1 order by v.received_at, v.voc_code`, hospitalCode)
  const vocItems: VocItem[] = vocRows.map((v) => ({
    code: v.code, receivedAt: v.received_at, type: v.type, status: v.status, source: v.source,
    title: stripHtml(v.title, 200), content: stripHtml(v.content, 1000), resolution: stripHtml(v.resolution, 800),
  }))
  const countBy = <T>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, number>()
    for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1)
    return Array.from(m.entries()).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n)
  }
  const groupMap = new Map<string, Map<string, number>>()
  for (const v of vocItems) {
    const t = v.type ?? '(미분류)'
    const [g, ...rest] = t.split('/')
    const sub = rest.join('/') || g
    const m = groupMap.get(g) ?? new Map<string, number>()
    m.set(sub, (m.get(sub) ?? 0) + 1)
    groupMap.set(g, m)
  }
  const byGroup = Array.from(groupMap.entries())
    .map(([group, m]) => ({ group, count: Array.from(m.values()).reduce((a, b) => a + b, 0), subs: Array.from(m.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.count - a.count)
  const vqMap = new Map<string, { label: string; count: number }>()
  for (const v of vocItems) {
    const k = quarterKey(v.receivedAt)
    const e = vqMap.get(k) ?? { label: quarterLabel(v.receivedAt), count: 0 }
    e.count++
    vqMap.set(k, e)
  }
  const unresolved = vocRows.filter((v) => v.status && v.status !== '종결').map((v) => ({ code: v.code, receivedAt: v.received_at, status: v.status!, title: stripHtml(v.title, 80) }))

  // ── 채널톡 상담 (병원 매칭분) — 봇 요약 메시지
  const chatRows = await q<{ id: string; opened_at: string | null; tags: string[] | null; first_ask: string | null; summary: string | null }>(
    `select c.id, to_char(c.opened_at at time zone 'Asia/Seoul','YYYY-MM-DD') opened_at, c.tags, c.first_ask_text first_ask,
            (select m.plain_text from channeltalk_messages m where m.chat_id = c.id and m.person_type = 'bot' and m.plain_text like '1.%'
              order by m.created_at_ct desc limit 1) summary
       from channeltalk_user_chats c where c.hospital_code = $1 order by c.opened_at`, hospitalCode)
  const chats = chatRows.map((c) => ({ id: c.id, openedAt: c.opened_at, tags: c.tags ?? [], summary: c.summary ? stripHtml(c.summary, 600) : null, firstAsk: c.first_ask ? stripHtml(c.first_ask, 200) : null }))

  // ── 유지보수·기타업무·티켓
  const mRows = await q<{
    code: string; title: string; status: string | null; type: string | null; reporter: string | null; reported: string | null; visit: string | null
    resolved: string | null; symptoms: string | null; resolution: string | null; notes: string | null
  }>(
    `select m.maintenance_code code, m.title, s.name status, t.name type, m.reporter_name reporter, to_char(m.reported_at,'YYYY-MM-DD') reported,
            to_char(m.visit_date,'YYYY-MM-DD') visit, to_char(m.resolved_at,'YYYY-MM-DD') resolved, m.symptoms, m.resolution, m.notes
       from maintenances m left join status_codes s on s.id = m.status_id left join status_codes t on t.id = m.type_id
      where m.hospital_code = $1 order by m.reported_at`, hospitalCode)
  const maintenances = mRows.map((m) => ({
    code: m.code, title: m.title, status: m.status, type: m.type, reporter: m.reporter, reportedAt: m.reported, visitDate: m.visit, resolvedAt: m.resolved,
    symptoms: stripHtml(m.symptoms, 600) || null, resolution: stripHtml(m.resolution, 800) || null, notes: stripHtml(m.notes, 600) || null,
  }))
  const eRows = await q<{ code: string; title: string; status: string | null; reported: string | null; resolved: string | null; note: string | null }>(
    `select e.etc_task_code code, e.title, s.name status, to_char(e.reported_at,'YYYY-MM-DD') reported, to_char(e.resolved_at,'YYYY-MM-DD') resolved, e.note
       from etc_tasks e join etc_task_hospitals eh on eh.etc_task_id = e.id left join status_codes s on s.id = e.status_id
      where eh.hospital_code = $1 order by e.reported_at`, hospitalCode)
  const etcTasks = eRows.map((e) => ({ code: e.code, title: e.title, status: e.status, reportedAt: e.reported, resolvedAt: e.resolved, note: stripHtml(e.note, 400) || null }))
  const tickets = (await q<{ ref_type: string | null; status: string; count: number }>(
    `select ref_type, status::text, count(*)::int count from tickets where hospital_code = $1 group by 1, 2 order by 1, 2`, hospitalCode))
    .map((t) => ({ refType: t.ref_type ?? '일반', status: t.status, count: t.count }))

  // ── 연혁 (코드 규칙으로 추출)
  const timeline: HospitalReportFacts['timeline'] = []
  for (const d of deals) if (d.contractDate) timeline.push({ date: d.contractDate, kind: '계약', text: `${d.code}${d.roundNo ? ` ${d.roundNo}차` : ''} ${d.status ?? ''} — ${[d.wardsText, d.bedCount ? `${d.bedCount}병상` : null, d.devices.map((x) => `${x.name} ${x.qty}`).join(' · ')].filter(Boolean).join(', ')}` })
  for (const p of projects) {
    if (p.startDate) timeline.push({ date: p.startDate, kind: '구축', text: `${p.name} 구축 착수${p.constructor ? ` (${p.constructor})` : ''}${p.gatewayCount ? ` — 게이트웨이 ${p.gatewayCount}대` : ''}` })
    if (p.endDateExpected) timeline.push({ date: p.endDateExpected, kind: '구축', text: `${p.name} 완료 예정일${p.buildStatus ? ` (현재 ${p.buildStatus})` : ''}` })
  }
  if (vocItems[0]) timeline.push({ date: vocItems[0].receivedAt, kind: 'VOC', text: `첫 VOC 기록 — ${vocItems[0].title}` })
  if (receipts[0]) timeline.push({ date: receipts[0].receiptDate, kind: 'AS', text: `첫 AS 접수 (${receipts[0].lines}대)` })
  const big = [...receipts].sort((a, b) => b.lines - a.lines)[0]
  if (big && receipts.length > 1) timeline.push({ date: big.receiptDate, kind: 'AS', text: `단일 최대 AS 접수 ${big.lines}대 (${big.code})${big.resolvedAt ? '' : ` — 현재 '${big.status ?? '진행'}'`}` })
  if (peak && receipts.length > 2) timeline.push({ date: `${peak[0]}-01`, kind: 'AS', text: `월 최대 AS — ${peak[1].receipts}회 ${peak[1].lines}대` })
  for (const m of maintenances) timeline.push({ date: m.reportedAt ?? '', kind: '유지보수', text: `${m.title}${m.visitDate ? ` — ${m.visitDate} 방문` : ''} (${m.code})` })
  for (const e of etcTasks) timeline.push({ date: e.reportedAt ?? '', kind: '기타업무', text: `${e.title} (${e.code})` })
  for (const t of tags) if (t.assigned_at) timeline.push({ date: t.assigned_at, kind: '운영 설정', text: `병원 태그 '${t.name}' 지정` })
  for (const r of receipts.filter((r) => !r.resolvedAt && !(big && receipts.length > 1 && r.code === big.code))) timeline.push({ date: r.receiptDate, kind: 'AS', text: `${r.code} ${r.lines}대 접수 — 현재 '${r.status ?? '진행'}'` })
  timeline.sort((a, b) => a.date.localeCompare(b.date))
  const tl = timeline.filter((t, i) => t.date && timeline.findIndex((x) => x.date === t.date && x.text === t.text) === i)

  // ── 데이터 점검 규칙 (§6)
  const checks: HospitalReportFacts['checks'] = []
  const contractedTotal = contracted.spo2 + contracted.ecg + contracted.other
  const activeTotal = active.spo2 + active.ecg + active.other
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
  if (contractedTotal > 0) {
    const ratio = pct(activeTotal, contractedTotal)
    checks.push({ key: 'registry_ratio', label: '기기 원장 등록률', level: ratio < 90 ? 'warn' : 'ok',
      detail: `계약 ${contractedTotal.toLocaleString()}대 대비 원장 ACTIVE ${activeTotal.toLocaleString()}대 (${ratio}%)`,
      impact: ratio < 90 ? '병동별 배치 현황·AS 비율 분모 부정확' : '—' })
  }
  if (activeTotal > 0) {
    checks.push({ key: 'device_no_ward', label: '원장 병동 미지정', level: pct(noWard, activeTotal) > 10 ? 'warn' : 'ok',
      detail: `ACTIVE ${activeTotal.toLocaleString()}대 중 ${noWard}대 (${pct(noWard, activeTotal)}%)`, impact: '병동별 분석 누락' })
  }
  const lineTotal = receipts.reduce((a, r) => a + r.lines, 0)
  if (lineTotal > 0) {
    checks.push({ key: 'as_ward_missing', label: 'AS 라인 병동 미기재', level: pct(wardMissing, lineTotal) > 10 ? 'warn' : 'ok',
      detail: `AS 라인 ${lineTotal}대 중 ${wardMissing}대 (${pct(wardMissing, lineTotal)}%)`, impact: '병동별 고장 분석 불가' })
  }
  const undecidedInDone = done.reduce((a, r) => a + r.outcome.undecided, 0)
  if (done.length > 0) {
    checks.push({ key: 'as_outcome_missing', label: '완료 AS 라인 처리 결과 미기재', level: undecidedInDone > 0 ? 'warn' : 'ok',
      detail: undecidedInDone > 0 ? `완료 접수 중 결과 미기재 ${undecidedInDone}대 (${done.filter((r) => r.outcome.undecided > 0).map((r) => r.code).join(', ')})` : '없음',
      impact: '교체·수리 반환 통계 왜곡' })
  }
  const mismatch = vocRows.filter((v) => v.status && !['종결'].includes(v.status) && /클로즈|종결|종료/.test(stripHtml(v.resolution) + stripHtml(v.content)))
  checks.push({ key: 'voc_status_mismatch', label: 'VOC 본문·상태 불일치', level: mismatch.length ? 'warn' : 'ok',
    detail: mismatch.length ? `본문은 종료인데 상태 미종결 ${mismatch.length}건 (${mismatch.map((v) => v.code).join(', ')})` : '없음', impact: '미결 현황 과대 집계' })
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const repliedOpen = vocRows.filter((v) => v.status === '회신완료' && (v.status_changed ?? v.received_at) < weekAgo)
  checks.push({ key: 'voc_replied_open', label: 'VOC 회신완료 장기 미종결', level: repliedOpen.length ? 'warn' : 'ok',
    detail: repliedOpen.length ? `${repliedOpen.length}건 (${repliedOpen.map((v) => v.code).join(', ')})` : '없음', impact: '종결 처리 누락' })
  for (const d of deals) {
    const p = projects.find((x) => x.code === d.projectCode)
    if (p && d.wardCount != null && p.wardCount != null && d.wardCount !== p.wardCount) {
      checks.push({ key: `ward_mismatch_${d.code}`, label: '딜·프로젝트 병동 수 불일치', level: 'warn', detail: `${d.code} ${d.wardCount}병동 ↔ ${p.code} ${p.wardCount}병동`, impact: '구축 범위 해석 혼선' })
    }
  }
  for (const p of projects) {
    const miss = [p.assigneeCount === 0 ? '담당자' : null, !p.educationDate ? '교육일' : null].filter(Boolean)
    if (miss.length) checks.push({ key: `project_missing_${p.code}`, label: '프로젝트 정보 미기재', level: 'warn', detail: `${p.code} — ${miss.join('·')} 미기재`, impact: '구축 이력 추적 불가' })
  }
  if (infra.servers === 0 && infra.emr === 0 && !meta?.ra) {
    checks.push({ key: 'infra_missing', label: '인프라 정보', level: 'warn', detail: '서버·EMR 연동·원격 접속 정보 미등록', impact: '장애 대응 시 현장 확인 의존' })
  }
  const lastVoc = vocItems[vocItems.length - 1]?.receivedAt ?? null
  const asAfterLastVoc = lastVoc ? receipts.filter((r) => r.receiptDate > lastVoc).length : 0
  if (lastVoc && asAfterLastVoc >= 2) {
    checks.push({ key: 'voc_gap', label: 'VOC 기록 공백 가능성', level: 'warn', detail: `마지막 VOC ${lastVoc} 이후 AS 접수 ${asAfterLastVoc}건`, impact: '최근 문의 이력 과소 집계' })
  }
  if (otherHospitalSerials.length) {
    checks.push({ key: 'as_other_hospital', label: '진행 중 AS 타병원 등록 시리얼', level: 'warn',
      detail: `${otherHospitalSerials.length}대 (${otherHospitalSerials.map((s) => `${s.serial}→${s.hospitalName}`).join(', ')})`, impact: 'AS 확정 처리 보류' })
  }

  const counts = (await q<{ label: string; count: number }>(
    `select '기기 원장 이벤트' label, count(*)::int count from hospital_device_events where hospital_code = $1`, hospitalCode))[0]

  return {
    version: 1,
    asOf: new Date().toISOString(),
    hospital: {
      code: h.code, name: h.name ?? h.hira_name ?? h.code, type: h.type, address: h.address, status: h.status,
      introType: h.intro_types ?? h.intro_type, introBeds: h.intro_beds, contractDate: h.contract_date,
      asMemo: meta?.as_memo ? stripHtml(meta.as_memo, 500) : null, asMemoUpdatedAt: meta?.as_memo_updated_at ?? null,
      tags: tags.map((t) => ({ name: t.name, description: t.description, assignedAt: t.assigned_at })),
      hasRemoteAccess: !!meta?.ra, serverCount: infra.servers, emrCount: infra.emr,
      daewoongClientCode: dealRows.find((d) => d.client_code)?.client_code ?? null,
      contacts: contacts.map((c) => ({ name: c.name, department: c.department, title: c.title, note: c.note })),
    },
    deals,
    projects,
    devices: { contracted, active, activeTotal, noWard, wards, firstPlacedOn },
    as: {
      receipts,
      quarters,
      totals: { receipts: receipts.length, lines: lineTotal, kind: totalKind, done: done.length, open: receipts.length - done.length },
      peakMonth: peak ? { month: peak[0], receipts: peak[1].receipts, lines: peak[1].lines } : null,
      lead: {
        median: median(leads), avg: leads.length ? round1(leads.reduce((a, b) => a + b, 0) / leads.length) : null,
        longest: [...done].sort((a, b) => (b.leadDays ?? 0) - (a.leadDays ?? 0)).slice(0, 4).filter((r) => (r.leadDays ?? 0) >= 30).map((r) => ({ code: r.code, days: r.leadDays! })),
      },
      outcome: { ...outcome, undecidedInDone },
      repeat: {
        distinctSerials: serialCount.size,
        repeatedSerials: Array.from(serialCount.values()).filter((c) => c > 1).length,
        dist: Array.from(repeatDist.entries()).filter(([t]) => t > 1).sort((a, b) => a[0] - b[0]).map(([times, serials]) => ({ times, serials })),
        top: Array.from(serialCount.entries()).filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([serial, times]) => ({ serial, times })),
      },
      distinctByKind: { spo2: distinctByKindSets.spo2.size, ecg: distinctByKindSets.ecg.size, other: distinctByKindSets.other.size },
      wardMissing,
      repair: {
        judged,
        repaired: Array.from(repairByKind.values()).reduce((a, b) => a + b.repaired, 0),
        noFault: Array.from(repairByKind.values()).reduce((a, b) => a + b.noFault, 0),
        byKind: Array.from(repairByKind.entries()).map(([kind, v]) => ({ kind, ...v })),
        findings: Array.from(findingCount.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      },
      otherHospitalSerials,
    },
    voc: {
      total: vocItems.length,
      firstAt: vocItems[0]?.receivedAt ?? null,
      lastAt: lastVoc,
      byStatus: countBy(vocRows, (v) => v.status ?? '(없음)').map(({ k, n }) => ({ status: k, count: n })),
      bySource: countBy(vocRows, (v) => v.source ?? '(없음)').map(({ k, n }) => ({ source: k, count: n })),
      byQuarter: Array.from(vqMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v),
      byGroup,
      unresolved,
      items: vocItems,
    },
    chats,
    maintenances,
    etcTasks,
    tickets,
    timeline: tl,
    checks,
    sourceCounts: [
      { label: '영업 딜', count: deals.length },
      { label: '프로젝트', count: projects.length },
      { label: '기기 원장(ACTIVE)', count: activeTotal },
      { label: counts.label, count: counts.count },
      { label: 'AS 접수', count: receipts.length },
      { label: 'AS 기기 라인', count: lineTotal },
      { label: 'VOC', count: vocItems.length },
      { label: '채널톡 상담(병원 매칭)', count: chats.length },
      { label: '유지보수', count: maintenances.length },
      { label: '기타업무', count: etcTasks.length },
      { label: '티켓', count: tickets.reduce((a, t) => a + t.count, 0) },
    ],
  }
}
