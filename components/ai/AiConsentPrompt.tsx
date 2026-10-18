'use client';

/**
 * One-time "Allow AI features?" prompt (App Store Review Guideline 5.1.2(i)).
 * Shown once per user, from the dashboard shell, while their choice is still
 * NULL. Either answer is saved, so it never shows again; the user can change
 * it later in Settings → Profile (AiDataSharingCard). Not shown on the active
 * workout screen, so it never interrupts a set.
 */

import { useEffect, useState } from 'react';
import { Button, Modal, ModalFooter } from '@/components/ui';
import { AiDataSharingDetails } from '@/components/ai/AiDataSharingDetails';
import {
  getAiDataSharingConsent,
  setAiDataSharingConsent,
} from '@/lib/actions/ai-consent';

export function AiConsentPrompt({ suppressed }: { suppressed: boolean }) {
  const [needsAnswer, setNeedsAnswer] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiDataSharingConsent()
      .then((consent) => {
        if (!cancelled && consent === null) setNeedsAnswer(true);
      })
      .catch((err) => console.error('Failed to load AI consent:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const answer = async (allowed: boolean) => {
    setIsSaving(true);
    setError(null);
    const result = await setAiDataSharingConsent(allowed).catch(() => null);
    setIsSaving(false);
    if (result?.ok) {
      setNeedsAnswer(false);
    } else {
      setError(result && !result.ok ? result.error : 'Failed to save. Please try again.');
    }
  };

  return (
    <Modal
      isOpen={needsAnswer && !suppressed}
      // Dismissing without answering just hides it for this visit; it asks
      // again next time since nothing was saved.
      onClose={() => setNeedsAnswer(false)}
      title="Allow AI features?"
      size="md"
    >
      <div data-testid="ai-consent-prompt">
        <AiDataSharingDetails />
        {error && <p className="mt-3 text-xs text-danger-400">{error}</p>}
        <ModalFooter>
          <Button variant="ghost" onClick={() => answer(false)} disabled={isSaving}>
            Don&apos;t allow
          </Button>
          <Button onClick={() => answer(true)} disabled={isSaving}>
            Allow
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
