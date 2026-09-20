import {
  displaySetQuality,
  SET_QUALITY_DISPLAY_META,
  type SetQualityDisplay,
} from '@/lib/training/setQualityDisplay';
import { EFFECTIVE_VOLUME_WEIGHTS } from '@/services/effectiveVolume';
import type { RepsInTank } from '@/types/schema';

describe('displaySetQuality', () => {
  describe('RIR-derived buckets (logged feedback chip)', () => {
    it('labels a 0 RIR set "maxed", not "effective"', () => {
      expect(displaySetQuality({ quality: 'effective', rir: 0, rpe: 10 })).toBe('maxed');
    });

    it('labels 1-2 RIR "stimulative"', () => {
      expect(displaySetQuality({ quality: 'stimulative', rir: 1, rpe: 9 })).toBe('stimulative');
      expect(displaySetQuality({ quality: 'stimulative', rir: 2, rpe: 7.5 })).toBe('stimulative');
    });

    it('labels 3 RIR "effective" (0.6x credit tier)', () => {
      expect(displaySetQuality({ quality: 'effective', rir: 3, rpe: 7 })).toBe('effective');
    });

    it('labels 4+ RIR "easy" (0.25x credit tier)', () => {
      expect(displaySetQuality({ quality: 'effective', rir: 4, rpe: 6 })).toBe('easy');
    });

    it('prefers the logged RIR over the stored quality when they disagree', () => {
      // rpe was manually edited to 8 (stored quality "stimulative") but the
      // user's chip says 3 RIR — the badge follows the chip, like the RIR
      // readout next to it.
      expect(displaySetQuality({ quality: 'stimulative', rir: 3, rpe: 8 })).toBe('effective');
    });
  });

  describe('RPE fallback (no feedback chip)', () => {
    it('derives the bucket from rpe via rpeToRir', () => {
      expect(displaySetQuality({ quality: 'effective', rpe: 10 })).toBe('maxed');
      expect(displaySetQuality({ quality: 'stimulative', rpe: 8 })).toBe('stimulative');
      expect(displaySetQuality({ quality: 'effective', rpe: 7 })).toBe('effective');
      expect(displaySetQuality({ quality: 'effective', rpe: 6 })).toBe('easy');
    });
  });

  describe('stored verdicts that RIR cannot override', () => {
    it('keeps "junk" (ugly form carries information the RIR does not)', () => {
      expect(displaySetQuality({ quality: 'junk', rir: 1, rpe: 9 })).toBe('junk');
    });

    it('keeps "excessive" on legacy rows', () => {
      expect(displaySetQuality({ quality: 'excessive', rir: 0, rpe: 10 })).toBe('excessive');
    });
  });

  describe('unresolvable RIR', () => {
    it('falls back to the stored quality with neither rir nor rpe', () => {
      expect(displaySetQuality({ quality: 'effective' })).toBe('effective');
      expect(displaySetQuality({ quality: 'stimulative', rir: null, rpe: null })).toBe(
        'stimulative'
      );
    });

    it('treats out-of-range rir as unresolvable', () => {
      expect(displaySetQuality({ quality: 'effective', rir: 7 })).toBe('effective');
      expect(displaySetQuality({ quality: 'effective', rir: -1 })).toBe('effective');
    });
  });

  describe('alignment with the effective-volume credit table', () => {
    it('full-credit RIRs (1.0x) display as maxed/stimulative, partial tiers as effective/easy', () => {
      const expectedByWeight: Record<number, SetQualityDisplay[]> = {
        1.0: ['maxed', 'stimulative'],
        0.6: ['effective'],
        0.25: ['easy'],
      };
      for (const rir of [0, 1, 2, 3, 4] as RepsInTank[]) {
        const bucket = displaySetQuality({ quality: 'effective', rir });
        const weight = EFFECTIVE_VOLUME_WEIGHTS[rir];
        expect(expectedByWeight[weight]).toContain(bucket);
      }
    });

    it('the maxed description states full credit and the recovery cost', () => {
      const desc = SET_QUALITY_DISPLAY_META.maxed.description;
      expect(desc).toContain(`${EFFECTIVE_VOLUME_WEIGHTS[0]}×`);
      expect(desc.toLowerCase()).toContain('recovery');
    });
  });
});
