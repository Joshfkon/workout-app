import { markObservationsViewed, observationsViewedThisSession } from '../observationsViewed';

describe('observationsViewed session tracker', () => {
  it('is false until marked, then true, scoped per workout session', () => {
    expect(observationsViewedThisSession('session-a')).toBe(false);
    markObservationsViewed('session-a');
    expect(observationsViewedThisSession('session-a')).toBe(true);
    expect(observationsViewedThisSession('session-b')).toBe(false);
  });
});
