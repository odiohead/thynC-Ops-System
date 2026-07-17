import { prisma } from '../prisma'

/**
 * 프로젝트 이슈노트 — 위키 연동 상수·헬퍼
 *
 * 프로젝트별 이슈노트는 위키의 시스템 카테고리 '프로젝트 이슈노트' 하위 페이지로 관리한다.
 * - 루트 카테고리 페이지 id는 AppSetting(`wiki_project_issue_root_id`)에 보관
 * - 프로젝트 ↔ 페이지 1:1 연결은 WikiPageReference(refType='project_issue', refCode=projectCode)
 * - 루트: 이동·이름변경·삭제 차단 / 이슈노트 페이지: 카테고리 밖 이동 차단, 삭제는 ADMIN 이상
 */
export const PROJECT_ISSUE_REF_TYPE = 'project_issue'
export const ISSUE_ROOT_SETTING_KEY = 'wiki_project_issue_root_id'
export const ISSUE_ROOT_TITLE = '프로젝트 이슈노트'
export const ISSUE_ROOT_ICON = '📋'
export const ISSUE_PAGE_ICON = '📝'

/** AppSetting에 기록된 루트 카테고리 페이지 id (페이지 실존 검증 없음) */
export async function getIssueNoteRootSetting(): Promise<string | null> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: ISSUE_ROOT_SETTING_KEY },
  })
  return setting?.value || null
}

/** 루트 카테고리 페이지 id 조회 — 페이지가 실존(미삭제)할 때만 반환 */
export async function getIssueNoteRootId(): Promise<string | null> {
  const id = await getIssueNoteRootSetting()
  if (!id) return null
  const page = await prisma.wikiPage.findUnique({
    where: { id },
    select: { id: true, deletedAt: true },
  })
  return page && !page.deletedAt ? page.id : null
}

/** 루트 카테고리 페이지 보장 — 없으면 생성 후 AppSetting에 기록 */
export async function ensureIssueNoteRoot(authorId: string): Promise<string> {
  const existing = await getIssueNoteRootId()
  if (existing) return existing

  const created = await prisma.wikiPage.create({
    data: {
      title: ISSUE_ROOT_TITLE,
      icon: ISSUE_ROOT_ICON,
      parentId: null,
      contentJson: [],
      plainText: '',
      authorId,
      lastEditorId: authorId,
    },
    select: { id: true },
  })
  await prisma.appSetting.upsert({
    where: { key: ISSUE_ROOT_SETTING_KEY },
    update: { value: created.id },
    create: { key: ISSUE_ROOT_SETTING_KEY, value: created.id },
  })
  return created.id
}

/**
 * 페이지 보호 등급 판정
 * - 'root'  : 시스템 카테고리(프로젝트 이슈노트) 자체
 * - 'issue' : 프로젝트에 연결된 이슈노트 페이지
 * - null    : 일반 위키 페이지
 */
export async function getIssuePageProtection(
  pageId: string,
): Promise<'root' | 'issue' | null> {
  const rootId = await getIssueNoteRootSetting()
  if (rootId === pageId) return 'root'
  const ref = await prisma.wikiPageReference.findFirst({
    where: { pageId, refType: PROJECT_ISSUE_REF_TYPE },
    select: { id: true },
  })
  return ref ? 'issue' : null
}
