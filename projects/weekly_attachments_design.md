# 주간업무 첨부파일 — 설계안

> **상태: 구현 완료 (dev2, 2026-09-18 · 첨부 별도 컬럼 개정 2026-09-19) — PROD 배포 대기**
> 착수 승인 2026-09-18 (사용자 "일단 착수해서 dev2에 반영"). §7 결정 A~H 전부 추천안대로.
> 작성 2026-09-18. `weekly_ops_design.md` v1(2026-08-19 PROD)의 후속 개선. 사용자 요청 — "목표일 오른쪽에 클립 아이콘, 없으면 '+첨부', 있으면 아이콘, 클릭하면 팝업 레이어에서 여러 파일 업로드".

---

## 1. 배경·목적

주간 보드의 안건에는 회의에서 공유할 근거 자료(견적서·회의록 캡처·PDF·엑셀 등)가 딸리는 경우가 많은데, 현재는 `detail`(리치텍스트)에 링크를 붙여 넣거나 위키·드라이브를 따로 여는 수밖에 없다. 안건 레코드에 **파일을 직접 붙여** 보드에서 한 번에 열도록 한다.

이 기능이 답해야 할 질문은 하나다.
- **Q5 (신규)**: 이 안건에 딸린 자료가 있나? 있으면 바로 열 수 있나?

`weekly_ops_design.md` §2의 Q1~Q4에는 영향 없음. 첨부는 **항목 단위**로 붙는다(주차별 진행 기록 단위가 아님 — §7 결정 근거).

---

## 2. 현행 확인 (2026-09-18 dev2)

| 항목 | 현황 |
|---|---|
| 데이터 | `weekly_items`(항목) · `weekly_item_updates`(주차별 진행) · `weekly_week_notes`. 파일 테이블 없음 |
| 화면 | `/weekly` 보드 테이블(`BOARD_COLS` 9열, 목표일 열 폭 112, 리사이즈 저장키 v3) + 아카이브·병원별·목표일 경과 리스트 테이블(목표일 마지막 열) + `ItemDetailModal`(92vw 2컬럼) |
| 행 클릭 | 행 전체 `onClick → setDetailId` (상세 모달). 셀 안의 버튼은 `stopPropagation` 필요 |
| 접근 | `checkWeeklyAccess(user, {write})` — 조회: SEERS OR `weekly.access`, 쓰기: + USER 이상. VIEWER 읽기 전용 |
| 기존 첨부 패턴 | `etc_task_files`·`maintenance_files`·`site_visit_files`·`install_plan_files` — `{fileCategory, fileName, s3Key, uploadedAt}` + `POST [id]/files`(multipart 단건) + `DELETE [id]/files/[fileId]` + `GET file-url?key=`(presigned). S3 키 `<domain>/<id>/<ts>_<name>` |
| S3 유틸 | `lib/s3.ts` `uploadToS3` / `getSignedUrl(key, expiresIn, {downloadName, inline})` / `deleteFromS3`. 한글 파일명은 `downloadName` 지정 필수(위키 A-11① 교훈) |
| UI 부품 | `app/components/ui/{Modal,Button,Badge,Input}` — **Popover 컴포넌트 없음** |
| 아이콘 | lucide-react (`Paperclip`·`Upload`·`X`·`Download` 보유) |

---

## 3. 화면 설계

### 3.1 보드·리스트 테이블 — '첨부' 별도 컬럼 (2026-09-19 개정)

> **개정 이력**: 초안은 목표일 셀 안에 [날짜 | 트리거]를 병합했으나, 1차 반영 검토에서 사용자 지적 — "첨부는 목표일과 같은 컬럼 개념이면 안 되고 별도 필드여야 하며, 병합하면 정렬이 안 맞는다". **목표일 오른쪽에 '첨부' 컬럼을 신설**하는 것으로 변경(트리거·레이어 동작은 동일).

