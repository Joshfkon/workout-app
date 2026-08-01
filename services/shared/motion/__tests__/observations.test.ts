/**
 * Post-set observations: descriptive language only, within-set median
 * reference only. The framing constraint is enforced here as a test, not a
 * convention: no emitted string — and no UI source string in the feature —
 * may judge a rep.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CaptureRep } from '../captureAnalysis';
import {
  buildObservations,
  NOTHING_NOTABLE_LINE,
  OBSERVATIONS_CONTEXT_LINE,
  THIN_REFERENCE_LINE,
} from '../observations';

/**
 * Language that judges reps instead of describing them. ROM shortening and
 * velocity loss are what approaching failure looks like in a productive
 * set — flagging them as errors would systematically discount the most
 * stimulative reps.
 */
const BANNED = [
  /didn['’]?t count/i,
  /not counted/i,
  /\binvalid\b/i,
  /incomplete rep/i,
  /bad form/i,
  /form breakdown/i,
  /partial rep/i,
  /failed rep/i,
];

function expectNoBannedLanguage(text: string, context: string) {
  for (const pattern of BANNED) {
    if (pattern.test(text)) {
      throw new Error(`Banned language ${pattern} in ${context}: "${text}"`);
    }
  }
}

/** Minimal CaptureRep for observation tests (half-rep spans unused here). */
function mkRep(
  index: number,
  args: { rom: number; meanW: number; peakW?: number; dwell?: number | null; accel?: number | null }
): CaptureRep {
  return {
    index,
    concentric: null as never,
    eccentric: null as never,
    concentricMs: 1200,
    eccentricMs: 1500,
    peakW: args.peakW ?? args.meanW * 1.6,
    meanWConcentric: args.meanW,
    romConcentricDeg: args.rom,
    romEccentricDeg: args.rom,
    romGravityDeg: null,
    bottomDwellMs: args.dwell === undefined ? 250 : args.dwell,
    turnaroundPeakAccelRadps2: args.accel === undefined ? 2.0 : args.accel,
  };
}

describe('buildObservations', () => {
  it('suppresses all median comparisons below 4 reps (raw values still shown by the panel)', () => {
    const reps = [
      mkRep(0, { rom: 70, meanW: 1.0, dwell: null, accel: null }),
      mkRep(1, { rom: 50, meanW: 0.5 }), // would trip ROM + velocity lines…
      mkRep(2, { rom: 45, meanW: 0.4 }),
    ];
    const obs = buildObservations(reps);
    expect(obs.referenceTooThin).toBe(true);
    expect(obs.lines).toHaveLength(0);
  });

  it('renders the nothing-notable line for flat metrics', () => {
    const reps = Array.from({ length: 8 }, (_, i) =>
      mkRep(i, { rom: 70, meanW: 1.0, dwell: i === 0 ? null : 250, accel: i === 0 ? null : 2.0 })
    );
    const obs = buildObservations(reps);
    expect(obs.referenceTooThin).toBe(false);
    expect(obs.nothingNotable).toBe(true);
    expect(obs.lines).toHaveLength(0);
    expect(NOTHING_NOTABLE_LINE).toMatch(/consistent across the set/);
  });

  it('emits all four line types on a fatiguing set, with collapsed rep ranges', () => {
    // 12 reps: ROM shortens on 10–12, velocity halves, turnaround accel
    // triples in the last third, dwell collapses from rep 2 to rep 11.
    const reps = Array.from({ length: 12 }, (_, i) => {
      const late = i >= 9;
      return mkRep(i, {
        rom: late ? 52 : 70, // 52/70 = 74% of median
        meanW: 1.0 - (0.5 * i) / 11, // rep1 1.0 → rep12 0.5
        dwell: i === 0 ? null : i === 1 ? 340 : i === 10 ? 90 : 250,
        accel: i === 0 ? null : late ? 6.0 : 2.0,
      });
    });
    const obs = buildObservations(reps);
    expect(obs.nothingNotable).toBe(false);
    expect(obs.lines).toHaveLength(4);

    const [romLine, velLine, turnLine, dwellLine] = obs.lines;
    expect(romLine).toMatch(/^Reps 10-12 traveled 74% of your set median\.$/);
    expect(velLine).toMatch(/^Mean concentric velocity fell 50% from rep 1 to rep 12\.$/);
    expect(turnLine).toMatch(/^Reps 9-12 showed \d\.\dx the bottom-turnaround acceleration of reps 1-4\.$/);
    expect(dwellLine).toMatch(/^Bottom dwell dropped from 340 ms on rep 2 to 90 ms on rep 11\.$/);

    for (const line of obs.lines) expectNoBannedLanguage(line, 'observation line');
  });

  it('emits at most one line per metric type and skips sub-threshold deviations', () => {
    // 15% velocity drop (< 20% threshold), mild ROM dip (90% of median).
    const reps = Array.from({ length: 8 }, (_, i) =>
      mkRep(i, {
        rom: i >= 6 ? 63 : 70,
        meanW: 1.0 - (0.15 * i) / 7,
        dwell: i === 0 ? null : 250,
        accel: i === 0 ? null : 2.0,
      })
    );
    const obs = buildObservations(reps);
    expect(obs.lines).toHaveLength(0);
    expect(obs.nothingNotable).toBe(true);
  });

  it('collapses non-contiguous rep ranges and uses the singular for one rep', () => {
    // Non-contiguous ROM qualifiers: reps 3 and 5-7.
    const reps = Array.from({ length: 8 }, (_, i) =>
      mkRep(i, {
        rom: i === 2 || (i >= 4 && i <= 6) ? 50 : 70,
        meanW: 1.0,
        dwell: i === 0 ? null : 250,
        accel: i === 0 ? null : 2.0,
      })
    );
    const obs = buildObservations(reps);
    expect(obs.lines.some((l) => /^Reps 3, 5-7 traveled /.test(l))).toBe(true);

    // A single qualifying rep reads "Rep 6", not "Reps 6".
    const single = Array.from({ length: 8 }, (_, i) =>
      mkRep(i, { rom: i === 5 ? 50 : 70, meanW: 1.0, dwell: i === 0 ? null : 250, accel: i === 0 ? null : 2.0 })
    );
    const singleObs = buildObservations(single);
    expect(singleObs.lines.some((l) => /^Rep 6 traveled \d+% of your set median\.$/.test(l))).toBe(true);
  });

  it('emits no dwell line when dwell grows over the set (threshold is a reduction)', () => {
    const reps = Array.from({ length: 6 }, (_, i) =>
      mkRep(i, {
        rom: 70,
        meanW: 1.0,
        dwell: i === 0 ? null : 100 + i * 80, // increasing dwell
        accel: i === 0 ? null : 2.0,
      })
    );
    const obs = buildObservations(reps);
    expect(obs.lines.some((l) => /Bottom dwell/.test(l))).toBe(false);
  });

  it('skips the turnaround line when the first third has no measurable turnarounds', () => {
    // 4 reps: first third = rep 1 only, whose turnaround metrics are null.
    const reps = Array.from({ length: 4 }, (_, i) =>
      mkRep(i, { rom: 70, meanW: 1.0, dwell: i === 0 ? null : 250, accel: i === 0 ? null : 8.0 })
    );
    const obs = buildObservations(reps);
    expect(obs.lines.some((l) => /turnaround/.test(l))).toBe(false);
  });

  it('never emits banned language from any scenario, including the constants', () => {
    const scenarios: CaptureRep[][] = [
      [],
      [mkRep(0, { rom: 10, meanW: 0.1, dwell: null, accel: null })],
      Array.from({ length: 12 }, (_, i) =>
        mkRep(i, {
          rom: 70 - i * 4,
          meanW: 1.2 - i * 0.08,
          dwell: i === 0 ? null : 400 - i * 30,
          accel: i === 0 ? null : 1 + i,
        })
      ),
    ];
    for (const reps of scenarios) {
      const obs = buildObservations(reps);
      for (const line of obs.lines) expectNoBannedLanguage(line, 'observation line');
    }
    expectNoBannedLanguage(OBSERVATIONS_CONTEXT_LINE, 'context line');
    expectNoBannedLanguage(NOTHING_NOTABLE_LINE, 'nothing-notable line');
    expectNoBannedLanguage(THIN_REFERENCE_LINE, 'thin-reference line');
    // The standing context is always present and explicitly descriptive.
    expect(OBSERVATIONS_CONTEXT_LINE).toMatch(/measurements, not errors/);
  });

  it('no UI source string in the motion feature carries banned language', () => {
    const ROOT = path.join(__dirname, '..', '..', '..', '..');
    const DIRS = ['components/motion', 'services/shared/motion'];
    const offenders: string[] = [];
    for (const dir of DIRS) {
      const abs = path.join(ROOT, dir);
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== '__tests__' && entry.name !== 'fixtures') walk(full);
          } else if (/\.(ts|tsx)$/.test(entry.name)) {
            const src = fs.readFileSync(full, 'utf8');
            for (const pattern of BANNED) {
              if (pattern.test(src)) offenders.push(`${path.relative(ROOT, full)} (${pattern})`);
            }
          }
        }
      };
      if (fs.existsSync(abs)) walk(abs);
    }
    expect(offenders).toEqual([]);
  });
});
