/**
 * users.training_age (years of consistent training) between the Settings
 * field and the database. Pure.
 *
 * "Not given" is stored as null, never 0. Settings used to write 0 for an
 * empty field, which read as "under a year of training" (the planners now
 * treat 0 as unset through services/mesocycleBuilder effectiveTrainingAge,
 * which also falls back to the experience level for null). Existing rows
 * that hold 0 show as an empty field and are saved back as null.
 */

/** The value to save for what is in the field: a positive number of years, else null. */
export function trainingAgeForSave(input: string): number | null {
  const years = parseFloat(input);
  return Number.isFinite(years) && years > 0 ? years : null;
}

/** The field's text for a stored value: empty for null / 0 / anything unusable. */
export function trainingAgeForDisplay(stored: unknown): string {
  const years = typeof stored === 'string' ? parseFloat(stored) : stored;
  return typeof years === 'number' && Number.isFinite(years) && years > 0 ? String(years) : '';
}
