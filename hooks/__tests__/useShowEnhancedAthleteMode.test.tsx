import { render, renderHook } from '@testing-library/react';

let mockNative = false;
jest.mock('@/lib/integrations/capacitor-stub', () => ({ isNativePlatform: () => mockNative }));
// The card's own data loading is irrelevant here: on native it must not mount.
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => {
    throw new Error('Enhanced Athlete Mode card mounted');
  },
}));

import { useShowEnhancedAthleteMode } from '@/hooks/useShowEnhancedAthleteMode';
import { EnhancedAthleteModeCard } from '@/components/settings/EnhancedAthleteModeCard';

describe('Enhanced Athlete Mode visibility', () => {
  it('is shown on the web', () => {
    mockNative = false;
    const { result } = renderHook(() => useShowEnhancedAthleteMode());
    expect(result.current).toBe(true);
  });

  it('is hidden in the native app', () => {
    mockNative = true;
    const { result } = renderHook(() => useShowEnhancedAthleteMode());
    expect(result.current).toBe(false);
  });

  it('the Settings card renders nothing in the native app', () => {
    mockNative = true;
    const { container } = render(<EnhancedAthleteModeCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
