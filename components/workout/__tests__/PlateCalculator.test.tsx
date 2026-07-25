import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlateCalculator } from '../PlateCalculator';

describe('PlateCalculator equipment modes', () => {
  it('defaults to barbell mode and includes the bar weight', async () => {
    const user = userEvent.setup();
    render(<PlateCalculator unit="lb" />);

    expect(screen.getByRole('button', { name: 'Barbell' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Barbell Type')).toBeInTheDocument();
    expect(screen.queryByText(/Starting Weight/)).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText('Enter weight in lb');
    await user.clear(input);
    await user.type(input, '135');

    expect(screen.getByText(/Bar: 45lb \+ Plates: 45lb × 2/)).toBeInTheDocument();
  });

  it('machine mode with no starting weight calculates plates only, without a bar', async () => {
    const user = userEvent.setup();
    render(<PlateCalculator unit="lb" />);

    await user.click(screen.getByRole('button', { name: 'Machine (no bar)' }));

    expect(screen.getByRole('button', { name: 'Machine (no bar)' })).toHaveAttribute('aria-pressed', 'true');
    // Barbell type selector is hidden; starting weight input appears
    expect(screen.queryByText('Barbell Type')).not.toBeInTheDocument();
    expect(screen.getByText(/Starting Weight/)).toBeInTheDocument();

    const input = screen.getByPlaceholderText('Enter weight in lb');
    await user.clear(input);
    await user.type(input, '90');

    // 90lb with no bar and no base = 45lb per side
    expect(screen.getByText('90 lb')).toBeInTheDocument();
    expect(screen.getByText(/Plates only \(no bar\): 45lb × 2/)).toBeInTheDocument();
  });

  it('machine mode includes an entered base weight in the total', async () => {
    const user = userEvent.setup();
    render(<PlateCalculator unit="lb" />);

    await user.click(screen.getByRole('button', { name: 'Machine (no bar)' }));

    const startingInput = screen.getByPlaceholderText('0');
    await user.type(startingInput, '50');

    const targetInput = screen.getByPlaceholderText('Enter weight in lb');
    await user.clear(targetInput);
    await user.type(targetInput, '90');

    // 90lb total - 50lb base = 40lb of plates = 20lb per side
    expect(screen.getByText(/Machine base: 50lb \+ Plates: 20lb × 2/)).toBeInTheDocument();
  });

  it('opens in machine mode when a saved starting weight exists, including zero', () => {
    render(<PlateCalculator unit="lb" startingWeightKg={0} onStartingWeightChange={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Machine (no bar)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Barbell Type')).not.toBeInTheDocument();
  });

  it('reports starting weight changes in kg', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<PlateCalculator unit="lb" onStartingWeightChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Machine (no bar)' }));
    await user.type(screen.getByPlaceholderText('0'), '0');

    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});
