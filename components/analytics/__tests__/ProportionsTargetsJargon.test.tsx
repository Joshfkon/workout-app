/**
 * @jest-environment jsdom
 *
 * Panel r19 (beginner): "Jargon such as FFMI and DEXA is shown with no
 * explanation." The FFMI section says what FFMI is, and the no-scan prompt
 * says what a DEXA scan is, in one plain line each.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProportionsTargetsCard } from '../ProportionsTargetsCard';
import { DEXA_PLAIN, FFMI_PLAIN } from '../bodyJargon';

jest.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return new Proxy({}, { get: () => Stub });
});

function renderCard(extra: Partial<React.ComponentProps<typeof ProportionsTargetsCard>> = {}) {
  return render(
    <ProportionsTargetsCard
      benchmarks={[]}
      activeTarget={null}
      activeMesocycle={null}
      currentFfmi={null}
      experience="novice"
      heightCm={null}
      displayUnit="in"
      weightUnit="lb"
      weightHistory={[]}
      {...extra}
    />
  );
}

describe('FFMI / DEXA in plain words', () => {
  it('explains both terms where the no-scan prompt first shows them', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Muscle-to-height ceiling \(FFMI\)/ }));
    const empty = screen.getByTestId('ffmi-ceiling-empty');
    expect(empty).toHaveTextContent('FFMI: how much muscle you carry for your height.');
    expect(empty).toHaveTextContent('DEXA: a body-composition scan that measures fat vs. muscle.');
    expect(FFMI_PLAIN).toMatch(/^FFMI: /);
    expect(DEXA_PLAIN).toMatch(/^DEXA: /);
  });

  it('explains FFMI above the ceiling gauge once there is a value', async () => {
    const user = userEvent.setup();
    renderCard({ currentFfmi: 20.4 });
    await user.click(screen.getByRole('button', { name: /Muscle-to-height ceiling \(FFMI\)/ }));
    expect(screen.getByTestId('ffmi-plain')).toHaveTextContent(FFMI_PLAIN);
  });

  it('hides the FFMI section entirely when showFfmi is off (food-only, or a beginner with no scan)', () => {
    renderCard({ showFfmi: false });
    expect(screen.queryByRole('button', { name: /FFMI/ })).not.toBeInTheDocument();
  });
});
