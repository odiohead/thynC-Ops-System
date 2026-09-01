# 병원별 웨어러블 디바이스 원장 — 조사 브리프 (참조 자료, 설계안 아님)

> 2026-09-01 설계 착수 전 코드베이스·DEV/PROD 데이터(읽기 전용)·온프렘 thynC WAR/DDL을 조사한 원문. 설계안은 `hospital_device_registry_design.md`. 숫자·file:line은 조사 시점(main b94d2d8, PROD 09-01 08:28 KST) 기준이며 이후 변경될 수 있음.

---


> 조사 기준: 코드 = `main` b94d2d8 (dev2). 데이터 = DEV `thync_ops_dev`(PROD 2026-08-10 01:00 덤프) + **PROD `thync_ops` 읽기 전용 재검증 2026-09-01 08:28 KST**(git 5a6c036, 마지막 마이그레이션 `20260831100000_sales_deal_product_type` — DEV와 스키마 동일). 아래 숫자는 별도 표기 없으면 PROD 현재값이며 괄호는 DEV 값.
> 온프렘 제품 = PROD `/home/ubuntu/thynC`의 DDL 스냅샷 `create_table_20260616.sql` + WAR `thync-api-onpremise-01.01.431`(DTO·SQL 리터럴 추출) + 관리자/서비스 콘솔 JS로 **검증**한 사실. `docs/thync-product-1.3.0`의 (추정) 표기는 대부분 검증 완료(§2 말미 정오표).

---

## 1. 기존 자산 지도

### 1.1 병원 도메인 (`hospitals` 및 하위 리소스)

| 항목 | 사실 | 근거 |
|---|---|---|
| 병원 코드 | `HOSP-NNNNNN`(max+1, 6자리 패딩). **앱에서 불변** — PUT은 hospitalCode를 받지 않고, DB FK 25개 중 8개만 ON UPDATE CASCADE라 raw 변경도 불가. 거의 모든 FK가 `hospitals.id`가 아니라 `hospital_code`(TEXT) 참조(예외 `hospital_intro_types`) | `app/api/hospitals/route.ts:42-50`, `app/api/hospitals/[code]/route.ts:31,80-95` |
| 상태 | `hospitals.status`는 **텍스트 라벨**(status_codes category `HOSPITAL`). `lib/hospitalStatus.ts` `HOSPITAL_STATUS_RANK` 미계약1→가견적요청→답사요청→계약완료→운영5→해지6(+DB에 보류·기타). `recomputeHospitalStatus`는 projects/siteVisit/installPlan만 입력 — **'운영' = buildStatus 라벨에 '완료' 포함 프로젝트 존재**. 기기 정보는 상태 신호가 아님. **go-live 날짜 필드 없음**(contractDate·project.endDateExpected만) | `lib/hospitalStatus.ts:4-23,110-190` |
| 상세 페이지 | 서버 컴포넌트, **탭 없는 카드 13개 세로 스택**(max-w-4xl): 헤더(수정/일괄이전/삭제) → 기본 정보 → DaewoongStaffTab → **'thynC 현황' 카드(상태·상품유형·도입형태·계약일 + '도입 현황' 서브섹션 = `HospitalDevicesSection`)** L205-259 → SalesSection(ADMIN+ AND SEERS) → SystemStatusCard(서버·EMR) → SiteVisits → InstallPlans → Maintenances → 구축 프로젝트 → **InventoryUsageCard(비어 있으면 self-hide, 실제로 렌더된 적 없음)** L341 → Consultations → 병원 노트(위키) → RelatedWiki. 쓰기 게이트 `isAdmin = role !== 'VIEWER'`. 카드는 `_components/` 하위 클라이언트 컴포넌트가 `/api/hospitals/[code]/<sub>`를 자체 fetch | `app/hospitals/[code]/page.tsx:40-94,175-356` |
| 시스템 정보(2026-08-16) | `HospitalServer`(hospital_servers: name, **wardInfo 자유 텍스트** '51·52병동', monitoringUrl, remoteUrl, sortOrder, 1:N, ON DELETE CASCADE), `HospitalEmrInfo`(1:1), `HospitalMeta`(1:1, 172행). **PROD에서 15일째 hospital_servers=0행, hospital_emr_info=0행** → ward_info 형식 실측 불가, FK 대상 없음. 가장 최근 "병원 하위 리소스" 패턴(전용 테이블 + `/api/hospitals/[code]/servers` + 카드 + `lib/hospitalSystem.ts` 상수 + `scripts/seed-hospital-system-nav.sql`) | `prisma/schema.prisma:470-519`, `app/api/hospitals/[code]/servers/route.ts:11-55`, `_components/SystemStatusCard.tsx:194` |
| 병동/병상 | **병동 마스터 없음.** 텍스트·카운트만: `hospital_servers.ward_info`, `sales_deals.wards_text`('IM, ICU', '전병상' 등 콤마) + `ward_count`, `projects.ward_count/bed_count/gateway_count`, `hospital_sales_profiles.total_wards/total_beds`, `hospitals.intro_beds`. 심평원 허가병상 `hira_hospitals.perm_sbd_cnt`. 유지보수 텍스트는 '6병동','101병동','806병동'; WMS 출고처 텍스트는 '71병동','5A병동','11B병동','중환자실','5층 간호사실' | `schema.prisma:71,408-410,490,2167-2168,2229-2232` |
| 병원 삭제 | `DELETE /api/hospitals/[code]`(ADMIN+): projects/siteVisits 있으면 409, 트랜잭션에서 `daewoongHospitalAssignment`·**`hospitalDevice`**·`hospitalMeta` deleteMany 후 삭제(= RESTRICT FK 3개를 비우는 목록). maintenances/consultations/sales_deals/etc_task_hospitals는 NO ACTION → **500**(DEV에 해당 병원 11곳). 사용 이력: 전체 기간 1회(중복 생성 1분 뒤 삭제) | `app/api/hospitals/[code]/route.ts:125-161` |
| 병원 재지정·일괄 이전 | `reassignWorkItemHospital`(ADMIN+, 단건 프로젝트/답사/설치계획/유지보수+티켓) / `transferAllWorkItems`(SUPER_ADMIN, 프로젝트·답사·설치계획·유지보수·상담·전체 티켓 이동 후 양쪽 상태 재계산; **hospital_devices·meta·servers·deals·inventory 등은 이동 안 함**, 원본 병원은 비워질 뿐 삭제 안 됨). **제3 경로**: maintenances/site-visits/install-plans **일반 PUT이 hospitalCode를 받음**(USER, 재계산·감사 마커 없음) — 실사용 4건 전부 이 경로. transferAll·reassign API 실사용 0건 | `lib/workItemReassign.ts:89-214,235-364`, `app/api/maintenances/[id]/route.ts:40-69`, `app/components/TransferAllWorkButton.tsx:19-21` |
| FK 매트릭스(hospital_code) | RESTRICT: projects, site_visits, hospital_devices, hospital_meta, daewoong_hospital_assignments, consultations / CASCADE: hospital_servers, hospital_emr_info, hospital_sales_profiles, sales_activities, person_affiliations, hospital_intro_types / SET NULL: install_plans, tickets, voc_receipts, weekly_items, ai_usage_logs, **inventory_units, inventory_transactions** / NO ACTION: maintenances, sales_deals, etc_task_hospitals, consultation_queue, tasks, ai_chat_sessions | DEV `pg_constraint` 실측, `prisma/migrations/20260322010000_add_hospital_device/migration.sql:16` |
| 병원 검색 | `GET /api/hospitals?search=&sido=&page=`: hospitalName OR hiraHospitalName contains(코드 검색 없음), **PAGE_SIZE 20 고정, `limit` 파라미터 무시**(호출부 ~15곳이 `&limit=20` 전달). status 필터는 `/hospitals` 서버 컴포넌트에만 있고 API엔 없음. UI 3패턴: (a) 검색→드롭다운(MaintenanceForm/VocForm/TransactionModal 등) (b) `HospitalSelectModal`(프로젝트) (c) `SearchSelect` 클라이언트 콤보박스(사전 로드, MAX 50; "3,600 병원엔 `<select>` 불가" 주석). 전체 80,598행 중 고객 ~215 | `app/api/hospitals/route.ts:103-145`, `app/projects/_components/HospitalSelectModal.tsx`, `app/weekly/_components/SearchSelect.tsx:3-36` |

