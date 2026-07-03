import {
  isStaleDeploymentError,
  beginStaleDeployRecovery,
} from '../staleDeployRecovery';

const CHUNK_RELOAD_KEY = 'chunk-error-reloaded-at';

function makeError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

// Let the clearCaches → reload promise chain settle.
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('isStaleDeploymentError', () => {
  it.each([
    ['ChunkLoadError by name', 'ChunkLoadError', 'anything at all'],
    ['webpack chunk message', 'Error', 'Loading chunk 4821 failed'],
    ['webpack named chunk', 'Error', 'Loading chunk app-pages-internals failed'],
    ['Safari module script', 'TypeError', 'Importing a module script failed.'],
    ['dynamic import failure', 'TypeError', 'Failed to fetch dynamically imported module: https://x/chunk.js'],
  ])('detects %s', (_label, name, message) => {
    expect(isStaleDeploymentError(makeError(name, message))).toBe(true);
  });

  it.each([
    ['generic error', 'Error', 'boom'],
    ['network error', 'TypeError', 'Failed to fetch'],
    ['null-access error', 'TypeError', "Cannot read properties of null (reading 'foo')"],
  ])('does not match %s', (_label, name, message) => {
    expect(isStaleDeploymentError(makeError(name, message))).toBe(false);
  });
});

describe('beginStaleDeployRecovery', () => {
  let reload: jest.Mock;
  let cacheDelete: jest.Mock;

  beforeEach(() => {
    sessionStorage.clear();
    reload = jest.fn();
    cacheDelete = jest.fn().mockResolvedValue(true);
    (globalThis as any).caches = {
      keys: jest.fn().mockResolvedValue(['hypertrack-v3', 'other-cache']),
      delete: cacheDelete,
    };
  });

  afterEach(() => {
    delete (globalThis as any).caches;
  });

  it('clears every cache, then reloads, and stamps the cooldown', async () => {
    expect(beginStaleDeployRecovery({ reload })).toBe(true);

    await flushMicrotasks();
    expect(cacheDelete).toHaveBeenCalledWith('hypertrack-v3');
    expect(cacheDelete).toHaveBeenCalledWith('other-cache');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Number(sessionStorage.getItem(CHUNK_RELOAD_KEY))).toBeGreaterThan(0);
  });

  it('returns false and does not reload within the 60s cooldown', async () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now() - 5_000));

    expect(beginStaleDeployRecovery({ reload })).toBe(false);

    await flushMicrotasks();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads again once the cooldown has passed', async () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now() - 61_000));

    expect(beginStaleDeployRecovery({ reload })).toBe(true);

    await flushMicrotasks();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads when the Cache API is unavailable', async () => {
    delete (globalThis as any).caches;

    expect(beginStaleDeployRecovery({ reload })).toBe(true);

    await flushMicrotasks();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads when cache clearing rejects', async () => {
    (globalThis as any).caches.keys = jest.fn().mockRejectedValue(new Error('denied'));

    expect(beginStaleDeployRecovery({ reload })).toBe(true);

    await flushMicrotasks();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
