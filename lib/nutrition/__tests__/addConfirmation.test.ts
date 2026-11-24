import { JUST_ADDED_MS, rowNeedsScroll } from '../addConfirmation';

describe('rowNeedsScroll', () => {
  const vh = 844;

  it('leaves a row in the clear middle of the screen alone', () => {
    expect(rowNeedsScroll({ top: 300, bottom: 350 }, vh)).toBe(false);
  });

  it('scrolls a row parked at the bottom edge, under the tab bar and toast', () => {
    expect(rowNeedsScroll({ top: 760, bottom: 810 }, vh)).toBe(true);
  });

  it('scrolls a row under the fixed header', () => {
    expect(rowNeedsScroll({ top: 20, bottom: 70 }, vh)).toBe(true);
  });

  it('keeps a just-added row flagged long enough to read', () => {
    expect(JUST_ADDED_MS).toBeGreaterThanOrEqual(5000);
  });
});
