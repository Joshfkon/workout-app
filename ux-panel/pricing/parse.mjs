/**
 * Pulling numbers and choices out of free-text pricing answers. Pure.
 *
 * Personas are asked to START each threshold answer with a monthly amount,
 * but they write like people: "$5ish", "about 8 bucks", "$60 a year",
 * "nothing, it should be free", "$5–7". The parser prefers explicit money
 * ($-prefixed or followed by dollars/bucks/USD), then a number with a period
 * word (a month, /mo), then spelled-out amounts, then a bare number, and
 * always keeps the original text beside the value.
 */

const WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

const NUM = String.raw`(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)`;
const RANGE_SEP = String.raw`\s*(?:-|–|—|to)\s*\$?\s*`;

/** Period words right after a number → multiplier to monthly. */
function periodFactor(after) {
  const a = after.slice(0, 24).toLowerCase();
  if (/^\s*(?:\/|a|per|each|every)?\s*(?:year|yr|annual|annum)/.test(a) || /^\s*(?:yearly|annually)/.test(a)) return 1 / 12;
  if (/^\s*(?:\/|a|per|each|every)?\s*(?:week|wk)/.test(a) || /^\s*weekly/.test(a)) return 52 / 12;
  if (/^\s*(?:\/|a|per|each|every)?\s*day\b/.test(a) || /^\s*daily/.test(a)) return 30;
  return 1;
}

const num = (s) => Number(s.replace(/,/g, ''));

/**
 * Parse a monthly dollar amount from free text.
 * @param {string} text
 * @returns {{value: number|null, kind: 'money'|'period'|'word'|'bare'|'free'|'none', text: string}}
 */
export function parseMonthlyAmount(text) {
  const t = String(text ?? '');
  const low = t.toLowerCase();
  const done = (value, kind) => ({ value: value == null ? null : Math.round(value * 100) / 100, kind, text: t });

  // 1. Explicit money: "$4.99", "$5-7", "5 dollars", "8 bucks", "USD 6".
  const money = [
    ...[...t.matchAll(new RegExp(String.raw`\$\s*${NUM}(?:${RANGE_SEP}${NUM})?`, 'gi'))].map((m) => ({ m, a: m[1], b: m[2] })),
    ...[...t.matchAll(new RegExp(String.raw`(?<![\d.$])${NUM}(?:${RANGE_SEP}${NUM})?\s*(?:dollars?|bucks|usd)\b`, 'gi'))].map((m) => ({ m, a: m[1], b: m[2] })),
    ...[...t.matchAll(new RegExp(String.raw`\busd\s*${NUM}`, 'gi'))].map((m) => ({ m, a: m[1] })),
  ].sort((x, y) => x.m.index - y.m.index);
  if (money.length) {
    const { m, a, b } = money[0];
    const v = b ? (num(a) + num(b)) / 2 : num(a);
    return done(v * periodFactor(t.slice(m.index + m[0].length)), 'money');
  }

  // 2. A number followed by a period word: "5 a month", "60/year".
  const period = new RegExp(String.raw`(?<![\d.])${NUM}(?:${RANGE_SEP}${NUM})?(?=\s*(?:\/|a|per)?\s*(?:mo\b|month|year|yr|week|day))`, 'i').exec(t);
  if (period) {
    const v = period[2] ? (num(period[1]) + num(period[2])) / 2 : num(period[1]);
    return done(v * periodFactor(t.slice(period.index + period[0].length)), 'period');
  }

  // 3. Spelled out: "five dollars", "twenty-five a month".
  const word = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[\s-](one|two|three|four|five|six|seven|eight|nine))?\s*(?:dollars?|bucks|a month|per month|\/mo)/i.exec(low);
  if (word) return done((WORDS[word[1]] + (word[2] ? WORDS[word[2]] : 0)) * periodFactor(low.slice(word.index + word[0].length)), 'word');

  // 4. "Free" / "nothing" with no number: zero.
  if (/\b(free|nothing|zero|wouldn'?t pay|no price|any price)\b/.test(low) && !/\d/.test(low)) return done(0, 'free');

  // 5. A bare number at the start (the prompt asks them to start with it).
  const bare = new RegExp(String.raw`^\W{0,3}${NUM}`).exec(t.trim());
  if (bare) return done(num(bare[1]), 'bare');
  return done(null, 'none');
}

/** Van Westendorp thresholds in order; `valid` = monotone non-decreasing and all present. */
export function parseVanWestendorp(answers) {
  const keys = ['too_cheap', 'bargain', 'getting_expensive', 'too_expensive'];
  const parsed = Object.fromEntries(keys.map((k) => [k, parseMonthlyAmount(answers?.[k])]));
  const vals = keys.map((k) => parsed[k].value);
  const complete = vals.every((v) => v != null && Number.isFinite(v));
  const monotone = complete && vals.every((v, i) => i === 0 || v >= vals[i - 1]);
  return {
    tooCheap: vals[0],
    cheap: vals[1],
    expensive: vals[2],
    tooExpensive: vals[3],
    valid: complete && monotone,
    reason: !complete ? 'missing amount' : !monotone ? 'thresholds out of order' : null,
    parsed,
  };
}

/**
 * The stance a would-buy answer opens with (personas are asked to start with
 * Yes, No or Maybe). Used as the per-persona yes/no where it is clear, with
 * SSR as the fallback, and reported against SSR as a sanity check: the small
 * local embedding misreads comparatives ("Definitely, that's less than
 * Strong" scores like a no).
 * @returns {'yes'|'no'|'maybe'|null}
 */
export function parseStance(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/^[\W_]+/, '');
  if (/^(maybe|perhaps|possibly|not sure|unsure|i'?m not sure|hmm|it depends|on the fence|50\/50)/.test(t)) return 'maybe';
  if (/^(probably not|likely not|not likely|unlikely|no\b|nope|nah|not\b|never|definitely not|absolutely not|i wouldn'?t|i would not|i don'?t think|i'?d rather|i'?d (?:stick|stay|keep|pass))/.test(t)) return 'no';
  if (/^(yes|yeah|yep|yup|sure|definitely|absolutely|of course|probably( yes)?\b|likely( yes)?\b|i would\b|i'?d (?!not)|i think so|easily|for sure)/.test(t)) return 'yes';
  return null;
}

/** "V2 — because…" → 'V2'; "None, …" → 'none'; unparseable → null. */
export function parseVariantChoice(text) {
  const t = String(text ?? '').trim();
  // The leading choice wins: "None — V2 is interesting, but…" is a none.
  const lead = /^\W*(?:option\s*v?|v)\s*([1-4])\b/i.exec(t);
  if (lead) return `V${lead[1]}`;
  if (/^\W*(none|neither|no\b|nothing|not any|i wouldn'?t|i would not)/i.test(t)) return 'none';
  const v = /\b(?:v|option\s*v?)\s*([1-4])\b/i.exec(t);
  if (v) return `V${v[1]}`;
  return null;
}

/** Dedupe a ranking and append any listed feature it left out (in list order), so every ranking is complete. */
export function normaliseRanking(ranking, features) {
  const seen = [];
  for (const f of ranking ?? []) if (features.includes(f) && !seen.includes(f)) seen.push(f);
  return [...seen, ...features.filter((f) => !seen.includes(f))];
}
