/**
 * POST /api/apple/sync — the iOS app sends the StoreKit 2 signed transactions
 * it holds (after a purchase, a restore, a Transaction.updates event, or its
 * launch-time entitlement check). We verify each with Apple's certificate
 * chain, keep the ones for this account, and record the best on the user's
 * subscription row. Idempotent: the same transactions give the same row.
 *
 * Auth: the Supabase access token as a Bearer header (as /api/stripe/checkout).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { now as clockNow } from '@/lib/clock';
import { applyAppleSubscription } from '@/lib/apple/applySubscription';
import { appleAdminClient, isUuid, verifyTransaction } from '@/lib/apple/server';
import { bestAppleTransaction, type AppleTransactionPayload } from '@/lib/apple/subscriptionState';

export const runtime = 'nodejs';

const MAX_TRANSACTIONS = 20;

export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user }, error: authError } = await anon.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { transactions?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const list = Array.isArray(body.transactions) ? body.transactions.slice(0, MAX_TRANSACTIONS) : [];
  if (list.length === 0) return NextResponse.json({ applied: false, reason: 'no_transactions' });

  const verified: AppleTransactionPayload[] = [];
  const rejected: string[] = [];
  for (const jws of list) {
    try {
      const t = verifyTransaction(String(jws));
      // The app tags every purchase with the account's id; a purchase made on
      // another HyperTrack account (same Apple ID) is not this user's.
      if (isUuid(t.appAccountToken) && t.appAccountToken.toLowerCase() !== user.id.toLowerCase()) {
        rejected.push('other_account');
        continue;
      }
      verified.push(t);
    } catch (e) {
      rejected.push(e instanceof Error ? e.message : 'invalid');
    }
  }

  const best = bestAppleTransaction(verified, clockNow());
  if (!best) {
    const otherAccount = rejected.includes('other_account');
    return NextResponse.json(
      {
        applied: false,
        reason: otherAccount ? 'other_account' : 'invalid',
        message: otherAccount
          ? 'This App Store subscription was bought on another HyperTrack account. Sign in to that account to use it.'
          : 'The App Store purchase could not be verified.',
      },
      { status: otherAccount ? 409 : 400 }
    );
  }

  const result = await applyAppleSubscription(appleAdminClient(), user.id, best, null, clockNow());
  if (!result.ok) {
    const status = result.reason === 'other_account' ? 409 : result.reason === 'lifetime_promo' ? 200 : 500;
    return NextResponse.json({ applied: false, reason: result.reason, message: result.message }, { status });
  }
  return NextResponse.json({
    applied: true,
    tier: result.state.tier,
    status: result.state.status,
    currentPeriodEnd: result.state.currentPeriodEnd,
  });
}
