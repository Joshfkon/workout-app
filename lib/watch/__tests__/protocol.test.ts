import {
  WATCH_PROTOCOL_VERSION,
  buildWatchState,
  createMessageDeduper,
  neighborBlockIndex,
  parseWatchCommand,
  resolveWatchLog,
  watchStateKey,
  type ActiveLoggerSnapshot,
  type WatchLogSetCommand,
} from '../protocol';

const logger = (over: Partial<ActiveLoggerSnapshot> = {}): ActiveLoggerSnapshot => ({
  blockId: 'b1',
  setNumber: 2,
  targetSets: 4,
  weight: '100',
  reps: '8',
  targetRir: 2,
  unit: 'kg',
  minIncrementKg: 2.5,
  isDurationBased: false,
  isBodyweight: false,
  weightMode: 'bodyweight',
  ...over,
});

const logCmd = (over: Partial<WatchLogSetCommand> = {}): WatchLogSetCommand => ({
  type: 'logSet',
  id: 'm1',
  sessionId: 's1',
  blockId: 'b1',
  setNumber: 2,
  weight: 102.5,
  reps: 7,
  rir: 1,
  ...over,
});

describe('parseWatchCommand', () => {
  it('accepts a well-formed logSet', () => {
    expect(parseWatchCommand({ ...logCmd(), v: WATCH_PROTOCOL_VERSION })).toEqual(logCmd());
  });

  it('accepts a null weight (plain bodyweight)', () => {
    expect(parseWatchCommand(logCmd({ weight: null }))).toEqual(logCmd({ weight: null }));
  });

  it.each([
    ['not an object', 'logSet'],
    ['missing id', { ...logCmd(), id: '' }],
    ['newer protocol', { ...logCmd(), v: WATCH_PROTOCOL_VERSION + 1 }],
    ['unknown type', { type: 'deleteEverything', id: 'x' }],
    ['rir out of range', logCmd({ rir: 5 as never })],
    ['fractional rir', logCmd({ rir: 1.5 as never })],
    ['zero reps', logCmd({ reps: 0 })],
    ['fractional reps', logCmd({ reps: 7.5 })],
    ['NaN weight', logCmd({ weight: NaN })],
    ['negative weight', logCmd({ weight: -5 })],
    ['string weight', { ...logCmd(), weight: '100' }],
    ['set number 0', logCmd({ setNumber: 0 })],
    ['missing block', { ...logCmd(), blockId: undefined }],
  ])('rejects %s', (_label, raw) => {
    expect(parseWatchCommand(raw)).toBeNull();
  });

  it('parses navigate, finish and requestState', () => {
    expect(
      parseWatchCommand({ type: 'navigate', id: 'n', sessionId: 's1', blockId: 'b1', direction: 'next' })
    ).toEqual({ type: 'navigate', id: 'n', sessionId: 's1', blockId: 'b1', direction: 'next' });
    expect(
      parseWatchCommand({ type: 'navigate', id: 'n', sessionId: 's1', blockId: 'b1', direction: 'up' })
    ).toBeNull();
    expect(parseWatchCommand({ type: 'finish', id: 'f', sessionId: 's1' })).toEqual({
      type: 'finish',
      id: 'f',
      sessionId: 's1',
    });
    expect(parseWatchCommand({ type: 'requestState', id: 'r' })).toEqual({ type: 'requestState', id: 'r' });
  });
});

describe('createMessageDeduper', () => {
  it('accepts an id once', () => {
    const d = createMessageDeduper();
    expect(d.accept('a')).toBe(true);
    expect(d.accept('a')).toBe(false);
    expect(d.accept('b')).toBe(true);
  });

  it('forgets the oldest ids past capacity', () => {
    const d = createMessageDeduper(2);
    d.accept('a');
    d.accept('b');
    d.accept('c');
    expect(d.accept('a')).toBe(true);
    expect(d.accept('c')).toBe(false);
  });
});

