/**
 * aiReview — the optional, non-blocking AI review of a draft plan.
 *
 * The model reviews JUDGMENT calls only; volume and recovery numbers are
 * computed here and handed over as authoritative context. Everything the
 * model returns is untrusted: it is parsed and validated against the exact
 * payload that was sent, and each surviving suggestion is a discrete diff the
 * user accepts or dismisses. Swaps can only target the item's closed
 * `swapCandidates` list — enforced at validation AND again when applied.
 *
 * Pure: no network, no React. The server action and the client hook share it.
 */

import { SETUP_CONFIG } from './config';
import type { PlanEdit } from './planEdits';
import type { GroupProjection } from './planProjection';
import { STABILIZER_REGION_LABEL } from './exerciseMeta';
import type {
  PlanItem,
  SetupExercise,
  SetupReadinessStatus,
  StabilizerLoadLevel,
} from './types';

export const REVIEW_SYSTEM_PROMPT =
  'You review a planned strength workout. Volume targets and recovery status are already computed and are authoritative. Do not recompute or second-guess them. Look for: redundant movements hitting the same pattern back-to-back; stacked stabilizer fatigue (grip, lower back, rotator cuff) given stabilizerLoad and recentSessions; poor ordering (isolation before a heavy compound for the same group, grip-heavy work before heavy pulls); exercises repeated from the last 48h for recovering groups; plans exceeding the time budget. Return at most 5 suggestions, only where they materially improve the session. An empty list is a valid, good answer. For swaps, use only exerciseIds from that item\'s swapCandidates. Respond with JSON only, no prose or markdown.';

/** Response contract, appended to the user turn so the model sees the exact shape. */
export const REVIEW_RESPONSE_SCHEMA_HINT = `Respond with exactly this JSON shape:
{"summary": "string, <= 140 chars, or empty", "suggestions": [{"id": "string", "type": "swap|reorder|remove|adjust_sets|flag", "itemId": "string", "replacementExerciseId": "string (swap only)", "newOrder": 1, "newSets": 3, "reason": "string, <= 120 chars", "severity": "info|warn"}]}`;

export const REVIEW_TIMEOUT_MS = 10_000;
/** The plan must sit unchanged this long before a background prefetch. */
export const REVIEW_PREFETCH_DEBOUNCE_MS = 2_000;
export const MAX_REVIEW_SUGGESTIONS = 5;
const MAX_SUMMARY_CHARS = 140;
const MAX_REASON_CHARS = 120;

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface ReviewPlanEntry {
  itemId: string;
  exerciseId: string;
  name: string;
  order: number;
  sets: number;
  repRange: [number, number];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  movementPattern: string;
  equipment: string;
  swapCandidates: { exerciseId: string; name: string }[];
}

export interface ReviewPayload {
  plan: ReviewPlanEntry[];
  selectedGroups: string[];
  readiness: Record<
    string,
    {
      status: SetupReadinessStatus;
      weeklyCredited: number;
      zoneMin: number;
      zoneMax: number;
      plannedCredited: number;
    }
  >;
  stabilizerLoad: Record<string, StabilizerLoadLevel>;
  constraints: { timeBudgetMin: number | null; estimatedDurationMin: number };
  recentSessions: { daysAgo: number; exercises: string[]; groups: string[] }[];
}

export interface BuildReviewPayloadInput {
  items: readonly PlanItem[];
  exercisesById: ReadonlyMap<string, SetupExercise>;
  /** Top-N available swap candidates per item (swapCandidatesForReview). */
  swapCandidatesFor: (item: PlanItem) => SetupExercise[];
  projection: readonly GroupProjection[];
  selectedGroups: readonly string[];
  stabilizerLoad: Partial<Record<string, StabilizerLoadLevel>>;
  timeBudgetMin: number | null;
  estimatedDurationMin: number;
  recentSessions: { daysAgo: number; exercises: string[]; groups: string[] }[];
}

