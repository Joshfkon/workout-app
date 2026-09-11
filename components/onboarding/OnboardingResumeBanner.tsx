'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { 
  getOnboardingProgress, 
  STEP_LABELS,
  getStepProgressPercentage,
  type OnboardingStep 
} from '@/lib/onboarding/onboardingProgress';

/**
 * Banner that appears on dashboard when onboarding is incomplete
 * Shows user's progress and provides a clear CTA to resume
 */
export function OnboardingResumeBanner() {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [resumeRoute, setResumeRoute] = useState('/onboarding');
  const [currentStep, setCurrentStep] = useState<OnboardingStep | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    async function checkOnboardingStatus() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setIsLoading(false);
        return;
      }

      const progress = await getOnboardingProgress(supabase, user.id);

      if (!progress.isComplete && progress.currentStep) {
        setIsVisible(true);
        setResumeRoute(progress.resumeRoute);
        setCurrentStep(progress.currentStep);
      }

      setIsLoading(false);
    }

    checkOnboardingStatus();
  }, []);

  const handleResume = () => {
    router.push(resumeRoute);
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    // Note: This is just a UI dismissal, not persistent
    // User can still see banner on next page load if onboarding incomplete
  };

  if (isLoading || !isVisible || isDismissed) {
    return null;
  }

  const progressPercentage = getStepProgressPercentage(currentStep);
  const nextStepLabel = currentStep 
    ? STEP_LABELS[currentStep] 
    : 'Get Started';

  return (
    <div className="fixed bottom-20 left-0 right-0 z-40 px-4 lg:left-64 lg:bottom-4 animate-slide-up">
      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-r from-primary-500 to-accent-500 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-4 sm:p-6">
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <svg 
                    className="w-6 h-6 text-white" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M13 10V3L4 14h7v7l9-11h-7z" 
                    />
                  </svg>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      Complete Your Setup
                    </h3>
                    <p className="text-sm text-white/90 mt-0.5">
                      You&apos;re {progressPercentage}% done! Let&apos;s finish setting up your profile.
                    </p>
                  </div>

                  {/* Dismiss button */}
                  <button
                    onClick={handleDismiss}
                    className="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 transition-colors"
                    aria-label="Dismiss"
                  >
                    <svg 
                      className="w-5 h-5 text-white/80" 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M6 18L18 6M6 6l12 12" 
                      />
                    </svg>
                  </button>
                </div>

                {/* Progress bar */}
                <div className="mb-3">
                  <div className="h-2 bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
                    <div 
                      className="h-full bg-white transition-all duration-500"
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>
                </div>

                {/* CTA */}
                <button
                  onClick={handleResume}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white text-primary-600 rounded-lg font-medium hover:bg-white/90 transition-colors"
                >
                  Continue Setup
                  <svg 
                    className="w-4 h-4" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M13 7l5 5m0 0l-5 5m5-5H6" 
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