describe('resolveWatchLog', () => {
  it('maps a current log to the shared payload-builder input', () => {
    const r = resolveWatchLog(logCmd(), { sessionId: 's1', logger: logger() });
    expect(r).toEqual({
      ok: true,
      input: expect.objectContaining({ weight: 102.5, reps: 7, rir: 1, unit: 'kg', setType: 'normal' }),
    });
  });

  it('refuses a log for a set the phone already moved past (no double log)', () => {
    expect(resolveWatchLog(logCmd({ setNumber: 1 }), { sessionId: 's1', logger: logger() })).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('refuses a log for another exercise', () => {
    expect(resolveWatchLog(logCmd({ blockId: 'b2' }), { sessionId: 's1', logger: logger() })).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('refuses another session and a missing logger', () => {
    expect(resolveWatchLog(logCmd({ sessionId: 's2' }), { sessionId: 's1', logger: logger() }).ok).toBe(false);
    expect(resolveWatchLog(logCmd(), { sessionId: 's1', logger: null })).toEqual({
      ok: false,
      reason: 'no-active-set',
    });
  });

  it('requires a load for a weighted exercise, like the phone row', () => {
    expect(resolveWatchLog(logCmd({ weight: 0 }), { sessionId: 's1', logger: logger() })).toEqual({
      ok: false,
      reason: 'invalid-weight',
    });
    expect(resolveWatchLog(logCmd({ weight: null }), { sessionId: 's1', logger: logger() }).ok).toBe(false);
  });

  it('logs plain bodyweight with no weight', () => {
    const r = resolveWatchLog(logCmd({ weight: null }), {
      sessionId: 's1',
      logger: logger({ isBodyweight: true, weightMode: 'bodyweight', userBodyweightKg: 80 }),
    });
    expect(r.ok).toBe(true);
  });

  it('caps reps at the exercise maximum', () => {
    const r = resolveWatchLog(logCmd({ reps: 300 }), { sessionId: 's1', logger: logger() });
    expect(r.ok && r.input.reps).toBe(100);
  });
});

describe('buildWatchState', () => {
  const base = {
    sessionId: 's1',
    exerciseName: 'Bench Press',
    exerciseNumber: 2,
    exerciseCount: 5,
    canPrev: true,
    canNext: true,
    rest: null,
    defaultRestSeconds: 120,
    block: { id: 'b1', targetSets: 4, completedSets: 1 },
    unit: 'kg' as const,
  };

  it('mirrors the phone steppers', () => {
    const s = buildWatchState({ ...base, logger: logger() });
    expect(s).toMatchObject({
      active: true,
      canLog: true,
      blockId: 'b1',
      setNumber: 2,
      targetSets: 4,
      weight: 100,
      weightStep: 2.5,
      reps: 8,
      repsLabel: 'reps',
      targetRir: 2,
    });
  });

  it('uses lb plate steps and hides weight for plain bodyweight', () => {
    expect(buildWatchState({ ...base, logger: logger({ unit: 'lb' }) }).weightStep).toBe(5);
    expect(
      buildWatchState({ ...base, logger: logger({ isBodyweight: true, weightMode: 'bodyweight' }) }).weight
    ).toBeNull();
  });

  it('labels holds in seconds and clamps RIR to a chip', () => {
    const s = buildWatchState({ ...base, logger: logger({ isDurationBased: true, reps: '45', targetRir: 6 }) });
    expect(s).toMatchObject({ repsLabel: 'sec', repsStep: 5, maxReps: 600, reps: 45, targetRir: 4 });
  });

  it('keeps the exercise on the watch when every planned set is done', () => {
    const s = buildWatchState({ ...base, block: { id: 'b1', targetSets: 4, completedSets: 4 }, logger: null });
    expect(s).toMatchObject({ active: true, blockId: 'b1', canLog: false, allSetsDone: true, setNumber: 4 });
  });

  it('says "continue on iPhone" (not done) when the row is hidden mid-flow', () => {
    const s = buildWatchState({ ...base, logger: null });
    expect(s).toMatchObject({ canLog: false, allSetsDone: false, setNumber: 2 });
  });

  it('ignores a logger that belongs to another block', () => {
    const s = buildWatchState({ ...base, logger: logger({ blockId: 'other' }) });
    expect(s.canLog).toBe(false);
  });

  it('state key ignores sub-second rest jitter', () => {
    const a = buildWatchState({ ...base, logger: logger(), rest: { endsAt: 1_000_100, totalSeconds: 90 } });
    const b = buildWatchState({ ...base, logger: logger(), rest: { endsAt: 1_000_300, totalSeconds: 90 } });
    const c = buildWatchState({ ...base, logger: logger(), rest: { endsAt: 1_005_000, totalSeconds: 90 } });
    expect(watchStateKey(a)).toBe(watchStateKey(b));
    expect(watchStateKey(a)).not.toBe(watchStateKey(c));
  });
});

describe('neighborBlockIndex', () => {
  const blocks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  it('steps in list order, skipping skipped blocks', () => {
    expect(neighborBlockIndex(blocks, 0, 'next', new Set(['b']))).toBe(2);
    expect(neighborBlockIndex(blocks, 2, 'prev', new Set(['b']))).toBe(0);
    expect(neighborBlockIndex(blocks, 3, 'next', new Set())).toBe(-1);
    expect(neighborBlockIndex(blocks, 0, 'prev', new Set())).toBe(-1);
  });
});
