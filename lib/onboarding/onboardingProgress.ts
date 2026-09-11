/**
 * Onboarding progress tracking utilities
 * 
 * Tracks user progress through the multi-step onboarding flow and provides
 * utilities for resuming from the last completed step.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Onboarding step identifiers in chronological order
 */
export type OnboardingStep = 
  | 'units'       // Unit selection (imperial/metric)
  | 'body_comp'   // Body composition input
  | 'goal'        // Training goal selection
  | 'benchmarks'  // Benchmark lift selection
  | 'calibrate'   // Strength calibration testing
  | 'complete'    // Results review
  | 'profile'     // Profile setup (username, bio, etc.)
  | 'enhanced'    // Enhanced athlete mode
  | 'install';    // PWA installation prompt

/**
 * Ordered list of onboarding steps
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  'units',
  'body_comp',
  'goal',
  'benchmarks',
  'calibrate',
  'complete',
  'profile',
  'enhanced',
  'install'
];

/**
 * Map steps to their route paths
 */
export const STEP_ROUTES: Record<OnboardingStep, string> = {
  units: '/onboarding',
  body_comp: '/onboarding',
  goal: '/onboarding',
  benchmarks: '/onboarding/benchmarks',
  calibrate: '/onboarding/calibrate',
  complete: '/onboarding/complete',
  profile: '/onboarding/profile',
  enhanced: '/onboarding/enhanced',
  install: '/onboarding/install'
};

/**
 * Human-readable labels for each step
 */
export const STEP_LABELS: Record<OnboardingStep, string> = {
  units: 'Unit Selection',
  body_comp: 'Body Composition',
  goal: 'Training Goal',
  benchmarks: 'Benchmark Selection',
  calibrate: 'Strength Testing',
  complete: 'Results',
  profile: 'Profile Setup',
  enhanced: 'Enhanced Mode',
  install: 'Install App'
};

/**
 * Get the next step after the given step
 */
export function getNextStep(currentStep: OnboardingStep | null): OnboardingStep | null {
  if (!currentStep) return 'units';
  
  const currentIndex = ONBOARDING_STEPS.indexOf(currentStep);
  if (currentIndex === -1 || currentIndex === ONBOARDING_STEPS.length - 1) {
    return null; // Last step or invalid step
  }
  
  return ONBOARDING_STEPS[currentIndex + 1];
}

/**
 * Get the route path for resuming onboarding from a given step
 * 
 * @param step - The last completed step (will resume at next step)
 * @param sessionId - Optional session ID to include in query params
 */
export function getResumeRoute(step: OnboardingStep | null, sessionId?: string): string {
  const nextStep = getNextStep(step);
  
  if (!nextStep) {
    // All steps completed
    return '/dashboard';
  }
  
  const route = STEP_ROUTES[nextStep];
  
  // Add session ID if provided and if the step needs it
  if (sessionId && ['benchmarks', 'calibrate', 'complete', 'profile', 'enhanced', 'install'].includes(nextStep)) {
    return `${route}?session=${sessionId}`;
  }
  
  return route;
}

/**
 * Update user's onboarding step progress
 */
export async function updateOnboardingStep(
  supabase: SupabaseClient,
  userId: string,
  step: OnboardingStep
): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase
      .from('users')
      .update({ onboarding_step: step })
      .eq('id', userId);
    
    if (error) {
      console.error('Failed to update onboarding step:', error);
      return { error };
    }
    
    return { error: null };
  } catch (err) {
    console.error('Failed to update onboarding step:', err);
    return { error: err as Error };
  }
}

/**
 * Mark onboarding as complete
 */
export async function completeOnboarding(
  supabase: SupabaseClient,
  userId: string
): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase
      .from('users')
      .update({ 
        onboarding_completed: true,
        onboarding_step: null // Clear step when completed
      })
      .eq('id', userId);
    
    if (error) {
      console.error('Failed to complete onboarding:', error);
      return { error };
    }
    
    return { error: null };
  } catch (err) {
    console.error('Failed to complete onboarding:', err);
    return { error: err as Error };
  }
}

/**
 * Get user's current onboarding progress
 */
export async function getOnboardingProgress(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  isComplete: boolean;
  currentStep: OnboardingStep | null;
  resumeRoute: string;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('onboarding_completed, onboarding_step')
      .eq('id', userId)
      .single();
    
    if (error) {
      console.error('Failed to get onboarding progress:', error);
      return {
        isComplete: false,
        currentStep: null,
        resumeRoute: '/onboarding',
        error
      };
    }
    
    const isComplete = data?.onboarding_completed ?? false;
    const currentStep = (data?.onboarding_step as OnboardingStep) ?? null;
    
    // Get session ID if user has an in-progress coaching session
    let sessionId: string | undefined;
    if (!isComplete && currentStep && ['benchmarks', 'calibrate', 'complete', 'profile', 'enhanced', 'install'].includes(currentStep)) {
      const { data: sessionData } = await supabase
        .from('coaching_sessions')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      sessionId = sessionData?.id;
    }
    
    const resumeRoute = getResumeRoute(currentStep, sessionId);
    
    return {
      isComplete,
      currentStep,
      resumeRoute,
      error: null
    };
  } catch (err) {
    console.error('Failed to get onboarding progress:', err);
    return {
      isComplete: false,
      currentStep: null,
      resumeRoute: '/onboarding',
      error: err as Error
    };
  }
}

/**
 * Check if a step should be skippable
 * 
 * Some steps like 'install' can be skipped without breaking the flow
 */
export function isStepSkippable(step: OnboardingStep): boolean {
  return step === 'install' || step === 'enhanced';
}

/**
 * Get progress percentage for a given step (0-100)
 */
export function getStepProgressPercentage(step: OnboardingStep | null): number {
  if (!step) return 0;
  
  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  if (stepIndex === -1) return 0;
  
  // Add 1 to include the current step as completed
  return Math.round(((stepIndex + 1) / ONBOARDING_STEPS.length) * 100);
}