| 상태 | 첨부 컬럼 표시 | 클릭 |
|---|---|---|
| 첨부 0건 · 쓰기 가능 | `+ 첨부` (muted, 작은 글씨, hover 시 진해짐) | 첨부 레이어 열기 |
| 첨부 0건 · VIEWER | `—` | — |
| 첨부 n건 (누구나) | `📎 3` (Paperclip 아이콘 + 건수, 기본색) | 첨부 레이어 열기 (VIEWER는 열람·다운로드만) |

- 트리거는 `<button>`이며 `e.stopPropagation()`으로 행 클릭(상세 모달)과 분리
- 목표일 셀은 원래대로 날짜만(경과 빨간 강조 유지)
- `BOARD_COLS`에 `files`('첨부', 기본 폭 72, 리사이즈 가능)를 `target` 다음에 추가. 저장키 `weekly_board_col_widths_v3` → **v5**로 올려 기존 사용자 폭 리셋(2026-08-21 선례)
- 아카이브·병원별·목표일 경과 리스트(3종)도 목표일 다음에 '첨부' `<th>`/`<td>` 추가 — 셀 렌더는 `AttachCell` 헬퍼 4곳 공용
- 툴팁: 트리거 `title="첨부파일 n건"` / `"첨부파일 추가"`

### 3.2 첨부 레이어 (팝업)

**Modal(`max-w-xl`) 한 장**으로 구성한다. 앵커형 popover 대신 Modal을 택한 이유: (1) 프로젝트에 Popover 부품이 없고 가로 스크롤 테이블 안 앵커 위치 계산이 번거로움, (2) 모바일에서 Modal이 그대로 성립, (3) 상세 모달과 같은 부품이라 시각 일관성.

```
┌ 첨부파일 — [안건명 앞 40자…]                              ✕ ┐
│                                                              │
│  ┌ 드래그해서 놓거나  [파일 선택] (여러 개 가능, 파일당 20MB) ┐│
│  └──────────────────────────────────────────────────────────┘│
│  업로드 중: 견적서_v2.xlsx  ▓▓▓▓▓░░░░ 2/3                     │
│                                                              │
│  📎 견적서_v2.xlsx          1.2 MB · 홍길동 · 09-18    [삭제] │
│  📎 회의록_0915.pdf         340 KB · 김철수 · 09-16    [삭제] │
│  📎 현장사진.jpg            2.8 MB · 홍길동 · 09-15    [삭제] │
│                                                              │
│  (0건이면) 첨부된 파일이 없습니다.                            │
└──────────────────────────────────────────────────────────────┘
```

- **파일명 클릭** → 새 탭에서 presigned URL 열림(PDF·이미지는 inline, 그 외 다운로드). 한글 파일명 보존
- **여러 파일 업로드**: `<input type="file" multiple>` + 레이어 내부 드롭존. 파일별 순차 요청(단건 API 반복)이 아니라 **한 요청에 N개**(§4.2) — 실패 시 "n건 중 m건 실패: 파일명(사유)" 플래시, 성공분은 유지
- **삭제**: 쓰기 권한자 누구나(업로더 제한 없음 — 주간툴은 협업 편집 원칙, 항목 수정·삭제도 동일 정책). `confirm('삭제할까요?')` 1회
- 정렬: 업로드 시각 오름차순(오래된 것 위 — 대화 흐름과 동일)
- 업로드·삭제 후 레이어 목록 즉시 갱신 + 부모 보드 `fileCount` 갱신(§3.4)
- 드래그 앤 드롭은 **레이어 안에서만**. 테이블 행에 직접 드롭은 비범위(오조작 위험·행별 드롭존 구현 비용)

### 3.3 항목 상세 모달 (`ItemDetailModal`)

좌측 컬럼(기본정보·설명) 하단에 **'첨부파일' 섹션**을 추가하고 §3.2와 같은 리스트·업로드 UI를 그대로 임베드한다(컴포넌트 공용 — `WeeklyFilesPanel`). 상세를 열어 둔 채로도 첨부를 관리할 수 있어야 보드 트리거와 상세가 어긋나지 않는다.

