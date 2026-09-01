import { Suspense } from 'react'
import DevicesClient from './_components/DevicesClient'
import { parseDevicesParams } from './_components/urlState'

/**
 * /devices — 디바이스 원장 (projects/hospital_device_registry_design.md §6.1)
 * 서버 컴포넌트는 searchParams만 파싱해 넘기고 데이터는 클라이언트가 API로 가져온다(읽기 전원 — 로그인은 middleware가 강제).
 * URL(v1 단순화 2026-09-01): ?view=hospital&hospital=&tab=list|history|wards|import&status=&model=&ward=&q=&page=&device= / ?view=devices&status=&model=&usage=&productType=&q=&page=&device=
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: '디바이스 원장',
}

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined }
}

export default function DevicesPage({ searchParams }: PageProps) {
  const initialParams = parseDevicesParams(searchParams)
  return (
    <Suspense fallback={null}>
      <DevicesClient initialParams={initialParams} />
    </Suspense>
  )
}
