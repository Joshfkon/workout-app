/**
 * Whether the Exercise library shows its loading state (skeleton + "Loading..."
 * subtitle): only with NO catalog to show and not mid-restore. A disabled or
 * pre-mount query still returns cached data, so a revisit or warm reload
 * renders the list without a skeleton flash.
 *
 * `isRestoring` only counts after mount. The server renders a plain
 * QueryClientProvider (no IndexedDB, so isRestoring is false) while the
 * client hydrates under PersistQueryClientProvider (isRestoring true).
 * Reading it before mount rendered "Loading..." on the server and
 * "0 exercises available" in the hydration pass — React's hydration warning
 * in PageHeader's subtitle. Before mount the answer must not depend on it.
 * Pure.
 */
export function catalogShowsLoading(input: {
  mounted: boolean;
  isRestoring: boolean;
  isQueryLoading: boolean;
  count: number;
}): boolean {
  if (input.count > 0) return false;
  if (!input.mounted) return true;
  return !input.isRestoring && input.isQueryLoading;
}
