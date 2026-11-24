import { earlierGoalAnswer, preselectionNote } from '../goalPreselection';

describe('onboarding goal preselection (UX round 21)', () => {
  it('prefers a goal saved in onboarding, then the direction of Eat targets, else nothing', () => {
    expect(earlierGoalAnswer('bulk', 'moderate_cut')).toEqual({ goal: 'bulk', source: 'saved' });
    expect(earlierGoalAnswer(null, 'aggressive_cut')).toEqual({ goal: 'cut', source: 'nutrition' });
    expect(earlierGoalAnswer(null, 'slow_bulk')).toEqual({ goal: 'bulk', source: 'nutrition' });
    expect(earlierGoalAnswer(null, 'maintain')).toEqual({ goal: 'maintenance', source: 'nutrition' });
    expect(earlierGoalAnswer(null, null)).toBeNull();
    expect(earlierGoalAnswer(null, 'something_else')).toBeNull();
  });

  it('says the default is a choice to change, in training or food words', () => {
    expect(preselectionNote('default', false)).toMatch(/Maintain is picked to start\. Cutting or bulking\?/);
    expect(preselectionNote('default', true)).not.toMatch(/muscle|cut|bulk/i);
    expect(preselectionNote('saved', false)).toMatch(/saved earlier/);
    expect(preselectionNote('nutrition', false)).toMatch(/food targets/);
  });
});
