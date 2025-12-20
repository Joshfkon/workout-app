'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AddToHomescreenGuide } from '@/components/onboarding/AddToHomescreenGuide';
import { usePWA } from '@/hooks/usePWA';

function InstallContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const { pwaContext, shouldShowInOnboarding, isLoading } = usePWA();

  // Redirect to dashboard if already installed or shouldn't show
  useEffect(() => {
    if (!isLoading && !shouldShowInOnboarding()) {
      router.push('/dashboard');
    }
  }, [isLoading, shouldShowInOnboarding, router]);

  const handleComplete = () => {
    router.push('/dashboard');
  };

  const handleSkip = () => {
    router.push('/dashboard');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // If already installed or completed, this shouldn't render but just in case
  if (!shouldShowInOnboarding()) {
    return null;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4, 5].map((step) => (
          <div key={step} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step <= 4
                ? 'bg-primary-500 text-white'
                : step === 5
                ? 'bg-primary-500/50 text-white border-2 border-primary-400'
                : 'bg-surface-800 text-surface-500'
            }`}>
              {step < 5 ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                step
              )}
            </div>
            {step < 5 && (
              <div className={`w-8 sm:w-12 h-0.5 ${step < 5 ? 'bg-primary-500' : 'bg-surface-800'}`} />
            )}
          </div>
        ))}
      </div>

      <AddToHomescreenGuide
        onComplete={handleComplete}
        onSkip={handleSkip}
        showSkipOption={true}
      />
    </div>
  );
}

export default function InstallPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <InstallContent />
    </Suspense>
  );
}
