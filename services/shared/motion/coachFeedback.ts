/**
 * Coach feedback: turns a CLEANED capture into short, trainer-style lines.
 *
 * Grounding rule (load-bearing): every sentence is built from a finding,
 * and every finding carries the reps and numbers that triggered it. No
 * finding → no sentence. No generic tips, no hype, no medical or injury
 * claims, and praise only when a positive finding backs it.
 *
 * Output shape:
 *   verdict   — one sentence on effort (velocity loss, cross-checked
 *               against logged RIR);
 *   cues      — up to MOTION_SET_CONFIG.coach.maxCues highest-severity
 *               technique / comparison findings;
 *   (the next-set call is composed OUTSIDE this feature from the
 *    prescription engine — services/setRecommendationLine.ts.)
 *
 * A low-confidence capture yields no verdict and no cues — only why.
 * Pure; thresholds in MOTION_SET_CONFIG.coach.
 */

import {
  assessConfidence,
  captureUnclearLine,
  type CleanedCapture,
  type CleanRep,
  type ConfidenceResult,
} from './captureGating';
import { MOTION_SET_CONFIG, type EffortZone } from './motionSetConfig';
import { computeVelocityLoss } from './setSummary';

export type PausePoint = 'bottom' | 'top' | null;

/**
 * Where the measured pause sits. The pipeline measures the pause BEFORE
 * each concentric, i.e. at the start position of the lift. For presses,
 * squats, hinges and lunges that is the bottom; for vertical pulls it is
 * the top (arms overhead). Rows, isolation work and anything unknown have
 * no reliable top/bottom → "between reps".
 */
export function pausePointForPattern(pattern: string | null | undefined): PausePoint {
  switch (pattern) {
    case 'squat':
    case 'hip_hinge':
    case 'lunge':
    case 'horizontal_push':
    case 'vertical_push':
      return 'bottom';
    case 'vertical_pull':
      return 'top';
    default:
      return null;
  }
}

export type CoachFindingType =
  | 'effort'
  | 'pausing'
  | 'eccentric_dropping'
  | 'eccentric_inconsistent'
  | 'rom_shortening'
  | 'grind'
  | 'consistency'
  | 'history';

export interface CoachFinding {
  type: CoachFindingType;
  /** 0 (informational) – 3 (address this now). */
  severity: 0 | 1 | 2 | 3;
  positive: boolean;
  /** The reps and numbers behind the finding — the only facts it may state. */
  evidence: Record<string, number | number[] | string | null>;
  /** One sentence for the coach output. */
  cue: string;
  /** ≤ ~45 chars for the set row's muted second line. */
  short: string;
}

export interface CoachHistory {
  source: 'last set' | 'last session';
  weightKg: number;
  /** Clean reps of that capture (rep number + mean ω). */
  reps: Array<{ n: number; meanW: number }>;
}

export interface CoachContext {
  loggedReps: number | null;
  loggedRir: number | null;
  /** Load of this set, kg (for the same-load history check). */
  weightKg: number | null;
  pausePoint: PausePoint;
  history?: CoachHistory | null;
}

export interface CoachEffort {
  zone: EffortZone;
  loss: number;
  baselineRep: number;
  /** Velocity and logged RIR disagree; which way. */
  disagreement: 'more_than_logged' | 'harder_than_logged' | null;
}

export interface CoachFeedback {
  confidence: ConfidenceResult;
  /** "Capture unclear: …" when confidence is low. */
  unclearLine: string | null;
  effort: CoachEffort | null;
  /** One sentence; null when low confidence or too few reps to read effort. */
  verdict: string | null;
  /** Banner-length verdict ("Steady set, more in the tank"). */
  verdictShort: string | null;
  /** Up to maxCues findings, highest severity first. */
  cues: CoachFinding[];
  /** Every finding (incl. effort) — the structured input for optional LLM phrasing. */
  findings: CoachFinding[];
}

