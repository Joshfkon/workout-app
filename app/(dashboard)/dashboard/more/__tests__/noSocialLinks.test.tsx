import { render, screen } from '@testing-library/react';
import MorePage from '../page';
import { SOCIAL_ROUTE_PREFIXES } from '@/lib/socialFeatures';

jest.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }));

describe('More page with the social features hidden', () => {
  it('links to no social screen and shows no Community section', () => {
    const { container } = render(<MorePage />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      for (const prefix of SOCIAL_ROUTE_PREFIXES) {
        expect(href === prefix || href.startsWith(prefix + '/')).toBe(false);
      }
    }
    expect(screen.queryByText('Community')).toBeNull();
    expect(screen.queryByText('Social feed')).toBeNull();
    // Non-social links are untouched.
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});
