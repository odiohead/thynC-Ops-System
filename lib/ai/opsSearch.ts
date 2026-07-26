import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * 축 2 — 운영 정보 자유 텍스트 검색 (v3 O1·O2)
 *
 * 유지보수 증상·조치, 처리 기록, 답사 노트, 기타업무 비고, 티켓 코멘트, 상담이력은
 * 실제 운영 노하우가 쌓이는 곳인데 기존 도구로는 **검색 수단이 전혀 없었다**
 * (구조화 필드 — 병원·상태·기간 — 로만 필터 가능).
 *
 * 규모가 작아(432건 / 약 9만 자) 전용 인덱스 없이 순차 스캔으로 충분하다.
 * Tiptap HTML은 조회 시점에 태그를 제거한다. 총량이 수십만 자를 넘어가면
 * 파생 평문 컬럼 + trigram 인덱스로 전환한다(설계문서 §6 판단 기준 참조).
 */

/** HTML 태그 제거 SQL 조각 (Tiptap 필드 공통) */
const STRIP = (col: string) => Prisma.raw(`regexp_replace(coalesce(${col},''), '<[^>]+>', ' ', 'g')`)

/**
 * 운영 텍스트 통합 소스 — 유형·출처코드·상세경로·병원·발생일·본문으로 정규화
 * `ref_path`는 출처 링크(G1)용. 티켓만 코드 기반 라우트이고 나머지는 숫자 id 기반이다.
 */
const OPS_SOURCE = Prisma.sql`
  SELECT 'MAINTENANCE'::text AS work_type, m.maintenance_code AS code,
         ('/maintenances/' || m.id) AS ref_path,
         m.hospital_code, h.hospital_name, m.reported_at::date AS occurred_at,
         m.title::text AS title,
         concat_ws(' / ', coalesce(m.symptoms,''), ${STRIP('m.resolution')}) AS body
    FROM maintenances m JOIN hospitals h ON h.hospital_code = m.hospital_code
  UNION ALL
  SELECT 'MAINTENANCE_LOG', m.maintenance_code, ('/maintenances/' || m.id),
         m.hospital_code, h.hospital_name,
         l.created_at::date, m.title::text, ${STRIP('l.content')}
    FROM maintenance_logs l
    JOIN maintenances m ON m.id = l.maintenance_id
    JOIN hospitals h ON h.hospital_code = m.hospital_code
  UNION ALL
  SELECT 'SITE_VISIT', v.site_visit_code, ('/site-visits/' || v.id),
         v.hospital_code, h.hospital_name,
         v.request_date::date, NULL::text, ${STRIP('v.notes')}
    FROM site_visits v JOIN hospitals h ON h.hospital_code = v.hospital_code
  UNION ALL
  SELECT 'ETC', e.etc_task_code, ('/etc-tasks/' || e.id),
         NULL, NULL, e.reported_at::date, e.title::text, ${STRIP('e.note')}
    FROM etc_tasks e
  UNION ALL
  SELECT 'TICKET', t.ticket_code, ('/tickets/' || t.ticket_code),
         t.hospital_code, h.hospital_name,
         tl.created_at::date, t.title::text, ${STRIP('tl.content_html')}
    FROM ticket_logs tl
    JOIN tickets t ON t.id = tl.ticket_id
    LEFT JOIN hospitals h ON h.hospital_code = t.hospital_code
   WHERE tl.log_type = 'comment'
  UNION ALL
  -- 상담이력 (2026-07-26) — 본문이 마크다운 평문이라 태그 제거가 필요 없다
  SELECT 'CONSULTATION', c.consultation_code,
         ('/hospitals/' || c.hospital_code || '#consultations'),
         c.hospital_code, h.hospital_name,
         c.consulted_at, c.title::text, c.content
    FROM consultations c
    JOIN hospitals h ON h.hospital_code = c.hospital_code
`

export type OpsSearchRow = {
  work_type: string
  code: string
  ref_path: string
  hospital_code: string | null
  hospital_name: string | null
  occurred_at: Date | null
  title: string | null
  body: string
  score: number
  total: number
}

/** 질의를 공백 토큰으로 분해 (최대 5개) — 한국어 조사 때문에 전체 문자열 매칭은 리콜이 낮다 */
export function tokenize(query: string): string[] {
  const t = query.split(/\s+/).filter(Boolean).slice(0, 5)
  return t.length > 0 ? t : [query]
}

/** 본문 발췌 — 가장 먼저 등장하는 토큰 주변 */
export function excerpt(body: string, terms: string[], span = 200): string {
  const lower = body.toLowerCase()
  const idx = terms
    .map((t) => lower.indexOf(t.toLowerCase()))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0]
  const text = idx === undefined ? body.slice(0, span) : body.slice(Math.max(0, idx - 60), idx + span - 60)
  return text.replace(/\s+/g, ' ').trim()
}

