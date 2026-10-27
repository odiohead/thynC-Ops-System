/**
 * [Claude 도움요청] — 채널톡 상담 원문에서 AS 접수 필드 구조화 추출 (L2, as_channeltalk_intake_design.md §4.5)
 * 등록대기 큐 상세에서 사용자가 누를 때만 호출. 결과는 빈 필드만 채우고(사람 입력 보존) 자동 등록은 하지 않는다.
 * 사용자 허용(2026-10-27 Q3)에 근거해 상담 본문을 그대로 전송한다 — 파일 메타·봇 안내문은 제외하고 user/manager/bot 텍스트만.
 */
import Anthropic from '@anthropic-ai/sdk'
import { AI_SUMMARIZE_MODEL } from '@/lib/ai/settings'

export interface AsAiExtract {
  hospitalName: string | null
  wards: string[]
  category: 'FAULT' | 'LOST' | null
  lines: { serial: string; ward: string | null; symptom: string | null }[]
  destInfo: string | null
  pickupDestInfo: string | null
  pickupDestDiffers: boolean
  preReplace: boolean
  reporterName: string | null
  notes: string | null
}

const TOOL: Anthropic.Tool = {
  name: 'as_extract',
  description: '채널톡 상담 원문에서 의료기기(심전계 A######, 산소포화도 P######) AS 접수 정보를 구조화한다. 모르는 값은 null.',
  input_schema: {
    type: 'object',
    properties: {
      hospitalName: { type: ['string', 'null'], description: '병원명 (법인명 제외, 원문 표기)' },
      wards: { type: 'array', items: { type: 'string' }, description: '병동명 목록' },
      category: { type: ['string', 'null'], enum: ['FAULT', 'LOST', null], description: 'FAULT 고장 / LOST 분실' },
      lines: {
        type: 'array',
        items: { type: 'object', properties: { serial: { type: 'string', description: '대문자, 영문1자+숫자6자' }, ward: { type: ['string', 'null'] }, symptom: { type: ['string', 'null'], description: '증상/접수사유 요약' } }, required: ['serial'] },
      },
      destInfo: { type: ['string', 'null'], description: '수리품 발송지(주소 / 수령인 / 연락처를 " / "로 연결)' },
      pickupDestInfo: { type: ['string', 'null'], description: '고장품 회수지 (발송지와 같으면 null)' },
      pickupDestDiffers: { type: 'boolean' },
      preReplace: { type: 'boolean', description: '고객이 선교체를 요청했는지' },
      reporterName: { type: ['string', 'null'], description: '접수자(병원/병동/이름)' },
      notes: { type: ['string', 'null'], description: '접수에 참고할 특이사항 1~2줄' },
    },
    required: ['wards', 'lines', 'pickupDestDiffers', 'preReplace'],
  },
}

export async function aiExtractAsFromMessages(messages: { personType: string | null; plainText: string | null; createdAtCt: Date }[]): Promise<AsAiExtract> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.')
  const client = new Anthropic({ apiKey })
  const who: Record<string, string> = { user: '고객', manager: '담당자', bot: '봇' }
  const transcript = messages
    .filter((m) => m.plainText?.trim())
    .map((m) => `[${m.createdAtCt.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)}] ${who[m.personType ?? ''] ?? m.personType}: ${m.plainText!.trim()}`)
    .join('\n')
    .slice(0, 60_000)
  const res = await client.messages.create({
    model: AI_SUMMARIZE_MODEL,
    max_tokens: 4000,
    system: '너는 의료기기 AS 접수 담당 보조다. 대화에서 AS 접수에 필요한 사실만 추출한다. 추측으로 채우지 말고 모르면 null. 시리얼은 A 또는 P로 시작하는 7자(영문1+숫자6)이며 오타(O→0 등)는 고치지 말고 원문 그대로 둔다. 환자 개인정보는 어떤 필드에도 넣지 않는다.',
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'as_extract' },
    messages: [{ role: 'user', content: `다음 채널톡 상담에서 AS 접수 정보를 추출해라. 봇의 확인문이 여러 번이면 마지막 확정본을 우선한다.\n\n<transcript>\n${transcript}\n</transcript>` }],
  })
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!block) throw new Error('AI 추출 결과가 없습니다.')
  const i = block.input as Partial<AsAiExtract>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    hospitalName: str(i.hospitalName), wards: Array.isArray(i.wards) ? i.wards.filter((w): w is string => typeof w === 'string') : [],
    category: i.category === 'LOST' ? 'LOST' : i.category === 'FAULT' ? 'FAULT' : null,
    lines: Array.isArray(i.lines) ? i.lines.filter((l) => l && typeof l.serial === 'string').map((l) => ({ serial: l.serial.replace(/\s+/g, '').toUpperCase(), ward: str(l.ward), symptom: str(l.symptom) })) : [],
    destInfo: str(i.destInfo), pickupDestInfo: str(i.pickupDestInfo), pickupDestDiffers: !!i.pickupDestDiffers, preReplace: !!i.preReplace,
    reporterName: str(i.reporterName), notes: str(i.notes),
  }
}
