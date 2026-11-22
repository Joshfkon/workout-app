'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { completeOnboarding } from '@/lib/onboarding/onboardingProgress';

/**
 * Header "Skip for now". Before the goal is saved (the /onboarding steps) it
 * is a plain link: setup isn't done, so the dashboard's resume banner should
 * offer to finish it. On every later page (benchmarks onward) the essentials
 * are saved, so skipping finishes onboarding in the same tap; otherwise it
 * lands on the dashboard with a "Complete your setup" banner to dismiss.
 */
function SkipLink() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const className = 'text-body text-ink-2 hover:text-ink transition-colors';
  const pastGoalStep = pathname.startsWith('/onboarding/');

  if (!pastGoalStep) {
    return (
      <Link href="/dashboard" className={className}>
        Skip for now →
      </Link>
    );
  }

  const skip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await completeOnboarding(supabase, user.id);
    } catch {
      // Best-effort: the worst case is the setup banner showing once.
    }
    router.push('/dashboard');
  };

  return (
    <button type="button" onClick={skip} disabled={busy} className={className} data-testid="header-skip-onboarding">
      Skip for now →
    </button>
  );
}

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 px-4 bg-canvas/80 backdrop-blur-lg border-b border-sep">
        <div className="max-w-4xl mx-auto h-full flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-lg bg-action flex items-center justify-center group-hover:scale-105 transition-transform">
              <svg className="w-5 h-5 text-on-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-headline font-bold text-ink">HyperTrack</span>
          </Link>
          
          <SkipLink />
        </div>
      </header>

      {/* Main content */}
      <main className="pt-16 min-h-screen">
        <div className="max-w-4xl mx-auto px-4 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

