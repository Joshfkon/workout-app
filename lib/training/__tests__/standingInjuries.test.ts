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
