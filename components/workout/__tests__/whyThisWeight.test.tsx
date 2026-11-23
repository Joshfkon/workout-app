import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { whyThisWeightSummary } from '../whyThisWeight';
import { SuggestionBanner } from '../SuggestionBanner';
import { restIntroText } from '../RestTimer';

describe('whyThisWeightSummary', () => {
  it('names last session’s set, its logged effort and the rule', () => {
    expect(
      whyThisWeightSummary(
        { ref: 'last_session', refSet: '65 lbs × 13', refRir: 2, rule: 'add_rep' },
        '65 lbs × 14'
      )
    ).toBe('Last time: 65 lbs × 13, 2 reps left → you had room, so +1 rep today: 65 lbs × 14.');
  });

  it('says why the load moved within a session', () => {
    expect(
      whyThisWeightSummary(
        { ref: 'last_set', refSet: '60 kg × 12', refRir: 4, rule: 'load_up', because: 'easier' },
        '62.5 kg × 10'
      )
    ).toBe('Your last set: 60 kg × 12, 4+ reps left → easier than your target, so weight up today: 62.5 kg × 10.');
  });

  it('leaves the effort out when none was logged', () => {
    expect(
      whyThisWeightSummary({ ref: 'last_session', refSet: '60 kg × 8', refRir: null, rule: 'hold' }, '60 kg × 8')
    ).toBe('Last time: 60 kg × 8 → same weight today: 60 kg × 8.');
  });

  it('rounded up, starting guess, recent sets, warm-up, deload', () => {
    expect(
      whyThisWeightSummary({ ref: 'last_session', refSet: '20 kg × 10', refRir: 3, rule: 'rounded_up' }, '22.5 kg × 10')
    ).toBe('Last time: 20 kg × 10, 3 reps left → your plates round up a little, so same reps at a touch more weight today: 22.5 kg × 10.');
    expect(whyThisWeightSummary({ ref: null, rule: 'start_guess', basis: 'your Bench Press' }, '40 kg × 8–12')).toBe(
      'First time on this lift: a starting guess from your Bench Press → 40 kg × 8–12. Adjust after your first set.'
    );
    expect(whyThisWeightSummary({ ref: null, rule: 'from_recent' }, '80 kg × 8–12')).toBe(
      'Based on your recent sets on this lift → 80 kg × 8–12.'
    );
    expect(whyThisWeightSummary({ ref: null, rule: 'warmup', pct: 60 }, '50 kg × 8–12')).toBe(
      'A warm-up set: about 60% of today’s top set → 50 kg × 8–12.'
    );
    expect(whyThisWeightSummary({ ref: null, rule: 'deload' }, '50 kg × 10')).toBe(
      'Lighter on purpose this session so you recover: 50 kg × 10.'
    );
  });

  it('says nothing without inputs', () => {
    expect(whyThisWeightSummary(null, '60 kg × 8')).toBeNull();
  });
});

describe('SuggestionBanner "Why this weight?"', () => {
  const props = {
    weightLabel: '65 lbs',
    repsLabel: '14',
    rir: 2,
    reason: 'matching set 1 from last session (65 lbs × 13) — go one more rep',
    explanation: ['Set-position matching: last session’s set 1 was 65 lbs × 13 at 2 RIR.'],
  };

  it('links to the same sheet with the plain summary on top, tagged Pro', async () => {
    const user = userEvent.setup();
    render(
      <SuggestionBanner
        {...props}
        why={{ ref: 'last_session', refSet: '65 lbs × 13', refRir: 2, rule: 'add_rep' }}
      />
    );
    const link = screen.getByTestId('why-this-weight');
    expect(link).toHaveTextContent('Why this weight?');
    expect(screen.getByTestId('pro-tag')).toHaveTextContent('Pro');
    await user.click(link);
    const sheet = screen.getByRole('dialog');
    expect(screen.getByTestId('why-this-weight-summary')).toHaveTextContent(
      'Last time: 65 lbs × 13, 2 reps left → you had room, so +1 rep today: 65 lbs × 14.'
    );
    // The engine reasoning is still below it.
    expect(sheet).toHaveTextContent('Set-position matching');
  });

  it('has no link when the card passed no inputs', () => {
    render(<SuggestionBanner {...props} />);
    expect(screen.queryByTestId('why-this-weight')).not.toBeInTheDocument();
  });
});

describe('restIntroText', () => {
  it('rounds to the half minute, or 5 s under a minute', () => {
    expect(restIntroText(180)).toBe('Rest about 3 min between sets. −15s / +15s to change.');
    expect(restIntroText(90)).toBe('Rest about 1.5 min between sets. −15s / +15s to change.');
    expect(restIntroText(47)).toBe('Rest about 45 sec between sets. −15s / +15s to change.');
  });
});
