'use client';

/**
 * Ask-at-first-use gate for third-party AI data sharing (App Store Review
 * Guideline 5.1.2(i)).
 *
 * The "Allow AI features?" sheet used to open on dashboard load. It now opens
 * only when the user taps an AI feature (coach chat, meal Describe, label AI
 * scan, progress-photo body-fat estimate, AI exercise completion) and has
 * never answered. Every such entry point awaits `ensureAiConsent()` from
 * `useAiConsentGate()` BEFORE calling its server action:
 *
 *   - already allowed  -> resolves true at once (no sheet)
 *   - already declined -> resolves false and shows the "turn it on in
 *                         Settings → Profile" note
 *   - never answered   -> opens the sheet; Allow saves and resolves true so
 *                         the feature continues, Don't allow saves and
 *                         resolves false with the note, dismissing saves
 *                         nothing and resolves false (asked again next time)
 *
 * This is the UX half only. The authority is server-side: every AI action
 * calls hasAiDataSharingConsent() (lib/ai/consent.ts) and refuses to reach a
 * provider without an explicit TRUE, whatever the client did.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, ModalFooter, ToastContainer, useToasts } from '@/components/ui';
import { AiDataSharingDetails } from '@/components/ai/AiDataSharingDetails';
import {
  getAiDataSharingConsent,
  setAiDataSharingConsent,
  type AiDataSharingConsent,
} from '@/lib/actions/ai-consent';
import { setBlockingPromptOpen } from '@/lib/ui/blockingPrompt';
import { subscribeAiConsent } from '@/components/ai/aiConsentBus';

/** Shown when the user declines (now or earlier) and taps an AI feature. */
export const AI_DECLINED_NOTE =
  'AI features are off, so nothing was sent. You can turn them on anytime in Settings → Profile.';

/** Resolves true when the feature may go ahead and call its AI action. */
export type EnsureAiConsent = () => Promise<boolean>;

const AiConsentContext = createContext<EnsureAiConsent | null>(null);

/**
 * Outside the provider there is no sheet to show, so only an explicit,
 * already-recorded TRUE lets a feature proceed.
 */
const ensureWithoutProvider: EnsureAiConsent = async () => {
  try {
    return (await getAiDataSharingConsent()) === true;
  } catch {
    return false;
  }
};

/** The gate for AI entry points. Await it before calling an AI server action. */
export function useAiConsentGate(): EnsureAiConsent {
  return useContext(AiConsentContext) ?? ensureWithoutProvider;
}

export function AiConsentProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // undefined = not read yet this session. Read lazily, on the first AI tap —
  // never on dashboard load.
  const consentRef = useRef<AiDataSharingConsent | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The pending ask; concurrent taps share it.
  const pendingRef = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(
    null
  );
  const { toasts, addToast, dismissToast } = useToasts();

  // Settings toggle flips the choice: keep the cache in step.
  useEffect(() => subscribeAiConsent((consent) => (consentRef.current = consent)), []);

  // Leaving the dashboard mid-ask: the feature never starts.
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  // Tips and the setup card wait while the sheet is up (lib/ui/blockingPrompt).
  useEffect(() => {
    setBlockingPromptOpen(isOpen);
    return () => setBlockingPromptOpen(false);
  }, [isOpen]);

  const showDeclinedNote = useCallback(() => {
    addToast('info', AI_DECLINED_NOTE, 6000, {
      label: 'Settings',
      onClick: () => router.push('/dashboard/settings'),
    });
  }, [addToast, router]);

  const settle = useCallback((ok: boolean) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setIsOpen(false);
    setError(null);
    pending?.resolve(ok);
  }, []);

  const ensureAiConsent = useCallback<EnsureAiConsent>(async () => {
    if (pendingRef.current) return pendingRef.current.promise;

    if (consentRef.current === undefined) {
      try {
        consentRef.current = await getAiDataSharingConsent();
      } catch (err) {
        // Couldn't read the choice (offline, …). Let the feature try: its
        // server action re-checks consent and refuses without a TRUE, so
        // nothing reaches a provider either way.
        console.error('Failed to load AI consent:', err);
        return true;
      }
    }

    if (consentRef.current === true) return true;
    if (consentRef.current === false) {
      showDeclinedNote();
      return false;
    }

    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    pendingRef.current = { promise, resolve };
    setError(null);
    setIsOpen(true);
    return promise;
  }, [showDeclinedNote]);

  const answer = async (allowed: boolean) => {
    setIsSaving(true);
    setError(null);
    const result = await setAiDataSharingConsent(allowed).catch(() => null);
    setIsSaving(false);
    if (!result?.ok) {
      setError(result && !result.ok ? result.error : 'Failed to save. Please try again.');
      return;
    }
    consentRef.current = allowed;
    settle(allowed);
    if (!allowed) showDeclinedNote();
  };

  const value = useMemo(() => ensureAiConsent, [ensureAiConsent]);

  return (
    <AiConsentContext.Provider value={value}>
      {children}
      <Modal
        isOpen={isOpen}
        // Dismissing without answering saves nothing and doesn't start the
        // feature; the next AI tap asks again.
        onClose={() => {
          if (!isSaving) settle(false);
        }}
        title="Allow AI features?"
        size="md"
      >
        <div data-testid="ai-consent-prompt">
          <AiDataSharingDetails />
          {error && <p className="mt-3 text-caption text-status-bad">{error}</p>}
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
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </AiConsentContext.Provider>
  );
}