// ---------------------------------------------------------------------------

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const s1 = (ms: number) => (ms / 1000).toFixed(1);
const pct = (f: number) => Math.round(f * 100);

/** "rep 4" / "reps 5 and 7" / "reps 5, 7 and 9". */
export function repList(ns: number[]): string {
  if (ns.length === 1) return `rep ${ns[0]}`;
  const head = ns.slice(0, -1).join(', ');
  return `reps ${head} and ${ns[ns.length - 1]}`;
}

const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function effortFinding(reps: CleanRep[], loggedRir: number | null): { effort: CoachEffort; finding: CoachFinding } | null {
  const v = computeVelocityLoss(reps);
  if (v.loss === null || v.zone === null || v.baselineRep === null) return null;
  const d = MOTION_SET_CONFIG.coach.rirDisagreement;
  const easyish = v.zone === 'easy' || v.zone === 'moderate';
  const disagreement =
    loggedRir === null
      ? null
      : easyish && loggedRir <= d.easyButLoggedAtMost
        ? ('more_than_logged' as const)
        : !easyish && loggedRir >= d.hardButLoggedAtLeast
          ? ('harder_than_logged' as const)
          : null;
  const severity = disagreement ? 2 : v.zone === 'near-failure' ? 2 : v.zone === 'hard' ? 1 : 0;
  const effort: CoachEffort = { zone: v.zone, loss: v.loss, baselineRep: v.baselineRep, disagreement };
  return {
    effort,
    finding: {
      type: 'effort',
      severity,
      positive: false,
      evidence: {
        velocityLossPct: pct(v.loss),
        zone: v.zone,
        baselineRep: v.baselineRep,
        loggedRir,
        disagreement,
      },
      cue: verdictSentence(effort, loggedRir),
      short: verdictShortText(effort),
    },
  };
}

function verdictSentence(e: CoachEffort, loggedRir: number | null): string {
  const p = pct(e.loss);
  if (e.disagreement === 'more_than_logged') {
    return `Your speed held up (${p}% loss), so you likely had more in the tank than the ${loggedRir} RIR you logged.`;
  }
  if (e.disagreement === 'harder_than_logged') {
    return `Your speed dropped ${p}%, which looks harder than the ${loggedRir} RIR you logged.`;
  }
  switch (e.zone) {
    case 'easy':
      return 'Steady set — you had more in the tank.';
    case 'moderate':
      return `Solid working set — speed dropped ${p}%, with reps still in reserve.`;
    case 'hard':
      return `Hard set — speed dropped ${p}%, close to your limit.`;
    default:
      return `Near-failure set — speed dropped ${p}% by the end.`;
  }
}

function verdictShortText(e: CoachEffort): string {
  if (e.disagreement === 'more_than_logged') return 'More in the tank than logged';
  if (e.disagreement === 'harder_than_logged') return 'Harder than logged';
  switch (e.zone) {
    case 'easy':
      return 'Steady set, more in the tank';
    case 'moderate':
      return 'Solid set, reps in reserve';
    case 'hard':
      return 'Hard set, close to your limit';
    default:
      return 'Near failure';
  }
}

function pausingFinding(reps: CleanRep[], where: PausePoint): CoachFinding | null {
  const c = MOTION_SET_CONFIG.coach.pausing;
  const paused = reps.filter((r) => r.dwellMs !== null && r.dwellMs > c.dwellAboveMs);
  if (paused.length < c.minReps) return null;
  const ns = paused.map((r) => r.n);
  const minS = Math.floor(Math.min(...paused.map((r) => r.dwellMs!)) / 100) / 10;
  const place = where === 'bottom' ? 'at the bottom' : where === 'top' ? 'at the top' : 'between reps';
  return {
    type: 'pausing',
    severity: paused.length >= 3 ? 3 : 2,
    positive: false,
    evidence: { reps: ns, minPauseS: minS, maxPauseS: Math.round(Math.max(...paused.map((r) => r.dwellMs!)) / 100) / 10, where: where ?? 'between reps' },
    cue: `You paused ${minS}+ seconds ${place} before ${repList(ns)} — that's resting between reps; keep it to a one-count.`,
    short: `Resting ${minS}+ s ${place === 'between reps' ? 'between reps' : place}`,
  };
}

