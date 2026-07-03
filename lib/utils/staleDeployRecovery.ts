/**
 * Recovery for stale-deployment chunk errors.
 *
 * A ChunkLoadError means the running page belongs to an older deployment and
 * asked for a JS chunk the server no longer has (or Safari's equivalent for
 * failed dynamic imports). Recover by clearing caches and reloading so the
 * client picks up the current build.
 */

const CHUNK_RELOAD_KEY = 'chunk-error-reloaded-at';
const RELOAD_COOLDOWN_MS = 60_000;

export function isStaleDeploymentError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(error.message) ||
    /Importing a module script failed/i.test(error.message) ||
    /Failed to fetch dynamically imported module/i.test(error.message)
  );
}

/**
 * Clear caches and reload, at most once per minute so a genuinely broken
 * deploy can't trap the user in a reload loop. Returns true when a reload
 * was scheduled (caller should show a recovery screen instead of the error
 * UI); false when rate-limited (caller falls through to the normal error UI).
 */
export function beginStaleDeployRecovery(
  deps: { reload?: () => void } = {}
): boolean {
  const reload = deps.reload ?? (() => window.location.reload());

  let lastReload = 0;
  try {
    lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0;
  } catch {}
  if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {}

  const clearCaches =
    typeof caches !== 'undefined'
      ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      : Promise.resolve([] as unknown[]);
  clearCaches
    .catch(() => {})
    .then(() => reload());
  return true;
}
