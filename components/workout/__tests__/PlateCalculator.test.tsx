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

describe('PlateCalculator weight increment setting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterAll(() => {
    localStorage.clear();
  });

  it('defaults to ±5lb steps from a 2.5lb smallest plate', () => {
    render(<PlateCalculator unit="lb" />);

    expect(screen.getByRole('button', { name: '±5lb 2.5lb plates' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Increase target weight by 5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease target weight by 5' })).toBeInTheDocument();
  });

  it('selecting 1.25lb plates makes a 202.5lb target exactly loadable', async () => {
    const user = userEvent.setup();
    render(<PlateCalculator unit="lb" />);

    const input = screen.getByPlaceholderText('Enter weight in lb');
    await user.clear(input);
    await user.type(input, '202.5');

    // Without micro plates the solver can only get within 2.5lb.
    expect(screen.getByTestId('plate-calc-closest')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '±2.5lb 1.25lb plates' }));

    expect(screen.queryByTestId('plate-calc-closest')).not.toBeInTheDocument();
    expect(screen.getByText('202.5 lb')).toBeInTheDocument();
    expect(screen.getByText(/Bar: 45lb \+ Plates: 78.75lb × 2/)).toBeInTheDocument();
  });

  it('steppers use the selected increment', async () => {
    const user = userEvent.setup();
    render(<PlateCalculator unit="lb" />);

    await user.click(screen.getByRole('button', { name: '±2.5lb 1.25lb plates' }));

    const input = screen.getByPlaceholderText('Enter weight in lb');
    await user.clear(input);
    await user.type(input, '200');
    await user.click(screen.getByRole('button', { name: 'Increase target weight by 2.5' }));

    expect(input).toHaveValue('202.5');
  });

  it('selecting 5lb smallest plates removes 2.5lb plates from the solver', async () => {
    const user = userEvent.setup();
    render(<PlateCalculator unit="lb" />);

    const input = screen.getByPlaceholderText('Enter weight in lb');
    await user.clear(input);
    await user.type(input, '50');

    // 50lb = bar + a 2.5lb plate per side: exact with the default plate set.
    expect(screen.queryByTestId('plate-calc-closest')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '±10lb 5lb plates' }));

    expect(screen.getByTestId('plate-calc-closest')).toHaveTextContent('closest is 45lb');
  });

  it('persists the choice per unit across mounts', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PlateCalculator unit="lb" />);

    await user.click(screen.getByRole('button', { name: '±2.5lb 1.25lb plates' }));
    unmount();

    render(<PlateCalculator unit="lb" />);
    expect(screen.getByRole('button', { name: '±2.5lb 1.25lb plates' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Increase target weight by 2.5' })).toBeInTheDocument();
  });

  it('offers kg options and defaults to ±2.5kg', () => {
    render(<PlateCalculator unit="kg" />);

    expect(screen.getByRole('button', { name: '±2.5kg 1.25kg plates' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: '±1kg 0.5kg plates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '±5kg 2.5kg plates' })).toBeInTheDocument();
  });
});