### 3.4 갱신 규칙

- 레이어에서 업로드·삭제 성공 → `router.refresh()`(CLAUDE.md 컨벤션) + 부모 콜백 `onFilesChanged(itemId, count)`로 보드 로컬 상태의 `fileCount`만 갱신(보드 전체 재조회 없음 — 보드 재조회는 스크롤·펼침 상태를 잃음)
- 상세 모달의 `onChanged`는 기존대로 보드 재조회이므로 상세에서 첨부를 바꾸면 그 경로로 반영

---

## 4. 데이터·API 설계

### 4.1 테이블 `weekly_item_files` (public, 신규)

기존 `*_files` 4종 패턴을 따르되, 주간툴에 없는 `file_category`는 **두지 않는다**(분류가 필요하다는 근거가 없음 — 필요해지면 v2). 대신 크기·업로더를 저장해 레이어에 표시한다.

```prisma
/// 주간업무 항목 첨부파일 (projects/weekly_attachments_design.md)
model WeeklyItemFile {
  id           Int      @id @default(autoincrement())
  itemId       Int      @map("item_id")
  fileName     String   @map("file_name")
  s3Key        String   @map("s3_key")
  sizeBytes    Int      @map("size_bytes")
  contentType  String?  @map("content_type")
  uploadedById String?  @map("uploaded_by")
  uploadedAt   DateTime @default(now()) @map("uploaded_at")

  item       WeeklyItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  uploadedBy User?      @relation("WeeklyFileUploader", fields: [uploadedById], references: [id], onDelete: SetNull)

  @@index([itemId])
  @@map("weekly_item_files")
  @@schema("public")
}
```

- `WeeklyItem`에 `files WeeklyItemFile[]`, `User`에 `weeklyFilesUploaded WeeklyItemFile[] @relation("WeeklyFileUploader")` 역관계 추가
- 항목 삭제 시 DB 행은 CASCADE. **S3 객체는 항목 DELETE 라우트에서 먼저 조회해 `deleteFromS3` 반복 후 삭제**(기존 도메인들은 이 정리를 안 해서 S3 고아가 남음 — 주간툴은 정리한다. 실패해도 DB 삭제는 진행, 경고 로그)
- S3 키: `weekly/<itemId>/<ts>_<원본파일명>` (기존 도메인 규칙과 동일). 파일명의 `/`·제어문자는 `_`로 치환

마이그레이션(규칙 1 — psql 직접 적용 → 파일 수동 생성 → `migrate resolve --applied` → `prisma generate`):

```sql
-- prisma/migrations/2026MMDDHHMMSS_weekly_item_files/migration.sql
CREATE TABLE public.weekly_item_files (
  id            SERIAL PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES public.weekly_items(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  s3_key        TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  content_type  TEXT,
  uploaded_by   TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX weekly_item_files_item_id_idx ON public.weekly_item_files(item_id);
```

### 4.2 API (`app/api/weekly/items/[id]/files/`)

전부 `getAuthUser` → `checkWeeklyAccess`(조회/쓰기) → 항목 존재 확인 순. 기존 주간 라우트와 동일 골격.

| 메서드·경로 | 권한 | 동작 |
|---|---|---|
| `GET /api/weekly/items/[id]/files` | 조회 | `{ files: WeeklyFileDto[] }` (uploadedAt asc) |
| `POST /api/weekly/items/[id]/files` | 쓰기 | multipart `files[]` **N개 한 번에**. 파일당 20MB·요청당 10개 초과 시 400. 파일별 S3 업로드→DB insert, 개별 실패는 건너뛰고 `{ files, failed: [{name, error}] }` 반환(201, 전부 실패면 400) |
| `GET /api/weekly/items/[id]/files/[fileId]` | 조회 | 파일이 그 항목 소속인지 검증 후 presigned URL(`expiresIn 300`, `downloadName=fileName`, inline)로 **302 redirect** — 화면은 `<a href target="_blank">`만 두면 됨. 기존 `file-url?key=` 방식은 키만 알면 항목 권한과 무관하게 열리므로 주간툴에서는 쓰지 않음 |
| `DELETE /api/weekly/items/[id]/files/[fileId]` | 쓰기 | 소속 검증 → `deleteFromS3` → DB delete |