/** O1 — 운영 이력 전문 검색 */
export async function searchOperationHistory(opts: {
  query: string
  workType?: string
  hospitalCode?: string
  from?: string
  to?: string
  limit: number
}): Promise<OpsSearchRow[]> {
  const terms = tokenize(opts.query)
  return prisma.$queryRaw<OpsSearchRow[]>`
    WITH src AS (${OPS_SOURCE})
    SELECT s.*,
           -- 운영 레코드는 평균 81~559자로 짧아 전체 토큰 AND는 리콜이 거의 0이 된다.
           -- 1개 이상 매칭을 통과 조건으로 두고 매칭 수·제목 가중·유사도로 순위를 매긴다.
           ( (SELECT count(*) FROM unnest(${terms}::text[]) tk
                WHERE s.body ILIKE '%' || tk || '%')::float8
             + (SELECT count(*) FROM unnest(${terms}::text[]) tk
                  WHERE coalesce(s.title,'') ILIKE '%' || tk || '%')::float8 * 2
             + similarity(coalesce(s.title,''), ${opts.query})::float8
           ) AS score,
           count(*) OVER ()::int AS total
      FROM src s
     WHERE btrim(s.body) <> ''
       AND (SELECT count(*) FROM unnest(${terms}::text[]) tk
              WHERE coalesce(s.title,'') || ' ' || s.body ILIKE '%' || tk || '%') > 0
       AND (${opts.workType ?? null}::text IS NULL OR s.work_type = ${opts.workType ?? null}::text)
       AND (${opts.hospitalCode ?? null}::text IS NULL OR s.hospital_code = ${opts.hospitalCode ?? null}::text)
       AND (${opts.from ?? null}::date IS NULL OR s.occurred_at >= ${opts.from ?? null}::date)
       AND (${opts.to ?? null}::date IS NULL OR s.occurred_at <= ${opts.to ?? null}::date)
     ORDER BY score DESC, s.occurred_at DESC NULLS LAST
     LIMIT ${opts.limit}
  `
}

export type SimilarCaseRow = {
  maintenance_code: string
  ref_path: string
  hospital_name: string
  type_name: string | null
  status_name: string | null
  priority: string
  reported_at: Date | null
  resolved_at: Date | null
  symptoms: string | null
  resolution: string | null
  score: number
  total: number
}

/**
 * O2 — 유사 장애 사례 검색 (CS 응대 특화)
 *
 * O1과 랭킹이 다르다: 증상 문장 전체가 입력이므로 토큰 AND는 너무 엄격하다.
 * 토큰 부분 매칭 수 + 증상 텍스트 유사도로 점수를 매기고, 같은 병원은 가산한다.
 * 반환에 조치(resolution)를 반드시 포함한다 — "어떻게 해결했는가"가 답의 본체다.
 */
export async function findSimilarCases(opts: {
  symptoms: string
  hospitalCode?: string
  limit: number
}): Promise<SimilarCaseRow[]> {
  const terms = tokenize(opts.symptoms)
  return prisma.$queryRaw<SimilarCaseRow[]>`
    SELECT m.maintenance_code, ('/maintenances/' || m.id) AS ref_path, h.hospital_name,
           t.name AS type_name, st.name AS status_name, m.priority,
           m.reported_at::date AS reported_at, m.resolved_at::date AS resolved_at,
           left(coalesce(m.symptoms,''), 300) AS symptoms,
           left(${STRIP('m.resolution')}, 500) AS resolution,
           ( (SELECT count(*) FROM unnest(${terms}::text[]) tk
                WHERE coalesce(m.symptoms,'') || ' ' || coalesce(m.title,'') ILIKE '%' || tk || '%')::float8 * 0.5
             + similarity(coalesce(m.symptoms,''), ${opts.symptoms})::float8
             + CASE WHEN m.hospital_code = ${opts.hospitalCode ?? null}::text THEN 0.3 ELSE 0 END
           ) AS score,
           count(*) OVER ()::int AS total
      FROM maintenances m
      JOIN hospitals h ON h.hospital_code = m.hospital_code
      LEFT JOIN status_codes t ON t.id = m.type_id
      LEFT JOIN status_codes st ON st.id = m.status_id
     WHERE btrim(coalesce(m.resolution,'')) <> ''
       AND (SELECT count(*) FROM unnest(${terms}::text[]) tk
              WHERE coalesce(m.symptoms,'') || ' ' || coalesce(m.title,'') ILIKE '%' || tk || '%') > 0
     ORDER BY score DESC, m.reported_at DESC NULLS LAST
     LIMIT ${opts.limit}
  `
}
