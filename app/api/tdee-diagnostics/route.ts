import { NextResponse } from 'next/server';
import { getRegressionDiagnostics } from '@/lib/actions/tdee';

export async function GET() {
  try {
    const diagnostics = await getRegressionDiagnostics();
    return NextResponse.json(diagnostics);
  } catch (error) {
    console.error('[TDEE Diagnostics] Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        rawData: [],
        regressionPairs: [],
        regressionStats: null,
        manualVerification: null,
      },
      { status: 500 }
    );
  }
}
