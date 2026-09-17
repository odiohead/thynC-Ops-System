/**
 * 기기 상태·위치 축 백필 (2026-09-17 — projects/device_condition_location_design.md §9.1 · 부록 B)
 *
 * 마이그(20260917120000_device_condition_location)는 DDL·seed만 적용한다. 기존 유닛 28,355대의 condition/location과
 * 회수·입고 기기의 소급 INTAKE 이벤트(source BACKFILL)는 이 스크립트가 채운다.
 *
 *   npx tsx scripts/backfill-device-condition.mts            # --dry 기본: 규칙별 대상 건수·리포트만 (쓰기 없음)
 *   npx tsx scripts/backfill-device-condition.mts --dry
 *   npx tsx scripts/backfill-device-condition.mts --apply    # 단일 tx 적용 → 부록 B 검증 SQL 출력
 *   npx tsx scripts/backfill-device-condition.mts --rehearse # --apply와 같은 경로를 끝까지 실행하고 COMMIT 직전 롤백(dev2 리허설·PROD 사전 점검, 쓰기 없음)
 *     --skip-health-check    DEV 전용 — 실행 중 서버 가드(/api/health eventTypes에 INTAKE) 생략. PROD 금지(A.0 순서 5는 반드시 4 이후)
 *     --health-url <url>     기본 http://localhost:3001/api/health (또는 env BACKFILL_HEALTH_URL)
 *
 * 규칙 순서(특수→일반): 3 → 2 → 1 (배치 ACTIVE), 5 → 6 → 7 → 8 (배치 RECOVERED). 모든 규칙에 미처리 유닛 가드
 * `condition IS NULL AND location_site_id IS NULL AND location_hospital_code IS NULL`을 붙인다 — 먼저 적용된 규칙이 나중 규칙을 자연히
 * 제외하고, 재실행 시 전부 0건. 이벤트 백필은 `NOT EXISTS (INTAKE·BACKFILL·device_id)` 중복 가드 → 재실행 시 0건.
 *
 * 재실행 안전: 유닛 값은 미처리 가드로, INTAKE는 중복 가드로 보호된다. 실시간 서비스가 이미 값을 쓴 유닛은 건드리지 않는다(§9.4).
 * PROD는 규칙 5(명시 허락) 적용 — 배포 순서는 설계안 A.0(코드 배포·재시작 후 --dry → --apply → 스케줄러 복구).
 */
import 'dotenv/config'
import { execSync } from 'node:child_process'
import { Prisma, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const REHEARSE = args.includes('--rehearse')
const APPLY = args.includes('--apply') || REHEARSE
const SKIP_HEALTH = args.includes('--skip-health-check')
const healthIdx = args.indexOf('--health-url')
const HEALTH_URL = healthIdx >= 0 ? args[healthIdx + 1] : process.env.BACKFILL_HEALTH_URL ?? 'http://localhost:3001/api/health'
const LIST_CAP = 60
const MEMO = '상태·위치 축 도입 백필'
const ACTOR_NAME = '백필 스크립트'
/** 규칙 4(e) — PROD 동기화본에 섞인 테스트 데이터(독해 지도 실측) */
const TEST_SERIALS = ['A999999', 'A222222', 'SMP0006', 'P11111', 'A111111']
const TEST_HOSPITAL = 'HOSP-080599'
/** 부록 B 기대(DEV 2026-09-17 실측) — PROD는 --dry 재산출값이 기준 */
const EXPECTED_DEV = { r1: 26023, r2: 734, r3: 130, r5: 128, r6: 0, r7: 1340, r8: 0, intake: 1470 }

type Tx = Prisma.TransactionClient
type Row = Record<string, unknown>

const fmt = (v: unknown): string => {
  if (v == null) return '-'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}
function printRows(title: string, rows: Row[], cap = LIST_CAP) {
  console.log(`  ${title}: ${rows.length}건`)
  if (rows.length === 0) return
  const cols = Object.keys(rows[0])
  console.log(`    ${cols.join(' | ')}`)
  for (const r of rows.slice(0, cap)) console.log(`    ${cols.map((c) => fmt(r[c])).join(' | ')}`)
  if (rows.length > cap) console.log(`    … 외 ${rows.length - cap}건`)
}
async function q<T extends Row = Row>(tx: Tx, sql: string): Promise<T[]> {
  return tx.$queryRawUnsafe<T[]>(sql)
}
async function count(tx: Tx, sql: string): Promise<number> {
  const r = await q<{ n: number }>(tx, `SELECT count(*)::int AS n FROM (${sql}) t`)
  return r[0]?.n ?? 0
}

type HealthBody = { eventTypes?: unknown; buildCommit?: unknown }
/** 이 소스 트리의 HEAD(short) — git 없으면 null */
function gitHead(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}
/**
 * 실행 중 서버 가드(A.0) — 백필·신규 이벤트가 구 코드 위에 생기면 `foldStepOk` default false로 해당 유닛 rebuild 409.
 * ① `eventTypes`에 INTAKE 포함(신규 어휘 인지) ② `buildCommit`(next.config env 인라인)이 있으면 이 트리의 HEAD와 대조 — 불일치면 재시작 누락·다른 체크아웃(둘 다 SKIP_HEALTH로만 우회)
 */
async function checkRunningServer(): Promise<void> {
  let body: HealthBody | null = null
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) })
    body = (await res.json()) as HealthBody
  } catch (e) {
    console.log(`[health] ${HEALTH_URL} 응답 실패: ${e instanceof Error ? e.message : String(e)}`)
  }
  const types = Array.isArray(body?.eventTypes) ? (body.eventTypes as unknown[]) : []
  const ok = types.includes('INTAKE')
  const commit = typeof body?.buildCommit === 'string' && body.buildCommit ? body.buildCommit : null
  const head = commit ? gitHead() : null
  const commitOk = !commit || !head || commit.startsWith(head) || head.startsWith(commit)
  console.log(`[health] ${HEALTH_URL} → eventTypes ${types.length ? types.join(',') : '(없음)'} · buildCommit ${fmt(commit)}${commit ? ` (HEAD ${fmt(head)} ${commitOk ? '일치' : '불일치'})` : ' (구 빌드 — 커밋 미노출, eventTypes만 판정)'} → ${ok ? '✓ 신규 어휘 인지' : '✗ INTAKE 미포함(구 빌드 또는 미재시작)'}`)
  const reason = !ok ? '실행 중 서버가 INTAKE 이벤트를 모르는 빌드입니다' : !commitOk ? `실행 중 서버 빌드(${commit})가 이 소스 트리 HEAD(${head})와 다릅니다` : null
  if (!reason) return
  if (SKIP_HEALTH) {
    console.log(`[health] --skip-health-check — ${reason}. DEV 전용 우회. PROD에서는 코드 배포·재시작(A.0 4) 뒤에만 --apply 하세요`)
    return
  }
  throw new Error(`${reason} — 배포·PM2 재시작 후 다시 실행하세요 (DEV만 --skip-health-check)`)
}