function eccentricFindings(reps: CleanRep[]): CoachFinding[] {
  const c = MOTION_SET_CONFIG.coach.eccentric;
  const med = median(reps.map((r) => r.eccentricMs));
  if (med <= 0) return [];
  if (med < c.droppingBelowMs) {
    return [
      {
        type: 'eccentric_dropping',
        severity: 3,
        positive: false,
        evidence: { medianEccentricS: Number(s1(med)) },
        cue: `You lowered the weight in about ${s1(med)} seconds per rep — slow the lowering down and control it.`,
        short: `Lowering fast (${s1(med)} s per rep)`,
      },
    ];
  }
  const slow = reps.filter((r) => r.eccentricMs > med * c.inconsistentRatio);
  if (slow.length === 0) return [];
  const worst = slow.reduce((a, b) => (b.eccentricMs > a.eccentricMs ? b : a));
  const ns = slow.map((r) => r.n);
  return [
    {
      type: 'eccentric_inconsistent',
      severity: 2,
      positive: false,
      evidence: { reps: ns, slowestEccentricS: Number(s1(worst.eccentricMs)), medianEccentricS: Number(s1(med)) },
      cue: `${cap(repList(ns))} took ${ns.length > 1 ? 'up to ' : ''}${s1(worst.eccentricMs)} seconds to lower against your usual ${s1(med)} — keep the lowering speed even.`,
      short: `Uneven lowering on ${repList(ns)}`,
    },
  ];
}

function romFinding(reps: CleanRep[]): CoachFinding | null {
  if (reps.length < 6) return null;
  const k = Math.floor(reps.length / 3);
  const first = mean(reps.slice(0, k).map((r) => r.romDeg));
  const last = mean(reps.slice(-k).map((r) => r.romDeg));
  if (first <= 0) return null;
  const drop = 1 - last / first;
  if (drop <= MOTION_SET_CONFIG.coach.romShortening.lastVsFirstThirdDropAbove) return null;
  return {
    type: 'rom_shortening',
    severity: 2,
    positive: false,
    evidence: { firstThirdRomDeg: Math.round(first), lastThirdRomDeg: Math.round(last), dropPct: pct(drop), repsPerThird: k },
    cue: `Your reps got shorter — the last ${k} travelled ${pct(drop)}% less than the first ${k}; finish each rep through the same range.`,
    short: `Reps got shorter (−${pct(drop)}%)`,
  };
}

function grindFinding(reps: CleanRep[]): CoachFinding | null {
  if (reps.length < 3) return null;
  const med = median(reps.map((r) => r.concentricMs));
  const last = reps[reps.length - 1];
  if (med <= 0 || last.concentricMs <= med * MOTION_SET_CONFIG.coach.grind.lastConcentricRatio) return null;
  return {
    type: 'grind',
    severity: 2,
    positive: false,
    evidence: { rep: last.n, concentricS: Number(s1(last.concentricMs)), medianConcentricS: Number(s1(med)) },
    cue: `Rep ${last.n} took ${s1(last.concentricMs)} seconds to lift against your usual ${s1(med)} — that last one was a grind.`,
    short: `Rep ${last.n} was a grind`,
  };
}

function consistencyFinding(reps: CleanRep[], romShortened: boolean): CoachFinding | null {
  const ws = reps.map((r) => r.meanW).filter((w) => w > 0);
  if (ws.length < 4 || romShortened) return null;
  const m = mean(ws);
  const cv = Math.sqrt(mean(ws.map((w) => (w - m) ** 2))) / m;
  if (cv >= MOTION_SET_CONFIG.coach.consistency.maxVelocityCv) return null;
  const within = Math.max(1, pct(cv));
  return {
    type: 'consistency',
    severity: 1,
    positive: true,
    evidence: { reps: ws.length, withinPct: within },
    cue: `Rep speed stayed even across all ${ws.length} reps (within ${within}%) — consistent work.`,
    short: `Even rep speed across ${ws.length} reps`,
  };
}

