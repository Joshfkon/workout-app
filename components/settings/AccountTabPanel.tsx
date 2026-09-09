'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import { InstallAppCard } from '@/components/settings/InstallAppCard';
import { SubscriptionCard } from '@/components/settings/SubscriptionCard';
import { ImportExportSettings } from '@/components/settings/ImportExportSettings';
import { DeleteAccountCard } from '@/components/settings/DeleteAccountCard';
import { redeemPromoCode } from '@/lib/actions/promoCodes';

export function AccountTabPanel() {
  // Promo code state
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoResult, setPromoResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleRedeemPromo = async () => {
    if (!promoCode.trim()) return;

    setPromoLoading(true);
    setPromoResult(null);

    try {
      const result = await redeemPromoCode(promoCode);
      setPromoResult(result);

      if (result.success) {
        setPromoCode('');
        // Clear subscription cache and refresh to show updated subscription
        setTimeout(() => {
          sessionStorage.removeItem('subscription_data');
          window.location.reload();
        }, 2000);
      }
    } catch {
      setPromoResult({ success: false, message: 'An error occurred. Please try again.' });
    } finally {
      setPromoLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Install App */}
      <InstallAppCard />

      {/* Subscription Management */}
      <SubscriptionCard />

      {/* Account & Setup */}
      <Card>
        <CardHeader>
          <CardTitle>Account & Setup</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Re-run the setup wizard or manage your account
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-surface-200">Setup Wizard</p>
              <p className="text-xs text-surface-500">Re-run the onboarding process to update your profile</p>
            </div>
            <Link href="/onboarding">
              <Button variant="outline" size="sm">
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-run Setup
              </Button>
            </Link>
          </div>
          
          <div className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-surface-200">Strength Calibration</p>
              <p className="text-xs text-surface-500">Update your benchmark lifts for better weight recommendations</p>
            </div>
            <Link href="/onboarding/calibrate">
              <Button variant="outline" size="sm">
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Calibrate
              </Button>
            </Link>
          </div>

          {/* Promo Code Redemption */}
          <div className="p-4 bg-gradient-to-r from-primary-500/10 to-accent-500/10 rounded-lg border border-primary-500/20">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
              </svg>
              <p className="text-sm font-medium text-surface-200">Redeem Promo Code</p>
            </div>
            <p className="text-xs text-surface-400 mb-3">Have a promo code? Enter it below to unlock premium features.</p>

            <div className="flex gap-2">
              <Input
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="Enter code (e.g., FAMILY-ELITE-001)"
                className="flex-1 uppercase"
                disabled={promoLoading}
              />
              <Button
                onClick={handleRedeemPromo}
                disabled={!promoCode.trim() || promoLoading}
                isLoading={promoLoading}
              >
                Redeem
              </Button>
            </div>

            {promoResult && (
              <div className={`mt-3 p-3 rounded-lg text-sm ${
                promoResult.success
                  ? 'bg-success-500/10 border border-success-500/20 text-success-400'
                  : 'bg-danger-500/10 border border-danger-500/20 text-danger-400'
              }`}>
                {promoResult.message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Import & Export */}
      <ImportExportSettings />

      {/* Legal */}
      <div className="text-center text-xs text-surface-500 space-x-3">
        <Link href="/privacy" className="hover:text-surface-300 underline">
          Privacy Policy
        </Link>
        <Link href="/terms" className="hover:text-surface-300 underline">
          Terms of Service
        </Link>
      </div>

      {/* Danger Zone — account deletion (App Store Guideline 5.1.1(v)) */}
      <DeleteAccountCard />
    </div>
  );
}
