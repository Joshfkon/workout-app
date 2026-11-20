/**
 * mealReminders — which "log your meal" reminders to schedule (pure).
 *
 * Local notifications can't check the food log when they fire, so instead of
 * a repeating alarm the app plans one-shot reminders for the next few days
 * every time it opens (and when you leave the Eat page), skipping any meal
 * already logged today. Logged lunch → no lunch nag.
 *
 * The copy pushes an estimate: a rough number logged beats a blank day.
 */

export type ReminderMeal = 'breakfast' | 'lunch' | 'dinner';

export interface MealReminderSettings {
  enabled: boolean;
  /** Local "HH:MM" per meal; a missing meal is not reminded. */
  times: Partial<Record<ReminderMeal, string>>;
}

export const DEFAULT_MEAL_REMINDER_TIMES: Record<ReminderMeal, string> = {
  breakfast: '10:00',
  lunch: '14:00',
  dinner: '20:30',
};

export const MEAL_REMINDER_DAYS_AHEAD = 3;
/** Notification ids 1850..1859 are reserved for meal reminders. */
export const MEAL_REMINDER_ID_BASE = 1850;
export const MEAL_REMINDER_ID_COUNT = 10;

const MEALS: ReminderMeal[] = ['breakfast', 'lunch', 'dinner'];
const LABEL: Record<ReminderMeal, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
};

export interface PlannedMealReminder {
  id: number;
  meal: ReminderMeal;
  fireAt: Date;
  title: string;
  body: string;
  /** In-app route the notification opens. */
  url: string;
}

/** Read the stored preference (users.preferences.mealReminders), defaulting to off. */
export function readMealReminderSettings(preferences: unknown): MealReminderSettings {
  const raw = (preferences as { mealReminders?: Partial<MealReminderSettings> } | null)?.mealReminders;
  return {
    enabled: raw?.enabled === true,
    times: { ...DEFAULT_MEAL_REMINDER_TIMES, ...(raw?.times ?? {}) },
  };
}

function parseTime(time: string | undefined): { hour: number; minute: number } | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Reminders for today (meals not yet logged, times still ahead) and the next
 * days (every meal — nothing is logged yet). `loggedToday` holds the meal
 * types with at least one food_log row today; snacks never cancel a meal.
 */
export function planMealReminders(
  settings: MealReminderSettings,
  loggedToday: ReadonlySet<string>,
  now: Date,
  daysAhead: number = MEAL_REMINDER_DAYS_AHEAD
): PlannedMealReminder[] {
  if (!settings.enabled) return [];
  const planned: PlannedMealReminder[] = [];
  for (let day = 0; day < daysAhead; day++) {
    for (const meal of MEALS) {
      const time = parseTime(settings.times[meal]);
      if (!time) continue;
      if (day === 0 && loggedToday.has(meal)) continue;
      const fireAt = new Date(now);
      fireAt.setDate(fireAt.getDate() + day);
      fireAt.setHours(time.hour, time.minute, 0, 0);
      if (fireAt.getTime() <= now.getTime()) continue;
      if (planned.length >= MEAL_REMINDER_ID_COUNT) return planned;
      planned.push({
        id: MEAL_REMINDER_ID_BASE + planned.length,
        meal,
        fireAt,
        title: `Log ${LABEL[meal]}?`,
        body: `Nothing logged for ${LABEL[meal]} yet. A rough estimate beats a blank — tap to describe it.`,
        url: `/dashboard/nutrition?describe=${meal}`,
      });
    }
  }
  return planned;
}
