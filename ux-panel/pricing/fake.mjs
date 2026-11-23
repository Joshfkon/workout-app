/**
 * Scripted stand-in for the pricing questions (`--fake-llm`): answers are
 * derived deterministically from the persona text in the prompt (segment,
 * money line, a hash for spread), so a free dry run exercises parsing,
 * scoring, aggregation and the report with non-degenerate data. Its
 * "findings" mean nothing.
 */
import { createHash } from 'node:crypto';
import { fakeLLM } from '../lib/llm.mjs';
import { rng } from '../personas/pricing.mjs';
import { RANKABLE_FEATURES, PACKAGES } from './questions.mjs';

const money = (x) => `$${x.toFixed(2)}`;
/** A would-buy verdict in the tools' {answer, why} shape. */
const v = (answer) => ({ answer, why: 'Fake reason.' });

function personaText(params) {
  const content = params.messages.at(-1).content;
  return (Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text) : [content]).join('\n');
}

function profile(text) {
  const who = /You are ([^\n]+)/.exec(text)?.[1] ?? text;
  const h = createHash('sha1').update(who).digest().readUInt32BE(0) / 2 ** 32;
  const food = /app is for food|uses an app for food|Doesn't lift/i.test(text);
  const both = !food && /Logged food|Tracked food/i.test(text);
  let wtp = food ? 3 + 6 * h : 3 + 9 * h;
  if (/Money is tight/.test(text)) wtp *= 0.7;
  if (/Doesn't sweat/.test(text)) wtp *= 1.3;
  return { h, food, both, wtp, r: rng(who) };
}

const verdict = (price, limit) =>
  price <= limit * 0.9 ? "Yes, I'd start a subscription at that price; it seems fair." : price <= limit * 1.15 ? "Maybe, I'm not sure that price is worth it." : "No, that's more than I'd pay for this.";

export function pricingFakeLLM(opts = {}) {
  const base = fakeLLM(opts);
  return {
    ...base,
    async call(params) {
      const name = params.tools?.[0]?.name ?? '';
      if (!name.startsWith('submit_pricing')) return base.call(params);
      base.ledger.add('fake', {});
      const text = personaText(params);
      const p = profile(text);
      const use = (input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'fake', name, input }] });
      if (name === 'submit_pricing_vw') {
        return use({
          too_cheap: `${money(Math.max(0.99, p.wtp * 0.3))} — any cheaper and I'd assume it's abandoned.`,
          bargain: `${money(p.wtp * 0.7)} — that would be a steal for what I'd use.`,
          getting_expensive: `About ${money(p.wtp * 1.2)} a month; I'd have to think about it.`,
          too_expensive: `${money(p.wtp * 1.8)} — no way at that point.`,
        });
      }
      if (name === 'submit_pricing_gg') {
        const prices = [...text.matchAll(/^\d\. \(\w+\) \$(\d+\.\d\d)\/month/gm)].map((m) => Number(m[1]));
        const ord = ['first', 'second', 'third', 'fourth', 'fifth'];
        return use(Object.fromEntries(ord.map((o, i) => [o, v(verdict(prices[i] ?? 99, p.wtp))])));
      }
      if (name === 'submit_pricing_plans') {
        const annual = [...text.matchAll(/Option (\d)x: \$(\d+\.\d\d) a year/g)].map((m) => [m[1], Number(m[2])]);
        const lifetime = [...text.matchAll(/Lifetime: \$(\d+\.\d\d) once/g)].map((m) => Number(m[1]));
        const a = (x) => (x <= p.wtp * 7 ? "Yes, I'd take the yearly plan at that price." : x <= p.wtp * 9 ? "Maybe, I'd have to think about committing for a year." : "No, I'd rather pay monthly or not at all.");
        const l = (x) => (x <= p.wtp * 9 ? "Yes, I'd buy it at that price." : x <= p.wtp * 12 ? "Maybe, I'm not sure it's worth it." : "No, I wouldn't buy it at that price.");
        return use({
          ...Object.fromEntries(annual.map(([m, x]) => [`annual_${m}x`, v(a(x))])),
          ...Object.fromEntries(lifetime.map((x) => [`lifetime_${Math.floor(x)}`, v(l(x))])),
        });
      }
      // packages
      const yes = {
        V1: !p.food && p.wtp >= 8,
        V2: (p.both && p.wtp >= 6) || (!p.food && p.wtp >= 8),
        V3: p.food && p.wtp >= 4.5,
        V4: (p.both || p.food) && p.wtp >= 7,
      };
      const pick = ['V2', 'V4', 'V1', 'V3'].find((id) => yes[id]) ?? 'None';
      const say = (id) => (yes[id] ? "Yes, I'd pay for this." : "No, I wouldn't pay for this.");
      return use({
        ...Object.fromEntries(PACKAGES.map((pk) => [pk.id.toLowerCase(), v(say(pk.id))])),
        choice: `${pick} — it fits how I'd actually use the app.`,
        feature_ranking: p.r.shuffle(RANKABLE_FEATURES),
        one_thing: p.r.pick(['Logging food by just describing it.', 'Weekly calorie adjustments that actually work.', 'A cheaper price.', 'Nothing really, I use free apps.', 'A program builder that plans my volume.']),
      });
    },
  };
}
