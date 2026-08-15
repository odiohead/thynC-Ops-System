# 영업현황 대시보드(지도) — 지역별 도입현황

> **상태: 완료 (dev2 구현 2026-08-14, v2 동일자, v3 2026-08-15) — PROD 배포 2026-08-15**

## v3 (2026-08-15 사용자 수정요청 2건)

1. **병상 전체 대비 실데이터** — 코드가 아니라 dev2 데이터 문제(perm_sbd_cnt 전량 NULL). PROD에서 3,089건을 SELECT해 dev2 `hira_hospitals`에 백필(총 546,223병상). PROD 반영 시에는 이 단계 불필요(PROD에 원본 존재)
2. **muted-earth 베이스맵** — 시각 렌더를 `public/geo/korea-map-E1-muted-earth.png`(흰 배경 투명 처리본)로 교체, 상호작용(권역 히트/틴트·앵커)은 기존 폴리곤 유지
   - 정렬 변환: 극점 대응(호미곶·고성 x쌍 + 북/동/남 y 3점 회귀) → `<image x=358.43 y=101.67 w=211.47 h=411.66>` (sx 0.18599·sy 0.21609 — 이미지는 mercator 대비 세로 ~16% 연장이라 preserveAspectRatio="none" 필수)
   - 제주: 이미지가 디자인상 남쪽으로 띄워 배치 → 생성 스크립트에 `shift: [0.7, 14.5]` (폴리곤·앵커 동반 이동), viewBox 508→516
   - 이미지에 없는 도서는 히트 폴리곤에서 제거(centroid x>615 동해, x<310 백령·대청), SK_OUTLINE·NK_PATH 생성 중단
   - 다크모드: PNG는 라이트 톤 고정 — brightness(0.85)·saturate(0.9)·opacity 0.95 감광 처리. 라이트 모드 주변 요소(리더선·기준선·잉크·바다)는 warm gray(stone)로 조정
   - 베이스맵 파일 원본: `C:\Users\USER\Downloads\korea-map-E1-muted-earth.png` (교체 시 정렬 변환 재유도 필요 — 오버레이 렌더로 검증)

### v3 후속 — 막대 모드 '도입현황 대비' 추가 (2026-08-15)

- BarMode 3종: `plain`(도입 수치 — **진입 기본값**, 2026-08-15 재확정) / `adoption`(도입현황 대비) / `overlay`(전체 대비)
- adoption 배경 = 전국 도입 합계(종별 필터 반영, kpi.hospitals/devices) — 전 권역 배경이 동일 최대 높이, 채움 비율 = 지역 구성비. 라벨 `도입/전국합계`, 표에 구성비 % 병기, 툴팁에 %
- 전 권역 배경 최대 높이 특성상 히트영역이 항상 138px → 강원 offset dy -18→0(뷰박스 상단 클리핑), 부산 dy 144→156(대구 라벨 간섭) 조정. 3모드 279케이스 전수 검증 통과

### v3 멀티에이전트 리뷰 반영

- **[medium] 유령 섬** — PNG에 그려지지 않은 도서 서브패스 27개(신안·진도 군도, 흑산도, 덕적도 등)가 히트·틴트 폴리곤에 잔존해 hover 시 빈 바다에 파란 틴트가 뜨는 결함 → 생성 스크립트의 도서 판정을 좌표 임계값에서 **PNG 알파 커버리지 판정**(링 꼭짓점+무게중심 샘플의 알파 보유율 <20% 드롭, 면적 200px² 이상 본토 링은 무조건 유지)으로 교체. 재생성 후 전 서브패스(37개) 알파 대조 감사로 유령 0개 확인
- **[low] 데드 export** — 미사용 MAP_W/MAP_H 제거
- 참고: `/geo/*.png`는 인증 미들웨어를 타므로 비로그인 curl은 307 — 지도 페이지 자체가 로그인 필수라 실사용 문제 없음

## v2 (2026-08-14 사용자 수정요청 3건)

