import { isValidTimeZone, resolveUserDay } from '../userTimeZone';

describe('resolveUserDay', () => {
  // 02:30 UTC on Nov 13 — still the evening of Nov 12 in the US.
  const instant = new Date('2026-11-13T02:30:00Z');

  it("resolves the user's calendar day in their zone, not the host's", () => {
    expect(resolveUserDay('America/Los_Angeles', instant).day).toBe('2026-11-12');
    expect(resolveUserDay('Pacific/Auckland', instant).day).toBe('2026-11-13');
    expect(resolveUserDay('UTC', instant).day).toBe('2026-11-13');
  });

  it('accepts the URL-encoded cookie form', () => {
    const r = resolveUserDay(encodeURIComponent('America/New_York'), instant);
    expect(r.timeZone).toBe('America/New_York');
    expect(r.day).toBe('2026-11-12');
  });

  it("returns a Date whose runtime-local day equals the user's day", () => {
    const { day, date } = resolveUserDay('America/Los_Angeles', instant);
    const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
    expect(local).toBe(day);
  });

  it('falls back to the runtime day for a missing or junk zone', () => {
    const runtimeDay = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(instant.getDate()).padStart(2, '0')}`;
    for (const bad of [undefined, null, '', 'Not/AZone', '../../etc', 'x'.repeat(200)]) {
      const r = resolveUserDay(bad, instant);
      expect(r.timeZone).toBeNull();
      expect(r.day).toBe(runtimeDay);
    }
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});
