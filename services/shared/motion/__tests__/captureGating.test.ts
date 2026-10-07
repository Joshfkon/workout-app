import { analyzeCapture } from '../captureAnalysis';
import {
  assessConfidence,
  captureUnclearLine,
  cleanCapture,
  describeCleaning,
  MULTI_AXIS_REASON,
} from '../captureGating';
import { buildCoachFeedback } from '../coachFeedback';
import { analysisFromColumns, SETUP_STROKE_CAPTURE } from './fixtures/realCaptures';
import { generateReps, type SyntheticRepSpec } from './synthetic';

const rep = (over: Partial<SyntheticRepSpec> = {}): SyntheticRepSpec => ({
  romDeg: 60,
  concentricMs: 1000,
  pauseTopMs: 300,
  eccentricMs: 1300,
  restAfterMs: 600,
  ...over,
});

const synth = (reps: SyntheticRepSpec[]) => {
  const { samples } = generateReps(reps, { gyroNoise: 0.005, sampleRateHz: 60 });
  return { samples, analysis: analyzeCapture(samples) };
};

describe('cleanCapture — regression: setup stroke as rep 1', () => {
  const cleaned = cleanCapture(analysisFromColumns(SETUP_STROKE_CAPTURE));

  it('rejects rep 1 and keeps 8 clean reps, renumbered 1–8', () => {
    expect(cleaned.rawRepCount).toBe(9);
    expect(cleaned.rejected.map((r) => r.detectedRep)).toEqual([1]);
    expect(cleaned.reps).toHaveLength(8);
    expect(cleaned.reps.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cleaned.reps[0].meanW).toBe(0.56);
  });

  it('logs every reason it rejected the rep', () => {
    const [r] = cleaned.rejected;
    expect(r.reasons).toEqual([
      'lifted in 0.47 s (typical 1.02 s)',
      'lowered in 0.25 s (typical 1.28 s)',
      'peak speed 2.88 rad/s, 2.5× typical',
    ]);
    expect(describeCleaning(cleaned)[0]).toMatch(/^Detected rep 1 set aside as setup motion: lifted in 0\.47 s/);
  });

  it('the first counted rep carries no pause from the setup stroke', () => {
    expect(cleaned.reps[0].dwellMs).toBeNull();
    expect(cleaned.reps[1].dwellMs).not.toBeNull();
  });

  it('is confident against the logged count', () => {
    expect(assessConfidence(cleaned, 8).confidence).toBe('ok');
  });
});

describe('cleanCapture — artifact rules', () => {
  const base = {
    meanW: Array(8).fill(0.6),
    concS: Array(8).fill(1.0),
    eccS: Array(8).fill(1.3),
    peakW: Array(8).fill(1.1),
    romDeg: Array(8).fill(60),
  };
  const withRep = (i: number, over: Partial<Record<keyof typeof base, number>>) => {
    const c = JSON.parse(JSON.stringify(base));
    for (const [k, v] of Object.entries(over)) c[k][i] = v;
    return cleanCapture(analysisFromColumns(c));
  };

  it('each rule alone rejects a rep — including the last two (re-rack)', () => {
    expect(withRep(7, { concS: 0.4 }).rejected[0].detectedRep).toBe(8);
    expect(withRep(6, { eccS: 0.5 }).rejected[0].detectedRep).toBe(7);
    expect(withRep(0, { peakW: 2.1 }).rejected[0].detectedRep).toBe(1);
    expect(withRep(1, { romDeg: 25 }).rejected[0].detectedRep).toBe(2);
  });

  it('keeps reps just inside every boundary', () => {
    const c = withRep(3, { concS: 0.51, eccS: 0.66, peakW: 1.97, romDeg: 31 });
    expect(c.rejected).toEqual([]);
    expect(c.reps).toHaveLength(8);
  });

  it('never counts unpaired movement phases', () => {
    const a = analysisFromColumns(base);
    a.unpairedHalfReps = 3;
    const c = cleanCapture(a);
    expect(c.reps).toHaveLength(8);
    expect(describeCleaning(c)).toContain("3 movement phases didn't pair into a rep (left out of the rep count).");
  });
});

