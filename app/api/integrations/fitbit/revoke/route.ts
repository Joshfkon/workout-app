import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Fitbit OAuth Token Revocation
 *
 * Revokes access tokens when user disconnects.
 * Requires authentication and verifies token ownership.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { accessToken } = await request.json();

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Access token required' },
        { status: 400 }
      );
    }

    // Verify the access token belongs to this user
    const { data: connection, error: connectionError } = await supabase
      .from('wearable_connections')
      .select('id')
      .eq('user_id', user.id)
      .eq('source', 'fitbit')
      .eq('access_token', accessToken)
      .single();

    if (connectionError || !connection) {
      return NextResponse.json(
        { error: 'Invalid access token or token does not belong to user' },
        { status: 403 }
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
