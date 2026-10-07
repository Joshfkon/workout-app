/**
 * The next-set call ("Next set: add 5 lb (95 lb × 12–13).") for the coach
 * sheet, plus the shown load/reps the exercise card's banner renders.
 *
 * NOT a decision engine. The load and reps always come from the
 * prescription engine (the caller passes what the next-set banner /
 * recommendSessionStart produced); logged RIR stays the primary effort
 * signal. This module phrases that as an action and applies ONE evidence
 * rule: when the motion effort finding says the set was much harder than
 * the logged RIR (near-failure velocity, logged RIR ≥ threshold), an engine
 * "add weight" becomes "hold" (conservative only — velocity never adds load).
 *
 * Motion boundary: the effort finding arrives as plain data. Nothing here
 * imports the motion feature.
 */

export type NextSetAction = 'add' | 'keep' | 'reduce' | 'stop';
export type EffortZoneLike = 'easy' | 'moderate' | 'hard' | 'near-failure';

export interface NextSetCallInput {
  scope: 'next_set' | 'next_session';
  /** Engine output for the next set / session. */
  engine: { weightKg: number; reps: number; effortVsTarget: 'easier' | 'on_target' | 'harder' };
  /** The just-logged set's load. */
  lastWeightKg: number;
  repRange: [number, number];
  loggedRir: number | null;
  /** Logged form rating on the set was the worst option. */
  formBrokeDown: boolean;
  /** Motion effort finding for the set — null when no confident capture. */
  effort: { zone: EffortZoneLike; disagreement: 'more_than_logged' | 'harder_than_logged' | null } | null;
  /** Logged RIR at/above which near-failure velocity holds an "add". */
  higherEffortMinLoggedRir: number;
  /** kg → "90 lb" in the user's unit, rounded as the banner rounds. */
  formatWeight: (kg: number) => string;
}

export interface NextSetCall {
  action: NextSetAction;
  /** One sentence for the coach sheet. */
  call: string;
  /** Load / reps the banner shows (the engine's, or the held load). */
  weightKg: number;
  repsLabel: string;
  heldByVelocity: boolean;
}

/** Load moves smaller than this (kg) are a hold. */
const SAME_LOAD_EPS_KG = 0.05;

export function repsLabelFor(engineReps: number, [lo, hi]: [number, number]): string {
  const from = Math.min(Math.max(Math.round(engineReps), lo), hi);
  return from >= hi ? `${hi}` : `${from}–${hi}`;
}

export function composeNextSetCall(input: NextSetCallInput): NextSetCall {
  const { engine, lastWeightKg, effort, formatWeight, scope } = input;
  const lead = scope === 'next_session' ? 'Next session' : 'Next set';

  if (input.formBrokeDown) {
    return {
      action: 'stop',
      call: 'Stop this exercise for today — you logged form breaking down.',
      weightKg: lastWeightKg,
      repsLabel: repsLabelFor(engine.reps, input.repRange),
      heldByVelocity: false,
    };
  }

  const delta = engine.weightKg - lastWeightKg;
  let action: Exclude<NextSetAction, 'stop'> =
    delta > SAME_LOAD_EPS_KG ? 'add' : delta < -SAME_LOAD_EPS_KG ? 'reduce' : 'keep';

  const heldByVelocity =
    action === 'add' &&
    effort?.zone === 'near-failure' &&
    input.loggedRir !== null &&
    input.loggedRir >= input.higherEffortMinLoggedRir;
  if (heldByVelocity) action = 'keep';

  const weightKg = heldByVelocity ? lastWeightKg : engine.weightKg;
  const reps = repsLabelFor(heldByVelocity ? input.repRange[0] : engine.reps, input.repRange);
  const w = formatWeight(weightKg);
  const roomLeft =
    effort?.zone === 'easy' || (effort === null && engine.effortVsTarget === 'easier');

  let call: string;
  if (heldByVelocity) {
    call = `${lead}: hold ${w} — your speed says that was harder than the ${input.loggedRir} RIR you logged.`;
  } else if (action === 'add') {
    call = `${lead}: add ${formatWeight(delta)} (${w} × ${reps}).`;
  } else if (action === 'reduce') {
    call = `${lead}: drop ${formatWeight(-delta)} (${w} × ${reps}).`;
  } else if (roomLeft) {
    call = `${lead}: hold ${w}, push closer to failure (${reps} reps).`;
  } else {
    call = `${lead}: hold ${w} × ${reps}.`;
  }
  return { action, call, weightKg, repsLabel: reps, heldByVelocity };
}

/** Banner verdict when there is no confident capture: the engine's own effort read. */
export function loggedEffortVerdict(effortVsTarget: 'easier' | 'on_target' | 'harder'): string {
  return effortVsTarget === 'harder'
    ? 'Harder than target'
    : effortVsTarget === 'easier'
      ? 'Easier than target'
      : 'On target';
}
