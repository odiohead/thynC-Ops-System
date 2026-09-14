import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const BUCKET_NAME = process.env.S3_BUCKET_NAME!

/**
 * S3에 파일 업로드
 * @param buffer 업로드할 파일 버퍼
 * @param key S3 내 저장 경로 (예: "projects/PRJ-202603-0001/파일명.pdf")
 * @param contentType 파일 MIME 타입
 * @returns 업로드된 파일의 key
 */
export async function uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<string> {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
    await s3Client.send(command)
    return key
  } catch (error) {
    throw new Error(`S3 업로드 실패 [${key}]: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * S3 파일의 presigned URL 생성
 * @param key S3 내 파일 경로
 * @param expiresIn URL 만료 시간(초), 기본값 3600 (1시간)
 * @param opts.downloadName 브라우저가 저장할 파일명(한글 등 non-ASCII 포함 가능) — 지정 시 Content-Disposition에
 *        RFC 5987 `filename*=UTF-8''…`으로 실린다. 미지정이면 S3 키 마지막 세그먼트로 저장되어 한글명이 `_`로 깨진다
 *        (위키 첨부 2026-09-12 A-11①). `inline`(기본 true)이면 PDF·이미지는 브라우저에서 바로 열린다.
 * @returns presigned URL
 */
export async function getSignedUrl(
  key: string,
  expiresIn: number = 3600,
  opts?: { downloadName?: string; inline?: boolean },
): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ...(opts?.downloadName
        ? { ResponseContentDisposition: buildContentDisposition(opts.downloadName, opts.inline ?? true) }
        : {}),
    })
    const url = await awsGetSignedUrl(s3Client, command, { expiresIn })
    return url
  } catch (error) {
    throw new Error(`S3 presigned URL 생성 실패 [${key}]: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * S3에서 파일 삭제
 * @param key S3 내 파일 경로
 */
export async function deleteFromS3(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    })
    await s3Client.send(command)
  } catch (error) {
    throw new Error(`S3 파일 삭제 실패 [${key}]: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** RFC 6266/5987 Content-Disposition — ASCII 폴백 + UTF-8 확장 파라미터 */
function buildContentDisposition(name: string, inline: boolean): string {
  const clean = name.replace(/[\r\n"]/g, '_')
  // eslint-disable-next-line no-control-regex
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_')
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
