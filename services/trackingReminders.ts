/**
 * trackingReminders — what body tracking is due, and which reminder
 * notifications to schedule (pure: no DB, no clock reads).
 *
 * Three things drift out of date if nobody asks: the weigh-in, tape
 * measurements and progress photos. Each has a cadence; an item is DUE once
 * its last entry is at least that old. Something never logged becomes due a
 * week after the account was created (a brand-new account isn't nagged on
 * day one). A cadence of 0 turns that item off.
 *
 * Notifications work like meal reminders (services/mealReminders): local
 * notifications can't look at the log when they fire, so the app re-plans
 * one-shots for the next week every time it opens. A due item notifies on its
 * due date, then once a week while it stays overdue — not every day. Workout
 * reminders fire on the block's scheduled training dates (the caller resolves
 * those through lib/training/trainingSchedule), skipping today once a
 * session is finished.
 *
 * Storage: users.preferences.trackingReminders, except the measurement
 * cadence, which stays in users.preferences.measurementNudgeWeeks (the Body
 * hub's existing tape nudge setting) so the two can never disagree.
 */

export type TrackingKind = 'weigh' | 'measure' | 'photo';

export const TRACKING_KINDS: TrackingKind[] = ['weigh', 'measure', 'photo'];

export interface TrackingReminderSettings {
  /** Days between entries per item; 0 = off. */
  cadenceDays: Record<TrackingKind, number>;
  /** iOS notification when body tracking is due. */
  notify: boolean;
  /** Local "HH:MM" for the body-tracking notification. */
  notifyTime: string;
  /** iOS notification on scheduled training dates. */
  workoutNotify: boolean;
  /** Local "HH:MM" for the workout notification. */
  workoutTime: string;
}

export const DEFAULT_TRACKING_REMINDERS: TrackingReminderSettings = {
  cadenceDays: { weigh: 7, measure: 28, photo: 28 },
  notify: false,
  notifyTime: '07:30',
  workoutNotify: false,
  workoutTime: '09:00',
};

/** Choices the Settings screen offers, in days (0 = off). */
export const CADENCE_OPTIONS: Record<TrackingKind, number[]> = {
  weigh: [0, 1, 3, 7, 14],
  measure: [0, 14, 28, 42, 56],
  photo: [0, 14, 28, 42, 56],
};

/** A never-logged item stays quiet for this long after sign-up. */
export const FIRST_ENTRY_GRACE_DAYS = 7;
/** While overdue, the notification repeats this often (not daily). */
export const OVERDUE_RENOTIFY_DAYS = 7;
/** Snoozing the Home nudge hides an item for this long. */
export const NUDGE_SNOOZE_DAYS = 7;
export const TRACKING_REMINDER_DAYS_AHEAD = 7;

/** Notification ids 1870..1877 body tracking, 1880..1887 workouts. */
export const TRACKING_REMINDER_ID_BASE = 1870;
export const WORKOUT_REMINDER_ID_BASE = 1880;
export const TRACKING_REMINDER_ID_COUNT = 8;

interface StoredTrackingReminders {
  weighInDays?: number;
  photoDays?: number;
  notify?: boolean;
  notifyTime?: string;
  workoutNotify?: boolean;
  workoutTime?: string;
}

function wholeDays(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function validTime(value: unknown, fallback: string): string {
  return typeof value === 'string' && parseTime(value) ? value : fallback;
}

/** Read users.preferences into settings, filling defaults. */
export function readTrackingReminderSettings(preferences: unknown): TrackingReminderSettings {
  const prefs = (preferences ?? {}) as {
    trackingReminders?: StoredTrackingReminders;
    measurementNudgeWeeks?: number;
  };
  const raw = prefs.trackingReminders ?? {};
  const d = DEFAULT_TRACKING_REMINDERS;
  return {
    cadenceDays: {
      weigh: wholeDays(raw.weighInDays, d.cadenceDays.weigh),
      measure:
        typeof prefs.measurementNudgeWeeks === 'number'
          ? wholeDays(prefs.measurementNudgeWeeks * 7, d.cadenceDays.measure)
          : d.cadenceDays.measure,
      photo: wholeDays(raw.photoDays, d.cadenceDays.photo),
    },
    notify: raw.notify === true,
    notifyTime: validTime(raw.notifyTime, d.notifyTime),
    workoutNotify: raw.workoutNotify === true,
    workoutTime: validTime(raw.workoutTime, d.workoutTime),
  };
}

/** The users.preferences keys to merge in when saving. */
export function trackingReminderPreferencesPatch(settings: TrackingReminderSettings): {
  trackingReminders: Required<StoredTrackingReminders>;
  measurementNudgeWeeks: number;
} {
  return {
    trackingReminders: {
      weighInDays: settings.cadenceDays.weigh,
      photoDays: settings.cadenceDays.photo,
      notify: settings.notify,
      notifyTime: settings.notifyTime,
      workoutNotify: settings.workoutNotify,
      workoutTime: settings.workoutTime,
    },
    measurementNudgeWeeks: Math.round(settings.cadenceDays.measure / 7),
  };
}

// ── Local-date arithmetic on YYYY-MM-DD (calendar days, DST-proof) ─────────

function dayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function addDays(date: string, days: number): string {
  const n = dayNumber(date) + days;
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
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

function atLocalTime(date: string, time: { hour: number; minute: number }): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, time.hour, time.minute, 0, 0);
}

