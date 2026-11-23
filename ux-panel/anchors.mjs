/**
 * SSR questions and their reference (anchor) statement sets.
 *
 * Following Maier et al. (App. C.1): each set holds five short, generic
 * statements, one per Likert point. Point 1 is a clear negative, 3 is
 * indifference or uncertainty, 5 is a clear positive, and 2 and 4 sit between
 * their neighbours. Several sets that are "similar but not identical" are
 * averaged, which smooths out the quirks of any single wording.
 *
 * Keep anchors app-agnostic (no feature names): they measure the stance of the
 * answer, not its topic. Changing an anchor changes every score for that
 * question, so a run records a hash of each question's anchors and the report
 * compares two runs only on the questions whose hashes match.
 *
 * Two scopes:
 *   task — asked after every session, about that one task (ease, polish).
 *   week — asked ONCE per persona after all of their sessions, framed as the
 *          end of a first week. "Would you keep using it?" after one short
 *          task gets "Maybe" every time, which is honest and tells us nothing,
 *          so the week questions ask something a persona can judge: whether
 *          they'd switch from what they use now, and whether they'd pay the
 *          real price instead of staying with it.
 */

/** The real Pro price (lib/stripe.ts), so "would you pay" has a number to judge. */
export const PRO_MONTHLY_PRICE = '$4.99';

/**
 * What Free and Pro include, as the app's own pricing lists them
 * (lib/stripe.ts TIER_FEATURES). Personas are asked whether they'd pay, so
 * they're told what paying gets them — a real user meets the paywall; ours
 * never did, and every "no" said "I haven't seen a Pro feature".
 */
export const FREE_FEATURES = ['Unlimited workout logging', 'Exercise history', 'Basic progress tracking'];
export const PRO_FEATURES = ['AI mesocycle builder', 'Smart weight suggestions', 'Advanced analytics', 'Unlimited workouts', 'Priority support'];

