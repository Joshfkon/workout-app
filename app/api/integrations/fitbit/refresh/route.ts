import { NextRequest, NextResponse } from 'next/server';

/**
 * Fitbit OAuth Token Refresh
 *
 * Refreshes expired access tokens using the refresh token.
 */
export async function POST(request: NextRequest) {
  try {
    const { refreshToken } = await request.json();

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'Refresh token required' },
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

    // Refresh the token
    const tokenResponse = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Fitbit token refresh failed:', error);
      return NextResponse.json(
        { error: 'Token refresh failed' },
        { status: 400 }
      );
    }

    const tokens = await tokenResponse.json();

    // Validate required fields in response
    if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
      console.error('Fitbit token refresh response missing required fields');
      return NextResponse.json(
        { error: 'Invalid token response from Fitbit' },
        { status: 502 }
      );
    }

    // Calculate expiration time
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expires_in);

    return NextResponse.json({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: expiresAt.toISOString(),
      userId: tokens.user_id,
      scope: tokens.scope ? tokens.scope.split(' ') : [],
    });
  } catch (error) {
    console.error('Fitbit token refresh error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
