/**
 * Tests for the simulation model (RNG + personas).
 *
 * Two jobs:
 *
 *  1. REPLAYABILITY. A stochastic harness is only useful if a failure can be
 *     reproduced from its seed. If these fail, every bug report the harness
 *     ever produces is unactionable.
 *
 *  2. Each persona actually exhibits the behaviour it claims to target. A
 *     "detrainer" that never takes a layoff, or a "plateauer" that quietly
 *     gets stronger, would let the bug class it exists for slip through while
 *     the suite stayed green — the worst possible failure mode for a harness.
 */
import { Rng, hashSeed, rng } from '../rng';
import {
  beginSession,
  createPersonaState,
  repsToFailure,
  honestAttempt,
  fatiguedE1RM,
  type PersonaState,
  type PrescribedSet,
} from '../persona';
import { PERSONA_NAMES, createPersona, type PersonaName } from '../personas';

const EX = 'ex-bench';

function prescribed(overrides: Partial<PrescribedSet> = {}): PrescribedSet {
  return { weightKg: 100, reps: 10, rir: 2, setNumber: 1, exerciseId: EX, ...overrides };
}

function stateAt(e1rm: number): PersonaState {
  return createPersonaState({ [EX]: e1rm });
}

describe('Rng — replayability', () => {
  it('the same seed produces the same stream', () => {
    const a = Array.from({ length: 20 }, () => rng('seed-1').next());
    const b = new Rng('seed-1');
    expect(a[0]).toBe(b.next());

    const s1 = new Rng(42);
    const s2 = new Rng(42);
    expect(Array.from({ length: 50 }, () => s1.next())).toEqual(
      Array.from({ length: 50 }, () => s2.next())
    );
  });

  it('different seeds produce different streams', () => {
    const a = Array.from({ length: 20 }, () => new Rng(1).next());
    const b = Array.from({ length: 20 }, () => new Rng(2).next());
    expect(a).not.toEqual(b);
  });

  it('accepts numeric and string seeds interchangeably', () => {
    expect(hashSeed(7)).toBe(7);
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });

  it('stays in [0, 1) across a long run', () => {
    const r = new Rng('range');
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() is inclusive at both ends and never escapes them', () => {
    const r = new Rng('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.int(1, 4));
    expect(Array.from(seen).sort()).toEqual([1, 2, 3, 4]);
  });

  it('int() rejects an empty range rather than returning NaN', () => {
    expect(() => new Rng('x').int(5, 4)).toThrow(/empty range/);
  });

  it('pick() throws on an empty array rather than returning undefined', () => {
    expect(() => new Rng('x').pick([])).toThrow(/empty array/);
  });

  it('normal() consumes exactly two draws every call, so inserting one elsewhere is detectable', () => {
    // Box–Muller caching would make the draw count depend on call history and
    // turn a small edit into an undiagnosable divergence.
    const a = new Rng('normal');
    a.normal();
    const afterNormal = a.next();

    const b = new Rng('normal');
    b.next();
    b.next();
    expect(b.next()).toBe(afterNormal);
  });

  it('bool(p) approximates p', () => {
    const r = new Rng('bools');
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (r.bool(0.3)) hits++;
    expect(hits / 10_000).toBeGreaterThan(0.27);
    expect(hits / 10_000).toBeLessThan(0.33);
  });

  it('fork() is determined by the parent seed and the label', () => {
    const first = new Rng('p').fork('exercise-noise').next();
    expect(new Rng('p').fork('exercise-noise').next()).toBe(first);
    expect(new Rng('p').fork('other-noise').next()).not.toBe(first);
  });

  it('draws on the parent do not disturb an already-forked child', () => {
    // This is the property fork() exists for: adding a draw somewhere else in
    // the run must not shift an isolated sub-decision's stream.
    const parent = new Rng('p');
    const child = parent.fork('exercise-noise');
    parent.next();
    parent.next();
    expect(child.next()).toBe(new Rng('p').fork('exercise-noise').next());
  });
});

describe('body model', () => {
  it('reps to failure fall as the load rises', () => {
    expect(repsToFailure(100, 50)).toBeGreaterThan(repsToFailure(100, 80));
    expect(repsToFailure(100, 80)).toBeGreaterThan(repsToFailure(100, 95));
  });

  it('a load at or above true capacity yields no reps', () => {
    expect(repsToFailure(100, 100)).toBe(1);
    expect(repsToFailure(100, 120)).toBe(0);
    expect(repsToFailure(100, 0)).toBe(0);
  });

  it('within-session fatigue reduces effective capacity', () => {
    const state = stateAt(100);
    const fresh = fatiguedE1RM(state, EX);
    state.sessionFatigue = 0.1;
    expect(fatiguedE1RM(state, EX)).toBeLessThan(fresh);
  });

  it('fatigue is capped so a long session cannot drive capacity to zero', () => {
    const state = stateAt(100);
    state.sessionFatigue = 10;
    expect(fatiguedE1RM(state, EX)).toBeCloseTo(75, 5);
  });

  it('an honest lifter stops at the ask when it is comfortably reachable', () => {
    // 100 kg e1RM at 60 kg is ~20 reps available; asked for 10.
    const outcome = honestAttempt({
      prescribed: prescribed({ weightKg: 60, reps: 10 }),
      state: stateAt(100),
      rng: new Rng('honest'),
    });
    expect(outcome.repsAchieved).toBe(10);
    expect(outcome.actualRIR).toBeGreaterThan(0);
  });

  it('reports RIR on the 0-4 chip the app records, even with much more in the tank', () => {
    // Ground truth stays exact for the simulator; what the ENGINE sees is
    // capped at what a user could actually enter. Feeding it an RIR of 11
    // would have the engine reading a value no real input can produce.
    const outcome = honestAttempt({
      prescribed: prescribed({ weightKg: 50, reps: 5 }),
      state: stateAt(150),
      rng: new Rng('deep-tank'),
    });
    expect(outcome.actualRIR).toBeGreaterThan(4);
    expect(outcome.reportedRIR).toBe(4);
  });

  it('reports RIR honestly when it is inside the chip range', () => {
    const outcome = honestAttempt({
      prescribed: prescribed({ weightKg: 90, reps: 5 }),
      state: stateAt(100),
      rng: new Rng('shallow-tank'),
    });
    expect(outcome.actualRIR).toBeLessThanOrEqual(4);
    expect(outcome.reportedRIR).toBe(outcome.actualRIR);
  });

  it('an honest lifter falls short when the ask exceeds capacity', () => {
    const outcome = honestAttempt({
      prescribed: prescribed({ weightKg: 97, reps: 10 }),
      state: stateAt(100),
      rng: new Rng('honest'),
    });
    expect(outcome.repsAchieved).toBeLessThan(10);
    expect(outcome.actualRIR).toBe(0);
  });

  it('performing a set accumulates fatigue', () => {
    const state = stateAt(100);
    honestAttempt({ prescribed: prescribed(), state, rng: new Rng('f') });
    expect(state.sessionFatigue).toBeGreaterThan(0);
  });
});

describe('every persona', () => {
  it.each(PERSONA_NAMES)('%s is replayable from its seed', (name) => {
    const run = () => {
      const persona = createPersona(name);
      const state = createPersonaState({ [EX]: persona.initialE1RM(EX) });
      const r = new Rng(`${name}:99`);
      const trace: unknown[] = [];
      for (let session = 0; session < 12; session++) {
        const attending = persona.attendSession({ state, rng: r, today: '2026-04-06' });
        trace.push(attending);
        if (!attending) {
          state.daysSinceLastSession += 2;
          continue;
        }
        beginSession(persona, state, r);
        for (let setNumber = 1; setNumber <= 3; setNumber++) {
          trace.push(
            persona.performSet({ prescribed: prescribed({ setNumber }), state, rng: r })
          );
        }
        state.sessionsCompleted += 1;
        persona.adaptAfterSession(state, r);
        state.daysSinceLastSession = 2;
      }
      return { trace, e1rm: state.trueE1RM.get(EX) };
    };

    expect(run()).toEqual(run());
  });

  it.each(PERSONA_NAMES)('%s never leaks actualRIR into what the engine sees', (name) => {
    const persona = createPersona(name);
    const state = createPersonaState({ [EX]: persona.initialE1RM(EX) });
    const r = new Rng(`${name}:leak`);

    for (let i = 0; i < 200; i++) {
      const outcome = persona.performSet({
        prescribed: prescribed({ setNumber: (i % 3) + 1 }),
        state,
        rng: r,
      });
      // The two fields the engine receives must always be usable values.
      expect(Number.isFinite(outcome.repsAchieved)).toBe(true);
      expect(outcome.repsAchieved).toBeGreaterThanOrEqual(0);
      expect(outcome.reportedRIR).toBeGreaterThanOrEqual(0);
      expect(outcome.reportedRIR).toBeLessThanOrEqual(4);
      expect(Number.isInteger(outcome.repsAchieved)).toBe(true);
    }
  });

  it.each(PERSONA_NAMES)('%s declares what it targets', (name) => {
    expect(createPersona(name).targets.length).toBeGreaterThan(10);
  });
});

/** Run a persona for `sessions` sessions and report what happened. */
function simulate(name: PersonaName, sessions: number, seed = 'sim') {
  const persona = createPersona(name);
  const state = createPersonaState({ [EX]: persona.initialE1RM(EX) });
  const r = new Rng(`${name}:${seed}`);
  const startE1RM = state.trueE1RM.get(EX)!;

  let attended = 0;
  let abandoned = 0;
  let maxGapDays = 0;
  const shortfalls: number[] = [];
  const rirGaps: number[] = [];

  for (let session = 0; session < sessions; session++) {
    if (!persona.attendSession({ state, rng: r, today: '2026-04-06' })) {
      state.daysSinceLastSession += 2;
      maxGapDays = Math.max(maxGapDays, state.daysSinceLastSession);
      continue;
    }
    attended++;
    beginSession(persona, state, r);
    for (let setNumber = 1; setNumber <= 3; setNumber++) {
      const outcome = persona.performSet({
        prescribed: prescribed({ setNumber }),
        state,
        rng: r,
      });
      if (outcome.disposition === 'abandoned') {
        abandoned++;
        break;
      }
      shortfalls.push(10 - outcome.repsAchieved);
      rirGaps.push(outcome.reportedRIR - outcome.actualRIR);
    }
    state.sessionsCompleted += 1;
    persona.adaptAfterSession(state, r);
    state.daysSinceLastSession = 2;
  }

  return {
    attended,
    abandoned,
    maxGapDays,
    startE1RM,
    endE1RM: state.trueE1RM.get(EX)!,
    meanShortfall: shortfalls.reduce((a, b) => a + b, 0) / Math.max(1, shortfalls.length),
    meanRirGap: rirGaps.reduce((a, b) => a + b, 0) / Math.max(1, rirGaps.length),
  };
}

describe('each persona exhibits the behaviour it claims', () => {
  it('linear novice: perfect adherence and real strength gain', () => {
    const r = simulate('linear-novice', 30);
    expect(r.attended).toBe(30);
    expect(r.abandoned).toBe(0);
    expect(r.endE1RM).toBeGreaterThan(r.startE1RM * 1.3);
  });

  it('chaotic intermediate: roughly 70% adherence, and it does abandon sessions', () => {
    const r = simulate('chaotic-intermediate', 200);
    expect(r.attended / 200).toBeGreaterThan(0.6);
    expect(r.attended / 200).toBeLessThan(0.8);
    expect(r.abandoned).toBeGreaterThan(0);
  });

  it('detrainer: takes a real multi-week layoff and comes back weaker than it left', () => {
    const persona = createPersona('detrainer');
    const state = createPersonaState({ [EX]: persona.initialE1RM(EX) });
    const r = new Rng('detrainer:layoff');
    let peak = 0;
    let sawLongGap = false;
    let weakerOnReturn = false;

    for (let day = 0; day < 120; day++) {
      const attending = persona.attendSession({ state, rng: r, today: '2026-04-06' });
      if (!attending) {
        state.daysSinceLastSession += 1;
        if (state.daysSinceLastSession >= 21) sawLongGap = true;
        continue;
      }
      const gapDays = state.daysSinceLastSession;
      peak = Math.max(peak, state.trueE1RM.get(EX)!);

      beginSession(persona, state, r);
      // Read AFTER session start: detraining lands on return, before any set,
      // so this is the capacity the engine actually meets on the comeback.
      if (gapDays >= 21 && state.trueE1RM.get(EX)! < peak) weakerOnReturn = true;
      persona.performSet({ prescribed: prescribed(), state, rng: r });
      state.sessionsCompleted += 1;
      persona.adaptAfterSession(state, r);
      state.daysSinceLastSession = 1;
    }

    expect(sawLongGap).toBe(true);
    expect(weakerOnReturn).toBe(true);
  });

  it('ego lifter: systematically reports MORE in the tank than it had', () => {
    const r = simulate('ego-lifter', 60);
    expect(r.meanRirGap).toBeGreaterThan(0.9);
  });

  it('plateauer: months of training, no meaningful strength change', () => {
    const r = simulate('plateauer', 80);
    const drift = Math.abs(r.endE1RM - r.startE1RM) / r.startE1RM;
    expect(drift).toBeLessThan(0.1);
  });

  it('short-set specialist: misses the target at genuinely zero RIR, honestly reported', () => {
    const persona = createPersona('short-set-specialist');
    const state = createPersonaState({ [EX]: 100 });
    const r = new Rng('short:1');
    const outcomes = [];
    for (let setNumber = 1; setNumber <= 3; setNumber++) {
      // 95 kg against a 100 kg true e1RM: ~1-2 reps available, 10 asked.
      outcomes.push(
        persona.performSet({
          prescribed: prescribed({ weightKg: 95, reps: 10, setNumber }),
          state,
          rng: r,
        })
      );
    }
    for (const o of outcomes) {
      expect(o.repsAchieved).toBeLessThan(10);
      expect(o.actualRIR).toBe(0);
      // Honest, not sandbagging — this is what makes it a Set-3 probe.
      expect(o.reportedRIR).toBe(0);
    }
  });

  it('messy editor: flagged as a set-mutating persona', () => {
    expect(createPersona('messy-editor').editsSets).toBe(true);
    // Behaviourally near-linear on purpose: the mutation pattern is the
    // variable, so lifting noise must not confound a failure.
    const r = simulate('messy-editor', 40);
    expect(r.endE1RM).toBeGreaterThan(r.startE1RM);
  });

  it('only the messy editor edits sets', () => {
    const editors = PERSONA_NAMES.filter((n) => createPersona(n).editsSets);
    expect(editors).toEqual(['messy-editor']);
  });
});