export const QUESTIONS = [
  {
    id: 'ease',
    scope: 'task',
    label: 'Ease of use',
    prompt: 'How easy or hard was it to do what you came to do? Answer in your own words, in one to three sentences.',
    anchorSets: [
      [
        "It was really hard, I couldn't figure it out.",
        'It was harder than it should have been.',
        'It was okay, some parts easy and some confusing.',
        'It was mostly easy to figure out.',
        'It was effortless, everything was where I expected.',
      ],
      [
        'I got completely lost.',
        'I struggled in a few places.',
        'It was manageable.',
        'It felt pretty intuitive.',
        'It was completely intuitive.',
      ],
      [
        'Very difficult to use.',
        'Somewhat difficult to use.',
        'Neither easy nor difficult to use.',
        'Somewhat easy to use.',
        'Very easy to use.',
      ],
      [
        'Frustrating from start to finish.',
        'More friction than I would like.',
        'Average, nothing special either way.',
        'Smooth with only minor hiccups.',
        'Smooth from start to finish.',
      ],
    ],
  },
  {
    id: 'polish',
    scope: 'task',
    label: 'Perceived polish',
    prompt: 'How polished and finished did the app feel to you? Answer in your own words, in one to three sentences.',
    anchorSets: [
      [
        'It feels broken and unfinished.',
        'It feels rough around the edges.',
        "It feels okay, neither rough nor polished.",
        'It feels mostly polished.',
        'It feels very polished and professional.',
      ],
      [
        'It looks like an early prototype.',
        'It looks like a beta with a lot of loose ends.',
        'It looks like a typical app.',
        'It looks like a well-made app.',
        'It looks like a top-tier, premium app.',
      ],
      [
        'Sloppy and buggy.',
        'A bit clunky.',
        'Decent.',
        'Clean and solid.',
        'Beautifully crafted.',
      ],
      [
        "I don't trust it to work properly.",
        'Some things made me doubt it.',
        "I have no strong opinion on its quality.",
        'It seems reliable and cared for.',
        'Every detail feels deliberate and reliable.',
      ],
    ],
  },
  {
    id: 'switch',
    scope: 'week',
    label: 'Would switch to it',
    prompt:
      'Compared with what you use now to track this (another app, a notebook, or nothing at all), would you switch to HyperTrack? Say what tips it either way. Answer honestly, in your own words, in one to three sentences.',
    anchorSets: [
      [
        "No, I'm staying with what I already use; this is worse for me.",
        "Probably not; what I use now is still a bit better for me.",
        "Maybe; it's better in some ways and worse in others.",
        "Yes, I'd probably switch; it's better than what I use now.",
        "Yes, I'm switching for sure.",
      ],
      [
        'No, what I use now does this much better.',
        'Not really, my current setup already does what I need.',
        "It's a toss-up between this and what I use now.",
        'Yes, it does this better than what I use now.',
        "Definitely, it's far better than anything I've used.",
      ],
      [
        "It's very unlikely that I'd switch to this app.",
        "It's somewhat unlikely that I'd switch to this app.",
        "It's neither likely nor unlikely that I'd switch to this app.",
        "It's somewhat likely that I'd switch to this app.",
        "It's very likely that I'd switch to this app.",
      ],
      [
        "I'm sticking with my old way.",
        "I'd keep my old way and maybe open this now and then.",
        "I'd use both for a while before deciding.",
        "I'd move most of my tracking here.",
        "I'd move everything here and drop my old way.",
      ],
    ],
  },
  {
    id: 'pay_price',
    scope: 'week',
    // v2: personas are told what Free and Pro include before answering, so
    // scores don't compare with v1 runs (the hash includes this).
    // v3: personas seeded on Pro (account.tier 'pro') are told they were on a
    // Pro trial, so for them it's "would you keep paying", asked after a week
    // with Pro unlocked (and the plan-training journey); the pooled pay_price
    // distribution no longer means what v2's did.
    version: 3,
    label: `Would pay ${PRO_MONTHLY_PRICE}/month`,
    prompt: `HyperTrack Pro costs ${PRO_MONTHLY_PRICE} a month. Would you pay that rather than stay with what you use now? Say why. Answer honestly, in your own words, in one to three sentences.`,
    anchorSets: [
      [
        "I wouldn't pay anything for this.",
        "I wouldn't pay that; it's not worth it to me.",
        "I might pay that, but I'm not sure it's worth it.",
        "I'd probably pay that.",
        "I'd happily pay that; it's worth it.",
      ],
      [
        'Not at that price, or at any price.',
        "That's too much for what it gives me.",
        "That price is borderline for me.",
        'That price seems fair for what I get.',
        "That's a bargain for what I get.",
      ],
      [
        "It's very unlikely that I'd subscribe at that price.",
        "It's somewhat unlikely that I'd subscribe at that price.",
        "It's neither likely nor unlikely that I'd subscribe at that price.",
        "It's somewhat likely that I'd subscribe at that price.",
        "It's very likely that I'd subscribe at that price.",
      ],
      [
        "I'd stay with my free option.",
        "I'd stick to a free version if there is one.",
        "I might try a paid trial.",
        "I'd subscribe after a trial.",
        "I'd subscribe today.",
      ],
    ],
  },
];

export const TASK_QUESTIONS = QUESTIONS.filter((q) => q.scope === 'task');
export const WEEK_QUESTIONS = QUESTIONS.filter((q) => q.scope === 'week');

/**
 * Labels for questions earlier runs asked (one review per task, schema 1), so
 * old runs still render. Their scores are never compared with the week
 * questions: they asked something else.
 */
export const RETIRED_QUESTION_LABELS = {
  keep_using: 'Likelihood to keep using (retired)',
  pay: 'Willingness to pay (retired)',
};

/**
 * Per-question anchor hashes for runs recorded before per-question hashes
 * existed, keyed by their whole-file `anchorsHash`. Lets a new run compare
 * ease and polish with those runs, whose anchors are unchanged.
 */
export const LEGACY_ANCHOR_HASHES = {
  b562e018a2: { keep_using: '5e9abb2303', ease: '8182770893', polish: '37fb4aba86', pay: 'b10add5287' },
};