### 1.2 기존 "기기" 개념 — 수량 계층 4개 + 모델 마스터

| 테이블(모델) | 성격 | 데이터 | 쓰기 경로 |
|---|---|---|---|
| `device_info` (`DeviceInfo`, schema:352-366) | **기기 모델 마스터**: deviceModel UNIQUE, deviceName, isActive, sortOrder. 관계 ProjectDevice/HospitalDevice/SalesDealDevice/InventoryItem.deviceInfoId | **2행뿐**: id1 `MC200M-T` 심전계, id2 `MP100W` 산소포화도. **게이트웨이 MGW1010 없음**(2026-08-04 UDI용 4행 추가 후 같은 날 삭제, UDI는 inventory_items로 이동) | `/settings/devices` **'기기 관리'**(nav sort 38, 그룹 '병원·구축', USER+), `/api/settings/devices` audit `setting:device_info` |
| `hospital_devices` (`HospitalDevice`, schema:456-467) | **병원×모델 수량**: hospitalCode(FK RESTRICT), deviceInfoId, quantity, updatedAt; UNIQUE(hospitalCode, deviceInfoId). createdAt·시리얼·상태·병동·이력 없음 | **PROD 132행 / 67병원 / 13,119대**(DEV 15/8/1,547). 120행·11,742대가 **2026-08-11~08-20에 수동 입력**(센서스). 62/67 병원 ECG=SpO2 동수; 5곳 상이(한양대 370/185, 클래스 90/30, 중앙메디컬 31/15, 중앙대광명 4/—, 희명 70/—). **비운영 병원 8곳**(강남 200, 양산부산대 136, 세란 127 …)도 계획 수량 보유. 운영 202곳 중 59곳(29%) 커버 | **유일 앱 쓰기 = `PUT /api/hospitals/[code]/devices`**(모델별 upsert, 0이면 delete, **같은 트랜잭션에서 `hospitals.intro_beds` 갱신**, 게이트 `role !== 'VIEWER'`, **logAudit 없음** → 8월 센서스 작성자 추적 불가). 스크립트·크론·딜 코드는 손대지 않음(**"딜 동기화됨" 주장은 오류**). GET은 device_info를 **isActive 필터 없이** 전부 반환. 읽기: 상세 페이지 `HospitalDevicesSection`('도입 병상 수' + '웨어러블 디바이스 도입 수량' 저장 버튼 1개), `lib/ai/tools.ts:602,621-623`(병원 요약 '심전계(MC200M-T) x200'), 병원 DELETE 캐스케이드 |
| `project_devices` (`ProjectDevice`, schema:442-453) | 프로젝트×모델 '운영 실측/구축 계획' 수량 | PROD 300행/153프로젝트/23,434 (DEV 280/143; 133 동수, 4 상이, 6 SpO2 없음) | `PUT /api/projects/[code]/devices`, 프로젝트 상세 '기기별 도입 수량'(isActive만) |
| `sales_deal_devices` (`SalesDealDevice`, schema:2301-2312) | 딜×모델 '계약 스냅샷 수량'(deal 삭제 CASCADE, 0은 미저장) | **PROD 112행/57딜/10,703**(DEV 0행) | 딜 PUT에서 deleteMany+createMany |
| `sales_deals.daewoong_device_count`(schema:2255) | 대웅 원장 '디바이스수' 정수 | **PROD 249딜 / 19,113**(DEV 232/18,738); 운영 201병원 18,380. 차수 가산(`daewoong_count_type` 병원/추가/로컬/이슈, 24병원이 2~3차) | 딜 폼 |
| `hospitals.intro_beds`(schema:71) | '도입 병상 수' | **2026-08-03 `scripts/sync-intro-beds-from-deals-20260803.sql`로 1회 = Σdaewoong_device_count(계약완료 딜)** → 이후 재계산 코드 없음(신규 딜 시 즉시 어긋남). 메모리 `bed-count-source-of-truth`: **두 sync 스크립트 재실행 금지**. 대시보드 KPI·영업 침투율·AI KPI가 참조 | 병원 POST/PUT/import/devices PUT |

**"1 디바이스"의 실체(실측)**: `daewoong_device_count`는 병상수가 아니라(deal.bed_count와 97/232 딜 불일치, 합 21,739 vs 18,738) **ECG(MC200M-T) 수와 일치**(project_devices 대비 112/128 병원). SpO2 동수는 ~81%만 성립하고 결정적 공식 없음(한양대 370/185 등 부분 도입). 따라서 물리 웨어러블 개체 수 ≈ ECG 18~19k + SpO2 ≤ 그 수준 ≈ **최대 ~37k** + 게이트웨이(projects.gateway_count 합 19,415, 중앙값 65, 최대 689).

**파생 속성 선례(복제 대상)**: `syncHospitalIntroTypesFromDeals(hospitalCode)`(`lib/sales.ts:126-156`, 5a6c036 배포): 매핑 상수 `DEAL_MODEL_TO_INTRO_TYPE`(SQL 백필 `scripts/migrate-intro-types-from-deals.sql`과 동일 유지 주석) → 딜 전량 조회 → **매핑 가능 소스 없으면 현행 유지 가드** → `$transaction([deleteMany, createMany])` 전량 교체 → 딜 POST/PUT/DELETE 성공 **후, 트랜잭션 밖에서 `.catch(console.error)`** 최선 노력. 수동 편집 UI는 남겨두고 다음 동기화 때 덮어씀(오버라이드 플래그·힌트 없음). SQL 백필에 가드가 빠져 PROD 병원 10곳 도입형태 유실 사고(2026-08-31, `DEV_HISTORY.md:42-55`).

**일반/라이트**: `sales_deals.product_type TEXT DEFAULT '일반'` 단일 컬럼, 코드에 기기 구성·수량 분기 **전무**(정규화·배지 색만). 라이트 딜 1건(세란병원 127대). status_codes INTRO_TYPE '구축형(라이트)'·'사용량비례형(라이트)' 사용 0건.

### 1.3 자재관리(WMS) — 이미 시리얼 개체를 관리 중