// ── What's due ───────────────────────────────────────────────────────────

export interface TrackingStatus {
  kind: TrackingKind;
  /** YYYY-MM-DD the item is (or became) due. */
  dueDate: string;
  isDue: boolean;
  /** Days since the last entry; null when never logged. */
  daysSinceLast: number | null;
  /** The item's cadence in days (also how often an overdue item re-notifies, capped at a week). */
  cadenceDays: number;
}

export interface TrackingStatusInput {
  settings: TrackingReminderSettings;
  /** Latest entry date (YYYY-MM-DD) per item, or null when never logged. */
  lastLogged: Record<TrackingKind, string | null>;
  /** YYYY-MM-DD the account was created; null = unknown (treated as old). */
  accountCreated: string | null;
  /** Local YYYY-MM-DD. */
  today: string;
}

/** Status of every item that is turned on (cadence > 0). */
export function computeTrackingStatus(input: TrackingStatusInput): TrackingStatus[] {
  const { settings, lastLogged, accountCreated, today } = input;
  return TRACKING_KINDS.flatMap((kind) => {
    const cadence = settings.cadenceDays[kind];
    if (!cadence || cadence <= 0) return [];
    const last = lastLogged[kind];
    const dueDate = last
      ? addDays(last, cadence)
      : accountCreated
        ? addDays(accountCreated, FIRST_ENTRY_GRACE_DAYS)
        : today;
    return [
      {
        kind,
        dueDate,
        isDue: daysBetween(dueDate, today) >= 0,
        daysSinceLast: last ? Math.max(0, daysBetween(last, today)) : null,
        cadenceDays: cadence,
      },
    ];
  });
}

/** Items due today, minus any the user snoozed on Home (snooze = hidden until that date). */
export function dueTrackingItems(
  statuses: TrackingStatus[],
  today: string,
  snoozedUntil: Partial<Record<TrackingKind, string>> = {}
): TrackingStatus[] {
  return statuses.filter((s) => {
    if (!s.isDue) return false;
    const until = snoozedUntil[s.kind];
    return !until || daysBetween(today, until) <= 0;
  });
}

// ── Copy ─────────────────────────────────────────────────────────────────

const NOUN: Record<TrackingKind, string> = {
  weigh: 'weigh-in',
  measure: 'measurements',
  photo: 'progress photos',
};

const ACTION: Record<TrackingKind, string> = {
  weigh: 'Weigh in',
  measure: 'Measure',
  photo: 'Add photos',
};

export function trackingActionLabel(kind: TrackingKind): string {
  return ACTION[kind];
}

