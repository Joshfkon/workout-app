/**
 * Field diagnostics for the auto-capture chain. The auto-capture flow is
 * deliberately silent in the UI — no toasts, no per-set judgments, silent
 * discards — which made its failures invisible in the field: a set that
 * produced no Observations row gave zero clues as to why. Every stage
 * transition logs through here so a device console tells the whole story:
 * armed → capture start → stop/collect → keep or discard (with reason) →
 * attach → persist.
 */
export function motionLog(message: string): void {
  // eslint-disable-next-line no-console -- deliberate field diagnostics: the auto-capture flow has no UI surface for failures
  console.info(`[motion] ${message}`);
}
