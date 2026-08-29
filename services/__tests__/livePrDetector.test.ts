import { detectLiveSetPr, type LivePrDetectionInput, type LivePrSetInput } from '../livePrDetector';
import { e1rmValueFromRpe } from '../shared/e1rm';

const workingSet = (overrides: Partial<LivePrSetInput> = {}): LivePrSetInput => ({
  weightKg: 100,
  reps: 5,
  rpe: 9,
  feedback: { form: 'clean' },
  isWarmup: false,
  ...overrides,
});

const baseInput = (overrides: Partial<LivePrDetectionInput> = {}): LivePrDetectionInput => ({
  set: workingSet(),
  priorSessionSets: [],
  previousBest: { weightKg: 95, reps: 8, e1rm: 100 },
  isDeload: false,
  exercise: { exerciseType: 'rep_based' },
  ...overrides,
});

describe('detectLiveSetPr', () => {
  it('detects an e1RM PR with percent improvement', () => {
    // 100kg x5 @RPE9 (RIR 1) -> Brzycki eff-6 = 100 * 36/31 ≈ 116.1
    const pr = detectLiveSetPr(baseInput());
    expect(pr).toEqual({
      type: 'e1rm',
      value: e1rmValueFromRpe(100, 5, 9),
      improvement: 16,
    });
  });

  it('falls back to a weight PR when the set has no e1RM estimate', () => {
    // 20 reps @RPE8 = 22 effective reps -> beyond the estimator's domain (0)
    const pr = detectLiveSetPr(
      baseInput({ set: workingSet({ weightKg: 98, reps: 20, rpe: 8 }) })
    );
    expect(pr).toEqual({ type: 'weight', value: 98, improvement: 3 });
  });

  it('detects a reps PR at >= 95% of the record weight', () => {
    // Heavy-single e1RM record stands; more reps near record weight is a reps PR.
    const pr = detectLiveSetPr(
      baseInput({
        previousBest: { weightKg: 100, reps: 8, e1rm: 150 },
        set: workingSet({ weightKg: 96, reps: 10, rpe: 8 }),
      })
    );
    expect(pr).toEqual({ type: 'reps', value: 10, improvement: 2 });
  });

  it('does not award a reps PR below the 95% weight tolerance', () => {
    const pr = detectLiveSetPr(
      baseInput({
        previousBest: { weightKg: 100, reps: 8, e1rm: 150 },
        set: workingSet({ weightKg: 90, reps: 12, rpe: 8 }),
      })
    );
    expect(pr).toBeNull();
  });

  it('never fires on a deload session', () => {
    expect(detectLiveSetPr(baseInput({ isDeload: true }))).toBeNull();
  });

  it('never fires for warmup sets (isWarmup flag)', () => {
    expect(detectLiveSetPr(baseInput({ set: workingSet({ isWarmup: true }) }))).toBeNull();
  });

  it('never fires for warmup sets (setType shape)', () => {
    expect(
      detectLiveSetPr(baseInput({ set: workingSet({ setType: 'warmup' }) }))
    ).toBeNull();
  });

  it('never fires for ugly-form sets', () => {
    expect(
      detectLiveSetPr(baseInput({ set: workingSet({ feedback: { form: 'ugly' } }) }))
    ).toBeNull();
  });

  it('returns null with no stored record (cold start)', () => {
    expect(detectLiveSetPr(baseInput({ previousBest: null }))).toBeNull();
  });

  it('treats missing form feedback as qualifying', () => {
    expect(detectLiveSetPr(baseInput({ set: workingSet({ feedback: null }) }))?.type).toBe('e1rm');
  });

  describe('session high-water mark', () => {
    it('does not re-fire for a set matching an earlier PR set this session', () => {
      const pr = detectLiveSetPr(
        baseInput({ priorSessionSets: [workingSet()], set: workingSet() })
      );
      expect(pr).toBeNull();
    });

    it('fires again when a later set beats the session best', () => {
      const pr = detectLiveSetPr(
        baseInput({
          priorSessionSets: [workingSet()],
          set: workingSet({ weightKg: 102.5 }),
        })
      );
      expect(pr?.type).toBe('e1rm');
    });

    it('ignores warmup and ugly-form sets when raising the baseline', () => {
      const pr = detectLiveSetPr(
        baseInput({
          priorSessionSets: [
            workingSet({ isWarmup: true }),
            workingSet({ feedback: { form: 'ugly' } }),
          ],
          set: workingSet(),
        })
      );
      // Neither prior set raised the baseline, so this still reads as a PR.
      expect(pr?.type).toBe('e1rm');
    });
  });

  describe('duration exercises (seconds in reps)', () => {
    const durationInput = (overrides: Partial<LivePrDetectionInput> = {}) =>
      baseInput({
        exercise: { exerciseType: 'duration_based' },
        previousBest: { weightKg: 20, reps: 45, e1rm: 0 },
        ...overrides,
      });

    it('detects a weight PR', () => {
      const pr = detectLiveSetPr(
        durationInput({ set: workingSet({ weightKg: 25, reps: 30 }) })
      );
      expect(pr).toEqual({ type: 'weight', value: 25, improvement: 25 });
    });

    it('detects a hold-duration PR at >= 95% weight', () => {
      const pr = detectLiveSetPr(
        durationInput({ set: workingSet({ weightKg: 20, reps: 60 }) })
      );
      expect(pr).toEqual({ type: 'duration', value: 60, improvement: 15 });
    });

    it('never awards an e1RM PR for a duration exercise', () => {
      const pr = detectLiveSetPr(
        durationInput({ set: workingSet({ weightKg: 20, reps: 40, rpe: 9 }) })
      );
      expect(pr).toBeNull();
    });
  });

  it('treats a missing exercise (no exerciseType) as rep-based', () => {
    expect(detectLiveSetPr(baseInput({ exercise: undefined }))?.type).toBe('e1rm');
  });
});
