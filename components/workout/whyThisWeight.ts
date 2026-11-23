/**
 * "Why this weight?" — a one-paragraph plain summary of the suggestion on
 * the active set, for lifters who want to see how their own inputs drive the
 * number (UX panel: a Hevy switcher).
 *
 * Built ONLY from values ExerciseCard already has when it builds the
 * suggestion (buildSuggestionInfo): the reference set as it was logged, the
 * effort logged on it, and WHICH rule produced today's numbers. No math
 * happens here — the rule is named, never re-derived, and today's numbers are
 * the banner's own labels.
 *
 *   "Last time: 65 lbs × 13, 2 reps left → you had room, so +1 rep today: 65 lbs × 14."
 */

/** The rule that produced today's numbers, as the card's branch named it. */
export type WhyRule =
  | 'add_rep'
  | 'add_load'
  | 'load_lever'
  | 'hold'
  | 'rounded_up'
  | 'load_up'
  | 'load_down'
  | 'lighter_for_range'
  | 'capped'
  | 'reps_to_beat'
  | 'start_guess'
  | 'from_recent'
  | 'held_until_top'
  | 'warmup'
  | 'deload'
  | 'pain';

export interface WhyThisWeight {
  /** Which logged set the numbers came from; null = no single reference set. */
  ref: 'last_session' | 'last_set' | null;
  /** The reference set as logged, display-formatted ("65 lbs × 13"). */
  refSet?: string;
  /** Reps left logged on the reference set (null/undefined = none logged). */
  refRir?: number | null;
  rule: WhyRule;
  /** start_guess: what the guess rests on ("your Bench Press", "your bodyweight"). */
  basis?: string | null;
  /** warmup: percent of today's top set. */
  pct?: number;
  /** What the engine's trigger saw in the reference set, when it named one. */
  because?: WhyBecause | null;
}

export type WhyBecause = 'reps_over' | 'reps_under' | 'easier' | 'harder' | 'matched';

const BECAUSE_PHRASE: Record<WhyBecause, string> = {
  reps_over: 'more reps than your range',
  reps_under: 'fewer reps than your range',
  easier: 'easier than your target',
  harder: 'harder than your target',
  matched: 'right on your target',
};

function repsLeft(rir: number): string {
  const r = Math.max(0, rir);
  if (r === 0) return 'nothing left';
  if (r >= 4) return '4+ reps left';
  const n = Number.isInteger(r) ? String(r) : r.toFixed(1);
  return `${n} rep${n === '1' ? '' : 's'} left`;
}

const RULE_PHRASE: Record<WhyRule, string> = {
  add_rep: 'you had room, so +1 rep today',
  add_load: 'you topped the rep range with room to spare, so one weight step up today',
  load_lever: 'more reps wouldn’t beat it at that weight, so one weight step up today',
  hold: 'same weight today',
  rounded_up: 'your plates round up a little, so same reps at a touch more weight today',
  load_up: 'weight up today',
  load_down: 'weight down today',
  lighter_for_range: 'you’re more tired now, so a bit lighter to stay in your rep range',
  capped: 'capped at what you’ve shown today',
  reps_to_beat: 'reps set to beat it today',
  start_guess: 'a starting guess',
  from_recent: 'based on your recent sets on this lift',
  held_until_top: 'held at your recent weight until you hit the top of the rep range',
  warmup: 'a warm-up set',
  deload: 'lighter on purpose this session so you recover',
  pain: 'eased off about 10% because you flagged pain',
};

/**
 * The summary sentence. `today` is the banner's own "weight × reps" label.
 * Returns null when there is nothing honest to say.
 */
export function whyThisWeightSummary(why: WhyThisWeight | null | undefined, today: string): string | null {
  if (!why) return null;
  const rule = RULE_PHRASE[why.rule];

  if (why.rule === 'deload' || why.rule === 'pain') {
    return `${capitalize(rule)}: ${today}.`;
  }
  if (why.rule === 'warmup') {
    return why.pct != null
      ? `A warm-up set: about ${why.pct}% of today’s top set → ${today}.`
      : `A warm-up set → ${today}.`;
  }
  if (why.rule === 'start_guess') {
    return why.basis
      ? `First time on this lift: a starting guess from ${why.basis} → ${today}. Adjust after your first set.`
      : `First time on this lift: a starting guess → ${today}. Adjust after your first set.`;
  }
  if (why.rule === 'from_recent' || why.rule === 'held_until_top') {
    return `${capitalize(rule)} → ${today}.`;
  }
  if (!why.ref || !why.refSet) return `${capitalize(rule)}: ${today}.`;

  const label = why.ref === 'last_session' ? 'Last time' : 'Your last set';
  const effort = why.refRir != null ? `, ${repsLeft(why.refRir)}` : '';
  const because = why.because ? `${BECAUSE_PHRASE[why.because]}, so ` : '';
  return `${label}: ${why.refSet}${effort} → ${because}${rule}: ${today}.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
