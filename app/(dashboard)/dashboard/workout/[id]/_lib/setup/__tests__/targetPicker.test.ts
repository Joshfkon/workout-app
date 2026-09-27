import {
  buildTargetChips,
  deriveShortcuts,
  dominantGroups,
  groupStatesFromRows,
  sessionTypeLabel,
  stabilizerLevel,
} from '../targetPicker';
import { buildReadinessRows, selectGoodTargets } from '../../readiness';
import { computeMuscleRecovery, type RecoverySession } from '@/services/muscleRecovery';
import type { StandardMuscleGroup } from '@/types/schema';
import type { RecentSessionSummary } from '@/services/workoutSetup/types';

const NOW = new Date('2026-07-11T12:00:00.000Z');
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const session = (at: Date, primaryMuscle: string, sets: number): RecoverySession => ({
  performedAt: at,
  exercises: [{ primaryMuscle, secondaryMuscles: [], sets: Array.from({ length: sets }, () => ({ repsInTank: 2 })) }],
});

describe('buildTargetChips', () => {
  // Chest + quads trained 5 days ago (Fresh, under MEV), quads again now
  // (Fatigued); forearms never → unknown.
  const history = [session(hoursBefore(120), 'chest', 3), session(NOW, 'quads', 5)];
  const rows = buildReadinessRows([], history, NOW);
  const { targets } = selectGoodTargets(rows, 3);
  const chips = buildTargetChips(rows, targets);

  it('never pre-selects a zero-history (unknown) group', () => {
    const forearms = chips.find((c) => c.group === 'forearms')!;
    expect(forearms.status).toBe('unknown');
    expect(forearms.preselected).toBe(false);
    expect(chips.filter((c) => c.status === 'unknown').every((c) => !c.preselected)).toBe(true);
  });

  it('pre-selects the Good Targets and ranks them first', () => {
    expect(chips.find((c) => c.group === 'chest')!.preselected).toBe(true);
    expect(chips[0].group).toBe('chest');
    // Fatigued sinks below unknown.
    const idx = (g: string) => chips.findIndex((c) => c.group === g);
    expect(idx('forearms')).toBeLessThan(idx('quads'));
  });

  it('carries the deficit and zone for the chip indicator', () => {
    const chest = chips.find((c) => c.group === 'chest')!;
    expect(chest).toMatchObject({ zoneMin: 8, zoneMax: 22 });
    expect(chest.deficit).toBe(chest.zoneMin - chest.weeklyCredited);
  });

  it('a fine-muscle target selects its parent group and becomes a focus muscle', () => {
    const reachable = new Set<StandardMuscleGroup>(['rear_delts', 'front_delts', 'lateral_delts']);
    const known = new Set<StandardMuscleGroup>(['rear_delts', 'front_delts', 'lateral_delts']);
    const r = buildReadinessRows([], [], NOW, reachable, undefined, undefined, undefined, known);
    const t = [{ muscle: 'rear_delts', displayName: 'Rear delts', isChild: true, score: 5, tier: 'ready' as const, readyInHours: 0 }];
    expect(buildTargetChips(r, t).find((c) => c.group === 'shoulders')!.preselected).toBe(true);
    expect(groupStatesFromRows(r, t).find((g) => g.group === 'shoulders')!.focusMuscles).toEqual(['rear_delts']);
  });
});

describe('stabilizerLevel', () => {
  it('maps the stabilizer channel onto ok / elevated / high', () => {
    const fresh = computeMuscleRecovery([], 'forearms', NOW);
    expect(stabilizerLevel(fresh)).toBe('ok');
    expect(stabilizerLevel({ ...fresh, readinessRatio: 0.8 })).toBe('elevated');
    expect(stabilizerLevel({ ...fresh, readinessRatio: 0.3 })).toBe('high');
  });
});

describe('shortcuts', () => {
  const s = (id: string, daysAgo: number, exercises: [string, string[], number][]): RecentSessionSummary => ({
    sessionId: id,
    completedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    exercises: exercises.map(([primaryMuscle, secondaryMuscles, workingSets], k) => ({
      exerciseId: `${id}-${k}`,
      name: `${primaryMuscle} ex`,
      primaryMuscle,
      secondaryMuscles,
      workingSets,
    })),
  });
  const push = s('a', 1, [['chest', ['triceps', 'front_delts'], 8], ['lateral_delts', [], 4], ['triceps', [], 3]]);
  const pull = s('b', 3, [['back', ['biceps'], 8], ['biceps', [], 4]]);
  const push2 = s('c', 5, [['chest', ['triceps', 'front_delts'], 8], ['lateral_delts', [], 4], ['triceps', [], 3]]);
  const daysAgo = (iso: string) => Math.round((NOW.getTime() - new Date(iso).getTime()) / 86_400_000);

  it('labels sessions by dominant groups', () => {
    expect(dominantGroups(push)[0]).toBe('chest');
    expect(sessionTypeLabel(dominantGroups(push))).toBe('Push');
    expect(sessionTypeLabel(dominantGroups(pull))).toBe('Pull');
    expect(sessionTypeLabel(['quads', 'hamstrings'])).toBe('Legs');
    expect(sessionTypeLabel(['chest', 'back'])).toBe('Upper');
    expect(sessionTypeLabel(['chest', 'quads'])).toBe('Full body');
  });

  it('repeat-type uses the latest session; recent sessions are distinct', () => {
    const { repeatType, recentSessions } = deriveShortcuts([push, pull, push2], daysAgo);
    expect(repeatType?.label).toBe('Push');
    expect(repeatType?.groups).toContain('chest');
    expect(recentSessions.map((r) => r.session.sessionId)).toEqual(['a', 'b']);
    expect(recentSessions[1]).toMatchObject({ label: 'Pull', daysAgo: 3 });
  });

  it('is empty without history', () => {
    expect(deriveShortcuts([], daysAgo)).toEqual({ repeatType: null, recentSessions: [] });
  });
});
