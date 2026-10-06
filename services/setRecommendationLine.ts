/**
 * One-line set recommendation ("Next set: stay at 90 lb, aim for 13–15
 * reps.") plus at most one supporting reason.
 *
 * NOT a decision engine. The load and reps always come from the
 * prescription engine (the caller passes what nextSetPrescription /
 * recommendSessionStart / the active banner produced); logged RIR stays
 * the primary effort signal. This module only phrases that as an action
 * and applies ONE evidence rule: when velocity loss says the set was much
 * harder than the logged RIR, an engine "add weight" is shown as "hold"
 * (conservative direction only — velocity never adds load).
 *
 * Motion boundary: velocity arrives as plain numbers. Nothing here imports
 * the motion feature, and nothing here changes what the engine stores or
 * prescribes elsewhere — this is display copy.
 */

export type RecommendationAction = 'add' | 'keep' | 'reduce' | 'stop';

export interface VelocityEvidence {
  confidence: 'ok' | 'low';
  /** (fastest − last) / fastest; null when too few reps. */
  loss: number | null;
  /** "Capture unclear: … Logged reps used." when confidence is low. */
  unclearLine: string | null;
}

export interface RecommendationThresholds {
  /** Loss above this with logged RIR ≥ minLoggedRir → effort looked higher. */
  higherEffortLossAbove: number;
  higherEffortMinLoggedRir: number;
  /** Loss below this reads as velocity holding up. */
  lowLossBelow: number;
}

export interface SetRecommendationInput {
  scope: 'next_set' | 'next_session';
  /** Engine output for the next set / session. */
  engine: {
    weightKg: number;
    reps: number;
    effortVsTarget: 'easier' | 'on_target' | 'harder';
  };
  /** The just-logged set's load. */
  lastWeightKg: number;
  repRange: [number, number];
  loggedRir: number | null;
  targetRir: number;
  /** Logged form rating on the set was the worst option. */
  formBrokeDown: boolean;
  velocity: VelocityEvidence | null;
  thresholds: RecommendationThresholds;
  /** kg → "90 lb" in the user's unit, rounded as the banner rounds. */
  formatWeight: (kg: number) => string;
}

export type SetRecommendationLine =
  | { kind: 'unclear'; text: string }
  | {
      kind: 'recommendation';
      action: RecommendationAction;
      headline: string;
      why: string | null;
      /** True when the velocity tiebreak turned an "add" into a "hold". */
      heldByVelocity: boolean;
    };

/** Load moves smaller than this (kg) are a hold. */
const SAME_LOAD_EPS_KG = 0.05;

function repsLabel(engineReps: number, [lo, hi]: [number, number]): string {
  const from = Math.min(Math.max(Math.round(engineReps), lo), hi);
  return from >= hi ? `${hi}` : `${from}–${hi}`;
}

const fmtRir = (r: number) => (Number.isInteger(r) ? String(r) : r.toFixed(1));

function headlineFor(
  scope: SetRecommendationInput['scope'],
  action: Exclude<RecommendationAction, 'stop'>,
  weight: string,
  delta: string,
  reps: string
): string {
  if (scope === 'next_session') {
    if (action === 'add') return `Next session: try ${weight} × ${reps}.`;
    if (action === 'reduce') return `Next session: drop to ${weight} × ${reps}.`;
    return `Next session: stay at ${weight} × ${reps}.`;
  }
  if (action === 'add') return `Next set: add ${delta} (${weight}), aim for ${reps} reps.`;
  if (action === 'reduce') return `Next set: drop to ${weight}, aim for ${reps} reps.`;
  return `Next set: stay at ${weight}, aim for ${reps} reps.`;
}

const EFFORT_PHRASE: Record<SetRecommendationInput['engine']['effortVsTarget'], string> = {
  harder: 'the set ran harder than your target',
  easier: 'you had reps to spare',
  on_target: 'you were close to your target effort',
};

/** The one supporting reason: velocity when available, else logged RIR. */
function whyFor(
  input: SetRecommendationInput,
  loss: number | null,
  higherEffortThanLogged: boolean,
  heldByVelocity: boolean
): string | null {
  const { engine, thresholds, loggedRir, targetRir } = input;
  if (loss === null) {
    return loggedRir === null
      ? null
      : `Why: you logged ${fmtRir(loggedRir)} RIR against a ${fmtRir(targetRir)} RIR target.`;
  }
  const pct = Math.round(loss * 100);
  if (heldByVelocity) {
    return `Why: velocity dropped ${pct}%. Effort looked higher than logged — hold weight.`;
  }
  const easierButSlowed =
    loss > thresholds.higherEffortLossAbove && engine.effortVsTarget === 'easier';
  if (higherEffortThanLogged || easierButSlowed) {
    return `Why: velocity dropped ${pct}% — effort looked higher than logged.`;
  }
  if (loss < thresholds.lowLossBelow && engine.effortVsTarget === 'harder') {
    return `Why: you logged ${fmtRir(loggedRir ?? 0)} RIR, though velocity held up (${pct}% loss).`;
  }
  return `Why: velocity dropped ${pct}% — ${EFFORT_PHRASE[engine.effortVsTarget]}.`;
}

export function composeSetRecommendation(input: SetRecommendationInput): SetRecommendationLine {
  const { engine, lastWeightKg, velocity, thresholds, formatWeight } = input;

  // Low confidence: no velocity claims and no recommendation at all.
  if (velocity && velocity.confidence === 'low') {
    return { kind: 'unclear', text: velocity.unclearLine ?? 'Capture unclear. Logged reps used.' };
  }

  if (input.formBrokeDown) {
    return {
      kind: 'recommendation',
      action: 'stop',
      headline: 'Stop this exercise for today — you logged form breaking down.',
      why: null,
      heldByVelocity: false,
    };
  }

  const delta = engine.weightKg - lastWeightKg;
  let action: Exclude<RecommendationAction, 'stop'> =
    delta > SAME_LOAD_EPS_KG ? 'add' : delta < -SAME_LOAD_EPS_KG ? 'reduce' : 'keep';

  const loss = velocity?.loss ?? null;
  const higherEffortThanLogged =
    loss !== null &&
    loss > thresholds.higherEffortLossAbove &&
    input.loggedRir !== null &&
    input.loggedRir >= thresholds.higherEffortMinLoggedRir;

  // Tiebreak (conservative only): velocity can turn an add into a hold.
  const heldByVelocity = action === 'add' && higherEffortThanLogged;
  if (heldByVelocity) action = 'keep';
  const weightKg = heldByVelocity ? lastWeightKg : engine.weightKg;
  const reps = repsLabel(heldByVelocity ? input.repRange[0] : engine.reps, input.repRange);

  return {
    kind: 'recommendation',
    action,
    headline: headlineFor(input.scope, action, formatWeight(weightKg), formatWeight(delta), reps),
    why: whyFor(input, loss, higherEffortThanLogged, heldByVelocity),
    heldByVelocity,
  };
}
