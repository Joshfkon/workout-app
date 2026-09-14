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
      {/* BILLING & SUBSCRIPTION (surfaced to top) */}
      <SubscriptionCard />

      {/* Install App */}
      <InstallAppCard />

      {/* DATA MANAGEMENT */}
      <ImportExportSettings />

      {/* MAINTENANCE & SETUP */}
      <Card>
        <CardHeader>
          <CardTitle>Maintenance & Setup</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Onboarding, calibration, and promo codes
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
                Calibrate
              </Button>
            </Link>
          </div>

          {/* Promo Code Redemption (standardized, no gradient) */}
          <div className="p-4 bg-surface-800/50 rounded-lg border border-surface-700">
            <p className="text-sm font-medium text-surface-200 mb-1">Redeem Promo Code</p>
            <p className="text-xs text-surface-500 mb-3">Have a promo code? Enter it below to unlock premium features.</p>

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

      {/* Legal - moved above danger zone for better separation */}
      <div className="text-center text-xs text-surface-500 space-x-3 py-4">
        <Link href="/privacy" className="hover:text-surface-300 underline">
          Privacy Policy
        </Link>
        <Link href="/terms" className="hover:text-surface-300 underline">
          Terms of Service
        </Link>
      </div>

      {/* DANGER ZONE - clearly separated at bottom */}
      <div className="pt-4 border-t-2 border-danger-500/20">
        <DeleteAccountCard />
      </div>
    </div>
  );
}
