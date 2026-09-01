/**
 * /devices 컴포넌트 배럴 — 소유 그룹(P3):
 *  - 스켈레톤(P3-0, 이후 Verify만 수정): DevicesClient · types · api · useDevicesUrlState · toast · index · ../page.tsx
 *  - GROUP A: HospitalPicker · SerialLookup · GlobalCoverage · ExcelButton (+ app/weekly/_components/SearchSelect onSearch 확장)
 *  - GROUP B: SummaryStrip · DeviceTable · BulkActionBar · DeviceHistoryDrawer · CorrectionModal
 *  - GROUP C: RegisterModal · MoveWardModal · RecoverModal · ReplaceModal · WardCombo · MaintenanceCodeCombo · MobileActionBar
 *  - GROUP D: ImportPanel · WardPanel · EventsTab
 */
export { default as DevicesClient } from './DevicesClient'
export type { DevicesClientProps } from './DevicesClient'

export * from './types'
export * from './api'
export { useDevicesUrlState, parseDevicesParams, serializeDevicesParams, resolveTab, resolveView, DEFAULT_URL_STATE } from './useDevicesUrlState'
export type { DevicesUrlState, DevicesUrlApi, SetHospitalOptions } from './useDevicesUrlState'
export { DevicesToastProvider, useDevicesToast } from './toast'
export type { NotifyFn, ToastKind, ToastOptions } from './toast'

// GROUP A
export { HospitalPicker } from './HospitalPicker'
export type { HospitalPickerProps } from './HospitalPicker'
export { SerialLookup } from './SerialLookup'
export type { SerialLookupProps } from './SerialLookup'
export { GlobalCoverage } from './GlobalCoverage'
export type { GlobalCoverageProps } from './GlobalCoverage'
export { ExcelButton } from './ExcelButton'
export type { ExcelButtonProps } from './ExcelButton'

// GROUP B
export { SummaryStrip } from './SummaryStrip'
export type { SummaryStripProps } from './SummaryStrip'
export { DeviceTable } from './DeviceTable'
export type { DeviceTableProps } from './DeviceTable'
export { BulkActionBar } from './BulkActionBar'
export type { BulkActionBarProps } from './BulkActionBar'
export { DeviceHistoryDrawer } from './DeviceHistoryDrawer'
export type { DeviceHistoryDrawerProps } from './DeviceHistoryDrawer'
export { CorrectionModal } from './CorrectionModal'
export type { CorrectionModalProps } from './CorrectionModal'
export { ProductTypeModal } from './ProductTypeModal'
export type { ProductTypeModalProps } from './ProductTypeModal'

// GROUP C
export { RegisterModal } from './RegisterModal'
export type { RegisterModalProps } from './RegisterModal'
export { MoveWardModal } from './MoveWardModal'
export type { MoveWardModalProps } from './MoveWardModal'
export { RecoverModal } from './RecoverModal'
export type { RecoverModalProps } from './RecoverModal'
export { ReplaceModal } from './ReplaceModal'
export type { ReplaceModalProps } from './ReplaceModal'
export { WardCombo } from './WardCombo'
export type { WardComboProps } from './WardCombo'
export { MaintenanceCodeCombo } from './MaintenanceCodeCombo'
export type { MaintenanceCodeComboProps } from './MaintenanceCodeCombo'
export { MobileActionBar } from './MobileActionBar'
export type { MobileActionBarProps } from './MobileActionBar'

// v1 단순화(2026-09-01) — 전역 [디바이스] 뷰
export { DeviceListTab } from './DeviceListTab'
export type { DeviceListTabProps } from './DeviceListTab'

// GROUP D
export { ImportPanel } from './ImportPanel'
export type { ImportPanelProps } from './ImportPanel'
export { WardPanel } from './WardPanel'
export type { WardPanelProps } from './WardPanel'
export { EventsTab } from './EventsTab'
export type { EventsTabProps } from './EventsTab'
