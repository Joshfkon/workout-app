import {
  MEAL_REMINDER_ID_BASE,
  planMealReminders,
  readMealReminderSettings,
  type MealReminderSettings,
} from '../mealReminders';

const on: MealReminderSettings = {
  enabled: true,
  times: { breakfast: '10:00', lunch: '14:00', dinner: '20:30' },
};
// Local noon on a Monday.
const noon = new Date(2026, 10, 16, 12, 0, 0);

describe('planMealReminders', () => {
  it('is empty when reminders are off', () => {
    expect(planMealReminders({ ...on, enabled: false }, new Set(), noon)).toEqual([]);
  });

  it('skips meals already logged today and times already past', () => {
    const plan = planMealReminders(on, new Set(['lunch']), noon, 1);
    // Breakfast (10:00) is past, lunch is logged → only dinner today.
    expect(plan.map((r) => r.meal)).toEqual(['dinner']);
    expect(plan[0].fireAt.getHours()).toBe(20);
    expect(plan[0].fireAt.getMinutes()).toBe(30);
  });

  it('reminds every meal on later days, with unique ids and a deep link', () => {
    const plan = planMealReminders(on, new Set(['breakfast', 'lunch', 'dinner']), noon, 3);
    expect(plan.map((r) => r.meal)).toEqual([
      'breakfast', 'lunch', 'dinner',
      'breakfast', 'lunch', 'dinner',
    ]);
    expect(new Set(plan.map((r) => r.id)).size).toBe(plan.length);
    expect(plan[0].id).toBe(MEAL_REMINDER_ID_BASE);
    expect(plan[0].url).toBe('/dashboard/nutrition?describe=breakfast');
    expect(plan[0].body).toMatch(/estimate/);
  });

  it('a snack does not count as the meal', () => {
    const plan = planMealReminders(on, new Set(['snack']), noon, 1);
    expect(plan.map((r) => r.meal)).toEqual(['lunch', 'dinner']);
  });

  it('ignores malformed times', () => {
    const plan = planMealReminders({ enabled: true, times: { lunch: '25:00', dinner: 'x' } }, new Set(), noon, 1);
    expect(plan).toEqual([]);
  });
});

describe('readMealReminderSettings', () => {
  it('defaults to off with sensible times', () => {
    expect(readMealReminderSettings(null)).toEqual({
      enabled: false,
      times: { breakfast: '10:00', lunch: '14:00', dinner: '20:30' },
    });
  });

  it('keeps stored times over the defaults', () => {
    expect(
      readMealReminderSettings({ mealReminders: { enabled: true, times: { lunch: '13:15' } } })
    ).toEqual({ enabled: true, times: { breakfast: '10:00', lunch: '13:15', dinner: '20:30' } });
  });
});