| 항목 | 사실 | 근거 |
|---|---|---|
| `InventoryUnit`(inventory_units, schema:1027-1051) | itemId, serialNo VARCHAR(100), lotNo, status VARCHAR(10) `IN_STOCK\|OUT\|DISPOSED`(enum·CHECK 없음), warehouseId(OUT이면 null), inventoryId, **hospitalCode nullable FK(ON DELETE SET NULL, '출고 설치처')**, memo, tags[]. **UNIQUE(item_id, serial_no) — 품목 단위 유일**(같은 모델이 인벤토리별 별도 품목). 개체 이력은 컬럼이 아니라 `inventory_transaction_units` 조인으로 도출. **RETURN 시 hospitalCode를 NULL로 덮어써 이전 설치처 소실** | `lib/inventory.ts:435-452,518-526,608-660` |
| 상태 전이 | OUT: IN_STOCK@창고 검증 → `{status:'OUT', warehouseId:null, hospitalCode: input.hospitalCode ?? null}`; 사유 value `DISPOSE`(폐기/불량) → DISPOSED. IN 사유 value `RETURN`(회수(반품)): **같은 품목** 시리얼 조회, IN_STOCK이면 거부 → IN_STOCK, hospitalCode null. 취소(`reverseTransaction`)는 역전이 + 개체가 이미 움직였으면 409. `REASON_VALUE_RETURN='RETURN'`, `REASON_VALUE_DISPOSE='DISPOSE'`(status_codes `STOCK_IN_TYPE`/`STOCK_OUT_TYPE`의 `value`) | `lib/inventory.ts:69-77,677-708` |
| 병원 연결 게이트 | `planInventoryTransaction`: **txType==='OUT' AND inventory.linkHospital**일 때만 hospitalCode 허용(`inventories.link_hospital=true`는 **id1 대웅제약재고뿐**; 평가용/판매용/thynC운영팀재고 false). hospitalCode/workType(`PROJECT\|MAINTENANCE\|ETC`, `/api/inventory/hospital-works`)/refCode는 OUT에만 저장. **Excel bulk-serial·다품목 bulk 라우트는 hospitalCode를 받지 않음**; 전표 메타 PUT의 hospitalCode 수정은 **units에 전파되지 않음** | `lib/inventory.ts:255-263,331-333`, `app/api/inventory/transactions/bulk-serial/route.ts:64-81`, `bulk/route.ts:40-71`, `[id]/route.ts:136-152` |
| 데이터 현실(PROD) | units **21,085**(IN_STOCK 16,594 / OUT **4,491** / DISPOSED 0), **hospital_code 보유 0**. transactions 684(IN 224, OUT 455, MOVE 5) **hospital_code·work_type·ref_code 전부 0**. 08-10 이후 OUT 224건(4명 작업, audit inventory_tx 574행)에도 0. 병원은 `destination` 자유 텍스트에만: distinct 165 중 병원명 **정확 일치 55, 퍼지 124, 미해결 41**(심포지엄·제주지사·연구실 등) | PROD 실측 |
| 시리얼 품목·형식 | 시리얼 관리 품목 18(웨어러블 9 = MC200M-T/MP100W/MGW1010 × 대웅/판매용/평가용 + 네트워크 장비 9, 개체 0). 형식: **ECG `A`+6자리 9,528개**, **SpO2 `P`+6자리 9,652개**, **게이트웨이 `GW####-B######` 14자 1,904개**(+18자 1). 전 시리얼 품목 간 중복 없음. 심전계/산소포화도 품목만 `device_info_id` 연결(6/24), **MGW1010 품목은 device_info_id NULL**. UDI-DI 08800096401314(ECG)/08800096401536(SpO2)는 품목 속성. 센서 패치 MP1000F/MP2000F/MP2000R·전극·배터리·에바폼은 **비시리얼 수량 품목** | PROD 실측, `lib/itemUdi.ts` |
| **AS 교체 흐름이 이미 WMS 텍스트로 기록 중** | 08-10 이후 **판매용재고 903호 단건 OUT 27건, note '판매용 (유지보수_분실) SD6420', destination '대청병원 / 71병동', '인천백병원 / 중환자실', '청구성심병원/ 5A병동', '대청병원 / 5층 간호사실', '국제성모병원 (11B병동)'**; 대웅제약재고 909호 대량 go-live 출고(세란 08-14 → hospital_devices 08-20 127/127과 일치, 더열린 08-21, 충북대 08-25); 평가용재고 데모/심포지엄 OUT. **IN 회수(반품) 57건**(08-10 이후), '불량게이트웨이' 1대씩 2건. **18개 개체가 OUT을 2회 이상**(반납 후 재출고). 전체 OUT 455 중 병동 텍스트 포함 30, note '교체' 78, '분실' 27 | PROD 실측 `inventory_transactions`/`_units` |
| 병원 상세 '사용 자재' | `InventoryUsageCard`: `/api/inventory/transactions?hospitalCode` + `/api/inventory/units?hospitalCode&status=OUT`('설치된 개체 (시리얼)') → 데이터 0이라 **한 번도 렌더된 적 없음** | `_components/InventoryUsageCard.tsx:22-44,81-93` |
| API·권한 | `GET /api/inventory/units`(로그인 전체, 필터 itemId/status/warehouseId/hospitalCode/inventoryId, **페이지네이션 없음**), `PATCH /units/[id]`(memo/tags/serialNo만 — "상태·위치는 전표로만"), 전표 목록 page/limit(≤200). 권한: `canManageStock`= ADMIN+ OR inventory_managers 풀 OR `inventory.manage\|admin`; `canAdminInventory`= ADMIN+ OR (USER+ AND `inventory.admin`); `canEditTxMeta`= ADMIN+ AND (풀 OR 권한). `/api/inventory/can-manage` 프로브 | `lib/inventory.ts:19-52`, `app/api/inventory/units/route.ts:8-40` |
| Excel 일괄(복제 대상) | `POST /api/inventory/transactions/bulk-serial`(multipart file; 시트1, 1행 헤더 skip, A=품목명 B=시리얼 C=LOT; MAX_ROWS 2000; `?preview=true` 행별 `{row,status:'ok'\|'error',message}`+summary; 오류 1건이라도 있으면 실행 거부; 단일 `$transaction`(timeout 120s) all-or-nothing; P2002 재시도; logAudit) + `BulkSerialTxModal`(미리보기 300행, 오류만 토글, 실행 버튼 비활성) | `bulk-serial/route.ts:20-260`, `app/inventory/components/BulkSerialTxModal.tsx:59-239` |
| 2.0 계획서 | `projects/ops_system_2.0_plan.html` A1 '장비 개체 수명주기 관리(시리얼 → 병원 설치 자산)' = 정확히 이 기능. "WMS 재고·전표 로직은 손대지 않음, 창고 밖 상태 추가", **미결 = 기존 HospitalDevice와의 관계**, 소급 범위는 '신규 출고 + 장애 시 백필' 권장. 상태 '기획 검토 대기' | `projects/README.md:18` |

### 1.4 AS / VOC / 티켓

| 항목 | 사실 | 근거 |
|---|---|---|
| `Maintenance`(schema:1103-1136) | `MNT-YYYYMM-NNNN`, hospitalCode **필수**, typeId(MAINTENANCE_TYPE 하드웨어/소프트웨어/네트워크/기타 — CTI 규칙 조건축), statusId(접수→OPEN/처리중→IN_PROGRESS/완료→CLOSED/보류→PENDING), priority→SEV, symptoms(text), resolution(Tiptap HTML), ticketId 1:1, 자식 logs/visits/assignees/files(CASCADE). **기기·시리얼 컬럼 없음**. PROD 260건(DEV 239), 월 최대 79건(06월), 유형 하드웨어 89/기타 70/네트워크 52/SW 21. 하드 삭제(ADMIN+ OR `maintenance.admin`) 후 티켓 삭제 | `app/api/maintenances/route.ts:94-234` |
| 실무 기록 방식(= 레지스트리가 구조화할 원시 데이터) | `MNT-202606-0007` "AS 기기 교체로 시리얼번호 변경 작업 : **P018363(삭제) -> P020418(등록)**"; `MNT-202605-0047` "**A126861기기 252병동->101병동**"; `MNT-202604-0019` GW "s/n. B013106, B014106 … (현황에 게이트웨이 시리얼 미기재)"; `MNT-202608-0005` "6병동, **B033167** 교체"; `MNT-202608-0023` "62병동 심전도 1ea **A12016**"(5자리 — 오타); `MNT-202608-0020/0021` **카트온BP 교체장비 재등록 / 반납된 기기 삭제 요청**(= 회수됐지만 삭제 안 된 온프렘 문제 그 자체). 전체 260건 중 광의 정규식 90건, 명시 시리얼 12건. 게이트웨이는 **항상 B-번호만** 인용. 소모품 센서 교체 캠페인(MP2000F '49ea','200대')은 `etc_tasks` | PROD 실측 |
| `VocReceipt`(schema:1853-1886) | `VOC-YYYYMM-NNNN`, **hospitalCode nullable**(비고객 허용)+hospitalNameRaw, channel/vocType/status 코드, content, resolution HTML, ticketId 1:1, 담당은 티켓만. 기기 필드 없음. **PROD 0건**(08-15 배포, 미사용; DEV 1건은 테스트). VOC 상세 '하위 티켓 생성' → `TICKET_DOMAIN_META[rt].childCreate.formPath?parentTicketId=`(현재 MAINTENANCE `/maintenances/new`만) — 기기 컨텍스트가 타고 갈 자연스러운 자리 | `app/voc/[id]/page.tsx:288-360`, `lib/ticket-domains/meta.ts:106-119` |
| 유지보수 POST parentTicketId | 정수·존재·부모의 parentId null(2레벨)·부모 CLOSED 아님 검증 → `$transaction{ createTicketForMaintenance; ticket.update(parentId); addTicketEvent 'link' parent_set/child_added }` | `app/api/maintenances/route.ts:94-105,166-181` |
| 티켓 도메인 어댑터 | `DOMAIN_REF_TYPES = SITE_VISIT\|INSTALL_PLAN\|PROJECT\|ETC\|MAINTENANCE\|VOC`(닫힌 목록). 어댑터 `{refType, meta, detailInclude, syncTicketToDomain, buildLinkedWork}`; 레지스트리 `TICKET_DOMAIN_ADAPTERS: Record<DomainRefType,…>`(누락 시 컴파일 오류). **신규 도메인 SOP(`projects/cs_ticket_workflow_design.md` §3.4)**: ① Prisma 테이블 + `Ticket` 1:1 역관계 필드 + 수동 마이그 ② status_codes 카테고리 + `ticket_status` 매핑 + `seed-ticket-status-map.sql`(규칙 6, 미매핑 400) ③ `ticket_domain_cti_rules` 행 + 시드(규칙 5) ④ 어댑터 파일 + registry.ts + meta.ts ⑤ 도메인 CRUD가 `createTicketForX`/`syncXToTicket`을 같은 트랜잭션에서 호출 ⑥ tsc + 왕복 스모크. **컴파일 팬아웃**: `TicketRefTypeBadge` REF_TYPE_TONES, `lib/notify.ts` TaskType, `lib/notifyFields.ts` TASK_TYPE_LABELS/FIELD_CATALOG/DEFAULT_FIELDS, (선택) `lib/sla.ts`. 시드 템플릿 `scripts/seed-cs-masters.sql:44-86`. 기존 마스터: Assignment Group 유지보수(3)/CS(18), CTI 고객지원>장애>하드웨어(7), 대기 사유 '자재·물품 대기'(2) | `lib/ticket-domains/registry.ts:23-54`, `types.ts:16-34`, `voc.ts:64-224` |
| 알림 | **Slack은 티켓 파이프라인 단일 소스**(`notifyTicketCreated/Changed`, 커밋 후 best-effort). 티켓 없는 레지스트리 이벤트는 알림 경로가 없음 — 직접 발송 추가 금지 | `lib/notify.ts:1-13` |
| 감사 | `logAudit({req, actor, action CREATE\|UPDATE\|DELETE, resource snake_case, resourceId=업무코드, resourceLabel, before, after})`; 사용자용 타임라인이 필요한 모듈은 **전용 로그 테이블**(maintenance_logs, ticket_logs)을 따로 가짐 — audit_logs는 타임라인 용도 아님 | `lib/audit.ts:4-112` |

