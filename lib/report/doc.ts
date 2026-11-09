/**
 * 레포트 문서 모델 — 웹 미리보기(app/reports/_components/ReportView)와 Word(lib/report/docx)가 같은 모델을 그린다.
 * (projects/hospital_report_design.md §5) 사내 양식 틀(머리글·결재란·바닥글)은 고정, 본문 목차는 레포트 종류가 정한다
 * — 양식 안내대로 목차 구성은 필수가 아니다. 구조: 결재란 → intro(번호 없는 요약) → 목차 `1.` → 하위 `1)` → outro(출처).
 */

export type ReportBlock =
  | { type: 'para'; text: string; tone?: 'normal' | 'muted' | 'warn' }
  /** ※ 보조 설명 — 작은 회색 글자 */
  | { type: 'note'; text: string }
  /** lead가 있으면 굵게 + ' — ' + text */
  | { type: 'bullets'; items: (string | { lead: string; text: string })[] }
  | {
      type: 'table'
      /** width는 상대 비율 (렌더러가 정규화) */
      columns: { label: string; width: number; align?: 'left' | 'center' | 'right' }[]
      rows: string[][]
      /** 마지막 행을 합계 행으로 강조 */
      totalRow?: boolean
      /** 첫 열을 항목명 열로 강조 */
      keyColumn?: boolean
    }
  /** 머리 행 없는 항목표 — 행은 [항목, 값, 항목, 값] 또는 [항목, 값](값이 오른쪽 끝까지) */
  | { type: 'kv'; rows: string[][] }
  /** 요약 지표 — 머리(항목) / 값(굵게) / 보조 문구, 본문 전체 폭 */
  | { type: 'kpi'; items: { label: string; value: string; sub: string }[] }

export interface ReportItem {
  /** 하위 항목 제목 (`1)`) — null이면 번호 없이 블록만 */
  title: string | null
  blocks: ReportBlock[]
}

export interface ReportSection {
  title: string
  items: ReportItem[]
}

export interface ReportHeader {
  docNumber: string | null
  title: string
  date: string // YYYY.MM.DD
  dept: string
  author: string
}

export interface ReportDoc {
  header: ReportHeader
  /** 결재란 바로 아래, 목차 번호 없는 요약 영역 */
  intro: ReportBlock[]
  sections: ReportSection[]
  /** 목차 뒤 출처·작성 메모 */
  outro: ReportBlock[]
}

/** 양식 머리글 문서번호 기본값 (D1 — 비우면 양식 문구 그대로) */
export const DEFAULT_DOC_NUMBER = 'ST-P-26xxxx-xx'
