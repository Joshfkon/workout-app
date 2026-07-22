/**
 * Generated-program band gate (convention-conversion v2 verification):
 * across representative templates (Full Body 3d / Upper-Lower 4d / PPL 6d),
 * no coarse group's CREDITED weekly total (direct + 0.5-secondary — the
 * currency every tracking surface counts in) may exceed its band MRV, and
 * the per-standard floors must hold (side delts never trimmed below their
 * child MEV even though they receive zero indirect inflow). This is the
 * regression guard for the indirect-aware allocator + goal-clamp: without
 * them the generator shipped programs the volume card flagged as over-MRV
 * (shoulders read 32 vs 12–26 on PPL pre-conversion).
 */
import { generateFullProgram } from '../mesocycleBuilder';
import { resolvePrimaryMuscleCredits, SECONDARY_MUSCLE_CREDIT } from '../volumeTracker';
import { resolveMuscleToStandard } from '@/types/schema';
import { STANDARD_TO_COARSE, RESEARCH_VOLUME_BANDS, COARSE_MUSCLES, type CoarseMuscle } from '../volumeBands';

const profile: any = {
  goal: 'bulk', experience: 'intermediate', heightCm: 175, latestDexa: null, age: 30,
  sleepQuality: 3, stressLevel: 3, trainingAge: 2,
  availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'], injuryHistory: [],
};

it('no generated program exceeds a band ceiling; subdivision floors hold', () => {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  for (const days of [3, 4, 6]) {
    const program = generateFullProgram(days, profile, 60);
    const direct: Record<string, number> = {}; const indirect: Record<string, number> = {}; const fine: Record<string, number> = {};
    const add = (rec: Record<string, number>, k: string | undefined, v: number) => { if (k) rec[k] = (rec[k] ?? 0) + v; };
    for (const s of program.sessions) for (const ex of s.exercises) {
      const pc = resolvePrimaryMuscleCredits(ex.exercise.primaryMuscle);
      const pset = new Set(pc.map((c) => c.muscle));
      for (const { muscle, weight } of pc) { add(direct, STANDARD_TO_COARSE[muscle], ex.sets * weight); add(fine, muscle, ex.sets * weight); }
      for (const sec of ex.exercise.secondaryMuscles ?? []) {
        const stds = resolveMuscleToStandard(sec); if (!stds.length) continue;
        const per = SECONDARY_MUSCLE_CREDIT / stds.length;
        for (const std of stds) if (!pset.has(std)) add(indirect, STANDARD_TO_COARSE[std], ex.sets * per);
      }
    }
    const over: string[] = [];
    const lines: string[] = [];
    for (const g of COARSE_MUSCLES) {
      const d = r1(direct[g] ?? 0), i = r1(indirect[g] ?? 0); if (d + i === 0) continue;
      const band = RESEARCH_VOLUME_BANDS[g as CoarseMuscle]; const total = r1(d + i);
      const status = total > band.mrv ? 'OVER' : total < band.mev ? 'under' : 'ok';
      if (status === 'OVER') over.push(g);
      lines.push(`${g}: ${d}+${i}=${total} [${band.mev}-${band.mrv}] ${status}`);
    }
    expect(over).toEqual([]); // GATE: no group's credited total exceeds its band MRV
    expect(lines.length).toBeGreaterThan(5); // fixture sanity: programs are non-trivial
    // Side delts get 0 indirect in every template — the allocator must keep
    // their DIRECT work at/above the child MEV floor (6).
    expect(r1(fine['lateral_delts'] ?? 0)).toBeGreaterThanOrEqual(6);
  }
});