### 1.5 플랫폼 공통(요약 — 체크리스트는 §5)
nav = `nav_menu_items` DB 행(operations 하위 hospitals 10 … inventory 70 … hira 100; PROD·DEV 동일 50행; `/devices` href 없음) / RBAC Lite = `lib/permissions.ts` 카탈로그 + `hasPermission` / 마스터 = `StatusCode(name, category, order, color, value)` + `StatusCodeManager` / UI 프리미티브 `app/components/ui/*` / Excel = `xlsx` / AI 도구 `lib/ai/tools.ts`(`find_serial_unit` 기존).

---

## 2. thynC 제품(온프렘) 디바이스 데이터 모델 요약 (WAR·DDL 검증)

### 2.1 `device_register` — 기관 보유 디바이스 등록/운용(19컬럼, 검증)
`device_register_id` PK · `organization_code varchar(64) NOT NULL`(**FK 없음**) · `device_type int DEFAULT 0` · `device_code varchar(64) NULL`(닉네임 S1/H1, **UNIQUE이나 nullable**) · **`serial_number varchar(64) NOT NULL UNIQUE(서버 전역)`** · **`ward_code varchar(128) NOT NULL`(FK 없음)** · `mac_address`(인덱스만, 비유일) · **`date_time datetime NULL`** · `etc varchar(500)` · `total_use_time int`(분) · `total_use_count int` · `device_return_status int DEFAULT 0`('0 사용중/1 반납') · `sickbed_code`/`sickroom_code`(FK SET NULL, 세션 중 일시 배정) · `auto_mode`/`auto_time_value`(기본 240분)/`auto_time_value_etc`/`auto_time_value_type` · `premium int NULL`(1 구독형/비례형, 0 기본형). 인덱스 (org,type),(org),(mac),(type),(date_time),(ward_code). **created/updated 분리 없음, soft-delete 없음, 등록 이력 테이블 없음.**

핵심 검증 사실:
- **`date_time`은 최초 등록일이 아님** — 클라이언트가 보낸 `requestDateTime`을 INSERT 시 저장하고 **UPDATE(병동 이동·닉네임 수정)마다 덮어씀**. 온프렘에서 등록일을 시드할 수 없음.
- **`device_return_status`는 사실상 사용되지 않음** — 서비스 콘솔은 항상 `deviceReturnStatus=0`으로 조회하고 1을 보내는 라이브 코드 없음; 관리자 콘솔 '삭제'는 `DELETE FROM device_register WHERE serial_number=?`. 회수됐지만 삭제 안 된 기기는 온프렘 데이터로 구분 불가(단서: `deviceUseStatus=0` + 사용량 정체). 사용자가 말한 "신뢰 불가"의 정확한 원인.
- `deviceUseStatus`는 컬럼이 아니라 **계산값**(`device_info JOIN measurement_info WHERE measurement_status IN (1,2)` 존재 여부).
- 라이프사이클 API: `InsertDeviceRegister`/`InsertDeviceListRegister`(+All/ForManager, 배치당 병동 1개, 아이템별 INSERT), `UpdateDeviceRegister`(병동 이동·닉네임·사용량 리셋), `UpdateAllDeviceOrganizationCodeList`(타 기관 일괄 이관, 측정 중이면 거부), `DeleteDeviceRegister`/`DeleteAllDeviceRegisterList`(물리 삭제), `ResetDeviceRegisterUseTime`(→`device_reset(serial_number, date_time)`). **교체 연결(구→신), 등록 단위 변경 이력, 회수/폐기 상태 없음 → 그 공백이 이 기능의 존재 이유.**

### 2.2 기기 유형·시리얼·MAC (검증, (추정) 해제)
| device_type | 제품 | 시리얼 규칙(관리자 콘솔 `DEVICE_SERIAL_CHECK`) | MAC 유도 |
|---|---|---|---|
| 1 ECG | MC200M(-T) 심전계 | `A`+6자리 | `08:D5:C0:5` + hex(숫자 5자리) |
| 2 TEMP | MT100D 체온계 | `C`+6자리 | `08:D5:C0:6`… |
| 3 SpO2 | MP100W 산소포화도 | `P`+6자리 | `08:D5:C0:4`… |
| 6 BP | MBP100U 혈압계 | `E`+6자리 | `08:D5:C0:7`… |
| 8 Tag | RTLS 태그 | — | `08:D5:C0:1`… |
| 10 Ring BP | SkyLabs SL-MPF1K07 | `[FGK][-A-Za-z0-9]{6}-[-A-Za-z0-9]{5}`(플래그) | 벤더 API 제공 |
| 11 Charm BP | H2-ABPM | `H2-BPM-[A-Z0-9]{4}`(플래그) | `00:00:00:B0:xx:xx` |
| 4 HR | `device_info`(세션) 전용 값 | | |

기본 정규식 `/^[APCE]\d{6}$/`; 서비스 콘솔 관리자 화면은 더 느슨(자모 제거, '-' 뒤 부분 채택 = 바코드 `XXX0000-A000000` 허용, 문자 A/P/C(/E) + 숫자 정확히 6). **서버는 시리얼 형식을 전혀 검증하지 않음**(`EntityConfig.SERIAL_NUMBER_PATTERN '^[a-zA-Z0-9]{6,24}$'` 미참조) → 실 등록에 오타·소문자·바코드형 혼재 가능. WMS 실측(A/P 7자)과 일치.

### 2.3 게이트웨이 `gateway_info`(별도 자산 클래스)
serial_number UNIQUE, mac_address UNIQUE, organization_code FK CASCADE, ip, ward_code·sickroom_code, floor·lc_number, fw_version·update_fw_version·fw_update_date_time, conn_status(0/1/2/5), gateway_error_code, axis_x/y(도면 좌표), deactivate, send_email. 관리자 콘솔 시리얼 규칙 **`/^[B]\d{6}$/`**, MAC 프리픽스 `08:D5:C0:2`. `gateway_device_conn_log`(gw_sn ↔ device_sn, rssi)가 GW–패치 유일 조인. **온프렘·유지보수 = 순수 `B######`, WMS = `GW####-B######` 합성** — 이중 표기.

