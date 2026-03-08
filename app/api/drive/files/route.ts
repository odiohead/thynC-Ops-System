import { NextRequest, NextResponse } from 'next/server';
import { listFilesInFolder } from '@/lib/googleDrive';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get('folderId') ?? undefined;

    const files = await listFilesInFolder(folderId);
    return NextResponse.json(files);
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
