import { catalogShowsLoading } from '../_lib/catalogLoading';

describe('catalogShowsLoading', () => {
  it('server render and hydration pass agree (the PageHeader hydration warning)', () => {
    // Server: plain QueryClientProvider, isRestoring false.
    const server = catalogShowsLoading({ mounted: false, isRestoring: false, isQueryLoading: false, count: 0 });
    // Client hydration: PersistQueryClientProvider, isRestoring true, not mounted yet.
    const hydration = catalogShowsLoading({ mounted: false, isRestoring: true, isQueryLoading: false, count: 0 });
    expect(hydration).toBe(server);
  });

  it('after mount, no skeleton while the cache restores', () => {
    expect(catalogShowsLoading({ mounted: true, isRestoring: true, isQueryLoading: true, count: 0 })).toBe(false);
  });

  it('after mount, a cold load with an empty cache shows loading', () => {
    expect(catalogShowsLoading({ mounted: true, isRestoring: false, isQueryLoading: true, count: 0 })).toBe(true);
    expect(catalogShowsLoading({ mounted: true, isRestoring: false, isQueryLoading: false, count: 0 })).toBe(false);
  });

  it('never with a catalog to show', () => {
    expect(catalogShowsLoading({ mounted: false, isRestoring: false, isQueryLoading: true, count: 12 })).toBe(false);
  });
});
