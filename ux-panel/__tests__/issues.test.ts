/**
 * Review-listed problems count as issues next to live friction reports, so a
 * run with no blockers can't read "0 issues" while every review complains.
 */
import { problemsToFrictions } from '../lib/issues.mjs';

const rec = {
  taskId: 'sam__find-setting',
  personaId: 'sam',
  journeyId: 'find-setting',
  finalUrl: '/dashboard/settings',
  log: [
    { step: 0, screen: '/dashboard', action: 'tapped e1' },
    { step: 1, screen: '/dashboard/more', action: 'tapped e2' },
    { step: 2, screen: '/dashboard/more', action: 'tapped e3' },
  ],
  review: {
    problems: [
      { screen: '/dashboard', text: 'AI popup blocked me at the start.', severity: 'minor' },
      { screen: '/somewhere-else', text: 'Settings was buried under More.', severity: 'major' },
      { screen: '', text: '   ', severity: 'minor' },
    ],
  },
};

describe('problemsToFrictions', () => {
  const items = problemsToFrictions(rec);

  it('turns each listed problem into a friction item tagged as from the review', () => {
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ screen: '/dashboard', source: 'review', personaId: 'sam', journeyId: 'find-setting', severity: 'minor' });
  });

  it('only trusts a screen the persona actually visited, and picks its last screenshot there', () => {
    expect(items[0].screenshot).toBe('step-00.jpg');
    expect(items[1].screen).toBe('/dashboard/settings'); // unvisited → final screen
  });

  it('returns nothing for a review without problems', () => {
    expect(problemsToFrictions({ ...rec, review: {} })).toEqual([]);
  });
});
