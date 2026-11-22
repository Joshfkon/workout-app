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
 * answer, not its topic. Changing an anchor changes every score, so compare
 * runs only when they used the same anchors — the run file records a hash of
 * this module's content for that reason.
 */

export const QUESTIONS = [
  {
    id: 'keep_using',
    label: 'Likelihood to keep using',
    prompt: 'Would you keep using this app after today? Answer honestly, in your own words, in one to three sentences.',
    anchorSets: [
      [
        "I'm definitely not going to use this app again.",
        "I probably won't keep using it.",
        "I'm not sure whether I'd keep using it.",
        "I'll probably keep using it.",
        "I'm definitely going to keep using this app.",
      ],
      [
        "I'd delete it right away.",
        "I doubt it will stick for me.",
        "Maybe, it could go either way.",
        "I think it will become part of my routine.",
        "This is going to be my app from now on.",
      ],
      [
        "No, I'm done with it.",
        "Probably not, unless it changes.",
        "I might give it another try, I don't know.",
        "Yes, most likely.",
        "Absolutely, I'd use it every time.",
      ],
      [
        "It's very unlikely that I'd keep using it.",
        "It's somewhat unlikely that I'd keep using it.",
        "It's neither likely nor unlikely that I'd keep using it.",
        "It's somewhat likely that I'd keep using it.",
        "It's very likely that I'd keep using it.",
      ],
    ],
  },
  {
    id: 'ease',
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
    id: 'pay',
    label: 'Willingness to pay',
    prompt: 'Would you pay for a subscription to this app? Answer honestly, in your own words, in one to three sentences.',
    anchorSets: [
      [
        "I would never pay for this.",
        "I probably wouldn't pay for this.",
        "I'm not sure whether I'd pay for this.",
        "I'd probably pay for this.",
        "I'd definitely pay for this.",
      ],
      [
        'Not worth any money to me.',
        "It's not worth paying for yet.",
        'Maybe, if the price was right.',
        'It seems worth paying for.',
        "It's easily worth the money.",
      ],
      [
        "It's very unlikely that I'd buy a subscription.",
        "It's somewhat unlikely that I'd buy a subscription.",
        "It's neither likely nor unlikely that I'd buy a subscription.",
        "It's somewhat likely that I'd buy a subscription.",
        "It's very likely that I'd buy a subscription.",
      ],
      [
        "I'd only use it if it stayed free.",
        "I'd stick to the free version.",
        "I might try a paid trial.",
        "I'd subscribe after a trial.",
        "I'd subscribe today.",
      ],
    ],
  },
];
