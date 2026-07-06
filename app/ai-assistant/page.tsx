'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { X } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface HospitalResult {
  hospitalCode: string
  hospitalName: string
}

interface StatusCodeOption {
  id: number
  name: string
  value: string | null
}

function generateSessionId() {
  return 'sess-' + Math.random().toString(36).substring(2) + Date.now().toString(36)
}

export default function AiAssistantPage() {
  // 채팅 상태
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId] = useState(() => generateSessionId())
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 병원 검색
  const [hospitalSearch, setHospitalSearch] = useState('')
  const [hospitalResults, setHospitalResults] = useState<HospitalResult[]>([])
  const [showHospitalDropdown, setShowHospitalDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const [selectedHospital, setSelectedHospital] = useState<HospitalResult | null>(null)
  const hospitalDropdownRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 우측 패널 상태
  const [panelOpen, setPanelOpen] = useState(false)
  const [consultationTypes, setConsultationTypes] = useState<StatusCodeOption[]>([])
  const [documentTypes, setDocumentTypes] = useState<StatusCodeOption[]>([])
  const [selectedConsultationType, setSelectedConsultationType] = useState('')
  const [selectedDocumentType, setSelectedDocumentType] = useState('')
  const [conclusion, setConclusion] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // 데이터 로드 (상담유형, 문서유형)
  useEffect(() => {
    Promise.all([
      fetch('/api/settings/consultation-type').then((r) => r.json()),
      fetch('/api/settings/document-type').then((r) => r.json()),
    ]).then(([ctData, dtData]) => {
      setConsultationTypes(ctData.statusCodes ?? [])
      setDocumentTypes(dtData.statusCodes ?? [])
    })
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // 병원 검색 (debounce 300ms)
  function handleHospitalSearchChange(value: string) {
    setHospitalSearch(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    if (!value.trim()) {
      setHospitalResults([])
      setShowHospitalDropdown(false)
      return
    }

    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/hospitals?page=1&search=${encodeURIComponent(value.trim())}`)
        const data = await res.json()
        const results: HospitalResult[] = (data.hospitals ?? []).map((h: HospitalResult) => ({
          hospitalCode: h.hospitalCode,
          hospitalName: h.hospitalName,
        }))
        setHospitalResults(results)
        setShowHospitalDropdown(results.length > 0)
      } catch {
        setHospitalResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  function handleSelectHospital(h: HospitalResult) {
    setSelectedHospital(h)
    setHospitalSearch('')
    setHospitalResults([])
    setShowHospitalDropdown(false)
  }

  function handleClearHospital() {
    setSelectedHospital(null)
    setHospitalSearch('')
    setHospitalResults([])
  }

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (hospitalDropdownRef.current && !hospitalDropdownRef.current.contains(e.target as Node)) {
        setShowHospitalDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // 채팅 전송
  async function handleSend() {
    const q = input.trim()
    if (!q || loading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    setLoading(true)

    try {
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, sessionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.error || '오류가 발생했습니다.' }])
        return
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'AI 서버에 연결할 수 없습니다.' }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // AI 정제
  async function handleSummarize() {
    if (messages.length === 0) {
      showToast('대화 내역이 없습니다.')
      return
    }
    setSummarizing(true)
    try {
      const hospitalName = selectedHospital?.hospitalName ?? '공통'
      const consultationTypeName = selectedConsultationType
        ? consultationTypes.find((c) => String(c.id) === selectedConsultationType)?.name ?? ''
        : ''

      const res = await fetch('/api/ai-assistant/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatHistory: messages,
          hospitalName,
          consultationType: consultationTypeName,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'AI 정제에 실패했습니다.')
        return
      }
      setConclusion(data.summary)
    } catch {
      showToast('AI 정제에 실패했습니다.')
    } finally {
      setSummarizing(false)
    }
  }

  // 대기리스트 등록
  async function handleSaveConsultation() {
    setSaving(true)
    try {
      const res = await fetch('/api/ai-assistant/consultation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalCode: selectedHospital?.hospitalCode || null,
          consultationTypeId: selectedConsultationType || null,
          documentTypeId: selectedDocumentType || null,
          conclusion,
          chatHistory: messages.length > 0 ? messages : [],
          aiSummary: conclusion,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || '저장에 실패했습니다.')
        return
      }
      showToast('대기리스트에 등록되었습니다.')
      setConclusion('')
      setSelectedConsultationType('')
      setSelectedDocumentType('')
    } catch {
      showToast('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex gap-6 h-[calc(100dvh-3.5rem)] lg:h-[calc(100vh-2rem)] px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
      {/* 토스트 */}
      {toast && (
        <div className="fixed top-4 right-4 z-[60] rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* ===== 좌측: 채팅 영역 ===== */}
      <div className="flex flex-col flex-1 min-w-0 max-w-4xl">
        {/* 헤더 */}
        <div className="shrink-0 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">AI 어시스턴트</h1>
              <p className="mt-1 text-sm text-gray-500">thynC 시스템에 대해 무엇이든 물어보세요.</p>
            </div>
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                panelOpen
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {panelOpen ? '상담 정리 닫기' : '상담 정리 열기'}
            </button>
          </div>

          {/* 병원 선택 영역 */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
            <span className="text-sm font-medium text-gray-500 shrink-0">병원</span>
            {selectedHospital ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1 text-sm font-medium text-blue-700">
                {selectedHospital.hospitalName}
                <button
                  onClick={handleClearHospital}
                  className="text-blue-400 hover:text-blue-600 transition-colors ml-0.5"
                  title="병원 선택 해제"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            ) : (
              <>
                <span className="inline-flex items-center rounded-md bg-gray-100 px-2.5 py-1 text-sm text-gray-600">공통</span>
                <div ref={hospitalDropdownRef} className="relative flex-1 max-w-xs">
                  <input
                    type="text"
                    value={hospitalSearch}
                    onChange={(e) => handleHospitalSearchChange(e.target.value)}
                    onFocus={() => { if (hospitalResults.length > 0) setShowHospitalDropdown(true) }}
                    placeholder="병원명으로 검색하여 지정..."
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {searching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                    </div>
                  )}
                  {showHospitalDropdown && hospitalResults.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                      {hospitalResults.map((h) => (
                        <button
                          key={h.hospitalCode}
                          onClick={() => handleSelectHospital(h)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700 transition-colors border-b border-gray-50 last:border-b-0"
                        >
                          {h.hospitalName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 대화 영역 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pb-4 rounded-lg border border-gray-200 bg-white p-4">
          {messages.length === 0 && !loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-gray-300">
                  <path d="M12 8V4H8"/>
                  <rect width="16" height="12" x="4" y="8" rx="2"/>
                  <path d="M2 14h2"/>
                  <path d="M20 14h2"/>
                  <path d="M15 13v2"/>
                  <path d="M9 13v2"/>
                </svg>
                <p className="text-sm">질문을 입력하면 AI가 답변합니다.</p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-blue-600 text-white">
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-[75%] rounded-2xl px-4 py-2.5 bg-gray-100 text-gray-900">
                  <div className="prose prose-sm prose-gray max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-2 prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-blue-600 prose-code:before:content-none prose-code:after:content-none prose-a:text-blue-600">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 입력 영역 */}
        <div className="shrink-0 pt-4 pb-[env(safe-area-inset-bottom)]">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="질문을 입력하세요... (Shift+Enter로 줄바꿈)"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              전송
            </button>
          </div>
        </div>
      </div>

      {/* ===== 우측: 상담 정리 패널 (토글) — 모바일에서는 풀스크린 오버레이 ===== */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-border lg:bg-transparent lg:p-0 lg:pl-6">
          <div className="flex items-baseline gap-2 mb-4 pt-1">
            <h2 className="text-base font-semibold text-gray-900">상담 정리</h2>
            <span className="text-xs text-gray-400">(선택사항)</span>
            <button
              onClick={() => setPanelOpen(false)}
              className="ml-auto self-center p-1 rounded-md text-muted-foreground hover:bg-muted transition-colors lg:hidden"
              title="상담 정리 닫기"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto">
            {/* 선택된 병원 표시 */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">병원</label>
              <p className="text-sm text-gray-900 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                {selectedHospital?.hospitalName ?? '공통'}
              </p>
            </div>

            {/* 상담유형 */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">상담유형</label>
              <select
                value={selectedConsultationType}
                onChange={(e) => setSelectedConsultationType(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">선택 안 함</option>
                {consultationTypes.map((ct) => (
                  <option key={ct.id} value={ct.id}>{ct.name}</option>
                ))}
              </select>
            </div>

            {/* 문서유형 */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">문서유형</label>
              <select
                value={selectedDocumentType}
                onChange={(e) => setSelectedDocumentType(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">선택 안 함</option>
                {documentTypes.map((dt) => (
                  <option key={dt.id} value={dt.id}>{dt.name}</option>
                ))}
              </select>
            </div>

            {/* 결론 / AI 정제 결과 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-500">결론</label>
                <button
                  onClick={handleSummarize}
                  disabled={summarizing || messages.length === 0}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {summarizing ? 'AI 정제 중...' : 'AI 정제'}
                </button>
              </div>
              <textarea
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value)}
                placeholder="AI 정제 버튼을 클릭하거나 직접 입력하세요..."
                rows={10}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* 등록 버튼 */}
          <div className="shrink-0 pt-3 border-t border-gray-200 mt-3">
            <button
              onClick={handleSaveConsultation}
              disabled={saving}
              className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? '등록 중...' : '대기리스트 등록'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