- **감사 로그**: `logAudit` resource `weekly_item_file`, action `CREATE`/`DELETE`, `resourceLabel = 안건명 / 파일명`. 기존 `*_files` 라우트들은 감사가 없지만 주간 항목 라우트는 전부 감사하므로 맞춘다
- **업로드 허용 형식**: 제한 없음(확장자 블랙리스트 `.exe .bat .cmd .sh .js .msi`만 거부). 회의 자료 성격상 화이트리스트가 더 방해
- **크기 상한 20MB**: 위키 HTML 문서 2MB보다 크지만 회의 자료(PPT·사진)에는 20MB가 현실적. Next.js Route Handler는 body 크기 자체 제한이 없고, **Nginx `client_max_body_size`가 실제 상한** — PROD·dev Nginx 설정 확인이 §8 선행 조건(다른 도메인 첨부가 현재 잘 되므로 20MB 이상으로 잡혀 있을 가능성이 높으나 미확인)

### 4.3 DTO 변경 (`lib/weekly.ts` 단일 소스)

```ts
export interface WeeklyFileDto {
  id: number
  fileName: string
  sizeBytes: number
  contentType: string | null
  uploadedByName: string | null
  uploadedAt: string
}
// WeeklyItemDto에 추가 — 보드·아카이브·병원별·경과 리스트 트리거용
fileCount: number
// WeeklyItemDetailDto에 추가
files: WeeklyFileDto[]
```

- `ITEM_INCLUDE`에 `_count: { select: { files: true } }` 추가 → `toItemDto`가 `fileCount` 채움. 보드 쿼리 1회로 N건 카운트 포함(별도 쿼리 없음)
- 상세 GET은 `files: { orderBy: { uploadedAt: 'asc' }, include: { uploadedBy: { select: { name } } } }`

---

## 5. 컴포넌트 구성

| 파일 | 역할 |
|---|---|
| `app/weekly/_components/WeeklyFilesPanel.tsx` (신규) | 리스트 + 드롭존 + 업로드 진행 + 삭제. props `{ itemId, canWrite, onChanged?(count) }`. 자체 fetch(`GET files`) — 레이어·상세 모달 양쪽에서 재사용 |
| `app/weekly/_components/FilesModal.tsx` (신규) | `Modal(max-w-xl)` 껍데기 + 제목(안건명) + `WeeklyFilesPanel` |
| `app/weekly/_components/AttachCell.tsx` (신규) | '첨부' 컬럼 셀 렌더(보드·리스트 3종 공용). props `{ fileCount, canWrite, onOpenFiles }` (2026-09-19 — 구 TargetCell 병합안 폐기) |
| `app/weekly/page.tsx` | `filesFor` 상태(열린 항목 id), 4개 테이블에 '첨부' 컬럼(`AttachCell`) 추가, `fileCount` 로컬 갱신 콜백, `BOARD_COLS.files` 신설·저장키 v5 |
| `app/weekly/_components/ItemDetailModal.tsx` | 좌측 하단 '첨부파일' 섹션에 `WeeklyFilesPanel` |
| `lib/weekly.ts` · `app/api/weekly/shared.ts` | DTO·include·`toItemDto` |
| `app/api/weekly/items/[id]/files/route.ts` · `[fileId]/route.ts` (신규) | §4.2 |
| `app/api/weekly/items/[id]/route.ts` | DELETE 시 S3 정리 |

---

## 6. 권한

