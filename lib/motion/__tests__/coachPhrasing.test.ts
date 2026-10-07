import { cleanCapture, buildCoachFeedback } from '@/services/shared/motion';
import { analysisFromColumns, SETUP_STROKE_CAPTURE } from '@/services/shared/motion/__tests__/fixtures/realCaptures';
import { buildCoachPhrasingPayload, validateCoachPhrasing } from '../coachPhrasing';

const fb = buildCoachFeedback(cleanCapture(analysisFromColumns(SETUP_STROKE_CAPTURE)), {
  loggedReps: 8, loggedRir: 3, weightKg: 40, pausePoint: 'bottom', history: null,
});
const payload = buildCoachPhrasingPayload(fb, {
  exercise: 'Leg Extension', weight: '90 lb', reps: 8, rir: 3, nextSetCall: 'Next set: add 5 lb (95 lb × 12–13).',
})!;

describe('coach phrasing (optional LLM)', () => {
  it('sends findings only — no template sentences, no samples', () => {
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/keep the lowering speed even/);
    expect(payload.findings.map((f) => f.type)).toEqual(['eccentric_inconsistent', 'consistency']);
  });

  it('accepts a faithful restatement', () => {
    const ok = JSON.stringify({
      verdict: 'Steady set — you had more left.',
      cues: ['Rep 3 lowered in 2.3 seconds versus your usual 1.3; keep it even.', 'Speed held within 8% over 8 reps.'],
      nextSetCall: 'Add 5 lb next set: 95 lb for 12–13.',
    });
    expect(validateCoachPhrasing(ok, payload)).not.toBeNull();
  });

  it('rejects invented numbers, extra cues, hype and medical claims', () => {
    const base = { verdict: 'Steady set.', cues: ['Rep 3 lowered slowly.'], nextSetCall: 'Add 5 lb.' };
    const bad = [
      { ...base, verdict: 'Steady set, about 3 reps left.' }, // 3 is in the input (rep 3, RIR 3) — allowed
      { ...base, cues: ['Rep 3 lowered in 4.1 seconds.'] }, // invented number
      { ...base, cues: ['a', 'b', 'c'] }, // more cues than findings
      { ...base, verdict: 'Great set!' },
      { ...base, cues: ['Watch your knee pain on rep 3.'] },
      { ...base, nextSetCall: null },
    ];
    expect(validateCoachPhrasing(JSON.stringify(bad[0]), payload)).not.toBeNull();
    for (const b of bad.slice(1)) expect(validateCoachPhrasing(JSON.stringify(b), payload)).toBeNull();
    expect(validateCoachPhrasing('not json', payload)).toBeNull();
  });

  it('a low-confidence capture is never sent', () => {
    const low = buildCoachFeedback(cleanCapture(analysisFromColumns(SETUP_STROKE_CAPTURE)), {
      loggedReps: 12, loggedRir: 3, weightKg: 40, pausePoint: 'bottom', history: null,
    });
    expect(buildCoachPhrasingPayload(low, { exercise: 'x', weight: '90 lb', reps: 12, rir: 3, nextSetCall: null })).toBeNull();
  });
});
