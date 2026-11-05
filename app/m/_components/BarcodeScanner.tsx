'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Flashlight, FlashlightOff, Keyboard } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 카메라 바코드 연속 스캐너 (mobile_pwa_design.md §3.5·§6.1)
 *
 * 엔진: barcode-detector 의 ponyfill(zxing-cpp WASM) — iOS Safari에 BarcodeDetector가 없어 전 기기 동일 엔진으로 통일
 *       (GS1 원소열의 GS 구분자 처리도 기기마다 달라지지 않게). WASM은 외부 CDN이 아니라 /vendor 에서 로드.
 * 동작: 시트를 닫지 않고 계속 읽는다. 조준 영역만 잘라 디코드(속도), 같은 값 1.5초 쿨다운, 판정 중엔 다음 프레임 보류.
 * 판정은 부모의 onDetect 가 하고, 결과(tone·message)를 화면 플래시·비프·진동으로 돌려준다.
 */

export interface ScanFeedback {
  tone: 'ok' | 'warn' | 'error'
  message: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** 디코드 1건 처리 — 반환한 피드백을 표시. 판정이 끝날 때까지 다음 스캔은 대기 */
  onDetect: (raw: string, format: string) => Promise<ScanFeedback> | ScanFeedback
  title?: string
  /** 상단 우측 카운터 (예: 담긴 개수) */
  counter?: React.ReactNode
  /** 하단 보조 영역 (최근 담긴 항목 등) */
  footer?: React.ReactNode
}

const WASM_URL = '/vendor/zxing_reader-3.1.6.wasm' // node_modules/zxing-wasm/dist/reader/zxing_reader.wasm 사본 — 패키지 갱신 시 동반 교체
const FORMATS = ['data_matrix', 'qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'upc_a'] as const
const COOLDOWN_MS = 1500
const SCAN_INTERVAL_MS = 110

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string; format: string }[]> }
let detectorPromise: Promise<Detector> | null = null

function getDetector(): Promise<Detector> {
  if (!detectorPromise) {
    detectorPromise = import('barcode-detector/ponyfill').then(({ BarcodeDetector, prepareZXingModule }) => {
      prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? WASM_URL : prefix + path),
        },
      })
      return new BarcodeDetector({ formats: [...FORMATS] }) as unknown as Detector
    })
    detectorPromise.catch(() => { detectorPromise = null })
  }
  return detectorPromise
}

let audioCtx: AudioContext | null = null
function beep(tone: ScanFeedback['tone']) {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    audioCtx ??= new AC()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.frequency.value = tone === 'ok' ? 1320 : tone === 'warn' ? 880 : 300
    g.gain.value = 0.08
    o.connect(g).connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + (tone === 'error' ? 0.25 : 0.09))
  } catch { /* 소리는 부가 기능 */ }
}

function vibrate(tone: ScanFeedback['tone']) {
  try { navigator.vibrate?.(tone === 'ok' ? 40 : [60, 60, 60]) } catch { /* iOS 미지원 */ }
}

