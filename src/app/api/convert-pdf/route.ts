import { NextRequest, NextResponse } from 'next/server';
import { convertServerSide } from '@/lib/pdf2js-server';
import { authorizeRequestContext } from '@/lib/generic-api';
import { StorageService } from '@/lib/storage-service';

export async function POST(request: NextRequest) {
  try {

    const context = await authorizeRequestContext(request);
    const storageService = new StorageService(context.databaseIdHash);
    const tempDir = storageService.getTempDir();

    const body = await request.json();
    const { pdfBase64, conversion_config } = body;

    if (!pdfBase64) {
      return NextResponse.json(
        { error: 'PDF base64 data is required' },
        { status: 400 }
      );
    }

    const images = await convertServerSide(pdfBase64, conversion_config || {}, tempDir);

    return NextResponse.json({
      success: true,
      images: images
    });

  } catch (error) {
    console.error('PDF conversion error:', error);
    return NextResponse.json(
      { error: 'Failed to convert PDF', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 