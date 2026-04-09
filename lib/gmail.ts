import { google } from 'googleapis'

export function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  )
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  })
  return google.gmail({ version: 'v1', auth: oauth2Client })
}

export function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractHtmlBody(payload: any): string {
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractHtmlBody(part)
      if (result) return result
    }
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }
  return ''
}

interface ParsedFormEmail {
  [key: string]: string
  hospitalName: string
  requestDateRaw: string
  managerName: string
  managerPhone: string
  managerEmail: string
  totalBeds: string
  address: string
  model: string
  fileUrl: string
  fileName: string
  fullText: string
}

export function parseFormEmail(html: string): ParsedFormEmail {
  // HTML 엔티티 치환
  let text = html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')

  // HTML 태그 제거 → 줄바꿈
  text = text.replace(/<[^>]+>/g, '\n')

  // 줄 분리·trim·빈줄 제거
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  // 단일 값 라벨 매핑 (다음 1줄이 값)
  const singleLabelMap: Record<string, string> = {
    '거래처명': 'hospitalName',
    '등록시각': 'requestDateRaw',
    '담당자 성함': 'managerName',
    '담당자 연락처': 'managerPhone',
    '담당자 이메일 주소': 'managerEmail',
    '전체 병상 수': 'totalBeds',
    '판매 모델': 'model',
  }

  // 복수 줄 라벨 (다음 라벨이 나올 때까지 모든 줄을 합침)
  const multiLineLabelMap: Record<string, string> = {
    '거래처 주소': 'address',
  }

  const allLabels = new Set([...Object.keys(singleLabelMap), ...Object.keys(multiLineLabelMap)])

  const result: ParsedFormEmail = {
    hospitalName: '',
    requestDateRaw: '',
    managerName: '',
    managerPhone: '',
    managerEmail: '',
    totalBeds: '',
    address: '',
    model: '',
    fileUrl: '',
    fileName: '',
    fullText: '',
  }

  for (let i = 0; i < lines.length; i++) {
    const singleKey = singleLabelMap[lines[i]]
    if (singleKey && i + 1 < lines.length) {
      (result as Record<string, string>)[singleKey] = lines[i + 1]
      continue
    }

    const multiKey = multiLineLabelMap[lines[i]]
    if (multiKey) {
      const valueParts: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        if (allLabels.has(lines[j])) break
        valueParts.push(lines[j])
      }
      (result as Record<string, string>)[multiKey] = valueParts.join(' ')
      continue
    }
  }

  // 파일 다운로드 링크 추출
  const fileUrlMatch = html.match(/href="(https:\/\/daewoongfmc\.imweb\.me\/form_file_download\.cm\?[^"]+)"/)
  if (fileUrlMatch) {
    result.fileUrl = fileUrlMatch[1]
  }

  // 본문 텍스트에서 파일명 추출 (확장자 패턴)
  const fileNameMatch = lines.find((l) => /\.(pdf|png|jpg|jpeg|zip|hwp|xlsx?)$/i.test(l.trim()))
  if (fileNameMatch) {
    result.fileName = fileNameMatch.trim()
  }

  // 전체 텍스트 (응답~입력폼 관리하기 사이)
  const startIdx = lines.findIndex((l) => l === '응답')
  const endIdx = lines.findIndex((l) => l.includes('입력폼 관리하기'))
  if (startIdx !== -1 && endIdx !== -1) {
    result.fullText = lines.slice(startIdx + 1, endIdx).join('\n')
  } else {
    result.fullText = lines.join('\n')
  }

  return result
}

/** 메일 전체 텍스트를 Tiptap HTML로 변환 */
export function buildNoteHtml(queueItem: {
  managerName: string
  managerPhone: string
  managerEmail: string
  address: string
  model: string
  totalBeds: string
}, fullText: string): string {
  const summary = [
    `<strong>담당자:</strong> ${queueItem.managerName} / ${queueItem.managerPhone} / ${queueItem.managerEmail}`,
    `<strong>거래처 주소:</strong> ${queueItem.address}`,
    `<strong>판매모델:</strong> ${queueItem.model} / <strong>전체병상:</strong> ${queueItem.totalBeds}`,
  ]

  const summaryHtml = summary.map((s) => `<p>${s}</p>`).join('')

  const bodyLines = fullText.split('\n')
  const bodyHtml = bodyLines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return '<p></p>'
    return `<p>${trimmed}</p>`
  }).join('')

  return `<p><strong>[메일 자동 등록]</strong></p>${summaryHtml}<hr><p><strong>--- 메일 원문 ---</strong></p>${bodyHtml}`
}

export function parseKstDate(dateStr: string): Date {
  try {
    const d = new Date(dateStr.replace(' ', 'T') + ':00+09:00')
    if (isNaN(d.getTime())) return new Date()
    return d
  } catch {
    return new Date()
  }
}
