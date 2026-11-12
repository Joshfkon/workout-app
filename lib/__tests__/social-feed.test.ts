import { feedCursorFilter, nextReactionCount } from '../social';

describe('feedCursorFilter', () => {
  it('pages by (created_at, id) so rows sharing a timestamp are not skipped', () => {
    expect(feedCursorFilter({ createdAt: '2026-01-02T03:04:05.123456+00:00', id: 'abc' })).toBe(
      'created_at.lt."2026-01-02T03:04:05.123456+00:00",and(created_at.eq."2026-01-02T03:04:05.123456+00:00",id.lt."abc")'
    );
  });
});

describe('nextReactionCount', () => {
  it('adds one for a new reaction and removes one when it is taken away', () => {
    expect(nextReactionCount(3, false, true)).toBe(4);
    expect(nextReactionCount(3, true, false)).toBe(2);
  });

  it('does not change when the reaction type is swapped', () => {
    expect(nextReactionCount(3, true, true)).toBe(3);
  });

  it('does not decrement when removing a reaction that was never set', () => {
    expect(nextReactionCount(3, false, false)).toBe(3);
  });

  it('never goes below zero', () => {
    expect(nextReactionCount(0, true, false)).toBe(0);
  });
});
