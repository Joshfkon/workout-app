import { hiddenSocialRedirect, SOCIAL_FEATURES_ENABLED } from '@/lib/socialFeatures';

describe('hiddenSocialRedirect', () => {
  it('ships with the social features hidden', () => {
    expect(SOCIAL_FEATURES_ENABLED).toBe(false);
  });

  it('sends social routes to /dashboard and the username step to the next onboarding step', () => {
    expect(hiddenSocialRedirect('/dashboard/feed')).toBe('/dashboard');
    expect(hiddenSocialRedirect('/dashboard/discover/123')).toBe('/dashboard');
    expect(hiddenSocialRedirect('/dashboard/leaderboards')).toBe('/dashboard');
    expect(hiddenSocialRedirect('/dashboard/profile/edit')).toBe('/dashboard');
    expect(hiddenSocialRedirect('/dashboard/search')).toBe('/dashboard');
    expect(hiddenSocialRedirect('/onboarding/profile')).toBe('/onboarding/enhanced');
  });

  it('ignores everything else', () => {
    for (const path of ['/dashboard', '/dashboard/feedback', '/dashboard/settings', '/onboarding', '/onboarding/enhanced']) {
      expect(hiddenSocialRedirect(path)).toBeNull();
    }
  });

  it('does nothing when the features are enabled', () => {
    expect(hiddenSocialRedirect('/dashboard/feed', true)).toBeNull();
    expect(hiddenSocialRedirect('/onboarding/profile', true)).toBeNull();
  });
});