| 행위 | 조건 |
|---|---|
| 트리거·레이어 열람·다운로드 | 주간툴 조회 권한(`checkWeeklyAccess`) — VIEWER 포함 |
| 업로드·삭제 | 주간툴 쓰기 권한(USER 이상) — 항목 수정 권한과 동일, 업로더 본인 제한 없음 |

새 권한 키 신설 없음(RBAC 규칙 1 — 기존 `weekly.access` 가산 그대로).

---

## 7. 결정 사항·근거

| # | 쟁점 | 결정 | 근거 |
|---|---|---|---|
| A | 첨부 단위 — 항목 vs 주차별 진행 기록 | **항목** | 요청이 "목표일 옆"(항목 속성 열). 주차별로 붙이면 보드에서 주차 이동 시 첨부가 보였다 사라져 혼란. 어느 주에 올렸는지는 `uploadedAt`으로 충분 |
| B | 트리거 위치 — 새 컬럼 vs 목표일 셀 병합 | **새 컬럼** (2026-09-19 번복) | 초안은 셀 병합이었으나 사용자 지적(별도 필드여야 하고 정렬이 흐트러짐)으로 '첨부' 컬럼 신설 |
| C | 레이어 형태 — 앵커 popover vs Modal | **Modal** | §3.2. Popover 부품 부재·모바일·일관성 |
| D | 여러 파일 — 단건 API 반복 vs 한 요청 N개 | **한 요청 N개** | 요청 수·감사 로그 수 절감, 부분 실패를 한 번에 보고 |
| E | 파일 분류(`file_category`) | **없음** | 필요 근거 없음. 신규 화면 단순화 원칙 |
| F | 다운로드 — `file-url?key=` 재사용 vs 항목 소속 검증 302 | **302** | 키 노출만으로 열리는 구멍을 주간툴에는 들이지 않음 |
| G | 삭제 권한 | 쓰기 권한자 전원 | 항목 수정·삭제와 동일 정책. 감사 로그로 추적 |
| H | 완료(아카이브) 항목 첨부 | **허용** | 완료 후 결과 자료 첨부가 자연스러움. 완료 항목 편집을 막는 규칙도 현재 없음 |

---

## 8. 선행 확인 (착수 전)

1. **Nginx `client_max_body_size`** (PROD·dev 호스트) — 20MB 이상인지. 미만이면 값 조정이 배포 절차에 포함됨(`.env` 외 PROD 편집이라 사용자 직접 또는 명시 허락)
2. S3 버킷 `weekly/` prefix 신규 — 별도 정책 없음(기존 도메인 prefix와 동일 버킷)

---

## 9. 비범위

- 테이블 행 직접 드롭 업로드, 미리보기 썸네일, 버전 관리, 파일 분류·태그
- 주차별 진행 기록(`weekly_item_updates`)·특이사항(`weekly_week_notes`) 첨부
- 엑셀/Slack 연동, 위키·드라이브 파일 링크 가져오기
- 바이러스 스캔

---

## 10. 구현 단계 (승인 후)

| 단계 | 내용 | 검증 |
|---|---|---|
| P1 | 마이그레이션 + Prisma 모델 + DTO/`toItemDto` `fileCount` | `psql \d weekly_item_files`, tsc 0, 보드 API `fileCount: 0` |
| P2 | files API 4종 + 항목 DELETE S3 정리 + 감사 | curl multipart 3개 업로드→목록→302 다운로드(한글명)→삭제, 21MB·11개 거부, VIEWER 403, 타 항목 fileId 404 |
| P3 | `WeeklyFilesPanel`·`FilesModal`·`TargetCell` + 보드/리스트 4곳 + 상세 모달 섹션 | 0건 '+첨부'→업로드 후 '📎 n' 즉시 갱신, 행 클릭 미전파, VIEWER 트리거 노출 규칙, 모바일 폭 |
| P4 | README(주요 기능·API·스키마·디렉토리)·DEV_HISTORY·`weekly_ops_design.md` §9 후속 링크 | — |

빌드·PM2 재시작·git push·PROD 반영은 사용자 명시 요청 시에만.
