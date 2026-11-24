'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card, CardContent } from '@/components/ui';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useSubscription } from '@/hooks/useSubscription';
import { TIER_FEATURES } from '@/lib/stripe';
import { appleProduct, type AppleBillingPeriod } from '@/lib/apple/iapProducts';
import {
  buyAppleSubscription,
  getAppleProducts,
  manageAppleSubscriptions,
  restoreApplePurchases,
  type AppleStoreProduct,
} from '@/lib/integrations/applePurchases';

type Msg = { type: 'success' | 'error' | 'info'; text: string } | null;

/**
 * iOS plan picker: App Store subscriptions (StoreKit 2). Prices come from the
 * App Store in the user's currency, never from TIER_FEATURES. Includes what
 * App Review requires next to a subscription: title, length, price, the
 * auto-renew terms, Restore purchases, and Terms / Privacy links.
 *
 * Only rendered when isApplePurchasesAvailable() (the plugin is in this app
 * build). A web (Stripe) subscriber is not offered a second subscription.
 */
function useWebBilling() {
  const s = useSubscription();
  const stripeSubscriptionBilled = s.billingSource === 'stripe' || (s.billingSource === null && !!s.stripeCustomerId);
  return { ...s, stripeSubscriptionBilled };
}

export function ApplePlans({ onPurchased }: { onPurchased?: () => void }) {
  const { user } = useAuthUser();
  const { tier, status, stripeSubscriptionBilled, refresh } = useWebBilling();
  const [period, setPeriod] = useState<AppleBillingPeriod>('yearly');
  const [products, setProducts] = useState<AppleStoreProduct[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    let alive = true;
    getAppleProducts()
      .then((p) => alive && setProducts(p))
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, []);

  // Billed on the web: the row says Stripe (or, on rows from before Apple
  // IAP, has no source but a Stripe customer). A former web customer who now
  // pays through Apple is billing_source 'apple' and keeps Restore/Manage.
  const subscribed = tier !== 'free' && (status === 'active' || status === 'trialing') && stripeSubscriptionBilled;
  const product = (t: 'pro' | 'elite') => products?.find((p) => p.id === appleProduct(t, period).id);

  const buy = async (t: 'pro' | 'elite') => {
    const p = product(t);
    if (!p || !user) return;
    setBusy(p.id);
    setMsg(null);
    const r = await buyAppleSubscription(p.id, user.id);
    setBusy(null);
    if (r.status === 'success') {
      setMsg({ type: 'success', text: `You're on ${TIER_FEATURES[t].name}. Thanks for supporting HyperTrack.` });
      await refresh();
      onPurchased?.();
    } else if (r.status === 'pending') {
      setMsg({ type: 'info', text: 'Waiting for approval. Your plan starts as soon as the App Store confirms it.' });
    } else if (r.status === 'error') {
      setMsg({ type: 'error', text: r.message });
    }
  };

  const restore = async () => {
    setBusy('restore');
    setMsg(null);
    try {
      const r = await restoreApplePurchases();
      if (r.applied) {
        await refresh();
        setMsg({ type: 'success', text: 'Your App Store subscription is restored.' });
      } else {
        setMsg({ type: 'info', text: r.message ?? 'No App Store subscription found for this Apple ID.' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Restore failed.' });
    } finally {
      setBusy(null);
    }
  };

  if (subscribed) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-2" data-testid="apple-plans-web-subscriber">
          <h2 className="text-headline font-semibold text-ink">You&apos;re on {TIER_FEATURES[tier].name}</h2>
          <p className="text-subhead text-ink-2">Your plan is billed through hypertrack.app, so there&apos;s nothing to buy here.</p>
        </CardContent>
      </Card>
    );
  }

  const unit = period === 'monthly' ? 'month' : 'year';

  return (
    <div className="space-y-4" data-testid="apple-plans">
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 p-1 bg-fill rounded-lg" role="group" aria-label="Billing period">
          {(['monthly', 'yearly'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`px-4 py-2 rounded-md text-subhead font-medium ${period === p ? 'bg-sep text-ink' : 'text-ink-2'}`}
            >
              {p === 'monthly' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
      </div>

      {products === null ? (
        <p className="text-center text-subhead text-ink-2">Loading App Store prices…</p>
      ) : products.length === 0 ? (
        <p className="text-center text-subhead text-ink-2">The App Store isn&apos;t responding. Check your connection and try again.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(['pro', 'elite'] as const).map((t) => {
            const p = product(t);
            const isCurrent = tier === t && status === 'active';
            return (
              <Card key={t} className={t === 'pro' ? 'border-action/40' : ''}>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <p className="text-headline font-semibold text-ink">{TIER_FEATURES[t].name}</p>
                    <p className="text-subhead text-ink-2">{TIER_FEATURES[t].description}</p>
                  </div>
                  <p className="text-title font-semibold text-ink tabular-nums">
                    {p ? p.displayPrice : '—'}
                    <span className="text-subhead font-normal text-ink-2"> / {unit}</span>
                  </p>
                  <ul className="space-y-1 text-subhead text-ink-2">
                    {TIER_FEATURES[t].features.slice(0, 5).map((f) => (
                      <li key={f}>· {f}</li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={t === 'pro' ? 'primary' : 'secondary'}
                    disabled={!p || !!busy || isCurrent}
                    onClick={() => void buy(t)}
                    data-testid={`apple-buy-${t}`}
                  >
                    {isCurrent ? 'Current plan' : busy === p?.id ? 'Opening the App Store…' : `Subscribe to ${TIER_FEATURES[t].name}`}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {msg && (
        <p
          role="status"
          className={`rounded-lg p-3 text-subhead ${
            msg.type === 'success' ? 'bg-status-good/10 text-ink' : msg.type === 'error' ? 'bg-status-bad/10 text-ink' : 'bg-fill text-ink'
          }`}
        >
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-4 text-subhead">
        <button type="button" className="font-semibold text-action" onClick={() => void restore()} disabled={!!busy} data-testid="apple-restore">
          {busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
        </button>
        {tier !== 'free' && status === 'active' && (
          <button type="button" className="font-semibold text-action" onClick={() => void manageAppleSubscriptions()}>
            Manage subscription
          </button>
        )}
      </div>

      <p className="text-caption text-ink-3 text-center max-w-md mx-auto" data-testid="apple-terms">
        Payment is charged to your Apple ID when you confirm. Subscriptions renew automatically at the same price for
        the same period unless turned off at least 24 hours before the period ends. Manage or cancel in your Apple ID
        settings. <Link href="/terms" className="underline">Terms of Use</Link> ·{' '}
        <Link href="/privacy" className="underline">Privacy Policy</Link>
      </p>
    </div>
  );
}
