/**
 * Eat's "How this is set": collapsed by default, lists the real inputs when
 * opened, and links to where targets are changed.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { TargetBasisDisclosure } from '../TargetBasisDisclosure';

describe('TargetBasisDisclosure', () => {
  it('opens to the inputs behind the target, with no TDEE abbreviation', () => {
    render(
      <TargetBasisDisclosure
        basis={{
          source: 'calculator',
          dailyBurnKcal: 2450,
          burnFrom: 'formula',
          goalLabel: 'Moderate cut',
          adjustmentKcal: -500,
          activityLabel: 'Moderately active',
          proteinPerWeight: { grams: 1, unit: 'lb' },
        }}
        onChangeTargets={jest.fn()}
      />
    );
    const toggle = screen.getByRole('button', { name: /how this is set/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('target-basis-panel')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByTestId('target-basis-panel');
    expect(panel).toHaveTextContent('Based on:');
    expect(panel).toHaveTextContent('Estimated daily burn: ~2,450 kcal (from your weight, height, age and activity)');
    expect(panel).toHaveTextContent('Goal: Moderate cut (−500 kcal a day)');
    expect(panel).toHaveTextContent('Protein: 1.0 g per lb of body weight');
    expect(panel).not.toHaveTextContent(/TDEE/);
  });

  it('"Change targets" calls through', () => {
    const onChangeTargets = jest.fn();
    render(<TargetBasisDisclosure basis={{ source: 'manual' }} onChangeTargets={onChangeTargets} />);
    fireEvent.click(screen.getByRole('button', { name: /how this is set/i }));
    expect(screen.getByTestId('target-basis-panel')).toHaveTextContent('You entered these targets yourself.');
    fireEvent.click(screen.getByRole('button', { name: 'Change targets' }));
    expect(onChangeTargets).toHaveBeenCalledTimes(1);
  });
});