1. **종별 복수선택 필터** — 칩 UI(딜 보유 종별만: 상급종합·종합병원·병원·요양병원·의원 + '전체'). 선택 즉시 지도·KPI·표·드릴다운 전부 재계산. 이를 위해 서버 payload를 권역 완성 집계에서 **병원 단위 flat 데이터(hospitals) + 권역×종별 전체 집계(totals: 전체 병원수 COUNT·허가병상 SUM)**로 개편, 집계는 전부 클라이언트 useMemo (서버 왕복 없음)
2. **막대 모드 2종** — '도입 수치'(도입 수량만) / '전체 대비'(선택 종별의 전체 병원수·허가병상을 fillOpacity 0.18 배경 막대로, 도입 수량을 진한 전경 막대로 **같은 스케일**에 겹침 — 배경 대비 채워진 비율 = 침투율). 전체 대비 모드 스케일은 권역 최대 '전체'값 기준, 도입 막대는 값>0이면 최소 1.5px 보장
3. **지도 세련화** — 바다 배경(rounded rect)·육지 세로 그라데이션·흰 내부 경계(1.1px)·드롭섀도(feDropShadow)·얇은 외곽 정의선(0.6px)·곡선 리더선·활성 권역 틴트 오버레이. 해안 도서 잡티는 생성 스크립트에서 투영면적 2.5px² 미만 링 제거(동해 도서는 centroid x>615 무조건 보존). 라벨 헤일로는 바다색 기준

### v2 멀티에이전트 리뷰 반영 (확정 8건 전수)

- **[high] overlay 라벨 오독** — 값 라벨이 배경(전체) 막대 꼭대기에 앉아 전체 막대의 값처럼 읽힘 → overlay에선 라벨을 `도입/전체` 병기(tspan — 도입 시리즈색 굵게 + 전체 회색, 1만 이상 '4.2만' 압축)로 변경
- **[medium] '전체' 분모가 전 기관 7.9만곳** (치과의원·보건소 포함, '모든 칩 선택'과 분모 2배 차이) → **totals 세계를 딜 보유 종별로 제한** (page.tsx에서 dealTypes 필터). '전체' ≡ 모든 칩 선택이 되고, 모든 칩을 켜면 '전체'로 자동 승격
- **[medium] 리더선 수직 진입** — 막대 사이 틈 세로줄 노출·호남 선이 '충청' 라벨 관통 → 경로를 `M ax ay Q ax gy leadX gy`(앵커에서 하강 후 그룹 측면으로 **수평 진입**, leadX = 그룹 앵커쪽 가장자리 +4px)로 변경
- **[low] etc(시도 미상) 분자/분모 불일치** → 침투율 분자를 권역 매핑분(mappedDevices)으로 통일 (KPI headline 수치는 전체 유지)
- **[low] 극단 필터 히트영역 슬리버** (의원 단독 선택 시 호남 최대 등) → 부산 dy 130→144, 호남 dx -140→-147. **선택 가능한 31개 종별 조합 × 2모드 × 3지표 = 186케이스 전수 스크립트 검증**으로 타 그룹 막대·기준선 침범 0건 확인 (잠재 케이스였던 대구↔부산·충청↔제주는 해당 권역이 전국 최대가 될 수 없어 구조적으로 미발현)

## 1. 목적·범위

대한민국 지도 위에 지역별 도입현황(병원수·병상수)을 수치로 보여주는 영업현황 세 번째 탭.
클로드디자인 와이어프레임(`dashboardmap_wireframe.zip` — 지도+표 2열, 권역 막대, 드릴다운)을 기반으로 구현.

- 라우트: `/sales/dashboard_map` · 탭: `대시보드 | 도입현황 | 대시보드(지도)` (SalesConceptTabs)
- 권한: 기존 영업 섹션 공통 게이트 (`canAccessSales` — ADMIN 이상 또는 `sales.access` + SEERS)
- **기존 테이블·로직 변경 없음** — 신규 페이지 + 탭 1개 추가만

## 2. 확정 결정사항 (2026-08-14 사용자)

| 항목 | 결정 |
|---|---|
| 지역 단위 | **7개 권역**: 수도권(서울·경기·인천) / 강원 / 충청(대전·세종시·충남·충북) / 대구·경북 / 부산·울산·경남 / 광주·전라(광주·전남·전북) / 제주 |
| 병상수 지표 | **계약완료 딜의 `daewoong_device_count` 합** (`bed_count` 아님 — KPI '도입 병상'·intro_beds 동기화와 동일 기준, 2026-07-31 결정 계승) |
| 도입률 | **병상 침투율** — 지역 허가병상수(`hira_hospitals.perm_sbd_cnt`, `hospitals` 조인 합) 대비 도입 병상. 미연동(분모 0) 지역은 '-' |
| 필터 | **지표 토글만** (병원수/병상수/둘 다) — 기간·담당자 필터 없음, 전체 누적 고정 |
| 커버지역 KPI | 제외 (와이어프레임의 3번째 KPI 자리는 '병상 침투율'로 대체) |

## 3. 구현 형상

