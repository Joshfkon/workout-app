import {
  __resetPendingWorkoutBuildsForTests,
  awaitPendingWorkoutBuild,
  clearPendingWorkoutPreview,
  getEarlyLoggedSet,
  getPendingWorkoutPreview,
  recordEarlyLoggedSet,
  takeEarlyLoggedSet,
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

  describe('preview of the first exercise', () => {
    const preview = {
      exercises: [
        {
          exerciseId: 'ex-bench',
          name: 'Bench Press',
          targetSets: 3,
          repRange: [8, 12] as [number, number],
          targetRir: 2,
          weightKg: 60,
          loggable: true,
        },
      ],
    };

    it('is available to the workout screen as soon as it navigates, and outlives a successful build', async () => {
      const rest = deferred();
      let seenAtNavigate: unknown = 'unset';
      const run = runNavigateFirstStart({
        navigate: (id) => {
          seenAtNavigate = getPendingWorkoutPreview(id);
        },
        start: async ({ sessionReady, preview: publish }) => {
          // Sheet order: the exercises are known before the session is ready.
          publish(preview);
          sessionReady('p1');
          await rest.promise;
          return { sessionId: 'p1' };
        },
      });
      await flush();
      expect(seenAtNavigate).toEqual(preview);
      rest.resolve();
      await run;
      await awaitPendingWorkoutBuild('p1');
      // The screen still has its own load to do: the preview stays until it clears it.
      expect(getPendingWorkoutPreview('p1')).toEqual(preview);
      clearPendingWorkoutPreview('p1');
      expect(getPendingWorkoutPreview('p1')).toBeNull();
    });

    it('accepts a preview published after the navigation (mesocycle start order)', async () => {
      await runNavigateFirstStart({
        navigate: () => {},
        start: async ({ sessionReady, preview: publish }) => {
          sessionReady('p2');
          publish(preview);
          return { sessionId: 'p2' };
        },
      });
      expect(getPendingWorkoutPreview('p2')).toEqual(preview);
    });

    it('drops the preview and any early set when the build fails', async () => {
      await runNavigateFirstStart({
        navigate: () => {},
        start: async ({ sessionReady, preview: publish }) => {
          sessionReady('p3');
          publish(preview);
          recordEarlyLoggedSet('p3', {
            exerciseId: 'ex-bench',
            weightKg: 60,
            repCount: 10,
            rpe: 8,
            feedback: { repsInTank: 2, form: 'clean' },
          });
          await flush();
          throw new Error('insert failed');
        },
      });
      expect(getPendingWorkoutPreview('p3')).toBeNull();
      expect(getEarlyLoggedSet('p3')).toBeNull();
    });

    it('hands an early set over exactly once', () => {
      const set = {
        exerciseId: 'ex-bench',
        weightKg: 60,
        repCount: 10,
        rpe: 8,
        feedback: { repsInTank: 2 as const, form: 'clean' as const },
      };
      recordEarlyLoggedSet('p4', set);
      expect(takeEarlyLoggedSet('p4')).toEqual(set);
      expect(takeEarlyLoggedSet('p4')).toBeNull();
    });

    it('ignores an empty preview', () => {
      runNavigateFirstStart({
        navigate: () => {},
        start: async ({ sessionReady, preview: publish }) => {
          sessionReady('p5');
          publish({ exercises: [] });
          return { sessionId: 'p5' };
        },
      });
      expect(getPendingWorkoutPreview('p5')).toBeNull();
    });
  });
});
