import {
  deriveEquipmentClass,
  isMachineClassAmbiguous,
  exerciseMatchesEquipmentGroups,
  equipmentClassLabel,
  equipmentClassToGroup,
  groupsToClasses,
  type EquipmentClass,
} from '../equipmentClass';

describe('deriveEquipmentClass', () => {
  const cases: Array<[string, Parameters<typeof deriveEquipmentClass>[0], EquipmentClass]> = [
    // Bodyweight flag wins over an incidental load tag.
    ['bodyweight flag', { name: 'Single Leg Calf Raise', isBodyweight: true, equipmentRequired: [] }, 'bodyweight'],
    ['weighted BW stays BW', { name: 'Weighted Pull-Up', isBodyweight: true, equipmentRequired: ['dumbbells'] }, 'bodyweight'],
    ['name declares BW', { name: 'Bodyweight Squat', equipmentRequired: [] }, 'bodyweight'],

    // Smith and cable beat the generic 'machine' word inside their tags.
    ['smith', { name: 'Smith Machine Bench Press', equipmentRequired: ['smith machine'] }, 'smith'],
    ['cable over machine', { name: 'Cable Fly', equipmentRequired: ['cable machine'] }, 'cable'],
    ['cable row', { name: 'Seated Cable Row', equipmentRequired: ['cable machine', 'row handle'] }, 'cable'],
    ['lat pulldown is cable', { name: 'Lat Pulldown', equipmentRequired: ['cable machine', 'lat pulldown bar'] }, 'cable'],

    // Plate-loaded signals.
    ['explicit plate loaded', { name: 'Seated Calf Raise (Plate Loaded)', equipmentRequired: ['weight plates'] }, 'machine_plate_loaded'],
    ['hammer strength', { name: 'Hammer Strength Chest Press', equipmentRequired: ['hammer strength machine'] }, 'machine_plate_loaded'],
    ['hack squat', { name: 'Hack Squat', equipmentRequired: ['hack squat machine'] }, 'machine_plate_loaded'],

    // Pin / selectorized + generic machine default.
    ['pec deck pin', { name: 'Pec Deck', equipmentRequired: ['pec deck machine'] }, 'machine_pin_loaded'],
    ['generic machine', { name: 'Machine Chest Press', equipmentRequired: ['chest press machine'] }, 'machine_pin_loaded'],
    ['bare machine tag', { name: 'MTS Row', equipmentRequired: ['mts machine'] }, 'machine_pin_loaded'],
    ['leg press defaults pin', { name: 'Leg Press', equipmentRequired: ['leg press machine'] }, 'machine_pin_loaded'],

    // Free weights beat supports (bench/rack) and the generic-machine fallback.
    ['barbell + bench', { name: 'Barbell Bench Press', equipmentRequired: ['barbell', 'bench'] }, 'barbell'],
    ['barbell + rack', { name: 'Back Squat', equipmentRequired: ['barbell', 'squat rack'] }, 'barbell'],
    ['preacher bench + barbell', { name: 'Preacher Curl', equipmentRequired: ['preacher bench', 'barbell'] }, 'barbell'],
    ['ez bar', { name: 'EZ Bar Curl', equipmentRequired: ['ez curl bar'] }, 'barbell'],
    ['trap bar', { name: 'Trap Bar Deadlift', equipmentRequired: ['trap bar'] }, 'barbell'],
    ['landmine', { name: 'Landmine Press', equipmentRequired: ['landmine', 'barbell'] }, 'barbell'],
    ['dumbbell + bench', { name: 'Dumbbell Bench Press', equipmentRequired: ['dumbbells', 'bench'] }, 'dumbbell'],
    ['kettlebell', { name: 'Kettlebell Swing', equipmentRequired: ['kettlebell'] }, 'kettlebell'],

    // Bands / other.
    ['band', { name: 'Band Pull-Apart', equipmentRequired: ['resistance bands'] }, 'band'],
    ['trx', { name: 'TRX Row', equipmentRequired: ['trx'] }, 'other'],

    // Bodyweight stations (is_bodyweight often unset in the data).
    ['dips via dip bars', { name: 'Dips (Chest Focus)', equipmentRequired: ['dip bars'] }, 'bodyweight'],
    ['pull-up via bar', { name: 'Pull-Up', equipmentRequired: ['pull-up bar'] }, 'bodyweight'],
    ['chin-up via bar', { name: 'Chin-Up', equipmentRequired: ['pull-up bar'] }, 'bodyweight'],
    // ...but an ASSISTED machine variant stays a machine, not bodyweight.
    ['assisted dip machine', { name: 'Assisted Dip', equipmentRequired: ['assisted dip machine'] }, 'machine_pin_loaded'],

    // Fallbacks.
    ['unknown → other', { name: 'Mystery Move', equipmentRequired: ['contraption'] }, 'other'],
    ['no signal → other', { name: 'Untagged', equipmentRequired: [] }, 'other'],
  ];

  it.each(cases)('%s', (_label, input, expected) => {
    expect(deriveEquipmentClass(input)).toBe(expected);
  });

  it('honors a stored equipment_class over derivation', () => {
    expect(
      deriveEquipmentClass({ name: 'Cable Fly', equipmentRequired: ['cable machine'], equipmentClass: 'machine_plate_loaded' })
    ).toBe('machine_plate_loaded');
  });

  it('reads snake_case aliases straight from a DB row', () => {
    expect(
      deriveEquipmentClass({ name: 'Dumbbell Curl', equipment_required: ['dumbbells'], is_bodyweight: false })
    ).toBe('dumbbell');
  });

  it('does not let "db" match inside another word', () => {
    // 'deadbug' contains 'db' as a substring but not as a word.
    expect(deriveEquipmentClass({ name: 'Deadbug', equipmentRequired: [] })).toBe('other');
  });
});

