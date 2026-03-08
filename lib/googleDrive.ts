import { google } from 'googleapis';
import { Readable } from 'stream';

function getDriveClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 설정되지 않았습니다. ' +
      '.env.local에 서비스 계정 JSON 키를 한 줄 문자열로 입력하세요.'
    );
  }

  let credentials: object;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON 파싱에 실패했습니다. ' +
      '유효한 JSON 문자열인지 확인하세요.'
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
}

interface UploadFileParams {
  fileName: string;
  content: string;
  mimeType: string;
  folderId?: string;
}

interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
}

export async function uploadFileToDrive({
  fileName,
  content,
  mimeType,
  folderId,
}: UploadFileParams): Promise<DriveFile> {
  const drive = getDriveClient();
  const targetFolderId = folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID;

  const stream = Readable.from([content]);

  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: targetFolderId ? [targetFolderId] : undefined,
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id, name, webViewLink',
  });

  const file = response.data;
  return {
    id: file.id ?? '',
    name: file.name ?? '',
    webViewLink: file.webViewLink ?? '',
  };
}

export async function listFilesInFolder(folderId?: string): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const targetFolderId = folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!targetFolderId) {
    throw new Error(
      'folderId가 지정되지 않았고 GOOGLE_DRIVE_FOLDER_ID 환경변수도 없습니다.'
    );
  }

  const response = await drive.files.list({
    q: `'${targetFolderId}' in parents and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    orderBy: 'createdTime desc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (response.data.files ?? []).map((file) => ({
    id: file.id ?? '',
    name: file.name ?? '',
    webViewLink: file.webViewLink ?? '',
  }));
}

export async function uploadCsvAsGoogleSheet({
  fileName,
  csvContent,
  folderId,
}: {
  fileName: string;
  csvContent: string;
  folderId?: string;
}): Promise<DriveFile> {
  const drive = getDriveClient();
  const targetFolderId = folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID;

  const stream = Readable.from(['\uFEFF' + csvContent]); // BOM 추가 (한글 깨짐 방지)

  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: targetFolderId ? [targetFolderId] : undefined,
    },
    media: {
      mimeType: 'text/csv',
      body: stream,
    },
    fields: 'id, name, webViewLink',
  });

  const file = response.data;
  return {
    id: file.id ?? '',
    name: file.name ?? '',
    webViewLink: file.webViewLink ?? '',
  };
}

export async function listFilesByNamePrefix(prefix: string, folderId?: string): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const targetFolderId = folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!targetFolderId) {
    throw new Error('folderId가 지정되지 않았고 GOOGLE_DRIVE_FOLDER_ID 환경변수도 없습니다.');
  }

  const response = await drive.files.list({
    q: `'${targetFolderId}' in parents and name contains '${prefix}' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    orderBy: 'createdTime desc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (response.data.files ?? []).map((file) => ({
    id: file.id ?? '',
    name: file.name ?? '',
    webViewLink: file.webViewLink ?? '',
  }));
}

export async function testDriveConnection(): Promise<{ success: boolean; message: string }> {
  try {
    await listFilesInFolder();
    return { success: true, message: 'Google Drive 연결 성공' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return { success: false, message: `Google Drive 연결 실패: ${message}` };
  }
}