export function buildReviewPayload(input: BuildReviewPayloadInput): ReviewPayload {
  const plan: ReviewPlanEntry[] = input.items.map((item, idx) => {
    const ex = input.exercisesById.get(item.exerciseId);
    return {
      itemId: item.itemId,
      exerciseId: item.exerciseId,
      name: ex?.name ?? item.exerciseId,
      order: idx + 1,
      sets: item.sets,
      repRange: item.repRange,
      primaryMuscles: ex ? [ex.primaryMuscle] : [],
      secondaryMuscles: ex?.secondaryMuscles ?? [],
      movementPattern: ex?.movementPattern ?? 'unknown',
      equipment: ex?.equipmentClass ?? ex?.equipment.join(', ') ?? 'unknown',
      swapCandidates: input
        .swapCandidatesFor(item)
        .slice(0, SETUP_CONFIG.swapCandidatesForReview)
        .map((c) => ({ exerciseId: c.id, name: c.name })),
    };
  });

  const readiness: ReviewPayload['readiness'] = {};
  for (const row of input.projection) {
    readiness[row.group] = {
      status: row.status,
      weeklyCredited: row.weeklyCredited,
      zoneMin: row.zoneMin,
      zoneMax: row.zoneMax,
      plannedCredited: row.planned,
    };
  }

  const stabilizerLoad: Record<string, StabilizerLoadLevel> = {};
  for (const [muscle, level] of Object.entries(input.stabilizerLoad)) {
    if (!level) continue;
    const region = (STABILIZER_REGION_LABEL[muscle] ?? muscle).replace(/\s+/g, '_');
    stabilizerLoad[region] = level;
  }

  return {
    plan,
    selectedGroups: [...input.selectedGroups],
    readiness,
    stabilizerLoad,
    constraints: {
      timeBudgetMin: input.timeBudgetMin,
      estimatedDurationMin: input.estimatedDurationMin,
    },
    recentSessions: input.recentSessions,
  };
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

export type ReviewSuggestionType = 'swap' | 'reorder' | 'remove' | 'adjust_sets' | 'flag';

export interface ReviewSuggestion {
  id: string;
  type: ReviewSuggestionType;
  itemId: string;
  replacementExerciseId?: string;
  newOrder?: number;
  newSets?: number;
  reason: string;
  severity: 'info' | 'warn';
}

export interface PlanReview {
  summary: string;
  suggestions: ReviewSuggestion[];
}

export type ReviewValidation =
  | { ok: true; review: PlanReview; dropped: { suggestion: unknown; why: string }[] }
  | { ok: false; error: string };

const TYPES = new Set<ReviewSuggestionType>(['swap', 'reorder', 'remove', 'adjust_sets', 'flag']);

/** Strip ```json fences / leading prose, returning the outermost JSON object text. */
export function extractJsonText(raw: string): string {
  let text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? text.slice(start, end + 1) : text;
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/**
 * Validate one suggestion against the payload it answers. Returns the clean
 * suggestion or the reason it was dropped.
 */
function validateSuggestion(
  raw: unknown,
  index: number,
  payload: ReviewPayload
): { suggestion: ReviewSuggestion } | { why: string } {
  if (!raw || typeof raw !== 'object') return { why: 'not an object' };
  const s = raw as Record<string, unknown>;
  const type = s.type as ReviewSuggestionType;
  if (!TYPES.has(type)) return { why: `unknown type ${String(s.type)}` };
  const entry = payload.plan.find((p) => p.itemId === s.itemId);
  if (!entry) return { why: `unknown itemId ${String(s.itemId)}` };
  if (typeof s.reason !== 'string' || s.reason.trim() === '') return { why: 'missing reason' };

  const out: ReviewSuggestion = {
    id: typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `s${index + 1}`,
    type,
    itemId: entry.itemId,
    reason: clip(s.reason, MAX_REASON_CHARS),
    severity: s.severity === 'warn' ? 'warn' : 'info',
  };

  switch (type) {
    case 'swap': {
      const allowed = entry.swapCandidates.some((c) => c.exerciseId === s.replacementExerciseId);
      if (!allowed) return { why: `swap to ${String(s.replacementExerciseId)} not in swapCandidates` };
      out.replacementExerciseId = s.replacementExerciseId as string;
      break;
    }
    case 'reorder':
      if (!isInt(s.newOrder) || s.newOrder < 1 || s.newOrder > payload.plan.length) {
        return { why: `newOrder ${String(s.newOrder)} out of range` };
      }
      if (s.newOrder === entry.order) return { why: 'reorder to the same position' };
      out.newOrder = s.newOrder;
      break;
    case 'adjust_sets':
      if (!isInt(s.newSets) || s.newSets < SETUP_CONFIG.minSetsPerItem || s.newSets > SETUP_CONFIG.maxSetsPerItem) {
        return { why: `newSets ${String(s.newSets)} out of range` };
      }
      if (s.newSets === entry.sets) return { why: 'adjust_sets to the same count' };
      out.newSets = s.newSets;
      break;
    case 'remove':
    case 'flag':
      break;
  }
  return { suggestion: out };
}

/**
 * Parse + validate a raw model response against the payload that was sent.
 * Any parse/schema failure → { ok: false } (callers log and show nothing).
 * Individually invalid suggestions are dropped (and reported), never fixed up.
 */
export function validateReviewResponse(raw: string, payload: ReviewPayload): ReviewValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(raw));
  } catch {
    return { ok: false, error: 'response is not valid JSON' };
  }
  return validateReviewObject(parsed, payload);
}

