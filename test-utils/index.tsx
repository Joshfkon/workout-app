import React, { ReactElement } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import type { WeightUnit } from '@/types/schema';

// Mock user preferences context value
export interface MockUserPreferences {
  units: WeightUnit;
  heightCm?: number | null;
  weightKg?: number | null;
}

const defaultMockPreferences: MockUserPreferences = {
  units: 'kg',
  heightCm: null,
  weightKg: null,
};

// Mock implementation of useUserPreferences for testing
export const createMockUseUserPreferences = (preferences: Partial<MockUserPreferences> = {}) => {
  const mergedPrefs = { ...defaultMockPreferences, ...preferences };

  return {
    preferences: {
      goal: 'maintenance' as const,
      experience: 'intermediate' as const,
      units: mergedPrefs.units,
      heightCm: mergedPrefs.heightCm ?? null,
      weightKg: mergedPrefs.weightKg ?? null,
      restTimerDefault: 180,
      showFormCues: true,
      showWarmupSuggestions: true,
      skipPreWorkoutCheckIn: false,
    },
    isLoading: false,
    updatePreference: jest.fn(),
    toggleUnits: jest.fn(),
  };
};

// Test wrapper with mock preferences
interface WrapperProps {
  children: React.ReactNode;
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  preferences?: Partial<MockUserPreferences>;
}

/**
 * Custom render function that wraps components with necessary providers
 * for testing with specific unit preferences
 */
export function renderWithPreferences(
  ui: ReactElement,
  { preferences = {}, ...renderOptions }: CustomRenderOptions = {}
): RenderResult & { mockPreferences: ReturnType<typeof createMockUseUserPreferences> } {
  const mockPreferences = createMockUseUserPreferences(preferences);

  const Wrapper = ({ children }: WrapperProps) => {
    return <>{children}</>;
  };

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    mockPreferences,
  };
}

// Re-export everything from @testing-library/react
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
