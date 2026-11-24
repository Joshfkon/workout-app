/**
 * POST /api/apple/notifications — App Store Server Notifications V2.
 * Set this URL (production and sandbox) in App Store Connect → App
 * Information → App Store Server Notifications.
 *
 * Apple calls with no session; the request authenticates itself by Apple's
 * signature (verified here), so the route is public in the middleware. It
 * keeps the row current between app launches: renewals, renewal turned off,
 * billing retry and grace period, expiry, refunds and revocations.
 *
 * 200 = handled (or deliberately ignored); 5xx makes Apple retry.
 */
import { NextRequest, NextResponse } from 'next/server';
import { now as clockNow } from '@/lib/clock';
import { applyAppleSubscription } from '@/lib/apple/applySubscription';
import { APPLE_BUNDLE_ID } from '@/lib/apple/iapProducts';
import { appleAdminClient, isUuid, verifyRenewal, verifyTransaction, ALLOW_XCODE_TRANSACTIONS } from '@/lib/apple/server';
import { AppleJwsError, verifyAppleJws } from '@/lib/apple/verifyJws';

export const runtime = 'nodejs';

interface NotificationPayload {
  notificationType: string;
  subtype?: string;
  notificationUUID?: string;
  data?: {
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
}

export async function POST(request: NextRequest) {
  let signedPayload: string;
  try {
    signedPayload = (await request.json()).signedPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  let note: NotificationPayload;
  try {
    note = verifyAppleJws<NotificationPayload>(signedPayload, { allowXcodeEnvironment: ALLOW_XCODE_TRANSACTIONS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid' }, { status: 400 });
  }

  if (note.notificationType === 'TEST') return NextResponse.json({ ok: true, test: true });
  if (note.data?.bundleId && note.data.bundleId !== APPLE_BUNDLE_ID) {
    return NextResponse.json({ ok: true, ignored: 'other_bundle' });
  }
  if (!note.data?.signedTransactionInfo) return NextResponse.json({ ok: true, ignored: 'no_transaction' });

  try {
    const transaction = verifyTransaction(note.data.signedTransactionInfo);
    const renewal = verifyRenewal(note.data.signedRenewalInfo);
    const admin = appleAdminClient();

    // The account: the row that already holds this subscription, else the
    // account id the app tagged the purchase with.
    const { data: row, error } = await admin
      .from('subscriptions')
      .select('user_id')
      .eq('apple_original_transaction_id', transaction.originalTransactionId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const userId = row?.user_id ?? (isUuid(transaction.appAccountToken) ? transaction.appAccountToken.toLowerCase() : null);
    if (!userId) return NextResponse.json({ ok: true, ignored: 'unknown_account' });

    const result = await applyAppleSubscription(admin, userId, transaction, renewal, clockNow());
    if (!result.ok && result.reason === 'db_error') return NextResponse.json({ error: result.message }, { status: 500 });
    return NextResponse.json({ ok: true, type: note.notificationType, applied: result.ok, reason: result.ok ? undefined : result.reason });
  } catch (e) {
    if (e instanceof AppleJwsError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
