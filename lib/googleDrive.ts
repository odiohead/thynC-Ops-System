import { google } from 'googleapis';
import { Readable } from 'stream';

function getCredentials(): object {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 설정되지 않았습니다. ' +
      '.env.local에 서비스 계정 JSON 키를 한 줄 문자열로 입력하세요.'
    );
  }
  try {
    return JSON.parse(serviceAccountJson);
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON 파싱에 실패했습니다. ' +
      '유효한 JSON 문자열인지 확인하세요.'
    );
  }
}

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
  return {
    drive: google.drive({ version: 'v3', auth }),
    sheets: google.sheets({ version: 'v4', auth }),
  };
}

interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
}

export async function createDriveFolder(name: string, parentFolderId: string): Promise<string> {
  const { drive } = getDriveClient();
  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });
  return response.data.id!;
}

interface UploadBufferParams {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  folderId: string;
}

export async function uploadBufferToDrive({
  fileName,
  buffer,
  mimeType,
  folderId,
}: UploadBufferParams): Promise<DriveFile> {
  const { drive } = getDriveClient();
  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id, name, webViewLink',
  });
  const file = response.data;
  return { id: file.id ?? '', name: file.name ?? '', webViewLink: file.webViewLink ?? '' };
}

interface UploadFileParams {
  fileName: string;
  content: string;
  mimeType: string;
  folderId?: string;
}

export async function uploadFileToDrive({
  fileName,
  content,
  mimeType,
  folderId,
}: UploadFileParams): Promise<DriveFile> {
  const { drive } = getDriveClient();
  const targetFolderId = folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID;

  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: targetFolderId ? [targetFolderId] : undefined,
    },
    media: {
      mimeType,
      body: Readable.from([content]),
    },
    fields: 'id, name, webViewLink',
  });

  const file = response.data;
  return { id: file.id ?? '', name: file.name ?? '', webViewLink: file.webViewLink ?? '' };
}

export async function listFilesInFolder(folderId?: string): Promise<DriveFile[]> {
  const { drive } = getDriveClient();
  const targetFolderId = folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!targetFolderId) {
    throw new Error('folderId가 지정되지 않았고 GOOGLE_DRIVE_FOLDER_ID 환경변수도 없습니다.');
  }

  const response = await drive.files.list({
    q: `'${targetFolderId}' in parents and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    orderBy: 'createdTime desc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (response.data.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '',
    webViewLink: f.webViewLink ?? '',
  }));
}

export async function listFilesByNamePrefix(prefix: string, folderId?: string): Promise<DriveFile[]> {
  const { drive } = getDriveClient();
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

  return (response.data.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '',
    webViewLink: f.webViewLink ?? '',
  }));
}

/**
 * Google Sheets API로 서식이 적용된 스프레드시트를 직접 생성합니다.
 * - 헤더 배경색: #cfe2f3, 굵게
 * - 전체 셀 얇은 테두리
 * - 첫 행 고정
 * - 열 너비 자동 조정
 */
export async function createFormattedSheet({
  fileName,
  headers,
  rows,
  folderId,
}: {
  fileName: string;
  headers: string[];
  rows: string[][];
  folderId?: string;
}): Promise<DriveFile> {
  const { drive, sheets } = getDriveClient();
  const targetFolderId = folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID;

  // 1. 빈 Google Sheets 파일 생성
  const createResponse = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: targetFolderId ? [targetFolderId] : undefined,
    },
    fields: 'id, name, webViewLink',
  });

  const fileId = createResponse.data.id!;
  const allData = [headers, ...rows];
  const numRows = allData.length;
  const numCols = headers.length;

  // 2. 데이터 입력
  await sheets.spreadsheets.values.update({
    spreadsheetId: fileId,
    range: 'A1',
    valueInputOption: 'RAW',
    requestBody: { values: allData },
  });

  // 3. 서식 적용
  // #cfe2f3 → R:207 G:226 B:243
  const headerBgColor = { red: 207 / 255, green: 226 / 255, blue: 243 / 255 };
  const thinBorder = { style: 'SOLID' as const, color: { red: 0, green: 0, blue: 0, alpha: 1 } };
  const allCellRange = { startRowIndex: 0, endRowIndex: numRows, startColumnIndex: 0, endColumnIndex: numCols };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: fileId,
    requestBody: {
      requests: [
        // 헤더 배경색 + 굵게
        {
          repeatCell: {
            range: { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: numCols },
            cell: {
              userEnteredFormat: {
                backgroundColor: headerBgColor,
                textFormat: { bold: true },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        // 전체 셀 얇은 테두리
        {
          updateBorders: {
            range: allCellRange,
            top: thinBorder,
            bottom: thinBorder,
            left: thinBorder,
            right: thinBorder,
            innerHorizontal: thinBorder,
            innerVertical: thinBorder,
          },
        },
        // 첫 행 고정
        {
          updateSheetProperties: {
            properties: { gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        // 열 너비 자동 조정
        {
          autoResizeDimensions: {
            dimensions: { dimension: 'COLUMNS', startIndex: 0, endIndex: numCols },
          },
        },
      ],
    },
  });

  return {
    id: fileId,
    name: createResponse.data.name ?? '',
    webViewLink: createResponse.data.webViewLink ?? '',
  };
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
