import {
  beginnerModeSummaryLine,
  beginnerMuscleName,
  beginnerPickReason,
  beginnerSuggestedFocus,
  effortLeftPhrase,
  effortTargetPhrase,
  plainRirText,
  resolveBeginnerMode,
} from '../beginnerMode';

describe('resolveBeginnerMode', () => {
  it('uses the saved choice when there is one', () => {
    expect(resolveBeginnerMode(false, 'novice')).toBe(false);
    expect(resolveBeginnerMode(true, 'advanced')).toBe(true);
  });

  it('defaults on for novices and off for everyone else', () => {
    expect(resolveBeginnerMode(undefined, 'novice')).toBe(true);
    expect(resolveBeginnerMode(undefined, 'intermediate')).toBe(false);
    expect(resolveBeginnerMode(undefined, 'advanced')).toBe(false);
    expect(resolveBeginnerMode(undefined, null)).toBe(false);
    expect(resolveBeginnerMode('yes', 'intermediate')).toBe(false);
  });
});

describe('beginnerModeSummaryLine', () => {
  it('says what the mode is and how to change it, either way', () => {
    expect(beginnerModeSummaryLine(true)).toMatch(/simpler workout screen/i);
    expect(beginnerModeSummaryLine(true)).toMatch(/Turn it off/);
    expect(beginnerModeSummaryLine(false)).toMatch(/Turn it on/);
    expect(beginnerModeSummaryLine(false)).toMatch(/simpler workout screen/);
  });
});

describe('effort phrases', () => {
  it('says the target in words', () => {
    expect(effortTargetPhrase(2)).toBe('stop 2 reps short of failure');
    expect(effortTargetPhrase(1)).toBe('stop 1 rep short of failure');
    expect(effortTargetPhrase(0)).toBe('go until you can’t do another rep');
    expect(effortTargetPhrase(4)).toBe('stop 4 or more reps short of failure');
  });

  it('says what is left in words', () => {
    expect(effortLeftPhrase(1)).toBe('about 1 more rep in you');
    expect(effortLeftPhrase(3)).toBe('about 3 more reps in you');
    expect(effortLeftPhrase(0)).toBe('no more reps in you');
  });
});

describe('plainRirText', () => {
  it.each([
    ['8 reps @ 2 RIR vs 3 target — load up', '8 reps with 2 reps left vs 3 target — load up'],
    ['hit 1 RIR vs 2 target', 'hit 1 rep left vs 2 target'],
    ['Target: 8–12 reps leaving 2 in reserve (RIR 2).', 'Target: 8–12 reps stopping when you could still do 2 more.'],
    ['Stop 2 reps short of failure', 'Stop when you could still do 2 more'],
    ['then stop 2 reps short of failure.', 'then stop when you could still do 2 more.'],
    ['stopping 1 rep short of failure', 'stopping when you could still do 1 more'],
    ['predicts about 9 reps to failure (0 RIR).', 'predicts about 9 reps to failure (0 reps left).'],
    ['with ≥2 RIR in 3 sessions', 'with ≥2 reps left in 3 sessions'],
    ['with nothing left in reserve — too heavy', 'with nothing left — too heavy'],
    ['5 left in the tank (RIR)', '5 left in you'],
  ])('%s', (input, expected) => {
    expect(plainRirText(input)).toBe(expected);
  });

  it('leaves text without RIR alone', () => {
    expect(plainRirText('From your last session: 60 kg × 10')).toBe('From your last session: 60 kg × 10');
  });
});

describe('suggested-workout wording', () => {
  it('uses everyday muscle names for the jargon ones', () => {
    expect(beginnerMuscleName('glute_med')).toBe('Side glutes');
    expect(beginnerMuscleName('lateral_delts')).toBe('Side shoulders');
    expect(beginnerMuscleName('biceps')).toBe('Biceps');
  });

  it('turns weekly-set accounting into "behind this week"', () => {
    expect(beginnerPickReason('Side Delts: 2 of 10 weekly sets done', 'lateral_delts')).toBe(
      'Side shoulders: needs more work this week'
    );
    expect(beginnerPickReason('Glute Med: 0 of 6 weekly sets done, almost recovered', 'glute_med')).toBe(
      'Side glutes: needs more work this week, almost rested'
    );
    expect(beginnerPickReason('Quads — near weekly max, light technique work only', 'quads')).toBe(
      'Front thighs: light technique work only'
    );
  });

  it('rewrites the focus line', () => {
    expect(beginnerSuggestedFocus('Today: side delts and glute med — rested, and furthest behind on this week’s sets.')).toBe(
      'Today: side shoulders and side glutes — rested, and they’ve had the least work this week.'
    );
    expect(
      beginnerSuggestedFocus(
        'Light technique session — every under-target muscle is close to its weekly recoverable maximum (MRV), so today stays easy on purpose.'
      )
    ).not.toMatch(/MRV|recoverable/);
  });
});
