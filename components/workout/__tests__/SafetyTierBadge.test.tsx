import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SafetyTierBadge } from '../SafetyTierBadge';

describe('SafetyTierBadge', () => {
  it('shows the tooltip on mouse hover and hides it on unhover', async () => {
    const user = userEvent.setup();
    render(<SafetyTierBadge tier="push_freely" />);
    const badge = screen.getByText(/🟢 Safe/);

    expect(screen.queryByText(/learn your limits/i)).not.toBeInTheDocument();

    await user.hover(badge);
    expect(screen.getByText(/learn your limits/i)).toBeInTheDocument();

    await user.unhover(badge);
    expect(screen.queryByText(/learn your limits/i)).not.toBeInTheDocument();
  });

  it('opens the tooltip below the badge so the sticky workout header cannot obscure it', async () => {
    const user = userEvent.setup();
    render(<SafetyTierBadge tier="push_freely" />);

    await user.hover(screen.getByText(/🟢 Safe/));
    const tooltip = screen.getByText(/learn your limits/i).parentElement!;
    expect(tooltip.className).toContain('top-full');
    expect(tooltip.className).not.toContain('bottom-full');
  });

  it('toggles the tooltip on touch tap (touch devices have no hover)', async () => {
    const user = userEvent.setup();
    render(<SafetyTierBadge tier="protect" />);
    const badge = screen.getByText(/🔴 Protect/);

    await user.pointer({ keys: '[TouchA]', target: badge });
    expect(screen.getByText(/heavy barbell compounds/i)).toBeInTheDocument();

    await user.pointer({ keys: '[TouchA]', target: badge });
    expect(screen.queryByText(/heavy barbell compounds/i)).not.toBeInTheDocument();
  });

  it('does not render a tooltip when showTooltip is false', async () => {
    const user = userEvent.setup();
    render(<SafetyTierBadge tier="push_cautiously" showTooltip={false} />);

    await user.hover(screen.getByText(/🟡 Caution/));
    expect(screen.queryByText(/free weight compounds/i)).not.toBeInTheDocument();
  });
});