- `app/sales/dashboard_map/page.tsx` — 서버 컴포넌트. 계약완료 딜 조회 → 시도명→권역 매핑(`SIDO_TO_REGION`) 집계, 병원 단위 드릴다운 리스트(`hospitalsByRegion`), 허가병상 분모 $queryRaw(시도별 → 권역 합산). 시도 미상 딜은 '기타' 행(지도 제외, 표에만)
- `app/sales/dashboard_map/_components/SalesDashboardMap.tsx` — 클라이언트. SVG 지도(권역 폴리곤 + 앵커·리더선·막대 그룹) + KPI 3종(도입 병원수·병상수·병상 침투율) + 지역별 수치 표(열 정렬·CSV 내보내기·합계) + 권역 클릭 드릴다운(병원 리스트 → `/hospitals/[code]` 링크) + 지도↔표 상호 하이라이트. 막대 높이는 지표별 독립 정규화(값/권역 최대값). 다크모드는 `useChartTheme` 분기, xl 미만 1열 스택
- `app/sales/dashboard_map/_components/koreaGeo.ts` — **자동 생성 파일** (아래 §4 절차로 재생성). 권역 병합 폴리곤·남한 외곽선·북한 윤곽의 투영된 SVG path + 앵커/오프셋

## 4. 지도 데이터 재생성 절차

koreaGeo.ts는 아래 1회성 스크립트로 생성한다 (리포 밖에서 실행, node + `topojson-client` + 프로젝트 `sharp`(베이스맵 알파 판정용) 필요. v3부터 `public/geo/korea-map-E1-muted-earth.png`가 입력에 포함 — 유령 섬 제거의 알파 커버리지 판정).

- 입력 1: 시도 폴리곤 — southkorea-maps kostat 2013 simplified topojson
  `https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2013/json/skorea_provinces_topo_simple.json`
- 입력 2: 북한 윤곽 — `https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json` (Natural Earth 110m, public domain)
- 투영: 수동 mercator, 남한 bounds를 와이어프레임 fitExtent `[[290,110],[630,485]]`(830×700 뷰박스)에 맞춤. 좌표 소수 1자리 반올림
- 권역 병합: `topojson.merge`로 시도 arcs 병합(내부 경계 제거). 시도 코드: 수도권 11·23·31 / 강원 32 / 충청 25·29·33·34 / 대구·경북 22·37 / 부산·울산·경남 21·26·38 / 광주·전라 24·35·36 / 제주 39
- 런타임 외부 CDN 의존 없음 — 생성 결과만 리포에 포함

