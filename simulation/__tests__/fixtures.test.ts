/**
 * The bootstrap world must be a world PRODUCTION COULD HOLD.
 *
 * `fakeSupabase` enforces no constraints (limitation L1), which is a deliberate
 * trade — but it means a fixture can seed a row the real database would reject
 * outright, and every run built on it then proves something about a state that
 * cannot exist. Codex review on #682 caught two at once: a `total_weeks: 24`
 * mesocycle (the schema caps it at 12, and additionally requires
 * `current_week <= total_weeks`, which a long run would have breached), and a
 * `status` field where the column is `state` — leaving the row invisible to the
 * production lookup the fixture exists to feed.
 *
 * Neither broke a test. That is the point of this file: the fake will not tell
 * you, so something has to.
 *
 * These assertions transcribe constraints from
 * `supabase/migrations/20241209000001_initial_schema.sql`. They are NOT a
 * schema validator — a real one is Layer 2's job. They pin the handful of
 * constraints this fixture can actually violate.
 */
import { createSimulationWorld, SIM_MESOCYCLE_ID, SIM_USER_ID } from '../fixtures';

/** `CREATE TYPE mesocycle_state AS ENUM ('planned', 'active', 'completed')`. */
const MESOCYCLE_STATES = ['planned', 'active', 'completed'];

interface MesocycleRow {
  id: string;
  user_id: string;
  state?: string;
  status?: string;
  total_weeks: number;
  current_week: number;
  deload_week: number;
  days_per_week: number;
}

function seededMesocycle(): MesocycleRow {
  const fake = createSimulationWorld();
  const rows = fake.db.rows('mesocycles') as unknown as MesocycleRow[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe('the simulated mesocycle satisfies the real schema', () => {
  it('carries a `state` the production lookup can find, not a `status`', () => {
    // SessionDriver.activeMesocycle() filters .eq('state', 'active'). A row
    // with `status` instead is silently invisible to it, so startSession()
    // throws "no active mesocycle" and the fixture cannot exercise the
    // production start/scheduling path at all.
    const meso = seededMesocycle();
    expect(meso.state).toBe('active');
    expect(MESOCYCLE_STATES).toContain(meso.state);
    expect(meso.status).toBeUndefined();
  });

  it('respects the CHECK constraints on the mesocycles table', () => {
    const meso = seededMesocycle();
    // CHECK (total_weeks >= 1 AND total_weeks <= 12)
    expect(meso.total_weeks).toBeGreaterThanOrEqual(1);
    expect(meso.total_weeks).toBeLessThanOrEqual(12);
    // CHECK (days_per_week >= 1 AND days_per_week <= 7)
    expect(meso.days_per_week).toBeGreaterThanOrEqual(1);
    expect(meso.days_per_week).toBeLessThanOrEqual(7);
    // CHECK (current_week >= 1), CONSTRAINT valid_current_week
    expect(meso.current_week).toBeGreaterThanOrEqual(1);
    expect(meso.current_week).toBeLessThanOrEqual(meso.total_weeks);
    // CONSTRAINT valid_deload_week
    expect(meso.deload_week).toBeLessThanOrEqual(meso.total_weeks);
  });

  it('belongs to the simulated user, and the sessions belong to it', () => {
    const fake = createSimulationWorld();
    const meso = (fake.db.rows('mesocycles') as unknown as MesocycleRow[])[0];
    expect(meso.id).toBe(SIM_MESOCYCLE_ID);
    expect(meso.user_id).toBe(SIM_USER_ID);

    const sessions = fake.db.rows('workout_sessions') as unknown as {
      mesocycle_id: string | null;
    }[];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.mesocycle_id === SIM_MESOCYCLE_ID)).toBe(true);
  });
});
