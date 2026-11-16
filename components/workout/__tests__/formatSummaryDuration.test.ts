import { formatSummaryDuration } from '../SessionSummary';

describe('formatSummaryDuration', () => {
  it('reads as minutes, never like a clock', () => {
    expect(formatSummaryDuration(26)).toBe('<1 min');
    expect(formatSummaryDuration(26 * 60)).toBe('26 min');
    expect(formatSummaryDuration(65 * 60)).toBe('1h 05m');
    expect(formatSummaryDuration(Number.NaN)).toBe('<1 min');
  });
});