```js
// 지도 경로 데이터 생성 스크립트 (1회성, 리포에 포함하지 않음)
// 입력: kostat 2013 시도 topojson(simplified) + world-atlas 110m(북한 윤곽)
// 출력: koreaGeo.ts — 7개 권역 병합 폴리곤·남한 외곽선·북한 윤곽을 830×700 뷰박스 좌표로 투영한 SVG path
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as topojson from 'topojson-client'

// 베이스맵 PNG 알파 — '이미지에 실제로 그려진 육지'만 히트 폴리곤에 남기는 판정에 사용
const sharp = createRequire('/home/ubuntu/workspace/thynC-Ops-System/package.json')('sharp')
const IMG = { x: 358.43, y: 101.67, sx: 0.18599, sy: 0.21609, w: 1137, h: 1905 }
const imgRaw = await sharp('/home/ubuntu/workspace/thynC-Ops-System/public/geo/korea-map-E1-muted-earth.png')
  .raw().toBuffer({ resolveWithObject: true })
const imgAlphaAt = (x, y) => {
  const ix = Math.round((x - IMG.x) / IMG.sx)
  const iy = Math.round((y - IMG.y) / IMG.sy)
  if (ix < 0 || iy < 0 || ix >= imgRaw.info.width || iy >= imgRaw.info.height) return 0
  return imgRaw.data[(iy * imgRaw.info.width + ix) * imgRaw.info.channels + 3]
}
// 링 꼭짓점+무게중심 샘플의 알파 보유 비율 — 이미지에 없는 유령 섬 판정 (2026-08-15 리뷰 반영)
const imageCoverage = (pts) => {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
  const samples = [[cx, cy], ...pts]
  const hit = samples.filter(([x, y]) => imgAlphaAt(x, y) > 0).length
  return hit / samples.length
}

const provincesTopo = JSON.parse(readFileSync('./provinces-topo.json', 'utf8'))
const worldTopo = JSON.parse(readFileSync('./world-110m.json', 'utf8'))

const W = 830, H = 700
// 와이어프레임: d3.geoMercator().fitExtent([[290,110],[W-200,H-215]], southKorea)
const EXTENT = [[290, 110], [W - 200, H - 215]]

// ── 권역 정의 (사용자 확정 2026-08-14) ──
const REGIONS = [
  { key: 'capital',  name: '수도권',         codes: ['11', '23', '31'], anchor: [126.98, 37.57], offset: [-118, -4] },
  // 강원 dy 0·부산 dy 156: '도입현황 대비' 모드(전 권역 배경 막대 최대 높이)에서의 상단 클리핑·대구 간섭 해소 (2026-08-15)
  { key: 'gangwon',  name: '강원',           codes: ['32'],             anchor: [128.30, 37.80], offset: [96, 0] },
  // 충청 dy는 광주·전라 히트영역과의 겹침 제거를 위해 96→86 (2026-08-14 리뷰 반영)
  { key: 'chungcheong', name: '충청',        codes: ['25', '29', '33', '34'], anchor: [127.30, 36.55], offset: [-124, 86] },
  { key: 'daegu',    name: '대구·경북',      codes: ['22', '37'],       anchor: [128.75, 36.20], offset: [104, 68] },
  { key: 'busan',    name: '부산·울산·경남', codes: ['21', '26', '38'], anchor: [128.90, 35.25], offset: [96, 156] },
  { key: 'honam',    name: '광주·전라',      codes: ['24', '35', '36'], anchor: [126.90, 35.35], offset: [-147, 120] },
  // 제주 오프셋은 광주·전라 도서(신안·진도권) 히트영역 겹침을 피해 남서쪽 바다로 (2026-08-14 리뷰 반영)
  // 제주는 베이스맵 PNG(디자인상 남쪽으로 띄움)에 맞춰 +14.5px 하향 (2026-08-15)
  { key: 'jeju',     name: '제주',           codes: ['39'],             anchor: [126.53, 33.42], offset: [-70, 14], shift: [0.7, 14.5] },
]

// ── 수동 mercator 투영 (d3 없이) ──
const rad = (d) => (d * Math.PI) / 180
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))

// 남한 전체 bounds로 fitExtent 스케일 계산
const skGeo = topojson.merge(provincesTopo, provincesTopo.objects.skorea_provinces_geo.geometries)
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
const eachCoord = (geom, fn) => {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  polys.forEach((rings) => rings.forEach((ring) => ring.forEach(fn)))
}
eachCoord(skGeo, ([lon, lat]) => {
  const x = rad(lon), y = -mercY(lat)
  if (x < minX) minX = x; if (x > maxX) maxX = x
  if (y < minY) minY = y; if (y > maxY) maxY = y
})
const [[ex0, ey0], [ex1, ey1]] = EXTENT
const scale = Math.min((ex1 - ex0) / (maxX - minX), (ey1 - ey0) / (maxY - minY))
const tx = ex0 + ((ex1 - ex0) - (maxX - minX) * scale) / 2 - minX * scale
const ty = ey0 + ((ey1 - ey0) - (maxY - minY) * scale) / 2 - minY * scale

const project = ([lon, lat]) => [
  Math.round((rad(lon) * scale + tx) * 10) / 10,
  Math.round((-mercY(lat) * scale + ty) * 10) / 10,
]

// 투영 좌표 기준 링 면적 (px²) — 잔잔한 해안 도서 잡티 제거용
const ringArea = (pts) => {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a / 2)
}

const toPath = (geom, minArea = 0, shift = [0, 0]) => {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  return polys
    .map((rings) =>
      rings
        .map((ring) => {
          const pts = ring.map((p) => {
            const q = project(p)
            return [Math.round((q[0] + shift[0]) * 10) / 10, Math.round((q[1] + shift[1]) * 10) / 10]
          })
          // 중복점 제거 (반올림으로 인접점이 겹치는 경우)
          const dedup = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1])
          if (dedup.length >= 3 && ringArea(dedup) < 200) {
            // 잡티 제거 + 베이스맵 PNG에 실제로 그려진 섬만 유지 (알파 커버리지 판정)
            if (minArea > 0 && ringArea(dedup) < minArea) return ''
            if (imageCoverage(dedup) < 0.2) return ''
          }
          return 'M' + dedup.map((p) => `${p[0]},${p[1]}`).join('L') + 'Z'
        })
        .join('')
    )
    .join('')
}

// ── 권역별 병합 폴리곤 ──
const allGeoms = provincesTopo.objects.skorea_provinces_geo.geometries
const regionOut = REGIONS.map((r) => {
  const geoms = allGeoms.filter((g) => r.codes.includes(g.properties.code))
  if (geoms.length !== r.codes.length) throw new Error(`권역 ${r.name}: 시도 코드 누락`)
  const merged = topojson.merge(provincesTopo, geoms)
  const shift = r.shift ?? [0, 0]
  const a = project(r.anchor)
  return {
    key: r.key,
    name: r.name,
    d: toPath(merged, 2.5, shift),
    anchor: [Math.round((a[0] + shift[0]) * 10) / 10, Math.round((a[1] + shift[1]) * 10) / 10],
    offset: r.offset,
  }
})

// v3: 렌더 베이스는 PNG(korea-map-E1-muted-earth) — 외곽선·북한 윤곽 미사용, 폴리곤은 히트/틴트 전용

const ts = `// 자동 생성 파일 — 수정하지 말 것.
// 원본: kostat 2013 시도 topojson(simplified, southkorea-maps).
// 830×700 뷰박스 기준 mercator 투영(남한 fit)이 적용된 SVG path 문자열 — 베이스맵 PNG와 정렬됨.
// 권역 병합·투영 로직은 빌드 밖 1회성 스크립트로 수행 (projects/sales_dashboard_map_design.md 참고).

