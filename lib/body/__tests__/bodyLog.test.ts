import {
  buildMeasurementUpsert,
  saveBodyMeasurements,
  saveWaistFromCheckin,
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
