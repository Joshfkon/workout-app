import {
  __resetPendingWorkoutBuildsForTests,
  awaitPendingWorkoutBuild,
  getPendingWorkoutBuildStage,
  hasPendingWorkoutBuild,
  runNavigateFirstStart,
  trackPendingWorkoutBuild,
} from '../pendingWorkoutStart';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('pendingWorkoutStart', () => {
  beforeEach(() => __resetPendingWorkoutBuildsForTests());

  it('navigates as soon as the session is ready, before the build finishes', async () => {
    const navigate = jest.fn();
    const rest = deferred();
    const run = runNavigateFirstStart({
      navigate,
      start: async ({ sessionReady, stage }) => {
        sessionReady('s1');
        stage('building');
        await rest.promise;
        stage('saving');
        return { sessionId: 's1' };
      },
    });
    await flush();
    expect(navigate).toHaveBeenCalledWith('s1');
    expect(hasPendingWorkoutBuild('s1')).toBe(true);
    expect(getPendingWorkoutBuildStage('s1')).toBe('building');

    // The workout page waits on the build before reading the session.
    let pageError: string | null | undefined;
    const page = awaitPendingWorkoutBuild('s1').then((e) => (pageError = e));
    await flush();
    expect(pageError).toBeUndefined();

    rest.resolve();
    await expect(run).resolves.toEqual({ sessionId: 's1', navigatedEarly: true });
    await page;
    expect(pageError).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(hasPendingWorkoutBuild('s1')).toBe(false);
  });

  it('navigates at the end when the start never reports a new session (resume)', async () => {
    const navigate = jest.fn();
    await expect(
      runNavigateFirstStart({ navigate, start: async () => ({ sessionId: 'existing' }) })
    ).resolves.toEqual({ sessionId: 'existing', navigatedEarly: false });
    expect(navigate).toHaveBeenCalledWith('existing');
    expect(await awaitPendingWorkoutBuild('existing')).toBeNull();
  });

  it('rethrows a failure before the navigation so the start screen can show it', async () => {
    const navigate = jest.fn();
    await expect(
      runNavigateFirstStart({
        navigate,
        start: async () => {
          throw new Error('offline');
        },
      })
    ).rejects.toThrow('offline');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('hands a failure after the navigation to the workout page instead of throwing', async () => {
    const navigate = jest.fn();
    await expect(
      runNavigateFirstStart({
        navigate,
        start: async ({ sessionReady }) => {
          sessionReady('s2');
          await flush();
          throw { message: 'blocks insert failed' };
        },
      })
    ).resolves.toEqual({ sessionId: 's2', navigatedEarly: true });
    expect(navigate).toHaveBeenCalledWith('s2');
    expect(await awaitPendingWorkoutBuild('s2')).toBe('blocks insert failed');
    // Consumed: a later visit loads normally.
    expect(await awaitPendingWorkoutBuild('s2')).toBeNull();
  });

  it('tracks a stage set directly on a tracked build', async () => {
    const d = deferred();
    const { setStage } = trackPendingWorkoutBuild('s3', d.promise);
    setStage('saving');
    expect(getPendingWorkoutBuildStage('s3')).toBe('saving');
    d.resolve();
    await flush();
    expect(getPendingWorkoutBuildStage('s3')).toBeNull();
  });
});
