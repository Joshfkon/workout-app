/**
 * Turn a raw USDA search failure (from `services/usdaService` via the
 * food-search action) into a short, friendly line for the Add food sheet.
 * The raw strings are written for logs ("Rate limit exceeded. Please wait a
 * moment and try again.") and read as a crash when shown verbatim.
 *
 * Shown only after the sheet's quiet automatic retries (lib/nutrition/
 * usdaRetry) have all failed, so it says what still works rather than
 * "busy" (r21 panel: "a USDA 'busy right now' message interrupted logging").
 */
export function friendlyUsdaError(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Couldn’t reach the USDA list. Your foods and common foods still work.';
  }
  if (msg.includes('sign in')) {
    return 'Sign in again to search USDA foods.';
  }
  if (msg.includes('too long')) {
    return 'That search is too long. Try fewer words.';
  }
  if (msg.includes('no foods found')) {
    return 'No USDA results';
  }
  return 'Couldn’t reach the USDA list. Your foods and common foods still work.';
}