describe('confidence', () => {
  it('flags count mismatch beyond 2 reps or 15% of logged', () => {
    const c = cleanCapture(analysisFromColumns(SETUP_STROKE_CAPTURE)); // 8 clean
    expect(assessConfidence(c, 9).confidence).toBe('ok'); // off by 1 (11%)
    expect(assessConfidence(c, 10).confidence).toBe('low'); // off by 2, but 20%
    expect(assessConfidence(c, 11).confidence).toBe('low'); // off by 3
  });

  it('upgrades a multi-axis capture once the artifact is removed', () => {
    // Real samples: 6 clean strokes about x, plus one setup stroke about z.
    const clean = generateReps(Array(6).fill(rep()), { gyroNoise: 0.005, sampleRateHz: 60 }).samples;
    const lastT = clean[clean.length - 1].tMs;
    // A fast re-rack swing about a tilted axis: on-axis enough to be
    // detected as a rep, off-axis enough to drag the whole-capture PC1 down.
    const wobble = generateReps([rep({ romDeg: 160, concentricMs: 450, eccentricMs: 350 })], {
      axis: { x: 0.6, y: 0, z: 1 },
      gyroNoise: 0.005,
      sampleRateHz: 60,
      leadInMs: 200,
    }).samples.map((s) => ({ ...s, tMs: s.tMs + lastT + 16 }));
    const samples = [...clean, ...wobble];
    const analysis = analyzeCapture(samples);
    const cleaned = cleanCapture(analysis, samples);
    expect(cleaned.rejected.length).toBeGreaterThanOrEqual(1);
    expect(cleaned.pc1ShareClean).not.toBeNull();
    expect(cleaned.pc1ShareClean!).toBeGreaterThan(0.95);
    expect(cleaned.pc1ShareClean!).toBeGreaterThan(cleaned.pc1ShareRaw);
  });

  it('upgrades to confident when the post-cleaning share clears the threshold', () => {
    // Real single-axis samples; the capture-wide share is what a re-rack
    // swing left behind (synthetic data can't hold a detected off-axis
    // stroke without it taking over the PCA axis).
    const samples = generateReps(Array(6).fill(rep()), { gyroNoise: 0.005, sampleRateHz: 60 }).samples;
    const analysis = { ...analyzeCapture(samples), pc1VarianceShare: 0.7 };
    const withSamples = assessConfidence(cleanCapture(analysis, samples), 6);
    expect(withSamples).toMatchObject({ confidence: 'ok', upgradedByCleaning: true });
    // Without samples there is nothing to recompute: stays low.
    expect(assessConfidence(cleanCapture(analysis), 6).confidence).toBe('low');
  });

  it('a low PC1 that cleaning cannot fix reads in plain language', () => {
    const cleaned = cleanCapture(analysisFromColumns(SETUP_STROKE_CAPTURE, 0.6));
    const conf = assessConfidence(cleaned, 8);
    expect(conf.confidence).toBe('low');
    expect(conf.reasons).toEqual([MULTI_AXIS_REASON]);
    expect(captureUnclearLine(conf)).toBe(
      'Capture unclear: The sensor picked up movement in more than one direction, so these numbers are rough.'
    );
  });
});

describe('regression: 18,710 ms gap, 20 detected vs 15 logged', () => {
  const { analysis } = synth([
    ...Array.from({ length: 4 }, () => rep()),
    rep({ restAfterMs: 18_710 }),
    ...Array.from({ length: 15 }, () => rep()),
  ]);

  it('splits at the pause and keeps the 15-rep block', () => {
    expect(analysis.reps).toHaveLength(20);
    const cleaned = cleanCapture(analysis);
    expect(cleaned.reps).toHaveLength(15);
    expect(cleaned.splitPauseMs).toBeGreaterThan(18_000);
  });

  it('is confident when the kept block matches the logged count (split found the set)', () => {
    expect(assessConfidence(cleanCapture(analysis), 15).confidence).toBe('ok');
  });

  it('stays unclear when there is no logged count to check the split against', () => {
    const conf = assessConfidence(cleanCapture(analysis), null);
    expect(conf.confidence).toBe('low');
    expect(captureUnclearLine(conf)).toBe('Capture unclear: There was a 19-second stop mid-set.');
  });

  it('a split block that disagrees with the log is unclear for the count, not the pause', () => {
    expect(assessConfidence(cleanCapture(analysis), 20).reasons).toEqual([
      'the sensor counted 15 reps but you logged 20',
      'there was a 19-second stop mid-set',
    ]);
  });

  it('never reports the pause as a dwell — the coached set starts after it', () => {
    const cleaned = cleanCapture(analysis);
    for (const r of cleaned.reps) expect(r.dwellMs ?? 0).toBeLessThan(5_000);
    const fb = buildCoachFeedback(cleaned, { loggedReps: 15, loggedRir: 2, weightKg: 40, pausePoint: 'bottom' });
    expect(fb.confidence.confidence).toBe('ok');
    expect(fb.cues.some((c) => c.type === 'pausing')).toBe(false);
    expect(JSON.stringify(fb)).not.toMatch(/18\s?\d{3}|18\.7|19-second/);
  });

  it('flags the count mismatch when there is no pause to split on', () => {
    const cleaned = cleanCapture(synth(Array.from({ length: 20 }, () => rep())).analysis);
    expect(assessConfidence(cleaned, 15).reasons[0]).toBe('the sensor counted 20 reps but you logged 15');
  });
});
