import {
  acceptAllOrder,
  buildReviewPayload,
  extractJsonText,
  suggestionToEdit,
  validateReviewResponse,
  type ReviewPayload,
  type ReviewSuggestion,
} from '../aiReview';
import { makePlanItem } from '../draftPlan';
import { applyPlanEdit } from '../planEdits';
import { projectPlanVolume } from '../planProjection';
import { swapCandidatesForReview } from '../swapRanking';
import { ALL_GROUPS, BY_ID, CATALOG } from './fixtures';
import type { PlanItem } from '../types';

const items: PlanItem[] = [
  makePlanItem(BY_ID.get('row')!, 'item-1', 4, 'generated'),
  makePlanItem(BY_ID.get('bench')!, 'item-2', 4, 'generated'),
  makePlanItem(BY_ID.get('curl')!, 'item-3', 3, 'generated'),
];

function payloadFor(plan: PlanItem[] = items): ReviewPayload {
  return buildReviewPayload({
    items: plan,
    exercisesById: BY_ID,
    swapCandidatesFor: (item) =>
      swapCandidatesForReview(BY_ID.get(item.exerciseId)!, CATALOG, {
        excludeIds: new Set(plan.map((i) => i.exerciseId)),
      }),
    projection: projectPlanVolume(plan, BY_ID, ALL_GROUPS, ['back', 'chest', 'biceps']),
    selectedGroups: ['back', 'chest', 'biceps'],
    stabilizerLoad: { forearms: 'high', erectors: 'ok' },
    timeBudgetMin: 60,
    estimatedDurationMin: 55,
    recentSessions: [{ daysAgo: 1, exercises: ['Deadlift'], groups: ['hamstrings'] }],
  });
}

describe('buildReviewPayload', () => {
  it('matches the request contract', () => {
    const p = payloadFor();
    expect(p.plan.map((e) => [e.itemId, e.order])).toEqual([['item-1', 1], ['item-2', 2], ['item-3', 3]]);
    expect(p.plan[0]).toMatchObject({ exerciseId: 'row', name: 'Barbell Row', sets: 4, primaryMuscles: ['back'] });
    // Closed swap set: same primary muscle, top ≤5, never an exercise already in the plan.
    const ids = p.plan[0].swapCandidates.map((c) => c.exerciseId);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(5);
    expect(ids).not.toContain('row');
    expect(ids).not.toContain('bench');
    expect(p.readiness.back).toMatchObject({ status: 'fresh', weeklyCredited: 0, zoneMin: 10, zoneMax: 25, plannedCredited: 4 });
    expect(p.stabilizerLoad).toEqual({ grip: 'high', lower_back: 'ok' });
    expect(p.constraints).toEqual({ timeBudgetMin: 60, estimatedDurationMin: 55 });
  });
});

