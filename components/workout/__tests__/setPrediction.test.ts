import {
  accuracyLine,
  expectLine,
  expectedRepsFromLabel,
  nextTimeLine,
  predictionAccuracy,
  predictionOutcome,
} from '../setPrediction';

const LB = 2.20462;

describe('expectedRepsFromLabel', () => {
  it('takes the target-effort count from the strip label', () => {
    expect(expectedRepsFromLabel('9')).toBe(9);
    expect(expectedRepsFromLabel('6–8')).toBe(8);
    expect(expectedRepsFromLabel('6-8')).toBe(8);
  });
  it('has nothing to say for timed or missing labels', () => {
    expect(expectedRepsFromLabel('30s')).toBeNull();
    expect(expectedRepsFromLabel('—')).toBeNull();
    expect(expectedRepsFromLabel('0')).toBeNull();
  });
});

describe('expectLine', () => {
  it('reads as a plain expectation', () => {
    expect(expectLine(9, '140 lbs')).toBe('Expect about 9 reps at 140 lbs');
    expect(expectLine(1, '100 kg')).toBe('Expect about 1 rep at 100 kg');
  });
});

describe('predictionOutcome', () => {
  const prediction = { repCount: 9, weightKg: 140 / LB };
  it('a hit within one rep gets a tick', () => {
    expect(predictionOutcome({ prediction, loggedReps: 9, loggedWeightKg: 140 / LB, hasNextSet: true })).toEqual({
      hit: true,
      text: 'You did 9 ✓',
    });
    expect(predictionOutcome({ prediction, loggedReps: 8, loggedWeightKg: 140 / LB, hasNextSet: true })?.hit).toBe(true);
  });
  it('a miss says which way and that the next set adjusts', () => {
    expect(predictionOutcome({ prediction, loggedReps: 7, loggedWeightKg: 140 / LB, hasNextSet: true })?.text).toBe(
      'You did 7 — harder than expected; next set adjusts'
    );
    expect(predictionOutcome({ prediction, loggedReps: 12, loggedWeightKg: 140 / LB, hasNextSet: false })?.text).toBe(
      'You did 12 — easier than expected; next time adjusts'
    );
  });
  it('says nothing for a set done at another load, or with no prediction', () => {
    expect(predictionOutcome({ prediction, loggedReps: 9, loggedWeightKg: 150 / LB, hasNextSet: true })).toBeNull();
    expect(predictionOutcome({ prediction: undefined, loggedReps: 9, loggedWeightKg: 60, hasNextSet: true })).toBeNull();
  });
});

describe('predictionAccuracy / accuracyLine', () => {
  it('counts only sets that had a prediction at their load', () => {
    const p = { repCount: 10, weightKg: 60 };
    const acc = predictionAccuracy([
      { prediction: p, loggedReps: 10, loggedWeightKg: 60 },
      { prediction: p, loggedReps: 7, loggedWeightKg: 60 },
      { prediction: p, loggedReps: 10, loggedWeightKg: 80 }, // other load: not counted
      { prediction: undefined, loggedReps: 10, loggedWeightKg: 60 }, // no forecast: not counted
    ]);
    expect(acc).toEqual({ hits: 1, total: 2 });
    expect(accuracyLine(acc)).toBe('Predictions within 1 rep: 1 of 2 sets');
    expect(accuracyLine({ hits: 1, total: 1 }, 'today')).toBe('Predictions within 1 rep today: 1 of 1 set');
    expect(accuracyLine(predictionAccuracy([]))).toBeNull();
  });
});

describe('nextTimeLine', () => {
  it('previews a heavier next load', () => {
    expect(nextTimeLine({ weight: 140, topReps: 10, nextWeight: 145, unitLabel: 'lbs' })).toBe(
      'Hit 140 lbs × 10 next time → 145 lbs'
    );
  });
  it('invents nothing when the engine would not add load', () => {
    expect(nextTimeLine({ weight: 140, topReps: 10, nextWeight: 140, unitLabel: 'lbs' })).toBeNull();
    expect(nextTimeLine({ weight: 0, topReps: 10, nextWeight: 5, unitLabel: 'kg' })).toBeNull();
  });
});
