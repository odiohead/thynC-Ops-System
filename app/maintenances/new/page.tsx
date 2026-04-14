import MaintenanceForm from '../MaintenanceForm'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: { hospitalCode?: string }
}

export default function NewMaintenancePage({ searchParams }: Props) {
  const hospitalCode = searchParams.hospitalCode ?? ''

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">유지보수 등록</h1>
        </div>
        <MaintenanceForm
          mode="create"
          initialData={hospitalCode ? { hospitalCode } : undefined}
        />
      </div>
    </div>
  )
}
