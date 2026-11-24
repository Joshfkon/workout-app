import {
  MIN_WEIGHT_CHART_POINTS,
  notEnoughWeighInsMessage,
  pickWeightChartRange,
  weighInDaysInRange,
} from '../weightChartRange';

const TODAY = '2026-11-24';
const daysAgo = (n: number) => new Date(Date.UTC(2026, 10, 24 - n)).toISOString().slice(0, 10);

describe('pickWeightChartRange', () => {
  it('opens on 30 days when it holds enough weigh-ins', () => {
    const days = [0, 3, 7, 14].map(daysAgo);
    expect(pickWeightChartRange(days, TODAY)).toMatchObject({ range: '30d', enough: true, needed: 0 });
  });

  it('opens on 90 days when 30 days is too sparse (the near-empty default)', () => {
    const days = [0, 5, 40, 60, 80].map(daysAgo);
    expect(pickWeightChartRange(days, TODAY)).toMatchObject({ range: '90d', points: 5, enough: true });
  });

  it('says plainly when even 90 days is not enough, and how many more are needed', () => {
    const info = pickWeightChartRange([daysAgo(1), daysAgo(50)], TODAY);
    expect(info).toMatchObject({ range: '90d', points: 2, enough: false, needed: MIN_WEIGHT_CHART_POINTS - 2 });
    expect(notEnoughWeighInsMessage(info)).toBe(
      'Not enough weigh-ins for a trend yet: 2 weigh-ins in the last 90 days. Weigh in on 2 more days to see one.'
    );
    expect(notEnoughWeighInsMessage(pickWeightChartRange([0, 1, 2, 3].map(daysAgo), TODAY))).toBeNull();
  });

  it('counts distinct days, ignores the future and anything older than the range', () => {
    expect(weighInDaysInRange([daysAgo(1), daysAgo(1), daysAgo(-2), daysAgo(31)], TODAY, 30)).toBe(1);
    expect(pickWeightChartRange([], TODAY)).toMatchObject({ range: '90d', points: 0, needed: MIN_WEIGHT_CHART_POINTS });
  });
});
