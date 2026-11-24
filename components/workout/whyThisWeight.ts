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

/** The rule in a few words, for the one-line strip reason. */
const RULE_SHORT: Partial<Record<WhyRule, string>> = {
  add_rep: '+1 rep',
  add_load: 'one weight step up',
  load_lever: 'one weight step up',
  hold: 'same weight',
  rounded_up: 'rounded up to the nearest plate, same reps',
  load_up: 'weight up',
  load_down: 'weight down',
  lighter_for_range: 'lighter to stay in range',
  capped: 'capped at today’s best',
  reps_to_beat: 'reps set to beat it',
};

/**
 * The one-line reason shown ON the suggestion strip (no tap), for first-time
 * lifts and for progressions off a logged set:
 *
 *   "Last time 65 lbs × 13, 2 reps left → +1 rep"
 *   "First time on this lift: starting guess from your Bench Press"
 *
 * Same inputs as the sheet summary, shorter. Null for rules whose existing
 * strip line already says it (warm-up, deload, pain, recent-sets).
 */
export function whyThisWeightLine(why: WhyThisWeight | null | undefined): string | null {
  if (!why) return null;
  if (why.rule === 'start_guess') {
    return why.basis
      ? `First time on this lift: starting guess from ${why.basis}`
      : 'First time on this lift: starting guess';
  }
  const short = RULE_SHORT[why.rule];
  if (!short || !why.ref || !why.refSet) return null;
  const label = why.ref === 'last_session' ? 'Last time' : 'Last set';
  const effort = why.refRir != null ? `, ${repsLeft(why.refRir)}` : '';
  return `${label} ${why.refSet}${effort} → ${short}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * What the just-logged set showed, as the card's branch named it — the
 * trigger the engine reacted to, or (no trigger) its effort read vs target.
 */
export type SetChangeCause =
  | 'harder'
  | 'easier'
  | 'on_target'
  | 'reps_under'
  | 'reps_over'
  | 'fatigue';

const SET_CHANGE_CAUSE: Record<SetChangeCause, string> = {
  harder: 'harder than target',
  easier: 'easier than target',
  on_target: 'on target',
  reps_under: 'fewer reps than your range',
  reps_over: 'more reps than your range',
  fatigue: 'you’re tiring — staying in your rep range',
};

export interface SetChangeLineInput {
  /** The just-logged set's number in this exercise (1-based). */
  setNo: number;
  /** That set as logged, display-formatted ("140 lbs × 9"). */
  lastSet: string;
  /** Reps left logged on it; null when no effort was logged. */
  lastRir: number | null;
  cause: SetChangeCause | null;
  /** Direction of the load change the engine made for the next set. */
  direction: 'up' | 'down';
  /** The next load equals one already used (earlier today or last session). */
  back: boolean;
  /** The next set's load, display-formatted ("135 lbs"). */
  next: string;
}

function leftShort(rir: number): string {
  const r = Math.max(0, rir);
  if (r === 0) return ' to failure';
  if (r >= 4) return ' at 4+ left';
  return ` at ${Number.isInteger(r) ? String(r) : r.toFixed(1)} left`;
}

/**
 * The one-line reason for a WITHIN-SESSION load change (set N → set N+1),
 * shown on the strip so a weight that moves between sets is never silent:
 *
 *   "Set 1 was 140 lbs × 9 at 1 left (harder than target) → back to 135 lbs"
 *
 * Phrases what the engine already decided (the caller passes the direction
 * of ITS change); no math happens here.
 */
export function setChangeLine(input: SetChangeLineInput): string {
  const effort = input.lastRir != null ? leftShort(input.lastRir) : '';
  const cause = input.cause ? ` (${SET_CHANGE_CAUSE[input.cause]})` : '';
  const move =
    input.direction === 'down'
      ? input.back
        ? 'back to'
        : 'down to'
      : input.back
        ? 'back up to'
        : 'up to';
  return `Set ${input.setNo} was ${input.lastSet}${effort}${cause} → ${move} ${input.next}`;
}

/**
 * First-time line for a barbell lift whose starting guess is the empty bar
 * (a beginner's usual prefill, "45 lbs"): say why that is the right start
 * and what to do if it's too light.
 */
export function emptyBarStartLine(reps: number): string {
  return `Empty bar — a safe start; add weight if ${reps} reps feel easy`;
}

/**
 * First-time line for a prefilled starting estimate. Always names what the
 * number rests on (the panel: "a guess, with no explanation"), says it is
 * light on purpose ONLY when the engine made it so (`startsLight`), and
 * tells the lifter to change it.
 */
export function coldStartSourceLine(input: {
  basis: string;
  startsLight: boolean;
  /** "pick a weight you could lift ~10 times" — how to judge the number. */
  pickHint: string;
}): string {
  const light = input.startsLight ? ', set on the light side' : '';
  return `First time on this lift — starting estimate from ${input.basis}${light}. Adjust if it feels heavy: ${input.pickHint}`;
}

/**
 * The caution under a prefill when the lifter reported an injury this lift
 * may load. No prescription path lowers the load for an injury, so this
 * never claims it did: it says so, and says when the start is light anyway.
 */
export function injuryLoadNote(input: { area: string; startsLight: boolean }): string {
  const area = input.area.toLowerCase();
  return input.startsLight
    ? `Started light, but not adjusted for your ${area} — go lighter if it hurts`
    : `Not adjusted for your ${area} — go lighter if it hurts`;
}

/** The empty Olympic bar: 20 kg, or 45 lb (20.4 kg). */
export function isEmptyBarLoad(loadKg: number, equipment: string | null | undefined): boolean {
  if ((equipment ?? '').toLowerCase() !== 'barbell') return false;
  return loadKg >= 19.9 && loadKg <= 20.5;
}

/** Whether a line claims an earlier session on this lift ("last session", "last time"). */
export function claimsPastSession(text: string | null | undefined): boolean {
  return !!text && /\blast (?:session|time)\b/i.test(text);
}

/**
 * The card's suggestion copy with every "last session" / "last time" claim
 * removed when the lift has no completed logged set to point at (UX panel
 * round 19: a beginner read "last session" on a lift she had never done).
 * Round 18 applied the same rule to the suggested-workout sheet
 * (hasCompletedLift). Lines without such a claim pass through unchanged, and
 * a lift WITH a completed logged set is never touched. Pure: wording only.
 */
export function withoutUnbackedHistoryClaims<
  T extends { source: string; reason: string; explanation: string[]; why: WhyThisWeight | null },
>(info: T, hasCompletedLoggedSet: boolean): T {
  if (hasCompletedLoggedSet) return info;
  return {
    ...info,
    source: claimsPastSession(info.source) ? '' : info.source,
    reason: claimsPastSession(info.reason) ? '' : info.reason,
    explanation: info.explanation.filter((line) => !claimsPastSession(line)),
    why: info.why?.ref === 'last_session' ? null : info.why,
  };
}
