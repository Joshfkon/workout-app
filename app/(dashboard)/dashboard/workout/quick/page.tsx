'use client';

/**
 * /dashboard/workout/quick — confirm screen for starting an ad-hoc workout.
 *
 * P0-1 (UX audit): this page previously INSERTED a workout session in a
 * mount effect, so merely visiting the URL (prefetch, bookmark, back-button,
 * crawler) created sessions and hijacked the Home/Train "Continue" cards.
 * Session creation now only happens behind the explicit Start tap, via the
 * same getOrCreateTodaySession used by the Blank-workout launcher.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBarbell, IconLoader2 } from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { Button, Card } from '@/components/ui';
import {
  findTodayAdhocSession,
  getOrCreateTodaySession,
} from '../_lib/adhocSession';

export default function QuickWorkoutPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [existing, setExisting] = useState<{ sessionId: string; hasLoggedSets: boolean } | null>(null);
  const supabase = createUntypedClient();

  // Read-only lookup so the CTA can say Continue vs Start. No writes here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push('/login');
          return;
        }
        const found = await findTodayAdhocSession(supabase, user.id);
        if (!cancelled) setExisting(found);
      } catch {
        // Lookup is best-effort; the Start tap re-resolves everything.
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async () => {
    if (isStarting) return;
    setIsStarting(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { sessionId } = await getOrCreateTodaySession(supabase, user.id);
      router.replace(`/dashboard/workout/${sessionId}?fromCreate=true`);
    } catch (err) {
      console.error('Failed to start quick workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStarting(false);
    }
  };

  const continuing = Boolean(existing?.hasLoggedSets);

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <Card variant="elevated" className="p-6 w-full max-w-sm text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-primary-500/15 flex items-center justify-center">
          <IconBarbell size={28} className="text-primary-400" />
        </div>
        <h1 className="text-xl font-bold text-surface-100">
          {continuing ? 'Continue today’s workout?' : 'Start a quick workout?'}
        </h1>
        <p className="text-sm text-surface-400 mt-2">
          {continuing
            ? 'You already have a workout in progress today — pick up where you left off.'
            : 'Opens an empty session. Add exercises as you go.'}
        </p>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
            <p className="text-sm text-danger-400">{error}</p>
          </div>
        )}

        <Button
          className="w-full mt-6 min-h-[48px]"
          onClick={handleStart}
          disabled={isStarting || isChecking}
        >
          {isStarting ? (
            <span className="inline-flex items-center gap-2">
              <IconLoader2 size={18} className="animate-spin" /> Starting…
            </span>
          ) : continuing ? 'Continue workout' : 'Start workout'}
        </Button>
        <Button
          variant="ghost"
          className="w-full mt-2 min-h-[44px] text-surface-400"
          onClick={() => router.push('/dashboard/log')}
          disabled={isStarting}
        >
          Cancel
        </Button>
      </Card>
    </div>
  );
}
