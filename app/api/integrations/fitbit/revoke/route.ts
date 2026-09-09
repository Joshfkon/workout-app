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

    // Revoke the token at Fitbit
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

    // Only proceed to clear tokens if revocation succeeded or token was already invalid
    if (!revokeResponse.ok) {
      const statusCode = revokeResponse.status;
      // 400 or 401 typically means token is already invalid/revoked
      const alreadyRevoked = statusCode === 400 || statusCode === 401;
      
      if (!alreadyRevoked) {
        // Transient error (5xx, network timeout, etc.) - keep credentials for retry
        console.error(`Fitbit revoke failed with status ${statusCode}`);
        return NextResponse.json(
          { error: 'Failed to revoke access at Fitbit. Please try again.' },
          { status: 502 }
        );
      }
      
      // Token already invalid - safe to clear
      console.info('Fitbit token already revoked or invalid, clearing credentials');
    }

    // Mark the connection as disconnected after successful revocation
    // Use user_id + source to avoid type issues with connection.id
    const { error: updateError } = await supabase
      .from('wearable_connections')
      // @ts-ignore - Supabase type generation issue with wearable_connections table
      .update({
        is_connected: false,
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
      })
      .eq('user_id', user.id)
      .eq('source', 'fitbit');

    if (updateError) {
      console.error('Failed to update connection status:', updateError);
      return NextResponse.json(
        { error: 'Failed to clear credentials' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Fitbit token revoke error:', error);
    return NextResponse.json(
      { error: 'An error occurred during revocation' },
      { status: 500 }
    );
  }
}
