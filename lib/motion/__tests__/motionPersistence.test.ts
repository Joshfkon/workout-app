/**
 * saveMotionCapture outcome semantics: the caller must be able to tell a
 * confirmed write ('synced') from a durably queued one ('queued'), and a
 * server REJECTION must throw — never report success — with the doomed
 * entry removed from the queue.
 */

import {
  __setDriverForTests,
  outboxCount,
  type OutboxSupabase,
} from '@/lib/offline/setOutbox';
import { saveMotionCapture } from '../motionPersistence';
import type { MotionCapture } from '@/types/motion';

/** Minimal in-memory outbox driver (mirrors the setOutbox test seam shape). */
function memoryDriver() {
  const store = new Map<string, unknown>();
  return {
    async put(entry: { id: string }) {
      store.set(entry.id, entry);
    },
    async getAll() {
      return Array.from(store.values()) as never[];
    },
    async delete(id: string) {
      store.delete(id);
    },
    async get(id: string) {
      return store.get(id) as never;
    },
  };
}

function supabaseAnswering(error: { message: string; code?: string } | null): OutboxSupabase {
  return {
    from: () => ({
      upsert: () => Promise.resolve({ error }),
      update: () => ({ eq: () => Promise.resolve({ error }) }),
    }),
  };
}

const capture: MotionCapture = {
  id: 'cap-1',
  setId: 'set-1',
  calibrationId: 'calib-1',
  side: 'right',
  startedAt: '2026-07-30T12:00:00.000Z',
  durationMs: 12345,
  sampleRateHz_mean: 100,
  sampleRateHz_stddev: 2,
  droppedSampleCount: 0,
  clipDetected: false,
  reps: [],
  qualityFlags: [],
  provenance: 'phone-imu-v1',
  schemaVersion: 1,
};

beforeEach(() => {
  __setDriverForTests(memoryDriver() as never);
});

afterEach(() => {
  __setDriverForTests(null);
});

describe('saveMotionCapture', () => {
  it("returns 'synced' when the row lands, leaving the queue empty", async () => {
    const result = await saveMotionCapture(supabaseAnswering(null), capture, 'user-1');
    expect(result).toBe('synced');
    expect(await outboxCount('motion_captures')).toBe(0);
  });

  it("returns 'queued' on a network failure, keeping the entry for retry", async () => {
    const result = await saveMotionCapture(
      supabaseAnswering({ message: 'Failed to fetch' }),
      capture,
      'user-1'
    );
    expect(result).toBe('queued');
    expect(await outboxCount('motion_captures')).toBe(1);
  });

  it('throws on a server rejection and removes the doomed entry from the queue', async () => {
    // SQLSTATE-style code = the server answered and refused (FK/RLS).
    await expect(
      saveMotionCapture(
        supabaseAnswering({ message: 'violates foreign key constraint', code: '23503' }),
        capture,
        'user-1'
      )
    ).rejects.toThrow(/rejected/);
    expect(await outboxCount('motion_captures')).toBe(0);
  });

  it('refuses to persist a capture without a calibration reference', async () => {
    await expect(
      saveMotionCapture(supabaseAnswering(null), { ...capture, calibrationId: '' }, 'user-1')
    ).rejects.toThrow(/calibrationId/);
    expect(await outboxCount('motion_captures')).toBe(0);
  });
});