/** Same as validateReviewResponse for an already-parsed value (defense in depth on the client). */
export function validateReviewObject(parsed: unknown, payload: ReviewPayload): ReviewValidation {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'response is not a JSON object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.suggestions)) return { ok: false, error: 'suggestions is not an array' };
  if (obj.summary !== undefined && obj.summary !== null && typeof obj.summary !== 'string') {
    return { ok: false, error: 'summary is not a string' };
  }

  const dropped: { suggestion: unknown; why: string }[] = [];
  const suggestions: ReviewSuggestion[] = [];
  const seenIds = new Set<string>();
  obj.suggestions.forEach((raw, index) => {
    const result = validateSuggestion(raw, index, payload);
    if ('why' in result) {
      dropped.push({ suggestion: raw, why: result.why });
      return;
    }
    let id = result.suggestion.id;
    while (seenIds.has(id)) id = `${id}-${index}`;
    seenIds.add(id);
    suggestions.push({ ...result.suggestion, id });
  });

  for (const extra of suggestions.splice(MAX_REVIEW_SUGGESTIONS)) {
    dropped.push({ suggestion: extra, why: 'more than 5 suggestions' });
  }

  return {
    ok: true,
    review: { summary: clip(typeof obj.summary === 'string' ? obj.summary : '', MAX_SUMMARY_CHARS), suggestions },
    dropped,
  };
}

// ---------------------------------------------------------------------------
// Applying suggestions (through the shared edit path)
// ---------------------------------------------------------------------------

/**
 * The PlanEdit a suggestion stands for, re-checked against the CURRENT plan
 * (earlier accepts may have removed or swapped the item). `null` means there
 * is nothing to apply: a flag (acknowledge only) or a suggestion that no
 * longer fits the plan.
 */
export function suggestionToEdit(
  suggestion: ReviewSuggestion,
  items: readonly PlanItem[],
  exercisesById: ReadonlyMap<string, SetupExercise>,
  payload: ReviewPayload
): PlanEdit | null {
  const item = items.find((i) => i.itemId === suggestion.itemId);
  if (!item) return null;
  const sent = payload.plan.find((p) => p.itemId === suggestion.itemId);
  switch (suggestion.type) {
    case 'swap': {
      // The item must still hold the exercise the candidates were built for,
      // and the replacement must be one of them — never anything else.
      if (!sent || item.exerciseId !== sent.exerciseId) return null;
      if (!sent.swapCandidates.some((c) => c.exerciseId === suggestion.replacementExerciseId)) return null;
      const replacement = exercisesById.get(suggestion.replacementExerciseId!);
      return replacement ? { type: 'swap', itemId: item.itemId, exercise: replacement, source: 'ai' } : null;
    }
    case 'reorder':
      return suggestion.newOrder && suggestion.newOrder <= items.length
        ? { type: 'move', itemId: item.itemId, toIndex: suggestion.newOrder - 1 }
        : null;
    case 'adjust_sets':
      return suggestion.newSets ? { type: 'set_sets', itemId: item.itemId, sets: suggestion.newSets } : null;
    case 'remove':
      return { type: 'remove', itemId: item.itemId };
    case 'flag':
      return null;
  }
}

/** Accept-all order: in-place changes first, then moves, then removals, so
 *  positions and item ids stay meaningful while the batch applies. */
export function acceptAllOrder(suggestions: readonly ReviewSuggestion[]): ReviewSuggestion[] {
  const rank: Record<ReviewSuggestionType, number> = { swap: 0, adjust_sets: 0, flag: 0, reorder: 1, remove: 2 };
  return [...suggestions].sort(
    (a, b) => rank[a.type] - rank[b.type] || (a.newOrder ?? 0) - (b.newOrder ?? 0)
  );
}

// ---------------------------------------------------------------------------
// Decision log (persisted on Start, for judging whether review is worth it)
// ---------------------------------------------------------------------------

export type ReviewDecisionKind = 'accepted' | 'dismissed' | 'ignored';

export interface ReviewDecision {
  suggestionId: string;
  type: ReviewSuggestionType;
  reason: string;
  severity: 'info' | 'warn';
  decision: ReviewDecisionKind;
  /** false when accepted but it no longer fit the plan (or was a flag). */
  applied: boolean;
  /** The item's exercise when the review was made. */
  exerciseId: string | null;
  replacementExerciseId: string | null;
  /** Hash of the plan the review answered. */
  planHash: string;
}

export function decisionFor(
  suggestion: ReviewSuggestion,
  payload: ReviewPayload,
  planHash: string,
  decision: ReviewDecisionKind,
  applied: boolean
): ReviewDecision {
  return {
    suggestionId: suggestion.id,
    type: suggestion.type,
    reason: suggestion.reason,
    severity: suggestion.severity,
    decision,
    applied,
    exerciseId: payload.plan.find((p) => p.itemId === suggestion.itemId)?.exerciseId ?? null,
    replacementExerciseId: suggestion.replacementExerciseId ?? null,
    planHash,
  };
}
