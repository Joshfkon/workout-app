import {
  buildMeasurementUpsert,
  saveBodyMeasurements,
  saveWaistFromCheckin,
  updateMeasurementSiteEntry,
  deleteMeasurementSiteEntry,
  BODY_MEASUREMENTS_CONFLICT,
} from '@/lib/body/bodyLog';
import type { SupabaseClient } from '@supabase/supabase-js';

// ------------------------------------------------------------
// A minimal upsert-recording mock. Records every (table, payload,
// options) so we can assert the single-source / one-row invariant.
// ------------------------------------------------------------
function mockClient() {
  const upserts: Array<{ table: string; payload: any; options: any }> = [];
  const client = {
    from(table: string) {
      return {
        upsert(payload: any, options: any) {
          upserts.push({ table, payload, options });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, upserts };
}

describe('buildMeasurementUpsert', () => {
  it('includes only provided sites and stamps source', () => {
    const payload = buildMeasurementUpsert('u1', '2026-05-01', { waist: 86 }, { source: 'daily_checkin' });
    expect(payload).toEqual({
      user_id: 'u1',
      logged_at: '2026-05-01',
      waist: 86,
      source: 'daily_checkin',
    });
  });

  it('omits source when not given (pre-migrate fallback shape)', () => {
    const payload = buildMeasurementUpsert('u1', '2026-05-01', { waist: 86 });
    expect(payload).not.toHaveProperty('source');
  });
});

describe('single-source invariant', () => {
  it('check-in waist and grid save target the SAME day-row (one row per user/day)', async () => {
    const { client, upserts } = mockClient();

    // Waist logged from the daily check-in...
    await saveWaistFromCheckin(client, 'u1', '2026-05-01', 86);
    // ...then the full grid edited the same day.
    await saveBodyMeasurements(client, 'u1', '2026-05-01', { chest: 104, waist: 85.5 });

    expect(upserts).toHaveLength(2);
    // Both write the same table, same conflict key, same (user_id, logged_at).
    for (const u of upserts) {
      expect(u.table).toBe('body_measurements');
      expect(u.options).toEqual({ onConflict: BODY_MEASUREMENTS_CONFLICT });
      expect(u.payload.user_id).toBe('u1');
      expect(u.payload.logged_at).toBe('2026-05-01');
    }
    // The check-in wrote ONLY waist (partial), tagged as its own source.
    expect(upserts[0].payload).toMatchObject({ waist: 86, source: 'daily_checkin' });
    expect(upserts[0].payload).not.toHaveProperty('chest');
    // The grid save defaults to body_grid.
    expect(upserts[1].payload.source).toBe('body_grid');
  });

  it('retries without source when the column is missing (ship-before-migrate)', async () => {
    const upserts: any[] = [];
    let calls = 0;
    const client = {
      from() {
        return {
          upsert(payload: any, options: any) {
            calls += 1;
            upserts.push({ payload, options });
            // First attempt fails as if `source` column is absent.
            if (calls === 1) {
              return Promise.resolve({ error: { code: '42703', message: 'column "source" does not exist' } });
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    } as unknown as SupabaseClient;

    await saveWaistFromCheckin(client, 'u1', '2026-05-01', 86);
    expect(calls).toBe(2);
    expect(upserts[0].payload).toHaveProperty('source');
    expect(upserts[1].payload).not.toHaveProperty('source'); // retry drops it
    expect(upserts[1].payload).toMatchObject({ waist: 86 });
  });
});

// ------------------------------------------------------------
// Per-entry correction helpers (the mislogged-site fix path)
// ------------------------------------------------------------

const SITE_KEYS = ['waist', 'right_thigh', 'right_calf'];

/**
 * Mock supporting the correction helpers' shapes: select→eq→eq→maybeSingle
 * (row lookup), update→eq→eq, delete→eq→eq (thenable chains). `row` is what
 * the lookup returns; mutations records the writes.
 */
function mockCorrectionClient(row: Record<string, unknown> | null) {
  const mutations: Array<{
    type: 'update' | 'delete';
    payload?: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];
  const client = {
    from() {
      return {
        select() {
          const sel: any = {
            eq: () => sel,
            maybeSingle: async () => ({ data: row, error: null }),
          };
          return sel;
        },
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const upd: any = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return upd;
            },
            then(resolve: (v: { error: null }) => void) {
              mutations.push({ type: 'update', payload, filters });
              resolve({ error: null });
            },
          };
          return upd;
        },
        delete() {
          const filters: Record<string, unknown> = {};
          const del: any = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return del;
            },
            then(resolve: (v: { error: null }) => void) {
              mutations.push({ type: 'delete', filters });
              resolve({ error: null });
            },
          };
          return del;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, mutations };
}

describe('updateMeasurementSiteEntry', () => {
  it('writes only the corrected site, keyed by user and day', async () => {
    const { client, mutations } = mockCorrectionClient(null);
    await updateMeasurementSiteEntry(client, 'u1', '2026-07-19', 'right_thigh', 54.61);
    expect(mutations).toEqual([
      {
        type: 'update',
        payload: { right_thigh: 54.61 },
        filters: { user_id: 'u1', logged_at: '2026-07-19' },
      },
    ]);
  });
});

describe('deleteMeasurementSiteEntry', () => {
  it('nulls the site when the day-row has other values', async () => {
    const { client, mutations } = mockCorrectionClient({
      logged_at: '2026-07-19',
      right_thigh: 35.8,
      waist: 86,
    });
    await deleteMeasurementSiteEntry(client, 'u1', '2026-07-19', 'right_thigh', SITE_KEYS);
    expect(mutations).toEqual([
      {
        type: 'update',
        payload: { right_thigh: null },
        filters: { user_id: 'u1', logged_at: '2026-07-19' },
      },
    ]);
  });

  it('deletes the whole day-row when the site was its only value', async () => {
    const { client, mutations } = mockCorrectionClient({
      logged_at: '2026-07-19',
      right_thigh: 35.8,
      waist: null,
    });
    await deleteMeasurementSiteEntry(client, 'u1', '2026-07-19', 'right_thigh', SITE_KEYS);
    expect(mutations).toEqual([
      { type: 'delete', filters: { user_id: 'u1', logged_at: '2026-07-19' } },
    ]);
  });

  it('is a no-op when the row does not exist', async () => {
    const { client, mutations } = mockCorrectionClient(null);
    await deleteMeasurementSiteEntry(client, 'u1', '2026-07-19', 'right_thigh', SITE_KEYS);
    expect(mutations).toHaveLength(0);
  });
});