/** 대상 집합 산출 — dry/apply 공용(임시 테이블, tx 종료 시 소멸). 가드·순서(3→2→1, 5→6→7→8)를 여기서 확정한다 */
async function buildTargets(tx: Tx, siteId: number) {
  // 미처리 유닛 가드 집합
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_pending ON COMMIT DROP AS
    SELECT u.id AS device_id, u.serial_no FROM device_units u
    WHERE u.condition IS NULL AND u.location_site_id IS NULL AND u.location_hospital_code IS NULL`)
  await tx.$executeRawUnsafe(`CREATE INDEX ON bf_pending(device_id)`)

  // 규칙 3 — ACTIVE ∧ 비종결 접수의 outcome NULL ∧ RECEIVED 라인(플래그 무관). 여러 라인이면 received_at DESC NULLS LAST, id DESC
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_r3 ON COMMIT DROP AS
    SELECT DISTINCT ON (i.device_id) i.device_id, p.serial_no, d.hospital_code, d.as_started_on, d.as_ref_code,
           r.as_code, s.name AS receipt_status, i.id AS item_id, i.received_at AS line_received_at,
           COALESCE(i.received_at, r.received_at, r.receipt_date) AS changed_on
    FROM as_receipt_items i
    JOIN as_receipts r ON r.id = i.receipt_id
    JOIN status_codes s ON s.id = r.status_id
    JOIN hospital_devices d ON d.device_id = i.device_id AND d.status = 'ACTIVE'
    JOIN bf_pending p ON p.device_id = i.device_id
    WHERE i.outcome IS NULL AND i.intake_state = 'RECEIVED' AND s.ticket_status NOT IN ('RESOLVED','CLOSED')
    ORDER BY i.device_id, i.received_at DESC NULLS LAST, i.id DESC`)

  // 규칙 2 매치(규칙 3 제외 전) — ACTIVE ∧ 플래그 ∧ (연결 접수 없음 OR 비종결). 규칙 3의 changes.before 계산에도 쓴다
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_r2m ON COMMIT DROP AS
    SELECT d.device_id, p.serial_no, d.hospital_code, d.as_started_on, d.as_ref_code, d.placed_on, r.id AS receipt_id, s.name AS receipt_status
    FROM hospital_devices d
    JOIN bf_pending p ON p.device_id = d.device_id
    LEFT JOIN as_receipts r ON r.as_code = d.as_ref_code
    LEFT JOIN status_codes s ON s.id = r.status_id
    WHERE d.status = 'ACTIVE' AND d.as_started_on IS NOT NULL AND (r.id IS NULL OR s.ticket_status NOT IN ('RESOLVED','CLOSED'))`)
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_r2 ON COMMIT DROP AS
    SELECT m.* FROM bf_r2m m WHERE NOT EXISTS (SELECT 1 FROM bf_r3 x WHERE x.device_id = m.device_id)`)

  // 규칙 1 — ACTIVE 나머지
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_r1 ON COMMIT DROP AS
    SELECT d.device_id, p.serial_no, d.hospital_code, d.placed_on
    FROM hospital_devices d JOIN bf_pending p ON p.device_id = d.device_id
    WHERE d.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM bf_r3 x WHERE x.device_id = d.device_id)
      AND NOT EXISTS (SELECT 1 FROM bf_r2m x WHERE x.device_id = d.device_id)`)

  // RECOVERED — 사유 value + RECOVER 이벤트 ref(occurred_on = recovered_on, 복수면 id 최대; n_candidates = 후보 수)
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_rec ON COMMIT DROP AS
    SELECT d.device_id, p.serial_no, d.recovered_on, d.last_hospital_code, sc.value AS reason_value, sc.name AS reason_name,
           e.ref_type, e.ref_code, COALESCE(e.n_candidates, 0)::int AS n_candidates
    FROM hospital_devices d
    JOIN bf_pending p ON p.device_id = d.device_id
    LEFT JOIN status_codes sc ON sc.id = d.recover_reason_id
    LEFT JOIN LATERAL (
      SELECT e.ref_type, e.ref_code, count(*) OVER () AS n_candidates FROM hospital_device_events e
      WHERE e.device_id = d.device_id AND e.event_type = 'RECOVER' AND e.occurred_on = d.recovered_on
      ORDER BY e.id DESC LIMIT 1) e ON true
    WHERE d.status = 'RECOVERED'`)
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_r5 ON COMMIT DROP AS SELECT * FROM bf_rec WHERE reason_value = 'LOST'`)
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_r6 ON COMMIT DROP AS SELECT * FROM bf_rec WHERE reason_value = 'DISPOSE'`)
  // 규칙 7 — DEFECT: changed_on = COALESCE(해당 접수 라인 received_at, recovered_on) — 라인 여러 건이면 received_at DESC NULLS LAST, id DESC
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_r7 ON COMMIT DROP AS
    SELECT x.*, l.received_at AS line_received_at, l.intake_state, l.outcome, COALESCE(l.received_at, x.recovered_on) AS changed_on
    FROM bf_rec x
    LEFT JOIN as_receipts r ON x.ref_type = 'AS' AND r.as_code = x.ref_code
    LEFT JOIN LATERAL (
      SELECT i.received_at, i.intake_state, i.outcome FROM as_receipt_items i
      WHERE i.receipt_id = r.id AND i.device_id = x.device_id
      ORDER BY i.received_at DESC NULLS LAST, i.id DESC LIMIT 1) l ON true
    WHERE x.reason_value = 'DEFECT'`)
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_r8 ON COMMIT DROP AS
    SELECT *, recovered_on AS changed_on FROM bf_rec WHERE reason_value IS NULL OR reason_value NOT IN ('LOST','DISPOSE','DEFECT')`)

  // 이벤트 백필 대상(규칙 3·7·8) — INTAKE(source BACKFILL). before: 규칙 3은 규칙 2·1을 먼저 적용했을 때의 값 / 규칙 7·8은 NULL·last 병원
  await tx.$executeRaw(Prisma.sql`CREATE TEMP TABLE bf_ev ON COMMIT DROP AS
    SELECT x.device_id, 3 AS rule, x.hospital_code, x.changed_on AS occurred_on, 'AS'::text AS ref_type, x.as_code AS ref_code,
           CASE WHEN EXISTS (SELECT 1 FROM bf_r2m m WHERE m.device_id = x.device_id) THEN 'AS_WAITING' ELSE 'IN_USE' END AS before_condition,
           'HOSPITAL'::text AS before_kind, x.hospital_code AS before_code, 'AS_WAITING'::text AS after_condition
    FROM bf_r3 x
    UNION ALL
    SELECT x.device_id, 7, x.last_hospital_code, x.changed_on, x.ref_type, x.ref_code,
           NULL, CASE WHEN x.last_hospital_code IS NULL THEN NULL ELSE 'HOSPITAL' END, x.last_hospital_code, NULL
    FROM bf_r7 x
    UNION ALL
    SELECT x.device_id, 8, x.last_hospital_code, x.changed_on, x.ref_type, x.ref_code,
           NULL, CASE WHEN x.last_hospital_code IS NULL THEN NULL ELSE 'HOSPITAL' END, x.last_hospital_code, NULL
    FROM bf_r8 x`)
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE bf_ev_new ON COMMIT DROP AS
    SELECT ev.* FROM bf_ev ev
    WHERE NOT EXISTS (SELECT 1 FROM hospital_device_events e WHERE e.event_type = 'INTAKE' AND e.source = 'BACKFILL' AND e.device_id = ev.device_id)`)

  // 배포 창 보정 대상 — condition 있음 ∧ 위치 둘 다 NULL ∧ 비종료 상태(코드 기동 후 백필 전에 AS_OPEN·회수 등이 건드린 유닛)
  await tx.$executeRaw(Prisma.sql`CREATE TEMP TABLE bf_win ON COMMIT DROP AS
    SELECT u.id AS device_id, u.serial_no, u.condition, u.condition_changed_on, d.status AS placement, d.hospital_code,
           CASE WHEN d.status = 'ACTIVE' THEN d.hospital_code END AS to_hospital_code,
           CASE WHEN d.status = 'RECOVERED' THEN ${siteId}::int END AS to_site_id
    FROM device_units u LEFT JOIN hospital_devices d ON d.device_id = u.id
    WHERE u.condition IS NOT NULL AND u.condition NOT IN ('LOST','SCRAPPED') AND u.location_site_id IS NULL AND u.location_hospital_code IS NULL`)

  const n = async (t: string) => count(tx, `SELECT 1 FROM ${t}`)
  return {
    pending: await n('bf_pending'),
    pendingNoPlacement: await count(tx, `SELECT 1 FROM bf_pending p WHERE NOT EXISTS (SELECT 1 FROM hospital_devices d WHERE d.device_id = p.device_id)`),
    r3: await n('bf_r3'), r2: await n('bf_r2'), r1: await n('bf_r1'),
    r5: await n('bf_r5'), r6: await n('bf_r6'), r7: await n('bf_r7'), r8: await n('bf_r8'),
    recUnmatched: await count(tx, `SELECT 1 FROM bf_rec WHERE reason_value NOT IN ('LOST','DISPOSE','DEFECT') AND reason_value IS NOT NULL`),
    ev: await n('bf_ev'), evNew: await n('bf_ev_new'),
    win: await n('bf_win'),
  }
}

async function report(tx: Tx, c: Awaited<ReturnType<typeof buildTargets>>) {
  console.log('\n■ 규칙별 이번 실행 대상 (적용 순서 3→2→1, 5→6→7→8 · 미처리 유닛 가드 적용)')
  console.log(`  미처리 유닛 ${c.pending}대 (배치 행 없음 ${c.pendingNoPlacement}대 — 규칙 대상 아님)`)
  const r3Flag = await q<{ flagged: boolean; flag_matches: boolean; n: number }>(tx, `SELECT (as_started_on IS NOT NULL) AS flagged, (as_ref_code = as_code) AS flag_matches, count(*)::int AS n FROM bf_r3 GROUP BY 1,2 ORDER BY 1,2`)
  const r3Inter = await count(tx, `SELECT 1 FROM bf_r3 x JOIN bf_r2m m ON m.device_id = x.device_id`)
  const r3Fallback = await count(tx, `SELECT 1 FROM bf_r3 WHERE line_received_at IS NULL`)
  console.log(`  규칙 3  ACTIVE ∧ 비종결 접수 RECEIVED 미종결 라인 → AS_WAITING·리프레시센터 : ${c.r3} (규칙 2 교집합 ${r3Inter} · ${r3Flag.map((r) => `플래그 ${r.flagged ? (r.flag_matches ? '=라인 접수' : '≠라인 접수(옛 접수)') : '없음'} ${r.n}`).join(' · ')}${r3Fallback ? ` · ⚠ 라인 received_at NULL → 접수 입고일/접수일 대체 ${r3Fallback}` : ''})`)
  const r2Kind = await q<{ k: string; n: number }>(tx, `SELECT CASE WHEN receipt_id IS NULL THEN '연결 접수 없음' ELSE '비종결 ' || receipt_status END AS k, count(*)::int AS n FROM bf_r2 GROUP BY 1 ORDER BY 2 DESC`)
  console.log(`  규칙 2  ACTIVE ∧ 플래그 ∧ (접수 없음 OR 비종결) → AS_WAITING·병원 : ${c.r2} (${r2Kind.map((r) => `${r.k} ${r.n}`).join(' · ') || '-'})`)
  console.log(`  규칙 1  ACTIVE 나머지 → IN_USE·병원 : ${c.r1}`)
  console.log(`  규칙 5  RECOVERED ∧ LOST → LOST·위치 없음 : ${c.r5}`)
  console.log(`  규칙 6  RECOVERED ∧ DISPOSE → SCRAPPED·위치 없음 : ${c.r6}`)
  const r7Line = await q<{ k: string; n: number }>(tx, `SELECT COALESCE(intake_state || '/' || COALESCE(outcome,'NULL'), '(라인 없음)') AS k, count(*)::int AS n FROM bf_r7 GROUP BY 1 ORDER BY 2 DESC`)
  const r7Recv = await count(tx, `SELECT 1 FROM bf_r7 WHERE line_received_at IS NOT NULL`)
  console.log(`  규칙 7  RECOVERED ∧ DEFECT → NULL(미확인)·리프레시센터 : ${c.r7} (changed_on=라인 입고일 ${r7Recv} · 회수일 ${c.r7 - r7Recv}; 라인 ${r7Line.map((r) => `${r.k} ${r.n}`).join(' · ') || '-'})`)
  const r8Kind = await q<{ k: string; n: number }>(tx, `SELECT COALESCE(reason_name, '(사유 없음)') AS k, count(*)::int AS n FROM bf_r8 GROUP BY 1 ORDER BY 2 DESC`)
  console.log(`  규칙 8  RECOVERED ∧ 그 외 사유 → NULL·리프레시센터 : ${c.r8} (${r8Kind.map((r) => `${r.k} ${r.n}`).join(' · ') || '-'})`)
  const evRef = await q<{ rule: number; ref_type: string | null; n: number }>(tx, `SELECT rule, ref_type, count(*)::int AS n FROM bf_ev_new GROUP BY 1,2 ORDER BY 1,2`)
  const evHospNull = await count(tx, `SELECT 1 FROM bf_ev_new WHERE hospital_code IS NULL`)
  const evOccNull = await count(tx, `SELECT 1 FROM bf_ev_new WHERE occurred_on IS NULL`)
  console.log(`  이벤트  INTAKE(source BACKFILL) 신규 : ${c.evNew} / 대상 ${c.ev} (중복 가드로 제외 ${c.ev - c.evNew}) — ${evRef.map((r) => `규칙${r.rule} ref ${r.ref_type ?? 'NULL'} ${r.n}`).join(' · ') || '-'}; hospital_code NULL ${evHospNull}${evOccNull ? ` · ⚠ occurred_on NULL ${evOccNull}(적용 중단 사유)` : ''}`)
  console.log(`  합계    유닛 ${c.r1 + c.r2 + c.r3 + c.r5 + c.r6 + c.r7 + c.r8} · 규칙 2∪3 ${c.r2 + c.r3}`)
  console.log(`  기대(DEV 2026-09-17) 1:${EXPECTED_DEV.r1} 2:${EXPECTED_DEV.r2} 3:${EXPECTED_DEV.r3} 5:${EXPECTED_DEV.r5} 6:${EXPECTED_DEV.r6} 7:${EXPECTED_DEV.r7} 8:${EXPECTED_DEV.r8} INTAKE:${EXPECTED_DEV.intake} — PROD·재실행은 다름이 정상`)

  console.log('\n■ 규칙 4 — 값 변경 없는 목록')
  printRows('(a) 플래그 ∧ 연결 접수 종결 → 규칙 1 IN_USE로 남음', await q(tx, `SELECT p.serial_no, d.hospital_code, d.as_ref_code, s.name AS receipt_status, d.as_started_on
    FROM hospital_devices d JOIN bf_pending p ON p.device_id = d.device_id JOIN as_receipts r ON r.as_code = d.as_ref_code JOIN status_codes s ON s.id = r.status_id
    WHERE d.status = 'ACTIVE' AND d.as_started_on IS NOT NULL AND s.ticket_status IN ('RESOLVED','CLOSED') ORDER BY 1`))
  printRows('(b) 비종결 접수 미종결 라인(PENDING)인데 플래그 없음 — 값은 규칙 1 IN_USE', await q(tx, `SELECT p.serial_no, d.hospital_code, r.hospital_code AS receipt_hospital, r.as_code, s.name AS receipt_status, i.intake_state
    FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id JOIN status_codes s ON s.id = r.status_id
    JOIN hospital_devices d ON d.device_id = i.device_id AND d.status = 'ACTIVE' JOIN bf_pending p ON p.device_id = d.device_id
    WHERE i.outcome IS NULL AND s.ticket_status NOT IN ('RESOLVED','CLOSED') AND d.as_started_on IS NULL AND i.intake_state = 'PENDING' ORDER BY 1`))
  printRows("(c) '발송완료' 접수의 미확정 라인(AS_WAITING으로 남음 — 라인 확정으로 정리)", await q(tx, `SELECT r.as_code, i.serial_no, i.intake_state, s.name AS receipt_status
    FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id JOIN status_codes s ON s.id = r.status_id
    WHERE i.outcome IS NULL AND s.name = '발송완료' ORDER BY 1,2`))
  printRows('(d) 종결(취소·완료) 접수의 미종결 라인', await q(tx, `SELECT s.name AS receipt_status, i.intake_state, count(*)::int AS n, string_agg(r.as_code || ':' || i.serial_no, ', ' ORDER BY r.as_code) AS lines
    FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id JOIN status_codes s ON s.id = r.status_id
    WHERE i.outcome IS NULL AND s.ticket_status IN ('RESOLVED','CLOSED') GROUP BY 1,2 ORDER BY 1,2`))
  const lit = (s: string) => `'${s.replace(/'/g, "''")}'`
  printRows('(e) 테스트 데이터(시리얼·HOSP-080599) — 수치 대조 시 제외', await q(tx, `SELECT u.serial_no, d.status AS placement, d.hospital_code, d.last_hospital_code, d.as_ref_code,
    CASE WHEN EXISTS (SELECT 1 FROM bf_r3 x WHERE x.device_id = u.id) THEN '규칙3' WHEN EXISTS (SELECT 1 FROM bf_r2 x WHERE x.device_id = u.id) THEN '규칙2'
         WHEN EXISTS (SELECT 1 FROM bf_r1 x WHERE x.device_id = u.id) THEN '규칙1' WHEN EXISTS (SELECT 1 FROM bf_rec x WHERE x.device_id = u.id) THEN '규칙5~8' ELSE '(대상 아님)' END AS rule
    FROM device_units u LEFT JOIN hospital_devices d ON d.device_id = u.id
    WHERE u.serial_no IN (${TEST_SERIALS.map(lit).join(',')}) OR d.hospital_code = ${lit(TEST_HOSPITAL)} OR d.last_hospital_code = ${lit(TEST_HOSPITAL)} ORDER BY 1`))

  console.log('\n■ 규칙 9 — RECOVERED ∧ 미종결 라인 보유(재접수) — 규칙 7 결과 유지')
  printRows('목록', await q(tx, `SELECT p.serial_no, d.last_hospital_code, r.as_code, s.name AS receipt_status, i.intake_state, x.reason_value
    FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id JOIN status_codes s ON s.id = r.status_id
    JOIN hospital_devices d ON d.device_id = i.device_id AND d.status = 'RECOVERED' JOIN bf_pending p ON p.device_id = d.device_id
    LEFT JOIN bf_rec x ON x.device_id = d.device_id
    WHERE i.outcome IS NULL AND s.ticket_status NOT IN ('RESOLVED','CLOSED') ORDER BY 1`))

  console.log('\n■ RECOVER 이벤트 후보(occurred_on = recovered_on) 0건 / 2건 이상 유닛 — 규칙 7·8 ref 판정 근거')
  printRows('전체 RECOVERED 기준', await q(tx, `SELECT u.serial_no, d.recovered_on, d.last_hospital_code, t.n AS candidates
    FROM hospital_devices d JOIN device_units u ON u.id = d.device_id
    JOIN LATERAL (SELECT count(*)::int AS n FROM hospital_device_events e WHERE e.device_id = d.device_id AND e.event_type = 'RECOVER' AND e.occurred_on = d.recovered_on) t ON true
    WHERE d.status = 'RECOVERED' AND t.n <> 1 ORDER BY t.n, 1`))
  const recNull = await count(tx, `SELECT 1 FROM hospital_devices WHERE status = 'RECOVERED' AND recovered_on IS NULL`)
  if (recNull) console.log(`  ⚠ recovered_on NULL인 RECOVERED ${recNull}대 — occurred_on을 만들 수 없어 적용 중단 사유`)

  console.log('\n■ 접수 상태별 AS_WAITING 분포')
  printRows('규칙 2 대상 × 플래그 접수 상태', await q(tx, `SELECT COALESCE(receipt_status, '(연결 접수 없음)') AS receipt_status, count(*)::int AS n FROM bf_r2 GROUP BY 1 ORDER BY 2 DESC`))
  printRows('규칙 3 대상 × 라인 접수 상태', await q(tx, `SELECT receipt_status, count(*)::int AS n FROM bf_r3 GROUP BY 1 ORDER BY 2 DESC`))
  printRows('현재 DB AS_WAITING 유닛 × 플래그 접수 상태(재실행·배포 창 점검용)', await q(tx, `SELECT COALESCE(s.name, CASE WHEN d.as_ref_code IS NULL THEN '(플래그 없음)' ELSE '(접수 없음)' END) AS receipt_status, count(*)::int AS n
    FROM device_units u JOIN hospital_devices d ON d.device_id = u.id LEFT JOIN as_receipts r ON r.as_code = d.as_ref_code LEFT JOIN status_codes s ON s.id = r.status_id
    WHERE u.condition = 'AS_WAITING' GROUP BY 1 ORDER BY 2 DESC`))
  printRows("취소 접수의 AS_WAITING 기기 목록(§7.3 종결 우회 — v1 비범위, 수동 정리 대상)", await q(tx, `SELECT u.serial_no, d.hospital_code, d.as_ref_code, s.name AS receipt_status
    FROM device_units u JOIN hospital_devices d ON d.device_id = u.id JOIN as_receipts r ON r.as_code = d.as_ref_code JOIN status_codes s ON s.id = r.status_id
    WHERE u.condition = 'AS_WAITING' AND s.name = '취소' ORDER BY 1`))

  console.log('\n■ 배포 창 보정 대상 — condition 있음 ∧ 위치 둘 다 NULL ∧ condition ∉ {LOST,SCRAPPED} (ACTIVE→배치 병원, RECOVERED→리프레시센터로 보정)')
  printRows('목록', await q(tx, `SELECT serial_no, condition, condition_changed_on, placement, hospital_code, to_hospital_code, to_site_id FROM bf_win ORDER BY 1`))
}