describe('validateReviewResponse', () => {
  const payload = payloadFor();
  const swapTarget = payload.plan[0].swapCandidates[0].exerciseId;
  const valid = {
    summary: 'Solid plan; one grip tweak.',
    suggestions: [
      { id: 'a', type: 'swap', itemId: 'item-1', replacementExerciseId: swapTarget, reason: 'Grip is fatigued', severity: 'warn' },
      { id: 'b', type: 'reorder', itemId: 'item-3', newOrder: 1, reason: 'why not', severity: 'info' },
      { id: 'c', type: 'adjust_sets', itemId: 'item-2', newSets: 3, reason: 'time', severity: 'info' },
      { id: 'd', type: 'remove', itemId: 'item-3', reason: 'redundant', severity: 'info' },
      { id: 'e', type: 'flag', itemId: 'item-2', reason: 'watch the shoulder', severity: 'info' },
    ],
  };

  it('accepts a valid response', () => {
    const r = validateReviewResponse(JSON.stringify(valid), payload);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.review.summary).toBe('Solid plan; one grip tweak.');
    expect(r.review.suggestions.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.dropped).toEqual([]);
  });

  it('strips code fences and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n' + JSON.stringify(valid) + '\n```\nThanks';
    expect(validateReviewResponse(raw, payload).ok).toBe(true);
    expect(extractJsonText('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('an empty suggestion list is a valid answer', () => {
    const r = validateReviewResponse('{"summary":"","suggestions":[]}', payload);
    expect(r).toEqual({ ok: true, review: { summary: '', suggestions: [] }, dropped: [] });
  });

  it('rejects malformed responses outright', () => {
    for (const raw of ['', 'not json', '{"summary": "x"', '[]', '{"suggestions": "none"}', '{"summary": 5, "suggestions": []}', 'null']) {
      expect(validateReviewResponse(raw, payload).ok).toBe(false);
    }
  });

  it('drops out-of-range values', () => {
    const r = validateReviewResponse(
      JSON.stringify({
        suggestions: [
          { type: 'adjust_sets', itemId: 'item-1', newSets: 0, reason: 'x' },
          { type: 'adjust_sets', itemId: 'item-1', newSets: 11, reason: 'x' },
          { type: 'adjust_sets', itemId: 'item-1', newSets: 2.5, reason: 'x' },
          { type: 'reorder', itemId: 'item-1', newOrder: 0, reason: 'x' },
          { type: 'reorder', itemId: 'item-1', newOrder: 4, reason: 'x' },
          { type: 'reorder', itemId: 'item-2', newOrder: 3, reason: 'ok' },
        ],
      }),
      payload
    );
    expect(r.ok && r.review.suggestions.map((s) => [s.type, s.newOrder])).toEqual([['reorder', 3]]);
    expect(r.ok && r.dropped).toHaveLength(5);
  });

  it('drops hallucinated item ids and exercises outside swapCandidates', () => {
    const r = validateReviewResponse(
      JSON.stringify({
        suggestions: [
          { type: 'remove', itemId: 'item-99', reason: 'x' },
          { type: 'swap', itemId: 'item-1', replacementExerciseId: 'made-up-row', reason: 'x' },
          // Real exercise, same muscle, but in the plan already → not a candidate.
          { type: 'swap', itemId: 'item-1', replacementExerciseId: 'bench', reason: 'x' },
          { type: 'swap', itemId: 'item-1', reason: 'no target' },
          { type: 'teleport', itemId: 'item-1', reason: 'x' },
        ],
      }),
      payload
    );
    expect(r.ok && r.review.suggestions).toEqual([]);
    expect(r.ok && r.dropped.map((d) => d.why)).toEqual([
      'unknown itemId item-99',
      'swap to made-up-row not in swapCandidates',
      'swap to bench not in swapCandidates',
      'swap to undefined not in swapCandidates',
      'unknown type teleport',
    ]);
  });

  it('caps at 5 suggestions, clips text, defaults severity, de-dupes ids', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: 'x', type: 'flag', itemId: 'item-1', reason: 'r'.repeat(200), severity: i === 0 ? 'bogus' : 'warn' }));
    const r = validateReviewResponse(JSON.stringify({ summary: 's'.repeat(300), suggestions: many }), payload);
    if (!r.ok) throw new Error('expected ok');
    expect(r.review.suggestions).toHaveLength(5);
    expect(r.review.summary.length).toBeLessThanOrEqual(140);
    expect(r.review.suggestions[0].reason.length).toBeLessThanOrEqual(120);
    expect(r.review.suggestions[0].severity).toBe('info');
    expect(new Set(r.review.suggestions.map((s) => s.id)).size).toBe(5);
  });
});

describe('suggestionToEdit (applied through the shared edit path)', () => {
  const payload = payloadFor();
  const target = payload.plan[0].swapCandidates[0].exerciseId;
  const s = (over: Partial<ReviewSuggestion>): ReviewSuggestion => ({ id: 'x', type: 'flag', itemId: 'item-1', reason: 'r', severity: 'info', ...over });

  it('maps each type to a PlanEdit', () => {
    expect(suggestionToEdit(s({ type: 'swap', replacementExerciseId: target }), items, BY_ID, payload)).toMatchObject({ type: 'swap', itemId: 'item-1', source: 'ai' });
    expect(suggestionToEdit(s({ type: 'reorder', newOrder: 3 }), items, BY_ID, payload)).toEqual({ type: 'move', itemId: 'item-1', toIndex: 2 });
    expect(suggestionToEdit(s({ type: 'adjust_sets', newSets: 2 }), items, BY_ID, payload)).toEqual({ type: 'set_sets', itemId: 'item-1', sets: 2 });
    expect(suggestionToEdit(s({ type: 'remove' }), items, BY_ID, payload)).toEqual({ type: 'remove', itemId: 'item-1' });
    expect(suggestionToEdit(s({ type: 'flag' }), items, BY_ID, payload)).toBeNull();
  });

  it('never applies a swap outside the candidates, or to an item already changed', () => {
    expect(suggestionToEdit(s({ type: 'swap', replacementExerciseId: 'squat' }), items, BY_ID, payload)).toBeNull();
    const swapped = applyPlanEdit(items, { type: 'swap', itemId: 'item-1', exercise: BY_ID.get('pulldown')! });
    expect(suggestionToEdit(s({ type: 'swap', replacementExerciseId: target }), swapped, BY_ID, payload)).toBeNull();
    const removed = applyPlanEdit(items, { type: 'remove', itemId: 'item-1' });
    expect(suggestionToEdit(s({ type: 'remove' }), removed, BY_ID, payload)).toBeNull();
  });

  it('accept-all applies in-place changes, then moves, then removals', () => {
    const order = acceptAllOrder([
      s({ id: 'rm', type: 'remove' }),
      s({ id: 'mv', type: 'reorder', newOrder: 2 }),
      s({ id: 'sw', type: 'swap' }),
    ]).map((x) => x.id);
    expect(order).toEqual(['sw', 'mv', 'rm']);
  });
});