export default function BarcodeScanner({ open, onClose, onDetect, title = '바코드 스캔', counter, footer }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const busyRef = useRef(false)
  const lastRef = useRef<{ value: string; at: number }>({ value: '', at: 0 })
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  const [status, setStatus] = useState<'starting' | 'running' | 'error'>('starting')
  const [errorText, setErrorText] = useState('')
  const [feedback, setFeedback] = useState<(ScanFeedback & { key: number }) | null>(null)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manual, setManual] = useState('')

  const handle = useCallback(async (raw: string, format: string) => {
    busyRef.current = true
    try {
      const fb = await onDetectRef.current(raw, format)
      setFeedback({ ...fb, key: Date.now() })
      beep(fb.tone)
      vibrate(fb.tone)
    } catch (e) {
      const fb: ScanFeedback = { tone: 'error', message: e instanceof Error ? e.message : '처리 실패' }
      setFeedback({ ...fb, key: Date.now() })
      beep('error')
    } finally {
      busyRef.current = false
    }
  }, [])

  // 카메라 시작·정지
  useEffect(() => {
    if (!open) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    setStatus('starting')
    setErrorText('')
    setFeedback(null)
    setTorchOn(false)

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('error')
        setErrorText('이 화면은 HTTPS에서만 카메라를 쓸 수 있습니다. 아래 수동 입력을 이용하세요.')
        setManualOpen(true)
        return
      }
      try {
        const [stream, detector] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          }),
          getDetector(),
        ])
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }
        setTorchSupported(!!caps.torch)
        if (caps.focusMode?.includes('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
        }
        const video = videoRef.current!
        video.srcObject = stream
        await video.play().catch(() => {})
        setStatus('running')

        const canvas = (canvasRef.current ??= document.createElement('canvas'))
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        const tick = async () => {
          if (stopped) return
          if (!busyRef.current && video.readyState >= 2 && video.videoWidth > 0) {
            // 조준 영역(가로 80% × 세로 50%, 화면 중앙)만 디코드
            const vw = video.videoWidth, vh = video.videoHeight
            const cw = Math.round(vw * 0.8), ch = Math.round(vh * 0.5)
            const scale = Math.min(1, 1280 / cw)
            canvas.width = Math.round(cw * scale)
            canvas.height = Math.round(ch * scale)
            ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height)
            try {
              const found = await detector.detect(canvas)
              const hit = found.find((f) => f.rawValue)
              if (hit) {
                const now = Date.now()
                const last = lastRef.current
                if (hit.rawValue !== last.value || now - last.at > COOLDOWN_MS) {
                  lastRef.current = { value: hit.rawValue, at: now }
                  await handle(hit.rawValue, hit.format)
                } else {
                  lastRef.current.at = now // 같은 라벨을 계속 비추는 동안은 쿨다운 연장
                }
              }
            } catch { /* 프레임 단위 실패는 무시 */ }
          }
          timer = setTimeout(tick, SCAN_INTERVAL_MS)
        }
        void tick()
      } catch (e) {
        const name = (e as { name?: string })?.name
        setStatus('error')
        setManualOpen(true)
        setErrorText(
          name === 'NotAllowedError'
            ? '카메라 권한이 거부되었습니다. 브라우저(또는 휴대폰 설정)에서 카메라를 허용하세요.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? '사용할 수 있는 카메라가 없습니다.'
              : `카메라를 시작하지 못했습니다. ${e instanceof Error ? e.message : ''}`
        )
      }
    }
    void start()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      lastRef.current = { value: '', at: 0 }
    }
  }, [open, handle])

  // 피드백 1.6초 후 사라짐
  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback((f) => (f?.key === feedback.key ? null : f)), 1600)
    return () => clearTimeout(t)
  }, [feedback])

  // 열림 동안 배경 스크롤 잠금
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
      setTorchOn(!torchOn)
    } catch { setTorchSupported(false) }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault()
    const v = manual.trim()
    if (!v || busyRef.current) return
    setManual('')
    await handle(v, 'manual')
  }

  if (!open) return null

  const frame = feedback?.tone === 'ok' ? 'border-success' : feedback?.tone === 'warn' ? 'border-warning' : feedback?.tone === 'error' ? 'border-destructive' : 'border-white/80'

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      {/* 상단 */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full bg-white/15 p-2.5">
          <X size={22} />
        </button>
        <p className="min-w-0 flex-1 truncate text-base font-semibold">{title}</p>
        {counter && <div className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold">{counter}</div>}
      </div>

      {/* 카메라 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {/* 조준 영역 — 디코드 영역(가로 80%·세로 50%)과 대략 일치 */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cn('h-[38%] w-[80%] rounded-2xl border-4 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-colors', frame)} />
        </div>
        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">카메라 준비 중…</div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm leading-relaxed text-white/90">{errorText}</div>
        )}
        {feedback && (
          <div key={feedback.key} className="absolute inset-x-4 top-4 flex justify-center">
            <div className={cn(
              'max-w-full rounded-xl px-4 py-2.5 text-center text-sm font-semibold shadow-lg',
              feedback.tone === 'ok' ? 'bg-success text-success-foreground' : feedback.tone === 'warn' ? 'bg-warning text-warning-foreground' : 'bg-destructive text-destructive-foreground'
            )}>
              {feedback.message}
            </div>
          </div>
        )}
        {status === 'running' && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
            {torchSupported && (
              <button type="button" onClick={() => void toggleTorch()} aria-label="손전등" className={cn('rounded-full p-3', torchOn ? 'bg-white text-black' : 'bg-white/20')}>
                {torchOn ? <FlashlightOff size={22} /> : <Flashlight size={22} />}
              </button>
            )}
            <button type="button" onClick={() => setManualOpen((v) => !v)} aria-label="수동 입력" className={cn('rounded-full p-3', manualOpen ? 'bg-white text-black' : 'bg-white/20')}>
              <Keyboard size={22} />
            </button>
          </div>
        )}
      </div>

      {/* 하단 — 수동 입력(블루투스·USB 리더도 여기로) + 보조 영역 */}
      <div className="space-y-2 bg-black px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {manualOpen && (
          <form onSubmit={(e) => void submitManual(e)} className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="시리얼 직접 입력 · 리더기 스캔"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              enterKeyHint="done"
              autoFocus
              className="h-12 min-w-0 flex-1 rounded-xl bg-white/10 px-3.5 font-mono text-base text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-white/40"
            />
            <button type="submit" className="h-12 shrink-0 rounded-xl bg-white px-4 text-sm font-semibold text-black">추가</button>
          </form>
        )}
        {footer}
        <button type="button" onClick={onClose} className="h-12 w-full rounded-xl bg-white/15 text-base font-semibold">
          완료
        </button>
      </div>
    </div>
  )
}
