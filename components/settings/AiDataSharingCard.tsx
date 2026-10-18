'use client';

/**
 * AI Features settings card: turns third-party AI data sharing on or off
 * (users.ai_data_sharing_consent). The AI server actions check the same
 * column (lib/ai/consent.ts), so turning this off stops all data going to
 * xAI and Anthropic.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Toggle } from '@/components/ui';
import { AiDataSharingDetails } from '@/components/ai/AiDataSharingDetails';
import {
  getAiDataSharingConsent,
  setAiDataSharingConsent,
} from '@/lib/actions/ai-consent';

export function AiDataSharingCard() {
  const [enabled, setEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiDataSharingConsent()
      .then((consent) => {
        if (!cancelled) setEnabled(consent === true);
      })
      .catch((err) => console.error('Failed to load AI consent:', err))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (value: boolean) => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    const result = await setAiDataSharingConsent(value).catch(() => null);
    if (result?.ok) {
      setEnabled(value);
    } else {
      setError(result && !result.ok ? result.error : 'Failed to save. Please try again.');
    }
    setIsSaving(false);
  };

  return (
    <Card data-testid="ai-data-sharing-card">
      <CardHeader>
        <CardTitle>AI Features</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <AiDataSharingDetails />
          <Toggle checked={enabled} onChange={persist} disabled={isLoading || isSaving} />
        </div>
        {error && <p className="text-xs text-danger-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
