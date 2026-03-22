'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface HospitalPreview {
  hospitalName: string
  introType: string | null
  introBeds: number | null
}

interface PreviewResult {
  hospitals: HospitalPreview[]
  currentCount: number
  defaultStatus: string
}

type Step = 'upload' | 'preview' | 'done'

export default function ImportButton() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [importedCount, setImportedCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open() {
    setIsOpen(true)
    setStep('upload')
    setFile(null)
    setPreview(null)
    setError(null)
  }

  function close() {
    setIsOpen(false)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setError(null)
    await loadPreview(f)
  }

  async function loadPreview(f: File) {
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/api/hospitals/import?preview=true', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? '파일 파싱에 실패했습니다.')
        return
      }
      setPreview(json)
      setStep('preview')
    } catch {
      setError('파일 처리 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/hospitals/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? '가져오기에 실패했습니다.')
        return
      }
      setImportedCount(json.imported)
      setStep('done')
      router.refresh()
    } catch {
      setError('가져오기 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={open}
        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
      >
        Excel 가져오기
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">

        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">병원 데이터 Excel 가져오기</h2>
          {step !== 'done' && (
            <button
              type="button"
              onClick={close}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </button>
          )}
        </div>

        <div className="px-6 py-5">

          {/* Step 1: 파일 선택 */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                <p className="font-medium text-gray-700">Excel 파일 형식 안내</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-gray-500">
                  <li>1행: 헤더 (병원명, 도입형태, 도입병상 수)</li>
                  <li>같은 병원명이 여러 행 있을 경우 자동 병합됩니다</li>
                  <li>도입형태는 중복 제거 후 쉼표(,)로 합쳐집니다</li>
                  <li>도입병상 수는 합산됩니다</li>
                </ul>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div
                className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-10 text-center transition-colors hover:border-blue-400 hover:bg-blue-50"
                onClick={() => fileRef.current?.click()}
              >
                {loading ? (
                  <p className="text-sm text-gray-400">파일 파싱 중...</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-700">클릭하여 파일 선택</p>
                    <p className="mt-1 text-xs text-gray-400">.xlsx, .xls 파일 지원</p>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {/* Step 2: 미리보기 */}
          {step === 'preview' && preview && (
            <div className="space-y-4">
              {/* 경고 */}
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm font-semibold text-red-700">⚠ 주의: 기존 데이터가 모두 삭제됩니다</p>
                <p className="mt-1 text-sm text-red-600">
                  현재 등록된 병원 <span className="font-bold">{preview.currentCount.toLocaleString()}건</span>과
                  대웅 직원 배정 데이터가 모두 삭제되고
                  Excel 데이터 <span className="font-bold">{preview.hospitals.length.toLocaleString()}건</span>이 새로 등록됩니다.
                </p>
                <p className="mt-1 text-xs text-red-500">기본 상태값: <span className="font-medium">{preview.defaultStatus}</span></p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* 미리보기 테이블 */}
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="border-b border-gray-200 px-4 py-2">
                  <span className="text-xs text-gray-500">
                    가져올 병원 <span className="font-medium text-gray-700">{preview.hospitals.length.toLocaleString()}</span>건
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        {['병원명', '도입형태', '도입병상 수'].map((col) => (
                          <th key={col} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {preview.hospitals.map((h, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{h.hospitalName}</td>
                          <td className="px-4 py-2.5 text-sm text-gray-600">
                            {h.introType
                              ? h.introType.split(',').map((t) => (
                                  <span key={t} className="mr-1 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{t}</span>
                                ))
                              : <span className="text-gray-400">-</span>}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-gray-600">
                            {h.introBeds != null ? h.introBeds.toLocaleString() : <span className="text-gray-400">-</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: 완료 */}
          {step === 'done' && (
            <div className="py-4 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <span className="text-3xl">✓</span>
              </div>
              <p className="text-lg font-semibold text-gray-900">가져오기 완료</p>
              <p className="mt-1 text-sm text-gray-500">
                병원 데이터 <span className="font-medium text-gray-700">{importedCount.toLocaleString()}건</span>이 등록되었습니다.
              </p>
            </div>
          )}

        </div>

        {/* 버튼 */}
        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
          {step === 'upload' && (
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              취소
            </button>
          )}
          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => { setStep('upload'); setPreview(null); if (fileRef.current) fileRef.current.value = '' }}
                className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
                disabled={loading}
              >
                다시 선택
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={loading}
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? '처리 중...' : '가져오기 실행'}
              </button>
            </>
          )}
          {step === 'done' && (
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              닫기
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
