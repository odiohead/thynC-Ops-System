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
 * @returns presigned URL
 */
export async function getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
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
