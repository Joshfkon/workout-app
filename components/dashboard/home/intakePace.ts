/**
 * Whether intake (calories or protein) is keeping pace with the day,
 * assuming an eating window of 7:00–21:00. More than 15 percentage points
 * behind the expected fraction of the target reads "behind".
 * Shared by the Nutrition glance tile and the "Log dinner" hero.
 */
export function intakePaceLabel(
  consumed: number,
  target: number,
  now: Date = new Date()
): 'on pace' | 'behind' {
  if (target <= 0) return 'on pace';
  const hourOfDay = now.getHours() + now.getMinutes() / 60;
  const expectedPercent = Math.max(0, Math.min(100, ((hourOfDay - 7) / (21 - 7)) * 100));
  const actualPercent = (consumed / target) * 100;
  return actualPercent < expectedPercent - 15 ? 'behind' : 'on pace';
}
