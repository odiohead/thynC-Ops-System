import { prisma } from '../prisma'

/**
 * 병원 노트 — 위키 연동 상수·헬퍼 (function_ai_assistant.html §6)
 *
 * 프로젝트 이슈노트와 동일 패턴: 위키 시스템 카테고리 '병원 노트' 하위에 병원별 1:1 페이지.
 * - 루트 카테고리 페이지 id는 AppSetting(`wiki_hospital_note_root_id`)에 보관
 * - 병원 ↔ 페이지 1:1 연결은 WikiPageReference(refType='hospital_note', refCode=hospitalCode)
 * - 루트: 이동·이름변경·삭제 차단 / 노트 페이지: 카테고리 밖 이동 차단, 삭제는 ADMIN 이상
 * - AI 상담 정리("병원 노트에 추가")가 이 페이지에 상담이력을 append — 어시스턴트가 read_hospital_note로 재활용
 */
export const HOSPITAL_NOTE_REF_TYPE = 'hospital_note'
export const HOSPITAL_NOTE_ROOT_SETTING_KEY = 'wiki_hospital_note_root_id'
export const HOSPITAL_NOTE_ROOT_TITLE = '병원 노트'
export const HOSPITAL_NOTE_ROOT_ICON = '🏥'
export const HOSPITAL_NOTE_PAGE_ICON = '🗒️'

/** AppSetting에 기록된 루트 카테고리 페이지 id (페이지 실존 검증 없음) */
export async function getHospitalNoteRootSetting(): Promise<string | null> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: HOSPITAL_NOTE_ROOT_SETTING_KEY },
  })
  return setting?.value || null
}

/** 루트 카테고리 페이지 id 조회 — 페이지가 실존(미삭제)할 때만 반환 */
export async function getHospitalNoteRootId(): Promise<string | null> {
  const id = await getHospitalNoteRootSetting()
  if (!id) return null
  const page = await prisma.wikiPage.findUnique({
    where: { id },
    select: { id: true, deletedAt: true },
  })
  return page && !page.deletedAt ? page.id : null
}

/** 루트 카테고리 페이지 보장 — 없으면 생성 후 AppSetting에 기록 */
export async function ensureHospitalNoteRoot(authorId: string): Promise<string> {
  const existing = await getHospitalNoteRootId()
  if (existing) return existing

  const created = await prisma.wikiPage.create({
    data: {
      title: HOSPITAL_NOTE_ROOT_TITLE,
      icon: HOSPITAL_NOTE_ROOT_ICON,
      parentId: null,
      contentJson: [],
      plainText: '',
      authorId,
      lastEditorId: authorId,
    },
    select: { id: true },
  })
  await prisma.appSetting.upsert({
    where: { key: HOSPITAL_NOTE_ROOT_SETTING_KEY },
    update: { value: created.id },
    create: { key: HOSPITAL_NOTE_ROOT_SETTING_KEY, value: created.id },
  })
  return created.id
}

/**
 * 페이지 보호 등급 판정 (프로젝트 이슈노트 보호와 병행 적용)
 * - 'root' : 시스템 카테고리(병원 노트) 자체
 * - 'note' : 병원에 연결된 노트 페이지
 * - null   : 일반 위키 페이지
 */
export async function getHospitalNotePageProtection(
  pageId: string,
): Promise<'root' | 'note' | null> {
  const rootId = await getHospitalNoteRootSetting()
  if (rootId === pageId) return 'root'
  const ref = await prisma.wikiPageReference.findFirst({
    where: { pageId, refType: HOSPITAL_NOTE_REF_TYPE },
    select: { id: true },
  })
  return ref ? 'note' : null
}

/** 병원의 노트 페이지 조회 (본문 포함, 없으면 null) */
export async function findHospitalNotePage(hospitalCode: string) {
  const ref = await prisma.wikiPageReference.findFirst({
    where: {
      refType: HOSPITAL_NOTE_REF_TYPE,
      refCode: hospitalCode,
      page: { deletedAt: null },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      page: {
        select: {
          id: true,
          title: true,
          contentJson: true,
          plainText: true,
          updatedAt: true,
          collabEnabled: true,
          lastEditor: { select: { name: true } },
        },
      },
    },
  })
  return ref?.page ?? null
}