### 2.4 배치 계층·코드 형식
`organization`(organization_code UNIQUE, level 0/1/5/10, `device_manager_type` 'SEERS 관리/병원 관리') 1:N `building` 1:N `ward`(ward_code varchar(128) UNIQUE, ward=병동명, nickname, deactivate) 1:N `sickroom` 1:N `sickbed`(모두 CASCADE). **디바이스의 영속 배치 = ward_code; 병실/병상은 세션 중 일시(SET NULL).** 관리자 콘솔 '병동 간 장치 이동'만 있고 병실/병상 배정 UI 없음. 실 ward_code 예(병원별 WAR 프로필): `BSHOSP1_6366`, `IBSH_B263`, `bkhosp_0V9V` → **`<organization_code>_<영숫자4>`**, 서버 생성, 대소문자 혼재. **한 온프렘 서버가 organization_code 2개를 호스팅하는 사례**(BSHOSP+BSHOSP1, IBSH+bkhosp) → 병원↔org 코드 1:N 가능. ops `hospitals`에 온프렘 org 코드 필드 없음.

### 2.5 `device_factory`(본사 생산 마스터, 온프렘엔 사실상 비어 있음)
serial_number UNIQUE, product_number UNIQUE, lot_number, carton/inner_box, firmware/hardware_version, `service_type` NORMAL/PREMIUM/REPLACEMENT/SAMPLE/DEVELOPMENT, `usable` UNUSED/USED/UNUSABLE/DISPOSAL, `refurbished`, `repair_count`. 제품 내 유일한 라이프사이클 모델(→ ops 인벤토리 판매용/평가용/대웅과 개념 대응).

### 2.6 읽기 동기화용 API 계약(검증)
Base `http://{host}:8080/mobiCAREConsole/API`(또는 8443), 전부 POST JSON, 헤더 `SX-Auth-Token`(로그인 `/API/Account/LoginHIS`; 토큰 오류는 HTTP 200 + `{result:false,error:241}`). `POST /API/Device/SelectDeviceRegisterPage`(기관) / `SelectAllDeviceRegisterPage(ForManager)`(targetOrganizationCode 필수): 요청 `ReqSelectDeviceRegister{organizationCode, targetOrganizationCode, serialNumber, deviceType(0=전체), deviceTypeList[], wardCode, search(device_code/serial LIKE), pageNumber, count, includeUseInfo, deviceReturnStatus?, deviceUseStatus?, orderParamMap{active|usageTime|usageCount: ASC|DESC}, sickRoomCode, sickBedCode, premium?}` + ReqJson 공통(requester, requestDateTime 'yyyy-MM-dd HH:mm:ss', gmtCode, timezone, deviceKind…). 응답 `ResSelectDeviceRegisterList{result, error, message, totalCount, deviceRegisterList:[{organizationCode, deviceCode, serialNumber, macAddress, wardCode, deviceType, dateTime, etc, totalUseTime, totalUseCount, deviceReturnStatus, deviceUseStatus, sickBedCode, sickRoomCode, premium}]}`. **updated-since/델타 필터 없음 → 동기화는 병원별 전량 스냅샷 diff(시리얼 upsert, 미존재 표시)로만 설계 가능.** 보조: `SelectDeviceRegisterCount`(type별 count), `SelectDeviceUsageList`(시리얼별 세션·리셋 이력, 마지막 사용일 단서), 게이트웨이 `/API/Manager/SelectGatewayInfoPage`. 일괄 등록 `ReqInsertDeviceListRegister{organizationCode, targetOrganizationCode, wardCode(배치당 1개), deviceInfoList:[{deviceCode:null, serialNumber, deviceType, macAddress, premium}]}` → 아이템별 result/error('Invalid wardCode','Duplicate registration'). 관리자 콘솔 xlsx: **첫 시트 A열 각 행 = 시리얼만**(헤더 skip 없음, 다른 열 무시), org/병동/premium은 폼에서. 클라우드 피드(`InsertOnpremiseDeviceRegisterInfo`, DTO `PremiumDeviceRegisterInfo{organizationCode, organizationName, wardCode, wardName, serialNumber, macAddress, deviceType, premium}`)는 정의만 있고 미가동.

### 2.7 `docs/thync-product-1.3.0` 정오표(기능과 함께 수정·재게시 권장)
`06-db-design.html:286-299` device_register 컬럼 누락(serial_number/organization_code/date_time/etc), ward_code NOT NULL·FK 없음, device_type 도메인 6/8/10/11 누락, return_status 미사용 주석 필요 / `11-glossary-codes.html:256-278` 문자→유형 매핑 (추정) 해제 및 규칙 정정 / `05-api-spec.html:555-571` 필드 목록 추가. 재게시 `scripts/publish-wiki-html-docs.mts`(AI 어시스턴트 `search_wiki`가 읽음).

---

## 3. 자재관리(WMS)와의 관계

**오늘 WMS에서 레지스트리를 도출할 수 있는가 → 불가.**
1. 병원 연결 0%: units 21,085·OUT 전표 455 모두 `hospital_code` NULL(연결 기능은 2026-07-08부터 있었음).
2. 2026-07-01 스냅샷 적재 이전 설치분(운영 병원 대부분)은 WMS OUT을 거치지 않음(UDI 설계서 §3.5, 소급 입력 거절 결정 4).
3. `destination` 텍스트는 정확 일치 55/165, 오타('클레스병원')·'2차' 접미·**병동이 텍스트에 섞임**('좋은선린병원/ ICU, 6병동, 8병동').
4. RETURN이 `hospitalCode`를 NULL로 덮어써 WMS만으로는 "어느 병원에서 회수됐는지" 소실.

**빠진 것(연동 전 선결 3 + 1)**: ① `link_hospital` 게이트가 대웅제약재고에만 켜져 있는데 **AS 교체 출고는 판매용재고**에서 나감 ② bulk-serial·bulk JSON 라우트에 hospitalCode 없음 ③ 전표 메타 PUT이 units에 미전파 ④ 병동 정보가 destination 텍스트에 기생.

**향후 WMS→레지스트리 자동 등록이 걸릴 지점(지금 설계에 예약만)**:
- OUT: `lib/inventory.ts:518-526`(units `hospitalCode` 스탬프 직후) — 입력에 이미 `hospitalCode, unitIds/serials, workType, refCode, txDate` 존재 → `registerFromInventoryOut(txId)` 형태의 **멱등 진입점**(키 = `inventory_transaction_units`)을 lib에 두면 `createInventoryTransaction` 끝에 한 줄 훅으로 붙일 수 있음. 조건 후보: `inventory.linkHospital AND item.isSerialManaged AND item.deviceInfoId IS NOT NULL`(판매용/평가용은 link_hospital 플립만으로 opt-in).
- RETURN IN: `lib/inventory.ts:435-452` → 레지스트리 '회수' 이벤트(ref_type `INVENTORY_TX`, ref_code `STK-…`). 취소(`reverseTransaction`)도 대칭 필요.
- 조인 키: `inventory_units.id`(nullable FK, ON DELETE SET NULL) + 비정규화 `serial_no`/모델. **units는 (item_id, serial_no) 유일이므로 시리얼+모델로 해석**(오늘은 전역 유일이지만 보장 아님). 모델 매핑은 `inventory_items.device_info_id`(ECG/SpO2 연결됨, **MGW1010 NULL**).
- 경계: **레지스트리는 `inventory_units.status`를 절대 쓰지 않음**(2.0 계획·WMS 설계 원칙). 회수 이벤트가 WMS 반품 입고를 자동 생성할지는 별도 결정(§8-13).
- 보조 백필 후보: 08-10 이후 '유지보수_분실' OUT 27건 + 회수(반품) IN 57건, 그 이전 시리얼 OUT 48전표/1,571개(28 목적지, 광주기독 405, 남양주백 253, 소나무 234) — destination→병원 퍼지 매칭 **제안 목록**으로만(자동 기록 금지).
- UI 재사용: 병원 타이프어헤드(`TransactionModal.tsx:186-206`), `UNIT_STATUS` 배지 맵, 개체 목록 컬럼(시리얼 mono/LOT/태그/상태/설치처), 전표 취소 409 패턴.

