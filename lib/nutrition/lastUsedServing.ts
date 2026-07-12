/**
 * Last-used amount + unit per food, persisted client-side.
 *
 * There is no recents table yet (the only aggregate is "frequent foods"), so
 * the editable-serving feature remembers the last amount+unit the user logged
 * for a given food in localStorage. This drives two things:
 *   - prefilling the AMOUNT + UNIT control on the next add of the same food
 *   - surfacing the user's last 2 distinct amounts as quick-chips
 *
 * Keyed by a stable per-food identifier ({@link foodKeyFor}) so it survives
 * across the search / barcode / edit entry points for the same product.
 */

const STORAGE_KEY = 'ht:lastUsedServing:v1';
const MAX_PER_FOOD = 8;

export interface LastUsedServing {
  amount: number;
  unitId: string;
  ts: number;
}

type Store = Record<string, LastUsedServing[]>;

/** Stable key for a food across entry points. */
export function foodKeyFor(food: {
  source?: string | null;
  foodId?: string | null;
  barcode?: string | null;
  id?: string | null;
  name?: string | null;
}): string {
  if (food.barcode) return `barcode:${food.barcode}`;
  if (food.foodId) return `usda:${food.foodId}`;
  if (food.id) return `id:${food.id}`;
  if (food.name) return `name:${food.name.trim().toLowerCase()}`;
  return 'unknown';
}

function readStore(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota / privacy mode — last-used is a nicety, fail silent */
  }
}

/** Most-recent amount+unit for this food, or null if never logged here. */
export function getLastUsedServing(key: string): LastUsedServing | null {
  const list = readStore()[key];
  return list && list.length > 0 ? list[0] : null;
}

/**
 * The user's last N distinct amounts for this food logged in `unitId`
 * (newest first). Used to append personal quick-chips to the defaults.
 */
export function getRecentAmounts(key: string, unitId: string, n = 2): number[] {
  const list = readStore()[key] ?? [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const entry of list) {
    if (entry.unitId !== unitId) continue;
    if (seen.has(entry.amount)) continue;
    seen.add(entry.amount);
    out.push(entry.amount);
    if (out.length >= n) break;
  }
  return out;
}

/** Record a logged amount+unit as the newest entry for this food. */
export function recordLastUsedServing(key: string, amount: number, unitId: string): void {
  if (!key || !Number.isFinite(amount) || amount <= 0) return;
  const store = readStore();
  const prev = store[key] ?? [];
  const next: LastUsedServing[] = [
    { amount, unitId, ts: Date.now() },
    ...prev.filter((e) => !(e.amount === amount && e.unitId === unitId)),
  ].slice(0, MAX_PER_FOOD);
  store[key] = next;
  writeStore(store);
}
