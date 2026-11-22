import {
  hasRecentLifting,
  orderProgressTabs,
  parseProgressTabParam,
  resolveActiveProgressTab,
  resolveDefaultProgressTab,
} from '../progressTabs';

describe('orderProgressTabs', () => {
  it('puts Body first and Strength last for someone who has not lifted', () => {
    expect(orderProgressTabs(false)).toEqual(['body-composition', 'wellness', 'strength']);
  });

  it('keeps Strength first for a lifter, or while not known', () => {
    expect(orderProgressTabs(true)).toEqual(['strength', 'body-composition', 'wellness']);
    expect(orderProgressTabs(undefined)).toEqual(['strength', 'body-composition', 'wellness']);
  });
});

const emptySummary = { lifts: [], insufficientData: 0 };
// Shape only matters for the length check.
const lifterSummary = { lifts: [{} as never], insufficientData: 0 };
const newLifterSummary = { lifts: [], insufficientData: 2 };

describe('hasRecentLifting', () => {
  it('is unknown until the lift-trend summary loads', () => {
    expect(hasRecentLifting(undefined)).toBeUndefined();
    expect(hasRecentLifting(null)).toBeUndefined();
  });

  it('counts trended and not-yet-trended lifts in the 12-week window', () => {
    expect(hasRecentLifting(emptySummary)).toBe(false);
    expect(hasRecentLifting(lifterSummary)).toBe(true);
    expect(hasRecentLifting(newLifterSummary)).toBe(true);
  });
});

describe('resolveDefaultProgressTab', () => {
  it('opens a food-only / weigh-in-only user on Body', () => {
    expect(
      resolveDefaultProgressTab({ hasRecentLifting: false, hasBodyOrFoodData: true })
    ).toBe('body-composition');
  });

  it('opens a lifter on Strength, even with body and food data', () => {
    expect(
      resolveDefaultProgressTab({ hasRecentLifting: true, hasBodyOrFoodData: true })
    ).toBe('strength');
    // Known lifter decides immediately, without waiting on the body/food probe.
    expect(
      resolveDefaultProgressTab({ hasRecentLifting: true, hasBodyOrFoodData: undefined })
    ).toBe('strength');
  });

  it('keeps Strength for a user with no data at all', () => {
    expect(
      resolveDefaultProgressTab({ hasRecentLifting: false, hasBodyOrFoodData: false })
    ).toBe('strength');
  });

  it('stays undecided while a needed signal is loading', () => {
    expect(
      resolveDefaultProgressTab({ hasRecentLifting: undefined, hasBodyOrFoodData: true })
    ).toBeNull();
    expect(
      resolveDefaultProgressTab({ hasRecentLifting: false, hasBodyOrFoodData: undefined })
    ).toBeNull();
  });
});

describe('resolveActiveProgressTab', () => {
  it('uses the data default when nothing explicit was chosen', () => {
    expect(
      resolveActiveProgressTab({ pickedTab: null, explicitTab: null, dataDefaultTab: 'body-composition' })
    ).toBe('body-composition');
  });

  it('falls back to Strength while the default is undecided', () => {
    expect(
      resolveActiveProgressTab({ pickedTab: null, explicitTab: null, dataDefaultTab: null })
    ).toBe('strength');
  });

  it('respects an explicit ?tab= deep link over the data default', () => {
    // Food-only user deep-linked to Strength stays on Strength.
    expect(
      resolveActiveProgressTab({
        pickedTab: null,
        explicitTab: parseProgressTabParam('strength'),
        dataDefaultTab: 'body-composition',
      })
    ).toBe('strength');
    // Lifter deep-linked to Body (incl. the legacy alias) stays on Body.
    expect(
      resolveActiveProgressTab({
        pickedTab: null,
        explicitTab: parseProgressTabParam('body'),
        dataDefaultTab: 'strength',
      })
    ).toBe('body-composition');
  });

  it('respects a tab the user tapped over both the link and the default', () => {
    expect(
      resolveActiveProgressTab({
        pickedTab: 'wellness',
        explicitTab: 'strength',
        dataDefaultTab: 'body-composition',
      })
    ).toBe('wellness');
  });
});

describe('parseProgressTabParam', () => {
  it('accepts tab ids and legacy aliases, rejects retired ids', () => {
    expect(parseProgressTabParam('wellness')).toBe('wellness');
    expect(parseProgressTabParam('goals')).toBe('body-composition');
    expect(parseProgressTabParam('training')).toBeNull();
    expect(parseProgressTabParam(null)).toBeNull();
  });
});
