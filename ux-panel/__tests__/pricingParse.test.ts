/**
 * Pricing-study text parsing: monthly amounts out of free-text thresholds,
 * the stance a would-buy answer opens with, and the package choice.
 */
import { parseMonthlyAmount, parseVanWestendorp, parseStance, parseVariantChoice, normaliseRanking } from '../pricing/parse.mjs';

describe('parseMonthlyAmount', () => {
  it.each([
    ['$4.99 — any cheaper and I would worry', 4.99, 'money'],
    ['About $8 a month, since I train 4x a week', 8, 'money'],
    ['about 8 bucks', 8, 'money'],
    ['10 dollars', 10, 'money'],
    ['$5-7 range', 6, 'money'],
    ['$5 to $7', 6, 'money'],
    ['$60 a year is fine', 5, 'money'],
    ['$2 a week', 8.67, 'money'],
    ['10/month', 10, 'period'],
    ['5 a month tops', 5, 'period'],
    ['five dollars a month', 5, 'word'],
    ['twenty-five dollars', 25, 'word'],
    ['Nothing, it should be free', 0, 'free'],
    ['3 — under that feels sketchy', 3, 'bare'],
  ])('%s → %p', (text, value, kind) => {
    const r = parseMonthlyAmount(text);
    expect(r.value).toBeCloseTo(value as number, 2);
    expect(r.kind).toBe(kind);
    expect(r.text).toBe(text);
  });

  it('prefers the money amount over other numbers in the sentence', () => {
    expect(parseMonthlyAmount('With 4 workouts a week, $9.99/mo is fair').value).toBe(9.99);
  });

  it('returns null when there is no amount', () => {
    expect(parseMonthlyAmount("I'm not sure").value).toBeNull();
    expect(parseMonthlyAmount(undefined as unknown as string).value).toBeNull();
  });
});

describe('parseVanWestendorp', () => {
  it('parses four thresholds and checks their order', () => {
    const ok = parseVanWestendorp({ too_cheap: '$1.99 — sketchy', bargain: '$4.99 — great', getting_expensive: '$9.99, hmm', too_expensive: '$15 no way' });
    expect(ok).toEqual(expect.objectContaining({ tooCheap: 1.99, cheap: 4.99, expensive: 9.99, tooExpensive: 15, valid: true }));
    const bad = parseVanWestendorp({ too_cheap: '$5', bargain: '$3', getting_expensive: '$9', too_expensive: '$12' });
    expect(bad.valid).toBe(false);
    expect(bad.reason).toMatch(/order/);
    expect(parseVanWestendorp({ too_cheap: '$1', bargain: 'not sure', getting_expensive: '$9', too_expensive: '$12' }).reason).toMatch(/missing/);
  });
});

describe('parseStance', () => {
  it.each([
    ["Yes, I'd sign up.", 'yes'],
    ['Definitely, that is less than Strong.', 'yes'],
    ["Probably yes, it's fair.", 'yes'],
    ["I'd pay that.", 'yes'],
    ["No, that's too much.", 'no'],
    ['Probably not at that price.', 'no'],
    ["I'd rather stick with Hevy.", 'no'],
    ["I wouldn't.", 'no'],
    ["Maybe, I'm not sure.", 'maybe'],
    ["Not sure, it depends.", 'maybe'],
    ['That price is fine.', null],
  ])('%s → %p', (text, stance) => expect(parseStance(text)).toBe(stance));
});

describe('parseVariantChoice / normaliseRanking', () => {
  it('reads the option an answer starts with', () => {
    expect(parseVariantChoice('V2 — the food AI is what I want')).toBe('V2');
    expect(parseVariantChoice('Option 3, because it is cheaper')).toBe('V3');
    expect(parseVariantChoice("None, I'd stay free")).toBe('none');
    expect(parseVariantChoice('Hard to say')).toBeNull();
  });

  it('completes a ranking: drops unknown and repeated items, appends what is missing', () => {
    expect(normaliseRanking(['b', 'x', 'b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
    expect(normaliseRanking(undefined as unknown as string[], ['a', 'b'])).toEqual(['a', 'b']);
  });
});