---

## 4. AS / VOC / 티켓과의 관계

**현재**: 기기 교체·회수·병동 이동은 전부 `maintenances.symptoms/resolution` 자유 텍스트(§1.4 예시). 유지보수 유형에 '교체/AS' 없음(하드웨어·기타에 숨음). VOC는 PROD 0건. 티켓 751건 중 VOC 1(DEV). 인벤토리 OUT의 `workType=MAINTENANCE + refCode=MNT-…` 연결은 구현돼 있으나 사용 0.

**미래 훅(지금은 스키마 자리만)**:
- **첫 연동 대상은 실무가 기록되는 유지보수**: 유지보수 상세에 '기기 교체' 액션(구 시리얼 회수 + 신 시리얼 등록 쌍) → 레지스트리 이벤트 `ref_type='MAINTENANCE', ref_code='MNT-…'`. VOC는 `VOC 상세 → 하위 유지보수 생성(?parentTicketId=)` 핸드오프에 기기 id를 쿼리로 실어 보내거나 VOC 자체 이벤트(`ref_type='VOC'`).
- 이벤트 참조는 **소프트 참조(ref_type+ref_code)** — `tickets.ref_type/ref_code`, `inventory_transactions.work_type/ref_code` 선례. 이유: 유지보수 hospital_code를 바꾸는 경로가 3개(재지정 API·일괄 이전·**일반 PUT**)이고 하드 삭제됨 → **이벤트 행에 hospital_code를 비정규화 저장**해 사건 시점 진실을 고정. `tickets`에 기기 컬럼 추가 금지.
- **레지스트리 자체는 티켓 도메인이 아님**(워크플로 상태·Assignment Group 없음) → 어댑터·CTI·상태맵·Slack 의무 없음(weekly 선례 §10). **'AS 교체요청'을 별도 도메인으로 만들 때만** §1.4 SOP 6단계 + 팬아웃(REF_TYPE_TONES, notify TaskType, notifyFields) + 시드(CTI 후보 고객지원>장애>하드웨어 또는 신설 고객지원>AS>교체, 큐 유지보수/CS, 대기 사유 '자재·물품 대기').
- 알림은 연결된 유지보수/VOC 티켓의 `notifyTicketChanged`로만.
- 유지보수 유형 '교체' 신설 시 규칙 6(ticket_status 매핑)은 MAINTENANCE_TYPE엔 해당 없음(조건축), CTI 규칙 행만 추가(규칙 5).

---

## 5. 플랫폼 규약 체크리스트