describe('isMachineClassAmbiguous', () => {
  it('flags a bare "machine" tag for review', () => {
    expect(isMachineClassAmbiguous({ name: 'Row', equipmentRequired: ['machine'] })).toBe(true);
  });
  it('flags leg press (plate vs selectorized both exist)', () => {
    expect(isMachineClassAmbiguous({ name: 'Leg Press', equipmentRequired: ['leg press machine'] })).toBe(true);
  });
  it('does not flag a specific pin machine', () => {
    expect(isMachineClassAmbiguous({ name: 'Pec Deck', equipmentRequired: ['pec deck machine'] })).toBe(false);
  });
  it('does not flag an explicit plate-loaded machine', () => {
    expect(isMachineClassAmbiguous({ name: 'Hack Squat', equipmentRequired: ['hack squat machine'] })).toBe(false);
  });
  it('does not flag non-machine classes', () => {
    expect(isMachineClassAmbiguous({ name: 'Barbell Row', equipmentRequired: ['barbell'] })).toBe(false);
  });
});

describe('exerciseMatchesEquipmentGroups', () => {
  const dumbbell = { name: 'Dumbbell Curl', equipmentRequired: ['dumbbells'] };
  const platMachine = { name: 'Hack Squat', equipmentRequired: ['hack squat machine'] };
  const pinMachine = { name: 'Pec Deck', equipmentRequired: ['pec deck machine'] };

  it('empty selection matches everything', () => {
    expect(exerciseMatchesEquipmentGroups(dumbbell, [])).toBe(true);
    expect(exerciseMatchesEquipmentGroups(dumbbell, null)).toBe(true);
  });

  it('matches within a selected group', () => {
    expect(exerciseMatchesEquipmentGroups(dumbbell, ['dumbbell'])).toBe(true);
    expect(exerciseMatchesEquipmentGroups(dumbbell, ['barbell'])).toBe(false);
  });

  it('"machine" group spans both plate and pin sub-classes', () => {
    expect(exerciseMatchesEquipmentGroups(platMachine, ['machine'])).toBe(true);
    expect(exerciseMatchesEquipmentGroups(pinMachine, ['machine'])).toBe(true);
  });

  it('is a union across selected groups', () => {
    expect(exerciseMatchesEquipmentGroups(dumbbell, ['barbell', 'dumbbell'])).toBe(true);
    expect(exerciseMatchesEquipmentGroups(pinMachine, ['barbell', 'dumbbell'])).toBe(false);
  });
});

describe('labels & rollup', () => {
  it('rolls both machine classes up to the Machine group', () => {
    expect(equipmentClassToGroup('machine_plate_loaded')).toBe('machine');
    expect(equipmentClassToGroup('machine_pin_loaded')).toBe('machine');
    expect(equipmentClassLabel('machine_plate_loaded')).toBe('Machine');
    expect(equipmentClassLabel('machine_pin_loaded')).toBe('Machine');
  });
  it('groupsToClasses expands machine to both sub-classes', () => {
    expect(groupsToClasses(['machine'])).toEqual(new Set(['machine_plate_loaded', 'machine_pin_loaded']));
  });
});
