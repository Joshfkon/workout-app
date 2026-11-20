'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { usePWA } from '@/hooks/usePWA';
import { persistEnhancedAthleteMode } from '@/lib/training/enhancedAthleteMode';
import { updateOnboardingStep, completeOnboarding } from '@/lib/onboarding/onboardingProgress';

/**
 * Onboarding: Enhanced Athlete Mode — asked right after training experience.
 * Writes the SAME persisted profile field as the Settings toggle
 * (users.enhanced_athlete_mode); there is no separate onboarding state.
 * Skipping the step leaves the mode off (the column defaults to false).
 * The first mesocycle generated after onboarding reads this flag.
 */
function EnhancedModeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const { shouldShowInOnboarding } = usePWA();

  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goToNextStep = async () => {
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      // Track enhanced step completion
      await updateOnboardingStep(supabase, user.id, 'enhanced');
      
      // If PWA install should show, go there; otherwise mark onboarding complete
      if (shouldShowInOnboarding()) {
        await updateOnboardingStep(supabase, user.id, 'install');
        router.push(`/onboarding/install?session=${sessionId}`);
      } else {
        // No install step - mark onboarding as complete
        await completeOnboarding(supabase, user.id);
        router.push('/dashboard');
      }
    } else {
      // Fallback if no user
      if (shouldShowInOnboarding()) {
        router.push(`/onboarding/install?session=${sessionId}`);
      } else {
        router.push('/dashboard');
      }
    }
  };

  const handleContinue = async () => {
    setSaving(true);
    setError(null);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      await persistEnhancedAthleteMode(supabase, user.id, enabled);
      goToNextStep();
    } catch (err) {
      console.error('Failed to save Enhanced Athlete Mode:', err);
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4, 5].map((step) => (
          <div
            key={step}
            className={`w-2 h-2 rounded-full ${
              step <= 5 ? 'bg-action' : 'bg-sep'
            }`}
          />
        ))}
      </div>

      <div className="text-center">
        <h1 className="text-title font-bold text-ink">Enhanced athlete mode</h1>
        <p className="mt-2 text-ink-2 max-w-md mx-auto">
          PEDs significantly increase recovery capacity. HyperTrack raises your volume
          ceiling accordingly. Joint-stress limits stay unchanged to protect connective
          tissue. You can change this anytime in Settings.
        </p>
      </div>

      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p className="text-body font-medium text-ink">I use performance enhancing drugs</p>
              <p className="text-caption text-ink-3 mt-0.5">
                Off by default. This only affects training volume programming.
              </p>
            </div>
            <Toggle checked={enabled} onChange={setEnabled} disabled={saving} />
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-body text-status-bad text-center">{error}</p>}

      <div className="flex flex-col gap-3">
        <Button onClick={handleContinue} isLoading={saving} className="w-full">
          Continue
        </Button>
        <button
          onClick={goToNextStep}
          disabled={saving}
          className="text-body text-ink-3 hover:text-ink-2 transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

export default function EnhancedModePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="w-8 h-8 border-4 border-action border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <EnhancedModeContent />
    </Suspense>
  );
}