| 영역 | 규약 | 근거 |
|---|---|---|
| 설계 문서 | `projects/<기능>_design.md`(+.html 선택), 상단 상태 blockquote(`설계 검토 대기 — 미착수` 등 고정 문구)·작성일·경위, `projects/README.md` 표 행 추가. 하우스 구조: 1 배경·목적(핵심 차별점) → **2 이 기능이 답해야 할 질문**(표, "기여 않는 필드·화면은 만들지 않는다") → **3 기존 기능과의 경계(중복 검토)**(file:line 인용) → 4 개념 모델(단일 소스 불변식) → 5 데이터 모델(컬럼\|타입\|근거) + 5b Prisma 역관계 + 5c 코드 상수 vs DB 마스터 → 6 화면(빈 상태 필드 노출, 모바일) → 7 API(메서드·경로\|동작\|권한, 규약 한 줄) → 8 권한 → 9 기존 데이터 연동(v1/v2, 'AI read-only 도구 노출') → 10 비범위 → 11 구현 단계(P1/P2/P3) → 12 쟁점(#\|쟁점\|추천\|대안) → 부록 마이그레이션 SQL. **설계 검토 게이트: 사용자 명시 착수 승인 전 코드 금지**(memory `design-review-gate`). `feature-design-principles`: 참고 구조 이식 금지, 빈 상태 노출, 중복 검토, **카드 나열 지양** | `projects/README.md:5-25`, `projects/weekly_ops_design.md`, `projects/inventory_udi_ledger_design.md` |
| DB 마이그레이션 | `prisma migrate dev` 금지 → psql DDL → `prisma/migrations/YYYYMMDDHHMMSS_snake/migration.sql` 수동 → `migrate resolve --applied` → schema.prisma(@map/@@map/@@schema("public"), Hospital·DeviceInfo·User 역관계) → `prisma generate`. PROD: `git pull` → `migrate deploy` → **`prisma generate`**(08-31 빌드 실패 교훈) → `NODE_OPTIONS=--max-old-space-size=4096 npm run build` → `pm2 restart thync-prod`. PROD DDL/DML 명시 허락. 빌드·push는 요청 시만 | CLAUDE.md 절대 규칙 1·3·4·5·6, `DEV_HISTORY.md:41-43` |
| nav | `nav_menu_items`(menu_key UNIQUE, label, href, icon_key ∈ `ICON_MAP`(package/wifi 등, 신규 아이콘은 `NavIcons.tsx` 코드 변경), parent_key, group_label, allowed_roles[], allowed_org_codes[], allowed_permissions[], sort_order). 등록은 **마이그레이션 내 `ON CONFLICT (menu_key) DO NOTHING` INSERT + `scripts/seed-<기능>.sql`(PROD→DEV 동기화 시 소실 대비 재실행 가능)**. operations 자식 sort: hospitals 10 … maintenances 50 / etc-tasks 60 / inventory 70 → 후보 55(AS 인접) 또는 75(WMS 인접). 설정 하위 그룹 '병원·구축'(30-40, devices 38) / '자재관리'(70-90). "메뉴 노출은 UX, 보안은 API 게이트" | `app/components/Navigation.tsx:52-156`, `scripts/seed-cs-masters.sql:78-86`, memory `nav-menu-sync-gotcha` |
| RBAC Lite | 권한 키는 `lib/permissions.ts` `PERMISSIONS`(label/module/description)에만 추가(풀 테이블 신설 금지), `hasPermission(user, key)`(SUPER_ADMIN true, 60s 캐시, 역할 변경 API는 `invalidatePermissionCache`). 합성: 가산 = 등급 OR 권한, 자격 = 등급 AND 권한; 신규는 `isUserOrAbove AND hasPermission` 권장. 서버 전용 `check<Feature>Access(user, {write}) → {status,error}\|null` 파일(`lib/weeklyAccess.ts`, `lib/sales.ts`, `lib/ai/access.ts`), 클라이언트 프로브 GET(`/api/inventory/can-manage`). 조직 게이트는 JWT 아닌 DB 실시간 조회. 기존 병원 하위 라우트는 `role === 'VIEWER'` 인라인(헬퍼 권장) | CLAUDE.md RBAC, `lib/appRoles.ts:14-59`, `lib/auth.ts:38-47` |
| 마스터 | 사용자가 편집하는 어휘 → `StatusCode` 신규 category + `app/api/settings/<slug>/route.ts`(GET `{statusCodes}`, POST/PUT/DELETE, audit `setting:<x>`) + `StatusCodeManager` 페이지 + nav 행 + `scripts/seed-*.sql`(`ON CONFLICT (name, category) DO NOTHING`); **시스템 의미는 `value` 컬럼**(RETURN/DISPOSE 선례, 삭제 불가). 동작을 좌우하는 코드 상수는 클라이언트 안전 `as const` + 타입 가드(`lib/hospitalSystem.ts`; weekly §5c 근거). 22 카테고리 기존 | `prisma/schema.prisma:131-173`, `app/settings/_components/StatusCodeManager.tsx` |
| API | `force-dynamic`, 수동 파싱(zod 없음), 오류 `{ error: '한국어' }` 400/401/403/404/409, 성공 리소스 키 객체(`{ data, total }` 목록), 병원 스코프는 `app/api/hospitals/[code]/<sub>/route.ts`(404 선검사), FK 대상 존재 검사, 모든 mutation `logAudit`(신규 resource 예 `hospital_device_unit`/`hospital_device_event`, resourceId=시리얼, label '{병원} {모델} {시리얼}'), 클라이언트 `router.refresh()` | `app/api/hospitals/[code]/servers/route.ts`, `lib/audit.ts` |
| 병원 생명주기 편입 | 신규 테이블 FK `hospital_code … ON DELETE RESTRICT ON UPDATE CASCADE` + DELETE 라우트 409 선검사('연결된 기기 이력…') 또는 CASCADE 선택; `transferAllWorkItems`에 units/events updateMany + `moved.devices` + 버튼 문구 추가 | `lib/workItemReassign.ts:258-343` |
| Excel | import = `bulk-serial` 패턴(multipart, `?preview=true`, 행별 ok/error, MAX_ROWS≈2000, 오류 시 실행 거부, 단일 트랜잭션, P2002 재시도, 파일 내·DB 중복 검사, `BulkSerialTxModal` UI) — `hospitals/import`의 전량 교체 방식은 복제 금지. export = `XLSX.utils.json_to_sheet` → `NextResponse` attachment(`filename*=UTF-8''`), 목록 where 빌더 재사용, 행 캡, `window.location.href` | `app/api/inventory/transactions/export/route.ts:11-67` |
| UI | `app/components/ui/*`(PageHeader/Table/TH/TD/Badge/Button/Input/Select/Modal(모바일 바텀시트)/EmptyState/Card) + 시맨틱 토큰; 목록 패턴 A(클라이언트 fetch)/B(서버 페이지네이션+탭+모달+Excel)/C(서버 컴포넌트 searchParams); 빈 상태에도 헤더·필드 노출; `md:hidden` 카드 또는 overflow-x-auto; 병원 선택은 검색 콤보/모달(플레인 select 금지) | `app/components/ui/Table.tsx`, `app/inventory/transactions/page.tsx` |
| AI 어시스턴트 | read-only 도구 4개소(`AI_TOOLS` 정의 + `TOOL_LABELS` + 구현 + `executeTool` case), 행 캡·`link` 필드, README '도구 26종' 갱신. 기존 `find_serial_unit`(inventory_units 기준, 병원은 항상 null)·`get_hospital_overview`(hospitalDevices 문자열)와 의미 구분 필요 | `lib/ai/tools.ts:37-62,477-548` |
| 문서 | `DEV_HISTORY.md` 상단(`## YYYY-MM-DD HH:MM \| 제목`, 검증 줄, 영향 파일), README: 디렉토리 구조(57-89), 스키마(369-370 HospitalDevice·491 DeviceInfo·667 WMS), 주요 기능 병원 관리(929-949 카드 순서), API 표(1482-1498, **`/api/hospitals/[code]/devices` POST→PUT 오기 수정**), AI 도구 수(1238), `projects/hospitals_erd.html` | README.md |
| 착수 전 | **"PROD 데이터 동기화해줘"로 DEV 갱신** — 현재 DEV엔 132행 hospital_devices·224건 OUT·4,491 OUT 개체·8월 유지보수가 없어 대조·임포트 로직 검증 불가 | CLAUDE.md 약속어 |

---

## 6. 데이터 규모(설계 사이징)

| 지표 | 값 |
|---|---|
| 병원 | 전체 80,598(HIRA 참조 포함) / 고객 **운영 202 · 계약완료 9 · 보류 3**(+답사요청 60, 가견적 22) — 레지스트리 모집단 ≈ 215, 검색 기본은 고객만 |
| 계약 디바이스 | 딜 249 / **19,113**(운영 201병원 18,380). 병원당(DEV) 최소 8, p25 30, 중앙값 53.5, p75 116.5, p90 205, **최대 500**(제주한라 500/500, 분당제생 469, 김포우리 469, 한양대 370, 평택성모 359). 구간: 1-10 6, 11-20 17, 21-50 78, 51-100 48, 101-200 36, 200+ 21 |
| 물리 개체 추정 | ECG ≈ 18~19k, SpO2 ≤ 동수(≈81% 병원 동수) → **전량 백필 ≈ 최대 37k행**, 게이트웨이 별도 ≈ 19k(gateway_count 합, 중앙값 65, 최대 689). 병원당 웨어러블 중앙값 ~107, p90 ~410, 최대 ~1,000(+GW 시 ~2,000) |
| 기존 수량 | hospital_devices 132/67/13,119; project_devices 300/153/23,434; sales_deal_devices 112/57/10,703; intro_beds 227 병원 |
| WMS | units 21,085(A 9,528 / P 9,652 / GW 1,905; OUT 4,491) · tx 684 · tx_units 21,479+ · 최대 품목 8,995개(ITEM-0016) — 동급 규모를 이미 btree 인덱스로 처리 |
| AS | 유지보수 260(월 최대 79, 병원당 최대 19), 기기 관련 ≈ 35%; 교체 이벤트는 그 부분집합 → **이벤트 증가 월 수십~수백 행**; VOC 0 |
| 문자열 | 시리얼 ≤ 14자(합성 GW), ward_code ≤ 128, 병동 텍스트 짧음 |
| 인덱스 권장 | units (hospital_code, status), UNIQUE 활성 배치 partial index (serial_no) 또는 (device_info_id, serial_no), events (unit_id, occurred_on desc), (hospital_code, occurred_on desc), (ref_type, ref_code). 파티셔닝·배치 잡 불필요. 병원별 목록은 전량 로드 가능하나 **전역 /devices는 page/limit 필수**(`/api/inventory/units`의 무제한 findMany 복제 금지) |
| 임포트 단위 | 병원별 20~1,000 시리얼(붙여넣기/Excel), MAX_ROWS 2000이면 최대 병원(GW 포함)도 1~2회 |

---

## 7. 명칭 충돌·주의점

1. **`hospital_devices` / Prisma `HospitalDevice` / `Hospital.hospitalDevices`·`DeviceInfo.hospitalDevices` / `GET·PUT /api/hospitals/[code]/devices`** — 이미 살아 있는 **병원×모델 수량 테이블**(PROD 132행, 8월 센서스, 상세 페이지 '도입 현황', AI 도구, 병원 DELETE 트랜잭션, `intro_beds`와 결합 저장). 사용자 스케치 이름 그대로 사용 불가. 폐기·개명하려면 위 5곳 + README:369 + hospitals_erd.html + PROD 132행 이관 필요.
2. **`device_info`** — 온프렘의 세션 기기 테이블 이름이지만 ops에서는 **모델 마스터 `DeviceInfo`**. 문서·대화에서 혼동 주의.
3. **'기기 관리' 라벨** = `/settings/devices`(DeviceInfo 마스터, nav sort 38). 새 메뉴는 다른 라벨('병원 기기 현황', '웨어러블 관리' 등). `/devices` href·`app/devices` 디렉토리는 비어 있음.
4. 병원 상세 `InventoryUsageCard`가 '설치된 개체 (시리얼)'을 이미 표방(렌더 0회) — 두 "이 병원의 기기" 위젯 병존 금지, 통합/대체 결정 필요.
5. AI `find_serial_unit`("이 시리얼 어느 병원에 있어?")은 inventory_units 기준이라 항상 병원 null — 신규 도구 설명에서 "창고 개체 vs 병원 등록 기기" 구분.
6. **'도입 병상'은 이미 디바이스 수 의미**(2026-08-03 이후, deal.bed_count와 별개). 새 기능에서 딜 수치는 '디바이스 수'로만 표기, 네 번째 축을 만들지 말 것.
7. 게이트웨이 시리얼 이중 표기: WMS `GW6420-B034799` vs 온프렘 규칙·유지보수 `B034799`.
8. `device_type` 도메인은 DDL 주석(1/2/3)보다 넓음(6/8/10/11, 4). 제3자 기기(카트온BP 반지)도 온프렘 등록 대상이라 실무 요청에 등장(MNT-202608-0020/0021).
9. 온프렘 `date_time`은 최종 쓰기 시각, `device_return_status`는 미사용 → 등록일·회수 여부를 온프렘에서 시드 불가.
10. WMS `inventory_units`는 (item_id, serial_no) 유일 — 전역 유일 가정 금지; `hospital_code`는 SET NULL·transferAll 미이동·데이터 0 → 의존 금지.
11. 메모리 규칙: `bed-count-source-of-truth`(sync 스크립트 재실행 금지, intro_beds 자동 재계산 없음이 확정 상태) / `ops-system-1_0-closed`(미착수 고도화 제안 금지 — 단 이 건은 사용자가 직접 제기) / `design-review-gate` / `feature-design-principles`.
12. 기존 devices PUT은 **감사 로그 없음** — 복제 금지. 기존 `hospitals.intro_type` 텍스트 컬럼은 PUT마다 null이 되는 사문(死文).
13. README API 표 `/api/hospitals/[code]/devices` 'POST 병원 장비 추가' 오기(실제 PUT).
14. DEV 스냅샷(08-10)이 낡음 — 수치 인용은 PROD 09-01 기준으로.

---

## 8. 열린 설계 쟁점(설계자가 결정해야 할 것 — 근거 포함)

| # | 쟁점 | 근거 | 선택지 |
|---|---|---|---|
| 1 | **명칭과 기존 `HospitalDevice`와의 관계** | §7-1; 2.0 계획서가 명시한 미결; PROD 132행이 8월에 채워짐(살아 있는 수동 센서스) | (a) 새 테이블(예 `hospital_device_units`+`hospital_device_events`) 병존, 수량표는 '기대 수량'으로 두고 **'등록 n / 수량 m' 대조 표시** (b) 시리얼 완비 병원부터 수량을 레지스트리 집계로 파생(선례 `syncHospitalIntroTypesFromDeals` 복제 + 빈 소스 가드, 파생 병원은 입력 잠금) (c) 수량표 폐기·개명 |
| 2 | **기기 식별 단위** | 온프렘 serial UNIQUE 전역·기관 이관 API 존재; WMS 18개체가 OUT 2회 이상; AS 회수 후 타 병원 재출고 가능성 | 시리얼 = 물리 개체 1행(현재 hospital/ward/status) + 이벤트 이력, **활성 배치 유일(partial unique)** vs 병원별 독립 목록(hospital_code+serial) |
| 3 | **모델 마스터** | `device_info` 2행(GW 없음), GET이 isActive 필터 없이 노출 → 행 추가 시 도입 수량 입력칸에 즉시 나타남; MGW1010 품목 device_info_id NULL; 온프렘 device_type 정수 코드 | device_info에 MGW1010(+필요 시 MT100D/E/링/참) 추가 & 필터 수정 vs `inventory_items` 참조 vs 자유 문자열+`device_type` 코드. 어느 쪽이든 **온프렘 int 코드를 담는 `device_type` 컬럼** 권장 |
| 4 | **WMS 연결 시점** | 훅 지점 명확(§3), 데이터 0%; 판매용재고(link_hospital=false)에서 AS 출고 | 지금: nullable `inventory_unit_id` + 시리얼 자동 매칭 **읽기 표시**만 / 쓰기 훅·link_hospital 확대·bulk 라우트 hospitalCode는 후속 |
| 5 | **이력 모델·이벤트 어휘** | 실무 원시 이벤트: 초기 출고, AS 교체(쌍), 병동 이동, 회수, 폐기/불량, 분실, 데모 반납; WMS RETURN/DISPOSE `value` 선례; audit_logs는 타임라인 아님 | append-only 이벤트 테이블(type, occurred_on Date 소급 허용, actor, from/to ward, hospital_code 비정규화, reason, ref_type/ref_code, replaced_unit_id) + 현재 상태 projection. 타입은 코드 상수, **회수 사유는 StatusCode 카테고리** 여부 |
| 6 | **병동 표현** | 마스터 없음, hospital_servers 0행, 4곳 자유 텍스트 소스, 온프렘 ward_code `<org>_<4>` | 자유 텍스트(+병원 내 distinct 자동완성) + `ext_ward_code` 예약 vs 병원별 병동 마스터 신설(hospital_servers·wardsText와 공유) |
| 7 | **화면 배치** | 상세 페이지 카드 13개·탭 없음, 카드 나열 지양 원칙, InventoryUsageCard 공석, 사용자 스케치 `/devices` | '도입 현황' 섹션에 모델별 등록/활성/회수 요약행 + `/devices?hospital=` 링크, 풀 UI(병원 선택·목록·이력 drawer·임포트)는 `/devices`; InventoryUsageCard 대체 |
| 8 | **권한·가시성** | 병원 하위 리소스 = 비VIEWER 쓰기; WMS = 풀/권한 합성; nav SEERS 게이트; DAEWOONG 조직 사용자 1명 | 읽기 로그인 전체 / 쓰기 `isUserOrAbove`(±`device.manage`) / 삭제·이력 정정 `isAdminOrAbove OR device.admin`; nav `allowed_org_codes {SEERS}` |
| 9 | **초기 적재 소스·범위·등록일** | 온프렘 export는 시리얼·ward_code·type·mac 제공하나 date_time 불신; 관리자 콘솔 xlsx는 A열 시리얼만; WMS 백필은 부분·퍼지; 2.0 계획은 '신규 + 장애 시 백필' | 병원별 Excel/붙여넣기(bulk-serial 패턴, 시리얼 형식은 **경고만**) + 배치별 업무일자 입력; 백필은 점진; WMS 08월 이후 84건은 제안 목록 |
| 10 | **기대 수량 대조 기준** | ECG = Σdeal(112/128), SpO2 공식 없음, sales_deal_devices PROD 112행 증가 중, hospital_devices 8월 센서스 | ECG hard/SpO2 soft 대조 vs hospital_devices 수량을 기대치로 vs sales_deal_devices 채우기 |
| 11 | **`intro_beds`·도입 수량 파생 여부** | 2026-08-03 "1회 종결" 결정, 재계산 코드 없음, 독자 다수(대시보드·영업·AI) | 현행 유지(레지스트리는 대조만) vs 결정 번복(사용자 명시 승인 필요) |
| 12 | **병원 삭제·일괄 이전 정책** | RESTRICT 테이블은 명시 deleteMany, CASCADE는 hospital_servers 선례, transferAll 실사용 0 | RESTRICT+409 & transferAll 편입(이력 보호) vs CASCADE(부속 속성 취급) |
| 13 | **회수 ↔ WMS 반품 입고 정합** | RETURN이 hospitalCode 소거, 회수 기기가 돌아오는 인벤토리(판매용 903호? 대웅 909호? thynC운영팀재고?) 불명 | 독립(지금) vs 회수 이벤트가 반품 입고 초안 생성(후속) |
| 14 | **AS 교체요청 도메인화** | SOP 비용(어댑터+CTI+상태맵+시드+팬아웃), 실무는 유지보수에 기록 | 유지보수 하위 흐름(ref MAINTENANCE)로 시작 vs 별도 티켓 도메인. 어느 쪽이든 이벤트 `ref_type` 예약으로 스키마 변경 없이 수용 |
| 15 | **온프렘 읽기 동기화 준비** | API·DTO 확정, 델타 없음, 병원↔org 1:N, 인증 계정·호스트(`HospitalServer.monitoringUrl`) 없음 | `source`(MANUAL/WMS/ONPREM_SYNC)·`ext_*` 스냅샷 컬럼·병원별 org code 매핑 예약만 vs 범위 밖 명시 |

**권장 뼈대(쟁점 선택의 기본값)**: 시리얼 단위 개체 테이블(`device_info_id`+`device_type`, `serial_no` 정규화 대문자, `hospital_code` NOT NULL RESTRICT, `ward` 텍스트, `status` 코드, nullable `inventory_unit_id`, `replaced_by_id`, `source`, `ext_*`) + append-only 이벤트 테이블(`hospital_code` 비정규화, `occurred_on` Date, `ref_type/ref_code`) + 활성 배치 partial unique + 병원별 Excel 임포트(preview) + `/devices` 목록·이력 + 상세 페이지 요약행 + `lib/deviceRegistry.ts`(상수·검증·`registerFromInventoryOut`/`replace` 서비스 함수 자리) + `checkDeviceRegistryAccess` + audit + nav 시드 + AI read-only 도구는 v2.
