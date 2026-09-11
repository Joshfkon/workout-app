/**
 * @jest-environment node
 */

import {
  getNextStep,
  getResumeRoute,
  getStepProgressPercentage,
  isStepSkippable,
  ONBOARDING_STEPS,
  STEP_ROUTES,
  STEP_LABELS,
  type OnboardingStep
} from '../onboardingProgress';

describe('onboardingProgress', () => {
  describe('getNextStep', () => {
    it('returns "units" when current step is null', () => {
      expect(getNextStep(null)).toBe('units');
    });

    it('returns next step in sequence', () => {
      expect(getNextStep('units')).toBe('body_comp');
      expect(getNextStep('body_comp')).toBe('goal');
      expect(getNextStep('goal')).toBe('benchmarks');
      expect(getNextStep('benchmarks')).toBe('calibrate');
      expect(getNextStep('calibrate')).toBe('complete');
      expect(getNextStep('complete')).toBe('profile');
      expect(getNextStep('profile')).toBe('enhanced');
      expect(getNextStep('enhanced')).toBe('install');
    });

    it('returns null for last step', () => {
      expect(getNextStep('install')).toBe(null);
    });
  });

  describe('getResumeRoute', () => {
    it('returns /onboarding for null step', () => {
      expect(getResumeRoute(null)).toBe('/onboarding');
    });

    it('returns correct routes for early steps', () => {
      expect(getResumeRoute('units')).toBe('/onboarding');
      expect(getResumeRoute('body_comp')).toBe('/onboarding');
    });

    it('returns /dashboard when all steps completed', () => {
      // When on last step, next is null → should return dashboard
      expect(getResumeRoute('install')).toBe('/dashboard');
    });

    it('includes session ID for steps that need it', () => {
      const sessionId = 'test-session-123';
      
      expect(getResumeRoute('goal', sessionId)).toBe('/onboarding/benchmarks?session=test-session-123');
      expect(getResumeRoute('benchmarks', sessionId)).toBe('/onboarding/calibrate?session=test-session-123');
      expect(getResumeRoute('calibrate', sessionId)).toBe('/onboarding/complete?session=test-session-123');
    });

    it('does not include session ID for early steps', () => {
      const sessionId = 'test-session-123';
      
      expect(getResumeRoute('units', sessionId)).toBe('/onboarding');
      expect(getResumeRoute('body_comp', sessionId)).toBe('/onboarding');
    });
  });

  describe('getStepProgressPercentage', () => {
    it('returns 0 for null step', () => {
      expect(getStepProgressPercentage(null)).toBe(0);
    });

    it('calculates correct percentage for each step', () => {
      const totalSteps = ONBOARDING_STEPS.length;
      
      // First step should be ~11% (1/9)
      expect(getStepProgressPercentage('units')).toBe(Math.round((1 / totalSteps) * 100));
      
      // Second step should be ~22% (2/9)
      expect(getStepProgressPercentage('body_comp')).toBe(Math.round((2 / totalSteps) * 100));
      
      // Last step should be 100% (9/9)
      expect(getStepProgressPercentage('install')).toBe(100);
    });
  });

  describe('isStepSkippable', () => {
    it('returns true for skippable steps', () => {
      expect(isStepSkippable('install')).toBe(true);
      expect(isStepSkippable('enhanced')).toBe(true);
    });

    it('returns false for non-skippable steps', () => {
      expect(isStepSkippable('units')).toBe(false);
      expect(isStepSkippable('body_comp')).toBe(false);
      expect(isStepSkippable('goal')).toBe(false);
      expect(isStepSkippable('benchmarks')).toBe(false);
      expect(isStepSkippable('calibrate')).toBe(false);
      expect(isStepSkippable('complete')).toBe(false);
      expect(isStepSkippable('profile')).toBe(false);
    });
  });

  describe('ONBOARDING_STEPS', () => {
    it('contains all steps in correct order', () => {
      expect(ONBOARDING_STEPS).toEqual([
        'units',
        'body_comp',
        'goal',
        'benchmarks',
        'calibrate',
        'complete',
        'profile',
        'enhanced',
        'install'
      ]);
    });
  });

  describe('STEP_ROUTES', () => {
    it('maps all steps to routes', () => {
      ONBOARDING_STEPS.forEach(step => {
        expect(STEP_ROUTES[step]).toBeDefined();
        expect(typeof STEP_ROUTES[step]).toBe('string');
      });
    });

    it('has correct route mappings', () => {
      expect(STEP_ROUTES.units).toBe('/onboarding');
      expect(STEP_ROUTES.body_comp).toBe('/onboarding');
      expect(STEP_ROUTES.goal).toBe('/onboarding');
      expect(STEP_ROUTES.benchmarks).toBe('/onboarding/benchmarks');
      expect(STEP_ROUTES.calibrate).toBe('/onboarding/calibrate');
      expect(STEP_ROUTES.complete).toBe('/onboarding/complete');
      expect(STEP_ROUTES.profile).toBe('/onboarding/profile');
      expect(STEP_ROUTES.enhanced).toBe('/onboarding/enhanced');
      expect(STEP_ROUTES.install).toBe('/onboarding/install');
    });
  });

  describe('STEP_LABELS', () => {
    it('has labels for all steps', () => {
      ONBOARDING_STEPS.forEach(step => {
        expect(STEP_LABELS[step]).toBeDefined();
        expect(typeof STEP_LABELS[step]).toBe('string');
        expect(STEP_LABELS[step].length).toBeGreaterThan(0);
      });
    });
  });
});