async function apply(tx: Tx, siteId: number, c: Awaited<ReturnType<typeof buildTargets>>) {
  console.log('\n■ 적용 (단일 tx)')
  const occNull = await count(tx, `SELECT 1 FROM bf_ev_new WHERE occurred_on IS NULL`)
  if (occNull) throw new Error(`INTAKE occurred_on NULL ${occNull}건 — recovered_on/received_at 결측을 먼저 보정하세요`)
  const chNull = await count(tx, `SELECT 1 FROM bf_r5 WHERE recovered_on IS NULL UNION ALL SELECT 1 FROM bf_r6 WHERE recovered_on IS NULL UNION ALL SELECT 1 FROM bf_r7 WHERE changed_on IS NULL UNION ALL SELECT 1 FROM bf_r8 WHERE changed_on IS NULL`)
  if (chNull) throw new Error(`회수 유닛 changed_on NULL ${chNull}건 — recovered_on 결측을 먼저 보정하세요`)

  const GUARD = `u.condition IS NULL AND u.location_site_id IS NULL AND u.location_hospital_code IS NULL`
  const step = async (label: string, expected: number, sql: string) => {
    const n = await tx.$executeRawUnsafe(sql)
    console.log(`  ${label}: ${n}건${n === expected ? '' : ` ⚠ 대상 ${expected}건과 다름`}`)
    if (n !== expected) throw new Error(`${label} 적용 건수(${n}) ≠ 대상(${expected}) — 동시 변경 의심, 전체 롤백`)
  }
  await step('규칙 3 AS_WAITING·센터', c.r3, `UPDATE device_units u SET condition = 'AS_WAITING', condition_changed_on = x.changed_on, location_hospital_code = NULL, location_site_id = ${siteId}, location_changed_on = x.changed_on
    FROM bf_r3 x WHERE x.device_id = u.id AND ${GUARD}`)
  // 규칙 2 위치 진입일 = 배치일(AS 접수는 위치를 바꾸지 않음 — §4.2 AS_OPEN '병원 유지')
  await step('규칙 2 AS_WAITING·병원', c.r2, `UPDATE device_units u SET condition = 'AS_WAITING', condition_changed_on = x.as_started_on, location_hospital_code = x.hospital_code, location_site_id = NULL, location_changed_on = COALESCE(x.placed_on, x.as_started_on)
    FROM bf_r2 x WHERE x.device_id = u.id AND ${GUARD}`)
  await step('규칙 1 IN_USE·병원', c.r1, `UPDATE device_units u SET condition = 'IN_USE', condition_changed_on = x.placed_on, location_hospital_code = x.hospital_code, location_site_id = NULL, location_changed_on = x.placed_on
    FROM bf_r1 x WHERE x.device_id = u.id AND ${GUARD}`)
  await step('규칙 5 LOST', c.r5, `UPDATE device_units u SET condition = 'LOST', condition_changed_on = x.recovered_on, location_hospital_code = NULL, location_site_id = NULL, location_changed_on = x.recovered_on
    FROM bf_r5 x WHERE x.device_id = u.id AND ${GUARD}`)
  await step('규칙 6 SCRAPPED', c.r6, `UPDATE device_units u SET condition = 'SCRAPPED', condition_changed_on = x.recovered_on, location_hospital_code = NULL, location_site_id = NULL, location_changed_on = x.recovered_on
    FROM bf_r6 x WHERE x.device_id = u.id AND ${GUARD}`)
  await step('규칙 7 NULL(미확인)·센터', c.r7, `UPDATE device_units u SET condition = NULL, condition_changed_on = x.changed_on, location_hospital_code = NULL, location_site_id = ${siteId}, location_changed_on = x.changed_on
    FROM bf_r7 x WHERE x.device_id = u.id AND ${GUARD}`)
  await step('규칙 8 NULL(미확인)·센터', c.r8, `UPDATE device_units u SET condition = NULL, condition_changed_on = x.changed_on, location_hospital_code = NULL, location_site_id = ${siteId}, location_changed_on = x.changed_on
    FROM bf_r8 x WHERE x.device_id = u.id AND ${GUARD}`)

  // 이벤트 백필 — 스냅샷 형식은 lib/deviceRegistry/condition.ts buildUnitStateChanges와 동일 { condition:{before,after}, location:{before:{kind,code},after:{kind,code}} }
  await step('INTAKE(source BACKFILL) 삽입', c.evNew, `INSERT INTO hospital_device_events (device_id, event_type, hospital_code, occurred_on, memo, ref_type, ref_code, source, changes, actor_id, actor_name)
    SELECT ev.device_id, 'INTAKE', ev.hospital_code, ev.occurred_on, '${MEMO}', ev.ref_type, ev.ref_code, 'BACKFILL',
           jsonb_build_object(
             'condition', jsonb_build_object('before', ev.before_condition, 'after', ev.after_condition),
             'location', jsonb_build_object('before', jsonb_build_object('kind', ev.before_kind, 'code', ev.before_code),
                                            'after', jsonb_build_object('kind', 'SITE', 'code', 'REFRESH_CENTER'))),
           NULL, '${ACTOR_NAME}'
    FROM bf_ev_new ev
    WHERE NOT EXISTS (SELECT 1 FROM hospital_device_events e WHERE e.event_type = 'INTAKE' AND e.source = 'BACKFILL' AND e.device_id = ev.device_id)`)

  // 배포 창 보정 — 위치만 채운다(condition 불변, 이벤트 없음). 배치 행 없는 유닛은 목적지가 없어 그대로 둔다
  await step('배포 창 위치 보정', await count(tx, `SELECT 1 FROM bf_win WHERE to_hospital_code IS NOT NULL OR to_site_id IS NOT NULL`),
    `UPDATE device_units u SET location_hospital_code = x.to_hospital_code, location_site_id = x.to_site_id, location_changed_on = COALESCE(u.condition_changed_on, CURRENT_DATE)
    FROM bf_win x WHERE x.device_id = u.id AND (x.to_hospital_code IS NOT NULL OR x.to_site_id IS NOT NULL) AND u.location_site_id IS NULL AND u.location_hospital_code IS NULL`)
}

