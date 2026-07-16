/**
 * Shared geometry for the set-logger selector chips: the effort/RIR row in
 * SetLoggerRow and the form row in the feedback sheet (FormRatingSelector).
 *
 * Height, radius, and selected treatment must stay identical so the two rows
 * read as one control family — `SetLoggerRow.test.tsx` asserts this parity.
 * Color enters ONLY on the selected chip; unselected chips are neutral gray
 * like every other chip in the app.
 */
export const SELECTOR_CHIP_BASE =
  'flex-1 min-h-[52px] rounded-xl flex flex-col items-center justify-center gap-0 font-medium transition-colors';

/** Unselected chips: neutral gray, no semantic color. */
export const SELECTOR_CHIP_IDLE =
  'bg-surface-800 text-surface-300 hover:bg-surface-700';

/** The effort chips' selected treatment (solid primary-500, white text). */
export const SELECTOR_CHIP_SELECTED = 'bg-primary-500 text-white';
