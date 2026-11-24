/**
 * App Store subscriptions on iOS (StoreKit 2, through the local
 * HyperTrackPurchases plugin in ios/App/App/HyperTrackPurchasesPlugin.swift).
 *
 * The app loads the web build from the server, so a web deploy can reach an
 * installed app that predates the plugin. Everything here checks
 * `isApplePurchasesAvailable()` first; without it the iOS screens keep their
 * old "plans are managed on the web" state.
 *
 * Nothing is unlocked on the device: every signed transaction goes to
 * /api/apple/sync, which verifies Apple's signature and updates the account.
 */
import { createUntypedClient } from '@/lib/supabase/client';
import { APPLE_PRODUCT_IDS } from '@/lib/apple/iapProducts';
import { Capacitor, getPlatform, isNativePlatform } from './capacitor-stub';

export interface AppleStoreProduct {
  id: string;
  displayName: string;
  description: string;
  /** Localized, e.g. "$4.99". Always show this, never a hardcoded price. */
  displayPrice: string;
  price: number;
  currencyCode: string;
  period?: { unit: 'day' | 'week' | 'month' | 'year' | 'unknown'; value: number };
  introOffer?: { displayPrice: string; paymentMode: string };
}

export type ApplePurchaseOutcome =
  | { status: 'success'; tier: string; currentPeriodEnd: string | null }
  | { status: 'cancelled' | 'pending' }
  | { status: 'error'; message: string };

interface PurchasesPlugin {
  getProducts(o: { productIds: readonly string[] }): Promise<{ products: AppleStoreProduct[] }>;
  purchase(o: { productId: string; appAccountToken: string }): Promise<{ status: string; jws?: string }>;
  currentEntitlements(): Promise<{ transactions: string[] }>;
  restore(): Promise<{ transactions: string[] }>;
  manageSubscriptions(): Promise<void>;
  addListener(event: 'transaction', cb: (e: { jws: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

const PLUGIN = 'HyperTrackPurchases';
let plugin: PurchasesPlugin | null = null;

export function isApplePurchasesAvailable(): boolean {
  if (!isNativePlatform() || getPlatform() !== 'ios') return false;
  try {
    return Capacitor.isPluginAvailable(PLUGIN);
  } catch {
    return false;
  }
}

function getPlugin(): PurchasesPlugin | null {
  if (!isApplePurchasesAvailable()) return null;
  if (plugin) return plugin;
  try {
    const { registerPlugin } = require('@capacitor/core');
    plugin = registerPlugin(PLUGIN) as PurchasesPlugin;
    return plugin;
  } catch {
    return null;
  }
}

/** Test hook: forget the cached plugin proxy. */
export function __resetApplePurchasesForTests(): void {
  plugin = null;
}

export async function getAppleProducts(): Promise<AppleStoreProduct[]> {
  const p = getPlugin();
  if (!p) return [];
  const { products } = await p.getProducts({ productIds: APPLE_PRODUCT_IDS });
  return products;
}

interface SyncResponse {
  applied: boolean;
  tier?: string;
  currentPeriodEnd?: string | null;
  reason?: string;
  message?: string;
}

/** Send signed transactions to the server, which verifies and records them. */
export async function syncAppleTransactions(transactions: string[]): Promise<SyncResponse> {
  if (transactions.length === 0) return { applied: false, reason: 'no_transactions' };
  const supabase = createUntypedClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { applied: false, reason: 'signed_out', message: 'Sign in to use your subscription.' };
  const res = await fetch('/api/apple/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ transactions }),
  });
  try {
    return (await res.json()) as SyncResponse;
  } catch {
    return { applied: false, reason: 'server', message: 'Could not reach HyperTrack. Try Restore purchases in a moment.' };
  }
}

export async function buyAppleSubscription(productId: string, accountId: string): Promise<ApplePurchaseOutcome> {
  const p = getPlugin();
  if (!p) return { status: 'error', message: 'In-app purchase needs the latest version of the app.' };
  try {
    const r = await p.purchase({ productId, appAccountToken: accountId });
    if (r.status === 'cancelled' || r.status === 'pending') return { status: r.status };
    if (r.status !== 'success' || !r.jws) return { status: 'error', message: 'The purchase did not complete.' };
    const synced = await syncAppleTransactions([r.jws]);
    if (!synced.applied) {
      return { status: 'error', message: synced.message ?? 'Your purchase went through, but we could not activate it yet. Tap Restore purchases.' };
    }
    return { status: 'success', tier: synced.tier ?? 'pro', currentPeriodEnd: synced.currentPeriodEnd ?? null };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Purchase failed.' };
  }
}

/** Restore button: asks the App Store, then syncs what it returns. */
export async function restoreApplePurchases(): Promise<SyncResponse> {
  const p = getPlugin();
  if (!p) return { applied: false, reason: 'unavailable' };
  const { transactions } = await p.restore();
  if (transactions.length === 0) {
    return { applied: false, reason: 'none', message: 'No App Store subscription found for this Apple ID.' };
  }
  return syncAppleTransactions(transactions);
}

/** Quiet launch-time check: sync whatever the device already holds. */
export async function syncCurrentAppleEntitlements(): Promise<SyncResponse | null> {
  const p = getPlugin();
  if (!p) return null;
  const { transactions } = await p.currentEntitlements();
  if (transactions.length === 0) return null;
  return syncAppleTransactions(transactions);
}

/** Renewals, Ask to Buy approvals and other-device purchases, as they arrive. */
export async function onAppleTransaction(cb: (r: SyncResponse) => void): Promise<() => void> {
  const p = getPlugin();
  if (!p) return () => {};
  const handle = await p.addListener('transaction', async ({ jws }) => cb(await syncAppleTransactions([jws])));
  return () => {
    void handle.remove();
  };
}

export async function manageAppleSubscriptions(): Promise<void> {
  await getPlugin()?.manageSubscriptions();
}
