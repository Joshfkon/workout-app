/**
 * Coach feedback: deterministic findings, grounded strictly in the data.
 * Includes the feature-wide banned-language guard (formerly in the
 * observations tests): no emitted string — and no UI source string in the
 * motion feature — may judge a rep.
 */
import * as fs from 'fs';
import * as path from 'path';
import { cleanCapture, type CleanRep } from '../captureGating';
import {
  buildCoachFeedback,
  buildCoachFindings,
  pausePointForPattern,
  rowCue,
  type CoachContext,
  type CoachFinding,
} from '../coachFeedback';
import { analysisFromColumns, SETUP_STROKE_CAPTURE, type RepColumns } from './fixtures/realCaptures';

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
/** No medical / injury claims, no hype. */
const NEVER_SAY = [/injur/i, /\bpain\b/i, /\bdoctor\b/i, /tendon|ligament|joint/i, /!/, /amazing|crushed|beast|killer/i];

const ctx = (over: Partial<CoachContext> = {}): CoachContext => ({
  loggedReps: null,
  loggedRir: null,
  weightKg: 40,
  pausePoint: 'bottom',
  history: null,
  ...over,
});

/** Clean reps from columns (no artifacts expected). */
const cleanFrom = (c: RepColumns) => cleanCapture(analysisFromColumns(c));
const even = (n: number, over: Partial<Record<keyof RepColumns, Array<number | null>>> = {}): RepColumns => ({
  meanW: Array(n).fill(0.6),
  concS: Array(n).fill(1.0),
  eccS: Array(n).fill(1.3),
  peakW: Array(n).fill(1.1),
  romDeg: Array(n).fill(60),
  ...(over as Partial<RepColumns>),
});

/** Every number in a finding's sentences must appear in its evidence. */
function expectGrounded(f: CoachFinding) {
  const allowed = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'number') allowed.add(String(v));
    if (Array.isArray(v)) v.forEach(add);
  };
  Object.values(f.evidence).forEach(add);
  for (const text of [f.cue, f.short]) {
    for (const m of text.match(/\d+(\.\d+)?/g) ?? []) {
      expect({ finding: f.type, text, number: m, ok: allowed.has(m) || allowed.has(String(Number(m))) }).toEqual({
        finding: f.type,
        text,
        number: m,
        ok: true,
      });
    }
  }
}

describe('regression: setup stroke as rep 1 (spec capture)', () => {
  const cleaned = cleanCapture(analysisFromColumns(SETUP_STROKE_CAPTURE));
  const fb = buildCoachFeedback(cleaned, ctx({ loggedReps: 8 }));

  it('reads ≈ 0% loss as "had more in the tank", not 56%', () => {
    expect(fb.effort).toMatchObject({ zone: 'easy', loss: 0, baselineRep: 1 });
    expect(fb.verdict).toBe('Steady set — you had more in the tank.');
    expect(fb.verdictShort).toBe('Steady set, more in the tank');
  });

  it('cues the slow lowering on (clean) rep 3, then earned praise', () => {
    expect(fb.cues.map((c) => c.cue)).toEqual([
      'Rep 3 took 2.3 seconds to lower against your usual 1.3 — keep the lowering speed even.',
      'Rep speed stayed even across all 8 reps (within 8%) — consistent work.',
    ]);
    expect(rowCue(fb)).toBe('Uneven lowering on rep 3');
  });
});

