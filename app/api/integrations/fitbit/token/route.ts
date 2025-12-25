import { NextRequest, NextResponse } from 'next/server';

/**
 * Fitbit OAuth Token Exchange
 *
 * Exchanges authorization code for access tokens.
 * This must be server-side as it requires the client secret.
 */
export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: 'Authorization code required' },
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

    // Use configured app URL instead of user-controlled Origin header to prevent OAuth token hijacking
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      return NextResponse.json(
        { error: 'Application URL not configured' },
        { status: 500 }
      );
    }
    const redirectUri = `${appUrl}/integrations/fitbit/callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Fitbit token exchange failed:', error);
      return NextResponse.json(
        { error: 'Token exchange failed' },
        { status: 400 }
      );
    }

    const tokens = await tokenResponse.json();

    // Validate required fields in response
    if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
      console.error('Fitbit token response missing required fields');
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
    console.error('Fitbit token exchange error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
