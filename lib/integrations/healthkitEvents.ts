/**
 * The window event fired after a HealthKit sync stores data, in a module of
 * its own so views can listen without loading the HealthKit sync code (which
 * stays out of the web bundle behind dynamic imports).
 */
export const HEALTHKIT_SYNCED_EVENT = 'hypertrack:healthkit-synced';
