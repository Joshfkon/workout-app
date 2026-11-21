import { tierBadgeClasses, ratingFillClass } from '../tierBadge';

describe('tierBadgeClasses', () => {
  it('uses design tokens only, strongest tier filled', () => {
    expect(tierBadgeClasses('S')).toBe('bg-action text-on-action');
    expect(tierBadgeClasses('A')).toContain('status-ok');
    expect(tierBadgeClasses('F')).toContain('status-bad');
    for (const t of ['S', 'A', 'B', 'C', 'D', 'F', null, undefined, '?']) {
      expect(tierBadgeClasses(t)).not.toMatch(/(amber|emerald|blue|red|orange|yellow)-\d/);
    }
  });

  it('falls back to neutral for C and unknown tiers', () => {
    expect(tierBadgeClasses('C')).toBe('bg-fill text-ink-2');
    expect(tierBadgeClasses(undefined)).toBe('bg-fill text-ink-2');
  });
});

describe('ratingFillClass', () => {
  it('maps 1–5 onto weak / fine / strong', () => {
    expect(ratingFillClass(5)).toBe('bg-status-ok');
    expect(ratingFillClass(4)).toBe('bg-status-ok');
    expect(ratingFillClass(3)).toBe('bg-action');
    expect(ratingFillClass(2)).toBe('bg-status-warn');
  });
});
