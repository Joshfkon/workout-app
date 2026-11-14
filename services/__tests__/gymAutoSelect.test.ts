import {
  AUTO_SELECT_MAX_ACCURACY_M,
  chooseAutoGym,
  shouldLearnGymPosition,
  type ChooseAutoGymInput,
} from '../gymAutoSelect';

// ~0.0009° latitude ≈ 100 m.
const FITNESS_19 = { id: 'f19', latitude: 38.0, longitude: -77.0 };
const PLANET = { id: 'pf', latitude: 38.05, longitude: -77.0 }; // ~5.5 km north
const NO_COORDS = { id: 'garage', latitude: null, longitude: null };

const at = (latitude: number, longitude: number, accuracyM = 30) => ({ latitude, longitude, accuracyM });

const input = (overrides: Partial<ChooseAutoGymInput> = {}): ChooseAutoGymInput => ({
  gyms: [FITNESS_19, PLANET, NO_COORDS],
  position: at(38.0005, -77.0), // ~55 m from Fitness 19
  currentGymId: 'pf',
  chosenManually: false,
  hasLoggedSets: false,
  ...overrides,
});

describe('chooseAutoGym', () => {
  it('switches to the saved gym the phone is in', () => {
    expect(chooseAutoGym(input())).toBe('f19');
  });

  it('switches when no gym is set yet', () => {
    expect(chooseAutoGym(input({ currentGymId: null }))).toBe('f19');
  });

  it('does nothing when that gym is already selected', () => {
    expect(chooseAutoGym(input({ currentGymId: 'f19' }))).toBeNull();
  });

  it('never overrides a gym the user picked', () => {
    expect(chooseAutoGym(input({ chosenManually: true }))).toBeNull();
  });

  it('never moves a workout that already has logged sets', () => {
    expect(chooseAutoGym(input({ hasLoggedSets: true }))).toBeNull();
  });

  it('ignores an inaccurate or missing fix', () => {
    expect(
      chooseAutoGym(input({ position: at(38.0005, -77.0, AUTO_SELECT_MAX_ACCURACY_M + 1) }))
    ).toBeNull();
    expect(chooseAutoGym(input({ position: null }))).toBeNull();
  });

  it('does nothing when no known gym is close', () => {
    expect(chooseAutoGym(input({ position: at(38.02, -77.0) }))).toBeNull(); // ~2.2 km away
  });

  it('does not guess between two known gyms that are both close', () => {
    const nextDoor = { id: 'nd', latitude: 38.0, longitude: -77.0006 }; // ~50 m east
    expect(chooseAutoGym(input({ gyms: [FITNESS_19, nextDoor], position: at(38.0001, -77.0003) }))).toBeNull();
  });
});

describe('shouldLearnGymPosition', () => {
  it('learns the position of a gym that has none', () => {
    expect(
      shouldLearnGymPosition({ gymId: 'garage', gyms: [FITNESS_19, NO_COORDS], position: at(38.1, -77.1) })
    ).toBe(true);
  });

  it('never overwrites a gym that already has a position', () => {
    expect(
      shouldLearnGymPosition({ gymId: 'f19', gyms: [FITNESS_19], position: at(38.1, -77.1) })
    ).toBe(false);
  });

  it('does not learn when another known gym is right there (likely the wrong gym)', () => {
    expect(
      shouldLearnGymPosition({ gymId: 'garage', gyms: [FITNESS_19, NO_COORDS], position: at(38.0005, -77.0) })
    ).toBe(false);
  });

  it('does not learn from an inaccurate fix', () => {
    expect(
      shouldLearnGymPosition({ gymId: 'garage', gyms: [NO_COORDS], position: at(38.1, -77.1, 500) })
    ).toBe(false);
  });
});
