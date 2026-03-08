import { NextRequest, NextResponse } from 'next/server';
import { uploadFileToDrive } from '@/lib/googleDrive';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileName, content, mimeType } = body;

    if (!fileName || !content || !mimeType) {
      return NextResponse.json(
        { error: 'fileName, content, mimeType는 필수 항목입니다.' },
        { status: 400 }
      );
    }

    const file = await uploadFileToDrive({ fileName, content, mimeType });
    return NextResponse.json(file, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
