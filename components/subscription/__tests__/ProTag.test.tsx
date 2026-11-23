import { render, screen } from '@testing-library/react';
import { TIER_FEATURES } from '@/lib/stripe';
import { FEATURE_PLAN, ProTag } from '../ProTag';

describe('ProTag', () => {
  it('labels a gated feature with the plan that unlocks it', () => {
    render(<ProTag feature="mesocycleBuilder" />);
    expect(screen.getByTestId('pro-tag')).toHaveTextContent('Pro plan');
    expect(screen.getByTestId('pro-tag')).toHaveAttribute('data-plan', 'pro');
  });

  it('says Elite for an Elite feature', () => {
    render(<ProTag feature="ai-coaching" />);
    expect(screen.getByTestId('pro-tag')).toHaveTextContent('Elite plan');
  });

  it('takes a plan directly', () => {
    render(<ProTag tier="elite" />);
    expect(screen.getByTestId('pro-tag')).toHaveAttribute('data-plan', 'elite');
  });

  it('maps every feature to the lowest plan whose TIER_FEATURES limit unlocks it', () => {
    for (const [feature, plan] of Object.entries(FEATURE_PLAN)) {
      const unlocks = (tier: 'free' | 'pro' | 'elite') =>
        (TIER_FEATURES[tier].limits as Record<string, unknown>)[feature] === true;
      expect(unlocks('free')).toBe(false);
      const lowest = unlocks('pro') ? 'pro' : unlocks('elite') ? 'elite' : null;
      expect(lowest).toBe(plan);
    }
  });
});