function historyFinding(reps: CleanRep[], ctx: CoachContext): CoachFinding | null {
  const h = ctx.history;
  const c = MOTION_SET_CONFIG.coach.history;
  if (!h || ctx.weightKg === null || Math.abs(h.weightKg - ctx.weightKg) > c.sameLoadToleranceKg) {
    return null;
  }
  const prev = new Map(h.reps.filter((r) => r.meanW > 0).map((r) => [r.n, r.meanW]));
  const pairs = reps.filter((r) => r.meanW > 0 && prev.has(r.n)).map((r) => r.meanW / prev.get(r.n)! - 1);
  if (pairs.length < 3) return null;
  const change = mean(pairs);
  if (Math.abs(change) <= c.meaningfulChange) return null;
  const faster = change > 0;
  return {
    type: 'history',
    severity: 1,
    positive: faster,
    evidence: {
      comparedTo: h.source,
      fromRep: 1,
      repsCompared: pairs.length,
      changePct: Math.abs(pct(change)),
      direction: faster ? 'faster' : 'slower',
    },
    cue: `Reps 1–${pairs.length} moved ${Math.abs(pct(change))}% ${faster ? 'faster' : 'slower'} than your ${h.source} at the same weight.`,
    short: `${Math.abs(pct(change))}% ${faster ? 'faster' : 'slower'} than ${h.source}`,
  };
}

/** Tiebreak order within a severity: technique first, praise last. */
const PRIORITY: CoachFindingType[] = [
  'eccentric_dropping',
  'pausing',
  'rom_shortening',
  'grind',
  'eccentric_inconsistent',
  'history',
  'consistency',
];

export function buildCoachFindings(reps: CleanRep[], ctx: CoachContext): { effort: CoachEffort | null; findings: CoachFinding[] } {
  const eff = effortFinding(reps, ctx.loggedRir);
  const rom = romFinding(reps);
  const findings = [
    ...(eff ? [eff.finding] : []),
    pausingFinding(reps, ctx.pausePoint),
    ...eccentricFindings(reps),
    rom,
    grindFinding(reps),
    consistencyFinding(reps, rom !== null),
    historyFinding(reps, ctx),
  ].filter((f): f is CoachFinding => f !== null);
  return { effort: eff?.effort ?? null, findings };
}

export function buildCoachFeedback(cleaned: CleanedCapture, ctx: CoachContext): CoachFeedback {
  const confidence = assessConfidence(cleaned, ctx.loggedReps);
  if (confidence.confidence === 'low') {
    return {
      confidence,
      unclearLine: captureUnclearLine(confidence),
      effort: null,
      verdict: null,
      verdictShort: null,
      cues: [],
      findings: [],
    };
  }
  const { effort, findings } = buildCoachFindings(cleaned.reps, ctx);
  const cues = findings
    .filter((f) => f.type !== 'effort')
    .sort(
      (a, b) =>
        b.severity - a.severity || PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type)
    )
    .slice(0, MOTION_SET_CONFIG.coach.maxCues);
  return {
    confidence,
    unclearLine: null,
    effort,
    verdict: effort ? verdictSentence(effort, ctx.loggedRir) : null,
    verdictShort: effort ? verdictShortText(effort) : null,
    cues,
    findings,
  };
}

/** The set row's muted second line: top cue at/above rowCueMinSeverity, else null. */
export function rowCue(feedback: CoachFeedback | null): string | null {
  const top = feedback?.cues[0];
  if (!top || top.positive || top.severity < MOTION_SET_CONFIG.coach.rowCueMinSeverity) return null;
  return top.short;
}
