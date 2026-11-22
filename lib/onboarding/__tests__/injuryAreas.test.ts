/**
 * @jest-environment node
 */

import { MUSCLE_GROUPS } from '@/types/schema';
import {
  INJURY_AREA_MUSCLES,
  ONBOARDING_INJURY_OPTIONS,
  injuryAreasFromHistory,
  mergeInjuryHistory,
} from '../injuryAreas';

describe('onboarding injury areas', () => {
  it('maps every chip to valid users.injury_history muscle groups', () => {
    for (const { id } of ONBOARDING_INJURY_OPTIONS) {
      expect(INJURY_AREA_MUSCLES[id].length).toBeGreaterThan(0);
      for (const m of INJURY_AREA_MUSCLES[id]) {
        expect(MUSCLE_GROUPS).toContain(m);
      }
    }
  });

  it('merges chips into the existing history, keeping groups set elsewhere', () => {
    expect(mergeInjuryHistory(['chest'], ['shoulder', 'knee'])).toEqual(['chest', 'shoulders', 'quads']);
  });

  it('"None" clears only the chip-covered groups', () => {
    expect(mergeInjuryHistory(['chest', 'shoulders', 'erectors'], [])).toEqual(['chest']);
  });

  it('keeps unknown legacy values and de-duplicates shared mappings', () => {
    expect(mergeInjuryHistory(['lats'], ['elbow', 'wrist'])).toEqual(['forearms', 'lats']);
    expect(mergeInjuryHistory(null, [])).toEqual([]);
  });

  it('restores chips from a stored history', () => {
    expect(injuryAreasFromHistory(['shoulders', 'chest'])).toEqual(['shoulder']);
    expect(injuryAreasFromHistory(['forearms'])).toEqual(['elbow', 'wrist']);
    expect(injuryAreasFromHistory(null)).toEqual([]);
  });
});