export interface RegionGeo {
  key: string
  name: string
  /** 병합 폴리곤 SVG path (뷰박스 좌표) */
  d: string
  /** 리더선 앵커 (지역 중심 부근, 뷰박스 좌표) */
  anchor: [number, number]
  /** 앵커 → 막대 그룹 오프셋 (지도 밖 바다 방향) */
  offset: [number, number]
}

export const REGION_GEO: RegionGeo[] = ${JSON.stringify(regionOut, null, 2).replace(/"([a-zA-Z]+)":/g, '$1:')}
`
writeFileSync('./koreaGeo.ts', ts)
console.log('regions:', regionOut.map((r) => `${r.name}(${r.d.length}b anchor ${r.anchor})`).join('\n'))
```

### 오프셋 조정 시 주의

막대 그룹 히트영역은 실제 막대 높이 기반 동적 크기(x ±25, y `topY-30`~`+20`)다. 오프셋을 바꾸면
인접 그룹 히트영역·타 권역 폴리곤과의 겹침을 다시 확인할 것 (2026-08-14 리뷰에서 고정 크기 히트영역이
대구↔부산 라벨·제주↔광주·전라 도서를 가로채는 결함이 발견되어 동적 크기 + 오프셋 조정으로 수정한 이력).

## 5. 리뷰 반영 내역 (2026-08-14 멀티에이전트 리뷰 — 확정 7건 전수 반영)

1. **[high] 히트영역 고정 크기로 인접 권역 가로챔** → 실제 막대 높이 기반 동적 크기로 변경 + 제주 오프셋 [-46,12]→[-70,26](광주·전라 도서 회피), 충청 dy 96→86, 대구 dy 74→68, 부산 dy 120→130. 검증 스크립트로 rect 쌍 겹침·타 권역 폴리곤 침범 0건 확인
2. **[medium] 키보드 접근성** → 정렬 헤더 `<th>` 내부 `<button>`화, 표 행 `tabIndex=0` + Enter/Space로 드릴다운 (드릴다운 리스트는 기존 Link로 접근 가능)
3. **[medium] koreaGeo.ts 재생성 절차 미문서화** → 본 문서 §4
4. **[low] CSV 파일명 UTC** → KST +9h 보정 (lib/sales `nextDealCode` 관례)
5. **[low] 터치 hover 고착** → `selectRegion` 시 `hoverKey` 해제
6. 기각 2건: 도입률 분모 dev2 전량 NULL(환경 문제 — dev2는 8/10 백업 복원본이라 심평원 상세연동 데이터 없음, PROD는 정상. 분모 0 가드로 '-' 표시), status name-only 필터(기존 대시보드와 동일 패턴·앱 경로상 도달 불가)

## 6. 알려진 한계

- 도입률 분모는 심평원 병원상세정보연동이 수집한 병원급 7종 허가병상만 포함 (의원급 미수집 — 종별 카드와 동일 한계)
- 권역 막대 오프셋은 수동 조정값 — 특정 권역 수치가 인접 권역 대비 극단적으로 커지면(현재 대비 ~1.5배 이상 점유율 변화) 시각적 겹침 여지, §4 검증 절차로 재확인
- dev2 로컬 DB에는 `perm_sbd_cnt`가 없어 도입률이 전부 '-'로 보임 (PROD 정상)