function ago(days: number): string {
  if (days < 14) return days === 1 ? '1 day ago' : `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

/** One quiet line per item: when it was last logged. */
export function trackingItemDetail(status: TrackingStatus): string {
  if (status.daysSinceLast === null) {
    return status.kind === 'photo'
      ? 'First photos: same light, same pose, every time'
      : `No ${NOUN[status.kind]} logged yet`;
  }
  const label =
    status.kind === 'weigh' ? 'Last weigh-in' : status.kind === 'measure' ? 'Last measurements' : 'Last photos';
  return `${label} ${ago(status.daysSinceLast)}`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Title for the Home nudge (one item or several). */
export function trackingNudgeTitle(items: TrackingStatus[]): string {
  if (items.length === 1) return NOTIFY_TITLE[items[0].kind];
  const nouns = joinList(items.map((s) => NOUN[s.kind]));
  return `Due: ${nouns}`;
}

// ── Notifications ────────────────────────────────────────────────────────

export interface PlannedTrackingReminder {
  id: number;
  fireAt: Date;
  title: string;
  body: string;
  /** In-app route the notification opens. */
  url: string;
}

export interface TrainingDay {
  /** YYYY-MM-DD */
  date: string;
  /** e.g. "Push", "Upper A"; optional. */
  label?: string | null;
}

export interface PlanTrackingRemindersInput {
  settings: TrackingReminderSettings;
  statuses: TrackingStatus[];
  /** Scheduled training dates from today onward (caller resolves the schedule). */
  trainingDays: TrainingDay[];
  /** A session was completed today, so today's workout reminder is moot. */
  trainedToday: boolean;
  now: Date;
  /** Local YYYY-MM-DD for `now`. */
  today: string;
  daysAhead?: number;
}

const NOTIFY_TITLE: Record<TrackingKind, string> = {
  weigh: 'Time to weigh in',
  measure: 'Time to measure',
  photo: 'Time for progress photos',
};

const NOTIFY_BODY: Record<TrackingKind, string> = {
  weigh: 'Same time, same conditions: morning, before food, is easiest to repeat.',
  measure: 'Waist, chest, arms. The tape catches changes the scale hides.',
  photo: 'Same light, same pose. Side by side they show what the mirror misses.',
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * When a due item next notifies: its due date, then every `repeatDays`
 * while it stays overdue (weekly by default; a daily weigh-in repeats daily).
 */
export function nextNotifyDate(dueDate: string, today: string, repeatDays: number = OVERDUE_RENOTIFY_DAYS): string {
  const overdue = daysBetween(dueDate, today);
  if (overdue <= 0) return dueDate;
  const step = Math.max(1, repeatDays);
  return addDays(dueDate, Math.ceil(overdue / step) * step);
}

function renotifyDays(status: TrackingStatus): number {
  return Math.max(1, Math.min(status.cadenceDays || OVERDUE_RENOTIFY_DAYS, OVERDUE_RENOTIFY_DAYS));
}

/** Does `status` notify on `date` (its next notify date or a later repeat)? */
function notifiesOn(status: TrackingStatus, today: string, date: string): boolean {
  const step = renotifyDays(status);
  const first = nextNotifyDate(status.dueDate, today, step);
  const offset = daysBetween(first, date);
  return offset >= 0 && offset % step === 0;
}

/**
 * Plan the next week of one-shot notifications. Body tracking: at most one
 * per day, naming everything that notifies that day. Workouts: one per
 * scheduled training date. Times already past are skipped.
 */
export function planTrackingReminders(input: PlanTrackingRemindersInput): PlannedTrackingReminder[] {
  const daysAhead = input.daysAhead ?? TRACKING_REMINDER_DAYS_AHEAD;
  return [...planBodyReminders(input, daysAhead), ...planWorkoutReminders(input, daysAhead)];
}

function planBodyReminders(input: PlanTrackingRemindersInput, daysAhead: number): PlannedTrackingReminder[] {
  const { settings, statuses, now, today } = input;
  const time = parseTime(settings.notifyTime);
  if (!settings.notify || !time) return [];
  const planned: PlannedTrackingReminder[] = [];
  for (let day = 0; day < daysAhead && planned.length < TRACKING_REMINDER_ID_COUNT; day++) {
    const date = addDays(today, day);
    const kinds = statuses.filter((s) => notifiesOn(s, today, date)).map((s) => s.kind);
    const fireAt = atLocalTime(date, time);
    if (kinds.length === 0 || fireAt.getTime() <= now.getTime()) continue;
    const single = kinds.length === 1 ? kinds[0] : null;
    planned.push({
      id: TRACKING_REMINDER_ID_BASE + planned.length,
      fireAt,
      title: single ? NOTIFY_TITLE[single] : 'Progress check-in',
      body: single
        ? NOTIFY_BODY[single]
        : `${capitalize(joinList(kinds.map((k) => NOUN[k])))} are due. Regular check-ins keep the trend readable.`,
      url: single === 'photo' ? '/dashboard/progress-photos?add=1' : '/dashboard',
    });
  }
  return planned;
}

function planWorkoutReminders(input: PlanTrackingRemindersInput, daysAhead: number): PlannedTrackingReminder[] {
  const { settings, trainingDays, trainedToday, now, today } = input;
  const time = parseTime(settings.workoutTime);
  if (!settings.workoutNotify || !time) return [];
  const lastDay = addDays(today, daysAhead - 1);
  // One per date (a two-a-day date lists itself twice), inside the window,
  // not today once a session is already finished.
  const dates = Array.from(new Map(trainingDays.map((d) => [d.date, d])).values()).filter(
    (d) =>
      daysBetween(today, d.date) >= 0 &&
      daysBetween(d.date, lastDay) >= 0 &&
      !(d.date === today && trainedToday)
  );
  const planned: PlannedTrackingReminder[] = [];
  for (const day of dates) {
    const fireAt = atLocalTime(day.date, time);
    if (fireAt.getTime() <= now.getTime()) continue;
    if (planned.length >= TRACKING_REMINDER_ID_COUNT) break;
    planned.push({
      id: WORKOUT_REMINDER_ID_BASE + planned.length,
      fireAt,
      title: 'Training day',
      body: day.label ? `${day.label} is on the plan today.` : 'A workout is on the plan today.',
      url: '/dashboard',
    });
  }
  return planned;
}

/** Every notification id this module may use (cleared before each re-plan). */
export function trackingReminderIds(): number[] {
  return Array.from({ length: TRACKING_REMINDER_ID_COUNT }, (_, i) => [
    TRACKING_REMINDER_ID_BASE + i,
    WORKOUT_REMINDER_ID_BASE + i,
  ]).flat();
}
