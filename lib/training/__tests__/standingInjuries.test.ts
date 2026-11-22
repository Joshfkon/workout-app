/**
 * @jest-environment node
 */

import { getInjuryType } from '@/lib/training/injury-types';
import { INJURY_LABELS } from '@/services/injuryAwareSwapper';
import {
  STANDING_AREA_INJURY_TYPE,
  STANDING_INJURY_OPTIONS,
  parseStandingInjuryAreas,
  standingAreasToCheckInInjuries,
  standingAreasToUserInjuries,
  checkInInjuryToUserInjury,
} from '../standingInjuries';

describe('standing injury areas', () => {
  it('uses the injury-aware swapper vocabulary for every option', () => {
    for (const { id } of STANDING_INJURY_OPTIONS) {
      expect(INJURY_LABELS[id]).toBeDefined();
      expect(getInjuryType(STANDING_AREA_INJURY_TYPE[id])).toBeDefined();
    }
  });

  it('parses only known, de-duplicated areas from preferences', () => {
    expect(parseStandingInjuryAreas(['knee', 'knee', 'chest', 3, 'shoulder'])).toEqual(['knee', 'shoulder']);
    expect(parseStandingInjuryAreas(undefined)).toEqual([]);
    expect(parseStandingInjuryAreas('knee')).toEqual([]);
  });

  it('expands to mild check-in injuries on both sides (onboarding does not ask a side)', () => {
    expect(standingAreasToCheckInInjuries(['knee', 'lower_back'])).toEqual([
      { area: 'knee_left', severity: 1 },
      { area: 'knee_right', severity: 1 },
      { area: 'lower_back', severity: 1 },
    ]);
    expect(standingAreasToCheckInInjuries([])).toEqual([]);
  });

  it('builds mild, active UserInjury entries for the exercise-safety check', () => {
    const now = new Date('2026-11-22T10:00:00');
    expect(standingAreasToUserInjuries(['shoulder'], now)).toEqual([
      { id: 'standing-shoulder', injuryTypeId: 'shoulder_impingement', severity: 'mild', isActive: true, startDate: now },
    ]);
  });
});

describe('checkInInjuryToUserInjury', () => {
  const now = new Date('2026-11-22T12:00:00Z');

  it('maps a sided check-in area and 1–3 severity to an INJURY_TYPES id the safety check understands', () => {
    expect(checkInInjuryToUserInjury({ id: 'a', area: 'knee_left', severity: 2 }, now)).toMatchObject({
      injuryTypeId: 'knee_injury',
      severity: 'moderate',
      affectedSide: 'left',
      isActive: true,
    });
    expect(checkInInjuryToUserInjury({ area: 'lower_back', severity: 1 }, now)).toMatchObject({ injuryTypeId: 'lower_back_strain', severity: 'mild' });
    expect(checkInInjuryToUserInjury({ area: 'ankle_right', severity: 3 }, now)).toMatchObject({ injuryTypeId: 'ankle_sprain', severity: 'severe', affectedSide: 'right' });
  });

  it('every mapped id is a real injury type', () => {
    for (const area of ['shoulder_left', 'elbow_right', 'wrist_left', 'hip_right', 'knee_right', 'lower_back', 'upper_back', 'neck', 'ankle_left']) {
      const injury = checkInInjuryToUserInjury({ area, severity: 1 }, now);
      expect(injury && getInjuryType(injury.injuryTypeId)).toBeTruthy();
    }
  });

  it('skips inactive injuries and areas with no matching type', () => {
    expect(checkInInjuryToUserInjury({ area: 'knee_left', severity: 1, isActive: false }, now)).toBeNull();
    expect(checkInInjuryToUserInjury({ area: 'chest', severity: 1 }, now)).toBeNull();
    expect(checkInInjuryToUserInjury({ area: 'other', severity: 1 }, now)).toBeNull();
  });
});
