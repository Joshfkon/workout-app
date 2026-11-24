/**
 * SSR anchor sets for the pricing study's would-buy answers, built like
 * ../anchors.mjs (Maier et al. App. C.1): five generic statements per set,
 * 1 = clear no, 3 = undecided, 5 = clear yes; several similar sets are
 * averaged. Purchase intent is the question the paper validated.
 *
 * Unlike the usability anchors these are SHORT, because the answers they
 * score are short: each would-buy answer is one sentence with no reasons
 * (the reasons go in a separate `why` field, as the week review learned).
 * On a hand-labelled bank of 22 short answers, short sets scored Spearman
 * ρ 0.94 vs 0.85 for paper-style long ones ("It's very unlikely that I'd…"),
 * which put "No, that's more than I'd pay" at 3.7. That bank was written by
 * us in the same style, so treat it as a sanity check, not a calibration.
 *
 * Van Westendorp answers are not anchored: they are dollar amounts, parsed
 * from the text (parse.mjs).
 *
 * Each question has a `version`; a run records a hash of {version, anchors}
 * per question (`pricingAnchorHashes`), and two runs compare only on
 * questions whose hashes match. Bump the version on any wording change.
 */
import { createHash } from 'node:crypto';

/** The four sets share a shape; `what` names the purchase, `alt` the fallback. */
const sets = ({ no, tooMuch, stay, stayLikely, think, fair, likely, now, worth }) => [
  [no, 'Probably not.', "Maybe, I'm not sure.", 'Probably yes.', 'Yes, definitely.'],
  [tooMuch, 'Probably not, a bit too much.', 'Maybe, it could go either way.', `Probably yes, ${fair}.`, `Yes, ${worth}.`],
  [stay, stayLikely, think, likely, now],
  ['Definitely not.', "I don't think so.", "I'm not sure.", 'I think so.', 'Definitely yes.'],
];

export const PRICING_QUESTIONS = [
  {
    id: 'subscribe',
    version: 1,
    label: 'Would start a subscription at this price',
    anchorSets: sets({
      no: "No, I wouldn't pay that.",
      tooMuch: 'No, too expensive for me.',
      stay: "No, I'd stick with free.",
      stayLikely: "Probably not, I'd likely stay free.",
      think: "Maybe, I'd think about it.",
      fair: "it's fair",
      likely: "Probably yes, I'd likely pay.",
      now: "Yes, I'd sign up right away.",
      worth: "it's worth it",
    }),
  },
  {
    id: 'annual',
    version: 1,
    label: 'Would pay yearly at this price',
    anchorSets: sets({
      no: "No, I wouldn't pay that for a year.",
      tooMuch: 'No, too much to pay up front.',
      stay: "No, I'd stay monthly or free.",
      stayLikely: "Probably not, I'd likely stay monthly.",
      think: "Maybe, I'd think about it.",
      fair: "it's a fair yearly price",
      likely: "Probably yes, I'd likely take the yearly plan.",
      now: "Yes, I'd take the yearly plan right away.",
      worth: "it's worth it for a year",
    }),
  },
  {
    id: 'lifetime',
    version: 1,
    label: 'Would buy lifetime at this price',
    anchorSets: sets({
      no: "No, I wouldn't buy it.",
      tooMuch: 'No, too much to pay at once.',
      stay: "No, I'd rather not pay that much at once.",
      stayLikely: "Probably not, it's a lot up front.",
      think: "Maybe, I'd think about it.",
      fair: "it's a fair one-time price",
      likely: "Probably yes, I'd likely buy it.",
      now: "Yes, I'd buy it right away.",
      worth: "it's worth it",
    }),
  },
  {
    id: 'package',
    version: 1,
    label: 'Would pay for this package',
    anchorSets: sets({
      no: "No, I wouldn't pay for this.",
      tooMuch: "No, it's not worth it to me.",
      stay: "No, I'd stay on free.",
      stayLikely: "Probably not, I'd likely stay on free.",
      think: "Maybe, I'd think about it.",
      fair: "it's what I'd use",
      likely: "Probably yes, I'd likely pay for it.",
      now: "Yes, I'd pay for it right away.",
      worth: "it's worth paying for",
    }),
  },
];

export const pricingQuestion = (id) => PRICING_QUESTIONS.find((q) => q.id === id);

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

/** Same recipe as run.mjs anchorHashes: the version is part of the hash. */
export function pricingAnchorHashes(questions = PRICING_QUESTIONS) {
  return Object.fromEntries(questions.map((q) => [q.id, sha(JSON.stringify(q.version ? { v: q.version, a: q.anchorSets } : q.anchorSets))]));
}
