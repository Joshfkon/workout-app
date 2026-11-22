import { act, renderHook } from '@testing-library/react';
import { useExplicitSmallestPlate } from '@/hooks/useSmallestPlate';
import { smallestPlateStorageKey, storeSmallestPlate } from '@/lib/workout/smallestPlate';

describe('useExplicitSmallestPlate', () => {
  beforeEach(() => window.localStorage.clear());

  it('is undefined until the user picks a plate', () => {
    const { result } = renderHook(() => useExplicitSmallestPlate('lb'));
    expect(result.current).toBeUndefined();
  });

  it('updates a mounted consumer when the plate calculator stores a new plate', () => {
    const { result } = renderHook(() => useExplicitSmallestPlate('lb'));
    act(() => storeSmallestPlate('lb', 1.25));
    expect(result.current).toBe(1.25);
    act(() => storeSmallestPlate('lb', 5));
    expect(result.current).toBe(5);
  });

  it('follows a change made in another tab (storage event)', () => {
    const { result } = renderHook(() => useExplicitSmallestPlate('lb'));
    act(() => {
      window.localStorage.setItem(smallestPlateStorageKey('lb'), '1.25');
      window.dispatchEvent(new StorageEvent('storage', { key: smallestPlateStorageKey('lb') }));
    });
    expect(result.current).toBe(1.25);
  });

  it('keeps units apart', () => {
    const { result } = renderHook(() => useExplicitSmallestPlate('kg'));
    act(() => storeSmallestPlate('lb', 1.25));
    expect(result.current).toBeUndefined();
  });
});
