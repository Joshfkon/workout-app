/**
 * Optional LLM phrasing of the coach feedback (feature flag
 * NEXT_PUBLIC_MOTION_COACH_LLM, off by default) — the pure half.
 *
 * The model receives ONLY the structured findings, the exercise name, the
 * logged set, and the engine's next-set call — never samples, never the
 * template sentences' reasoning. It may only restate those in a trainer's
 * voice. Its output is validated here and discarded (→ template) if it:
 *   - isn't the expected JSON shape / length;
 *   - contains any number that isn't in the input;
 *   - contains banned / medical / hype language.
 * The templates ship without the LLM; this only ever swaps wording.
 */

import type { CoachFeedback } from '@/services/shared/motion';

export interface CoachPhrasingPayload {
  exercise: string;
  loggedSet: { weight: string; reps: number; rir: number | null };
  verdict: { zone: string; velocityLossPct: number; disagreement: string | null } | null;
  findings: Array<{ type: string; severity: number; positive: boolean; evidence: Record<string, unknown> }>;
  nextSetCall: string | null;
}

export interface CoachPhrasedText {
  verdict: string | null;
  cues: string[];
  nextSetCall: string | null;
}

export const COACH_PHRASING_SYSTEM_PROMPT = `You are a strength coach writing feedback on one set, for a lifter between sets.
You receive JSON with the exercise, the logged set, an effort verdict, up to two findings, and the next-set call.
Rewrite them in a direct, plain trainer's voice. Rules:
- Restate ONLY what is in the JSON. Do not add facts, numbers, advice, causes, or encouragement that the JSON does not contain.
- Every number you write must appear in the JSON exactly.
- verdict: one sentence about effort, from "verdict" (null if verdict is null).
- cues: one sentence per finding, in the given order, keeping its rep numbers and figures. Praise only for findings with "positive": true.
- nextSetCall: restate the given next-set call (null if null). Keep its weight and reps unchanged.
- No emojis, no exclamation marks, no hype, no medical or injury claims.
Reply with JSON only: {"verdict": string|null, "cues": string[], "nextSetCall": string|null}`;

export function buildCoachPhrasingPayload(
  feedback: CoachFeedback,
  args: { exercise: string; weight: string; reps: number; rir: number | null; nextSetCall: string | null }
): CoachPhrasingPayload | null {
  if (feedback.confidence.confidence === 'low' || !feedback.effort) return null;
  return {
    exercise: args.exercise,
    loggedSet: { weight: args.weight, reps: args.reps, rir: args.rir },
    verdict: {
      zone: feedback.effort.zone,
      velocityLossPct: Math.round(feedback.effort.loss * 100),
      disagreement: feedback.effort.disagreement,
    },
    findings: feedback.cues.map((c) => ({
      type: c.type,
      severity: c.severity,
      positive: c.positive,
      evidence: c.evidence,
    })),
    nextSetCall: args.nextSetCall,
  };
}

const NOT_ALLOWED = [
  /injur/i,
  /\bpain\b/i,
  /doctor|physio|medical/i,
  /tendon|ligament|joint/i,
  /!/,
  /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/,
  /form breakdown|bad form|partial rep|failed rep|\binvalid\b/i,
];

const numbersIn = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));

/** Parse + validate a model reply against its payload. Null → use the template. */
export function validateCoachPhrasing(raw: string, payload: CoachPhrasingPayload): CoachPhrasedText | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const p = parsed as Partial<CoachPhrasedText>;
  const str = (v: unknown) => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 220);
  if (!str(p.verdict) || !str(p.nextSetCall) || !Array.isArray(p.cues)) return null;
  if (p.cues.length > payload.findings.length || !p.cues.every((c) => typeof c === 'string' && str(c))) return null;
  if ((p.verdict === null) !== (payload.verdict === null)) return null;
  if ((p.nextSetCall === null) !== (payload.nextSetCall === null)) return null;

  const allowed = new Set(numbersIn(JSON.stringify(payload)));
  const texts = [p.verdict, p.nextSetCall, ...p.cues].filter((t): t is string => typeof t === 'string');
  for (const t of texts) {
    if (NOT_ALLOWED.some((re) => re.test(t))) return null;
    if (numbersIn(t).some((n) => !allowed.has(n))) return null;
  }
  return { verdict: p.verdict ?? null, cues: p.cues as string[], nextSetCall: p.nextSetCall ?? null };
}
