/**
 * The iOS number pad has no key that closes it, so the keyboard toolbar (with
 * its Done button) must be visible in the native app. Capacitor's Keyboard
 * plugin hides that toolbar by default; showKeyboardAccessoryBar turns it on.
 */

const mockSetAccessoryBarVisible = jest.fn();

jest.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    setAccessoryBarVisible: (...args: unknown[]) => mockSetAccessoryBarVisible(...args),
  },
}));

jest.mock('../capacitor-stub', () => ({
  isNativePlatform: jest.fn(),
  getPlatform: jest.fn(),
}));

import { isNativePlatform, getPlatform } from '../capacitor-stub';
import { showKeyboardAccessoryBar } from '../keyboard';

function onPlatform(native: boolean, platform: string) {
  (isNativePlatform as jest.Mock).mockReturnValue(native);
  (getPlatform as jest.Mock).mockReturnValue(platform);
}

describe('showKeyboardAccessoryBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetAccessoryBarVisible.mockResolvedValue(undefined);
  });

  it('shows the keyboard toolbar in the iOS app', async () => {
    onPlatform(true, 'ios');
    await showKeyboardAccessoryBar();
    expect(mockSetAccessoryBarVisible).toHaveBeenCalledWith({ isVisible: true });
  });

  it.each([
    ['web', false, 'web'],
    ['Android', true, 'android'],
  ])('does nothing on %s', async (_label, native, platform) => {
    onPlatform(native, platform);
    await showKeyboardAccessoryBar();
    expect(mockSetAccessoryBarVisible).not.toHaveBeenCalled();
  });

  it('never throws if the plugin call fails', async () => {
    onPlatform(true, 'ios');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSetAccessoryBarVisible.mockRejectedValue(new Error('not implemented'));
    await expect(showKeyboardAccessoryBar()).resolves.toBeUndefined();
  });
});