/** 부록 B 검증 SQL — --dry 말미(현재값) · --apply 직후 */
async function appendixB(tx: Tx, label: string) {
  console.log(`\n■ 부록 B 검증 SQL (${label})`)
  printRows('condition × 위치 분포 (기대 DEV: IN_USE/hosp 26,023 · AS_WAITING/hosp 734 · AS_WAITING/site 130 · LOST/none 128 · NULL/site 1,340)',
    await q(tx, `SELECT condition, (location_site_id IS NOT NULL) AS at_site, (location_hospital_code IS NOT NULL) AS at_hosp, count(*)::int AS n FROM device_units GROUP BY 1,2,3 ORDER BY 1,2,3`))
  const i3 = await count(tx, `SELECT 1 FROM device_units u JOIN hospital_devices d ON d.device_id = u.id WHERE d.status = 'ACTIVE' AND u.condition IN ('LOST','SCRAPPED','PRE_SHIP')`)
  const activeNull = await count(tx, `SELECT 1 FROM device_units u JOIN hospital_devices d ON d.device_id = u.id WHERE d.status = 'ACTIVE' AND u.condition IS NULL`)
  const i6 = await count(tx, `SELECT 1 FROM device_units u JOIN LATERAL (SELECT changes FROM hospital_device_events e WHERE e.device_id = u.id AND e.changes ? 'condition' ORDER BY id DESC LIMIT 1) l ON true
    WHERE (l.changes->'condition'->>'after') IS DISTINCT FROM u.condition`)
  const intake = await count(tx, `SELECT 1 FROM hospital_device_events WHERE event_type = 'INTAKE' AND source = 'BACKFILL'`)
  console.log(`  I-3 (ACTIVE ∧ LOST/SCRAPPED/PRE_SHIP): ${i3} (기대 0)`)
  console.log(`  ACTIVE ∧ condition NULL: ${activeNull} (기대 0 — 백필 전에는 ACTIVE 전수)`)
  console.log(`  I-6 (유닛 값 ≠ id 최대 스냅샷 after): ${i6} (기대 0)`)
  console.log(`  INTAKE·BACKFILL 이벤트: ${intake} (기대 DEV 1,470 · 재실행 후 증가 0)`)
  printRows('I-4 예외 리포트 (ACTIVE ∧ IN_USE ∧ 위치 ≠ 배치 병원 — 취소 라인·수동 해제 유닛만 허용)', await q(tx, `SELECT u.serial_no, d.hospital_code, u.location_hospital_code, u.location_site_id
    FROM device_units u JOIN hospital_devices d ON d.device_id = u.id WHERE d.status = 'ACTIVE' AND u.condition = 'IN_USE' AND u.location_hospital_code IS DISTINCT FROM d.hospital_code ORDER BY 1`))
}