describe('findings', () => {
  const find = (cols: RepColumns, c: Partial<CoachContext> = {}) =>
    buildCoachFindings(cleanFrom(cols).reps, ctx(c)).findings;
  const byType = (fs: CoachFinding[], t: string) => fs.find((f) => f.type === t);

  it('EFFORT zones and the logged-RIR cross-check', () => {
    const fading = (end: number) => even(8, { meanW: [0.8, 0.78, 0.75, 0.7, 0.66, 0.62, end, end] });
    expect(byType(find(fading(0.72)), 'effort')!.evidence.zone).toBe('easy'); // 10%
    expect(byType(find(fading(0.6)), 'effort')!.evidence.zone).toBe('moderate'); // 25%
    expect(byType(find(fading(0.5)), 'effort')!.evidence.zone).toBe('hard'); // 37.5%
    expect(byType(find(fading(0.4)), 'effort')!.evidence.zone).toBe('near-failure'); // 50%

    const more = buildCoachFeedback(cleanFrom(fading(0.72)), ctx({ loggedRir: 0 }));
    expect(more.verdict).toBe('Your speed held up (10% loss), so you likely had more in the tank than the 0 RIR you logged.');
    const harder = buildCoachFeedback(cleanFrom(fading(0.4)), ctx({ loggedRir: 3 }));
    expect(harder.verdict).toBe('Your speed dropped 50%, which looks harder than the 3 RIR you logged.');
  });

  it('PAUSING names the reps and where the pause sits', () => {
    const dwell = [null, 400, 400, 400, 2100, 400, 1700, 400, 2400];
    const cols = even(9, { dwellMs: dwell });
    const at = (p: CoachContext['pausePoint']) => byType(find(cols, { pausePoint: p }), 'pausing')!.cue;
    expect(at('bottom')).toBe(
      "You paused 1.7+ seconds at the bottom before reps 5, 7 and 9 — that's resting between reps; keep it to a one-count."
    );
    expect(at('top')).toMatch(/ at the top before reps 5, 7 and 9/);
    expect(at(null)).toMatch(/ between reps before reps 5, 7 and 9/);
    expect(byType(find(even(9, { dwellMs: [null, 400, 400, 2000, 400, 400, 400, 400, 400] })), 'pausing')).toBeUndefined();
  });

  it('ECCENTRIC: dropping the weight vs an uneven tempo', () => {
    expect(byType(find(even(8, { eccS: Array(8).fill(0.55) })), 'eccentric_dropping')!.cue).toBe(
      'You lowered the weight in about 0.6 seconds per rep — slow the lowering down and control it.'
    );
    const uneven = byType(find(even(8, { eccS: [1.3, 1.3, 2.2, 1.3, 1.3, 2.4, 1.3, 1.3] })), 'eccentric_inconsistent')!;
    expect(uneven.cue).toBe('Reps 3 and 6 took up to 2.4 seconds to lower against your usual 1.3 — keep the lowering speed even.');
  });

  it('ROM SHORTENING compares the last third to the first', () => {
    const f = byType(find(even(9, { romDeg: [62, 61, 60, 60, 59, 58, 54, 53, 52] })), 'rom_shortening')!;
    expect(f.evidence.dropPct).toBe(13);
    expect(f.cue).toBe('Your reps got shorter — the last 3 travelled 13% less than the first 3; finish each rep through the same range.');
    expect(byType(find(even(9, { romDeg: [60, 60, 60, 60, 60, 60, 57, 57, 57] })), 'rom_shortening')).toBeUndefined(); // 5%
  });

  it('GRIND flags only the last rep', () => {
    expect(byType(find(even(8, { concS: [1, 1, 1, 1, 1, 1, 1, 1.5] })), 'grind')!.cue).toBe(
      'Rep 8 took 1.5 seconds to lift against your usual 1.0 — that last one was a grind.'
    );
    expect(byType(find(even(8, { concS: [1, 1, 1, 1.6, 1, 1, 1, 1] })), 'grind')).toBeUndefined();
  });

  it('CONSISTENCY praise only when earned', () => {
    expect(byType(find(even(8)), 'consistency')?.positive).toBe(true);
    expect(byType(find(even(8, { meanW: [0.8, 0.5, 0.8, 0.5, 0.8, 0.5, 0.8, 0.5] })), 'consistency')).toBeUndefined();
    // Even speed but shrinking range: no praise.
    expect(byType(find(even(9, { romDeg: [62, 61, 60, 60, 59, 58, 54, 53, 52] })), 'consistency')).toBeUndefined();
  });

  it('VS HISTORY only at the same load, only past 10%', () => {
    const h = { source: 'last set' as const, weightKg: 40, reps: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, meanW: 0.5 })) };
    expect(byType(find(even(8), { history: h }), 'history')!.cue).toBe(
      'Reps 1–8 moved 20% faster than your last set at the same weight.'
    );
    expect(byType(find(even(8), { history: { ...h, weightKg: 45 } }), 'history')).toBeUndefined();
    const close = { ...h, reps: h.reps.map((r) => ({ ...r, meanW: 0.57 })) };
    expect(byType(find(even(8), { history: close }), 'history')).toBeUndefined();
  });

  it('every number in every sentence comes from its evidence', () => {
    const scenarios: Array<[RepColumns, Partial<CoachContext>]> = [
      [SETUP_STROKE_CAPTURE, { loggedRir: 0 }],
      [even(9, { dwellMs: [null, 400, 400, 400, 2100, 400, 1700, 400, 2400], romDeg: [62, 61, 60, 60, 59, 58, 54, 53, 52], concS: [1, 1, 1, 1, 1, 1, 1, 1, 1.6] }), { loggedRir: 3 }],
      [even(8, { eccS: Array(8).fill(0.55), meanW: [0.8, 0.78, 0.75, 0.7, 0.66, 0.62, 0.4, 0.4] }), {}],
      [even(8), { history: { source: 'last session', weightKg: 40, reps: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, meanW: 0.7 })) } }],
    ];
    for (const [cols, c] of scenarios) {
      const fs = buildCoachFindings(cleanFrom(cols).reps, ctx(c)).findings;
      expect(fs.length).toBeGreaterThan(0);
      fs.forEach(expectGrounded);
      for (const f of fs) for (const re of [...BANNED, ...NEVER_SAY]) expect([f.cue, re.source, re.test(f.cue)]).toEqual([f.cue, re.source, false]);
    }
  });
});

describe('low confidence', () => {
  it('no verdict, no cues, no velocity claims — only the reason', () => {
    const cleaned = cleanCapture(analysisFromColumns(SETUP_STROKE_CAPTURE));
    const fb = buildCoachFeedback(cleaned, ctx({ loggedReps: 12 }));
    expect(fb.verdict).toBeNull();
    expect(fb.cues).toEqual([]);
    expect(fb.findings).toEqual([]);
    expect(fb.unclearLine).toBe('Capture unclear: The sensor counted 8 reps but you logged 12.');
    expect(rowCue(fb)).toBeNull();
  });
});

describe('pausePointForPattern', () => {
  it('maps patterns whose start position is unambiguous', () => {
    expect(pausePointForPattern('squat')).toBe('bottom');
    expect(pausePointForPattern('horizontal_push')).toBe('bottom');
    expect(pausePointForPattern('vertical_pull')).toBe('top');
    expect(pausePointForPattern('isolation')).toBeNull();
    expect(pausePointForPattern(undefined)).toBeNull();
  });
});

it('no UI source string in the motion feature carries banned language', () => {
  const ROOT = path.join(__dirname, '..', '..', '..', '..');
  const offenders: string[] = [];
  for (const dir of ['components/motion', 'services/shared/motion']) {
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'fixtures') walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8');
          for (const p of BANNED) if (p.test(src)) offenders.push(`${path.relative(ROOT, full)} (${p})`);
        }
      }
    };
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) walk(abs);
  }
  expect(offenders).toEqual([]);
});

// Keep the CleanRep type import live for readers of the fixtures.
export type _CleanRep = CleanRep;
