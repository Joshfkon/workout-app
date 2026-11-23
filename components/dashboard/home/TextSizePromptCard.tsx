'use client';

/**
 * One-time "Text too small?" card on Home, for accounts that never saw the
 * onboarding step where text size is offered.
 *
 * Shown only while no size was ever picked (none on this device — see
 * hasChosenTextSize — and none saved on the account) and the card was never
 * closed. Picking a size saves it, so the card does not come back; it stays
 * up for the rest of this visit so the sizes can be compared, with a Done
 * button. Closing it is remembered per user (users.preferences, plus this
 * device's localStorage so it stays closed offline).
 */

import { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { useUserStore } from '@/stores/userStore';
import { createUntypedClient } from '@/lib/supabase/client';
import { savePreferencesPatch } from '@/lib/settings/savePreferencesPatch';
import { hasChosenTextSize } from '@/hooks/useTextSize';
import { isTextSize } from '@/lib/textSize';
import { TextSizeQuickPicker } from '@/components/settings/TextSizeQuickPicker';

export const TEXT_SIZE_PROMPT_DISMISSED_KEY = 'textSizePromptDismissed';

function dismissedOnDevice(userId: string): boolean {
  try {
    return localStorage.getItem(`${TEXT_SIZE_PROMPT_DISMISSED_KEY}:${userId}`) === '1';
  } catch {
    return false;
  }
}

export function TextSizePromptCard() {
  const userId = useUserStore((s) => s.user?.id ?? null);
  const savedSize = useUserStore((s) => s.user?.preferences.textSize);
  const dismissedOnAccount = useUserStore((s) => s.user?.preferences.textSizePromptDismissed === true);
  // Read after mount (localStorage): null until then, so the server render
  // and first client render agree (nothing shown).
  const [chosenAtMount, setChosenAtMount] = useState<boolean | null>(null);
  const [dismissedHere, setDismissedHere] = useState(false);
  const [pickedHere, setPickedHere] = useState(false);

  useEffect(() => {
    setChosenAtMount(hasChosenTextSize());
  }, []);

  if (!userId || chosenAtMount === null || dismissedHere) return null;
  const eligible =
    !chosenAtMount && !isTextSize(savedSize) && !dismissedOnAccount && !dismissedOnDevice(userId);
  if (!pickedHere && !eligible) return null;

  const dismiss = () => {
    setDismissedHere(true);
    if (pickedHere) return; // A picked size already retires the card.
    try {
      localStorage.setItem(`${TEXT_SIZE_PROMPT_DISMISSED_KEY}:${userId}`, '1');
    } catch {}
    useUserStore.getState().updatePreferences({ textSizePromptDismissed: true });
    void savePreferencesPatch(createUntypedClient(), userId, { textSizePromptDismissed: true }).catch(
      () => {}
    );
  };

  return (
    <section
      className="rounded-card bg-card shadow-card px-4 py-3"
      aria-label="Text size"
      data-testid="text-size-prompt"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-ink">Text too small?</h2>
          <p className="text-subhead text-ink-2">
            {pickedHere ? 'Saved. You can change it any time in Settings.' : 'Make it bigger.'}
          </p>
        </div>
        {!pickedHere && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close text size card"
            data-testid="text-size-prompt-dismiss"
            className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-ink-2"
          >
            <IconX size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <TextSizeQuickPicker onPick={() => setPickedHere(true)} />
        {pickedHere && (
          <button
            type="button"
            onClick={dismiss}
            data-testid="text-size-prompt-done"
            className="min-h-[44px] rounded-button px-3 text-subhead font-semibold text-action"
          >
            Done
          </button>
        )}
      </div>
    </section>
  );
}