async function main() {
  console.log(`[backfill-device-condition] 모드: ${REHEARSE ? 'REHEARSE(적용 경로 실행 후 롤백 — 쓰기 없음)' : APPLY ? 'APPLY(단일 tx 쓰기)' : 'DRY RUN(쓰기 없음)'} · DB ${(process.env.DATABASE_URL ?? '').replace(/\/\/.*@/, '//***@')}`)
  if (APPLY) await checkRunningServer()
  else {
    try { await checkRunningServer() } catch (e) { console.log(`[health] (dry) ${e instanceof Error ? e.message : String(e)}`) }
  }

  await prisma.$transaction(
    async (tx) => {
      const site = await q<{ id: number }>(tx, `SELECT id FROM status_codes WHERE category = 'DEVICE_SITE' AND value = 'REFRESH_CENTER' ORDER BY "order" LIMIT 1`)
      if (!site[0]) throw new Error('거점 마스터 DEVICE_SITE/REFRESH_CENTER 없음 — 마이그 20260917120000 또는 seed-device-registry.sql 먼저')
      const siteId = site[0].id
      console.log(`[backfill-device-condition] 리프레시센터 status_codes.id = ${siteId}`)

      const c = await buildTargets(tx, siteId)
      await report(tx, c)
      if (!APPLY) {
        await appendixB(tx, '현재값 — 적용 전')
        console.log('\n[backfill-device-condition] DRY RUN 종료 — 적용은 --apply (코드 배포·재시작 후, PROD는 규칙 5 명시 허락)')
        return
      }
      await apply(tx, siteId, c)
      await appendixB(tx, REHEARSE ? '리허설 — 롤백 직전' : '적용 직후 — 같은 tx')
      if (REHEARSE) {
        // 재실행 안전 확인까지 같은 tx에서: 적용 직후 대상 집합을 다시 산출하면 전부 0건이어야 한다
        for (const t of ['bf_pending', 'bf_r3', 'bf_r2m', 'bf_r2', 'bf_r1', 'bf_rec', 'bf_r5', 'bf_r6', 'bf_r7', 'bf_r8', 'bf_ev', 'bf_ev_new', 'bf_win']) await tx.$executeRawUnsafe(`DROP TABLE ${t}`)
        const again = await buildTargets(tx, siteId)
        console.log(`\n■ 리허설 재산출(같은 tx, 적용 직후) — 규칙 3/2/1/5/6/7/8 = ${again.r3}/${again.r2}/${again.r1}/${again.r5}/${again.r6}/${again.r7}/${again.r8} · INTAKE 신규 ${again.evNew} · 배포 창 ${again.win} (전부 0 기대)`)
        throw new RehearsalRollback()
      }
      console.log('\n[backfill-device-condition] 적용 완료 — COMMIT. 재실행(--dry)에서 규칙별 0건·INTAKE 증가 0 확인')
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  )
}

class RehearsalRollback extends Error {
  constructor() {
    super('rehearsal rollback')
  }
}

main()
  .catch((e) => {
    if (e instanceof RehearsalRollback) {
      console.log('\n[backfill-device-condition] 리허설 종료 — 전체 롤백(쓰기 없음). 실제 적용은 --apply')
      return
    }
    console.error(`\n[backfill-device-condition] 실패 — ${APPLY ? '전체 롤백' : 'dry'}:`, e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
