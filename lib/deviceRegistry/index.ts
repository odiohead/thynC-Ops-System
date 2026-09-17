/**
 * 디바이스 원장 서비스 계층 — 단일 import 경로 `@/lib/deviceRegistry` (§7.0 유일한 쓰기자)
 *
 * core   : 타입·RegistryError·withRegistryTx·fold/rebuild·assertTransition·병동/모델/사유 해석
 * write  : registerDevices·moveDeviceWard·recoverDevice·replaceDevice·bulkDeviceAction·correctDevice·updateDeviceMemo
 * condition: 유닛 상태·위치 축(2026-09-17) — intakeDevice·markDeviceRepaired·undoDeviceRepaired·scrapDevice·moveDeviceLocation·applyImplicitTransition·취소 규약 헬퍼
 * import : previewRows·importBatch
 * admin  : editEvent·cancelLastEvent·cancelImportBatch·editImportBatchDate
 * read   : getHospitalDeviceSummary·getGlobalCoverage·lookupDevice·listUnits/listEvents(+where 빌더)·getUnitDetail·listImportBatches
 * wms    : matchInventoryUnits·queryWmsUnits
 * hooks  : 후속 훅 스텁 4종
 */
export * from './core'
export * from './wms'
export * from './condition'
export * from './write'
export * from './import'
export * from './admin'
export * from './read'
export * from './hooks'
