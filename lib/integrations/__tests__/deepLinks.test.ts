import { resolveDeepLinkPath } from '../capacitor-stub';

describe('resolveDeepLinkPath', () => {
  it.each([
    ['hypertrack://dashboard', '/dashboard'],
    ['hypertrack://dashboard/history?tab=prs', '/dashboard/history?tab=prs'],
    ['hypertrack://auth/callback?code=abc', '/auth/callback?code=abc'],
    ['hypertrack:///dashboard/nutrition', '/dashboard/nutrition'],
    ['HyperTrack://dashboard', '/dashboard'],
    ['https://www.hypertrack.app/auth/callback?code=abc', '/auth/callback?code=abc'],
    ['https://hypertrack.app/dashboard/workout/123#set-2', '/dashboard/workout/123#set-2'],
  ])('%s -> %s', (url, expected) => {
    expect(resolveDeepLinkPath(url)).toBe(expected);
  });

  it.each([
    'https://evil.example/dashboard',
    'http://www.hypertrack.app/dashboard',
    'javascript:alert(1)',
    'not a url',
    'hypertrack://',
    '',
  ])('ignores %s', (url) => {
    expect(resolveDeepLinkPath(url)).toBeNull();
  });

  it('can never produce a protocol-relative (cross-origin) target', () => {
    for (const url of [
      'hypertrack:////evil.example/x',
      'hypertrack://dashboard//evil.example',
      'hypertrack:///\\evil.example',
      'https://www.hypertrack.app//evil.example/x',
    ]) {
      const path = resolveDeepLinkPath(url);
      expect(path).not.toBeNull();
      expect(path!.startsWith('/')).toBe(true);
      expect(path!.startsWith('//')).toBe(false);
      expect(new URL(path!, 'https://www.hypertrack.app').origin).toBe(
        'https://www.hypertrack.app'
      );
    }
  });
});
