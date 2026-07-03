import EtcTaskForm from '../EtcTaskForm'

export const dynamic = 'force-dynamic'

export default function NewEtcTaskPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">기타업무 등록</h1>
        </div>
        <EtcTaskForm mode="create" />
      </div>
    </div>
  )
}
