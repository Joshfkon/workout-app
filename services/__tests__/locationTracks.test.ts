import {
  buildLocationTracks,
  defaultTrackKey,
  locationIdForTrack,
  shouldSplitByLocation,
  trackKeyFor,
  trackLabel,
  UNASSIGNED_TRACK_KEY,
  UNASSIGNED_TRACK_LABEL,
} from '../locationTracks';

type Row = { loc: string | null; date: string };
const tracksOf = (rows: Row[], names: Record<string, string> = {}) =>
  buildLocationTracks(rows, (r) => r.loc, (r) => r.date, names);

describe('locationTracks', () => {
  it('round-trips keys, with null as the unassigned track', () => {
    expect(trackKeyFor(null)).toBe(UNASSIGNED_TRACK_KEY);
    expect(trackKeyFor(undefined)).toBe(UNASSIGNED_TRACK_KEY);
    expect(trackKeyFor('gym-a')).toBe('gym-a');
    expect(locationIdForTrack(UNASSIGNED_TRACK_KEY)).toBeNull();
    expect(locationIdForTrack('gym-a')).toBe('gym-a');
  });

  it('labels tracks by gym name, never by id', () => {
    expect(trackLabel('gym-a', { 'gym-a': 'Planet Fitness' })).toBe('Planet Fitness');
    expect(trackLabel(null)).toBe(UNASSIGNED_TRACK_LABEL);
    expect(trackLabel('gym-x', {})).toBe('Unnamed gym');
  });

  it('groups per location, most recently used first', () => {
    const tracks = tracksOf(
      [
        { loc: 'home', date: '2026-09-01' },
        { loc: 'home', date: '2026-09-10' },
        { loc: 'pf', date: '2026-09-20' },
        { loc: null, date: '2026-06-01' },
      ],
      { home: 'Home Gym', pf: 'Planet Fitness' }
    );
    expect(tracks.map((t) => [t.key, t.label, t.count])).toEqual([
      ['pf', 'Planet Fitness', 1],
      ['home', 'Home Gym', 2],
      [UNASSIGNED_TRACK_KEY, UNASSIGNED_TRACK_LABEL, 1],
    ]);
    expect(tracks[1].latestDate).toBe('2026-09-10');
  });

  it('splits only local-scope exercises with more than one track', () => {
    const two = tracksOf([
      { loc: 'a', date: '2026-01-01' },
      { loc: 'b', date: '2026-01-02' },
    ]);
    const one = tracksOf([{ loc: 'a', date: '2026-01-01' }]);
    expect(shouldSplitByLocation('local', two)).toBe(true);
    expect(shouldSplitByLocation('global', two)).toBe(false);
    expect(shouldSplitByLocation(undefined, two)).toBe(false);
    expect(shouldSplitByLocation('local', one)).toBe(false);
  });

  it('opens on the preferred gym when it has history, else the latest', () => {
    const tracks = tracksOf([
      { loc: 'a', date: '2026-01-01' },
      { loc: 'b', date: '2026-01-05' },
    ]);
    expect(defaultTrackKey(tracks, 'a')).toBe('a');
    expect(defaultTrackKey(tracks, 'c')).toBe('b');
    expect(defaultTrackKey(tracks)).toBe('b');
    expect(defaultTrackKey([], 'a')).toBeNull();
  });
});
