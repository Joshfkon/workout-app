jest.mock('@/lib/offline/setOutbox', () => ({
  enqueueRowUpsert: jest.fn(async () => {}),
  flushSetOutbox: jest.fn(async () => ({})),
}));

import { enqueueRowUpsert, flushSetOutbox } from '@/lib/offline/setOutbox';
import { enqueuePlanReviewDecisions, reviewDecisionRows } from '../planReviewWrites';
import type { ReviewDecision } from '@/services/workoutSetup/aiReview';

const decision = (over: Partial<ReviewDecision> = {}): ReviewDecision => ({
  suggestionId: 's1',
  type: 'swap',
  reason: 'Grip is fatigued',
  severity: 'warn',
  decision: 'accepted',
  applied: true,
  exerciseId: 'ex-row',
  replacementExerciseId: 'ex-csrow',
  planHash: 'abcd1234',
  ...over,
});

describe('plan review decision persistence', () => {
  it('maps decisions to workout_plan_review_events rows (type + reason + decision)', () => {
    let n = 0;
    const rows = reviewDecisionRows(
      [decision(), decision({ suggestionId: 's2', type: 'flag', decision: 'ignored', applied: false, replacementExerciseId: null })],
      'u1',
      'sess1',
      () => `id-${++n}`
    );
    expect(rows[0]).toMatchObject({
      id: 'id-1', user_id: 'u1', session_id: 'sess1', suggestion_id: 's1', suggestion_type: 'swap',
      reason: 'Grip is fatigued', severity: 'warn', decision: 'accepted', applied: true,
      exercise_id: 'ex-row', replacement_exercise_id: 'ex-csrow', plan_hash: 'abcd1234',
    });
    expect(rows[1]).toMatchObject({ suggestion_type: 'flag', decision: 'ignored', applied: false, replacement_exercise_id: null });
  });

  it('queues each row through the outbox and flushes; no-ops with no decisions', async () => {
    const supabase = {} as never;
    await enqueuePlanReviewDecisions(supabase, { userId: 'u1', sessionId: 's', decisions: [] });
    expect(enqueueRowUpsert).not.toHaveBeenCalled();
    await enqueuePlanReviewDecisions(supabase, { userId: 'u1', sessionId: 's', decisions: [decision(), decision()] });
    expect(enqueueRowUpsert).toHaveBeenCalledTimes(2);
    expect((enqueueRowUpsert as jest.Mock).mock.calls[0][1]).toBe('workout_plan_review_events');
    expect(flushSetOutbox).toHaveBeenCalledTimes(1);
  });
});
