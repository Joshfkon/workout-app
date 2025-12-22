import { NextRequest, NextResponse } from 'next/server';

/**
 * Fitbit OAuth Token Revocation
 *
 * Revokes access tokens when user disconnects.
 */
export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json();

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Access token required' },
        { status: 400 }
      );
    }

    const clientId = process.env.FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Fitbit credentials not configured' },
        { status: 500 }
      );
    }

    // Revoke the token
    const revokeResponse = await fetch('https://api.fitbit.com/oauth2/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        token: accessToken,
      }),
    });

    if (!revokeResponse.ok) {
      console.warn('Fitbit token revoke failed, but continuing...');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Fitbit token revoke error:', error);
    // Still return success - token may already be invalid
    return NextResponse.json({ success: true });
  }
}
