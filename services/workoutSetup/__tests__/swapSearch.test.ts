import { rankSwapCandidates, searchSwapCandidates } from '../swapRanking';
import { BY_ID, CATALOG } from './fixtures';

const bench = BY_ID.get('bench')!;
const ids = (cs: { exercise: { id: string } }[]) => cs.map((c) => c.exercise.id);

describe('searchSwapCandidates', () => {
  it('empty query is exactly the ranked recommendations', () => {
    const res = searchSwapCandidates(bench, CATALOG, '   ');
    expect(ids(res.matches)).toEqual(ids(rankSwapCandidates(bench, CATALOG)));
    expect(res.otherMatches).toEqual([]);
  });

  it('filters same-muscle candidates by word prefix, keeping their ranking', () => {
    const res = searchSwapCandidates(bench, CATALOG, 'inc');
    expect(ids(res.matches)).toEqual(['incline']);
  });

  it('reaches the rest of the catalog for an explicit search', () => {
    const res = searchSwapCandidates(bench, CATALOG, 'curl');
    expect(res.matches).toEqual([]);
    expect(ids(res.otherMatches).sort()).toEqual(['curl', 'legcurl', 'wristcurl']);
  });

  it('every token must match; matches primary muscle words too', () => {
    expect(ids(searchSwapCandidates(bench, CATALOG, 'dumb curl').otherMatches)).toEqual(['curl']);
    expect(ids(searchSwapCandidates(bench, CATALOG, 'hamstr').otherMatches).sort()).toEqual(['deadlift', 'legcurl']);
  });

  it('never offers the current exercise or ones already in the plan', () => {
    const res = searchSwapCandidates(bench, CATALOG, 'barbell', { excludeIds: new Set(['squat']) });
    const all = [...ids(res.matches), ...ids(res.otherMatches)];
    expect(all).not.toContain('bench');
    expect(all).not.toContain('squat');
    expect(all).toEqual(expect.arrayContaining(['row', 'thrust']));
  });

  it('other matches sort unavailable equipment last', () => {
    const res = searchSwapCandidates(bench, CATALOG, 'curl', { unavailableExerciseIds: ['curl'] });
    expect(res.otherMatches[res.otherMatches.length - 1].exercise.id).toBe('curl');
    expect(res.otherMatches[res.otherMatches.length - 1].equipmentAvailable).toBe(false);
  });
});
