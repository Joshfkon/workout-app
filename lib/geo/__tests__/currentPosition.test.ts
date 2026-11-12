/**
 * getCurrentPositionSafe picks its transport by platform: the native
 * Geolocation plugin inside the Capacitor shell (one OS prompt, remembered),
 * navigator.geolocation everywhere else — including a native shell whose
 * binary predates the plugin.
 */

const mockIsNativePlatform = jest.fn();
const mockIsPluginAvailable = jest.fn();
const mockCheckPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetCurrentPosition = jest.fn();

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform(),
    isPluginAvailable: (name: string) => mockIsPluginAvailable(name),
  },
}));

jest.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: () => mockCheckPermissions(),
    requestPermissions: () => mockRequestPermissions(),
    getCurrentPosition: (options: unknown) => mockGetCurrentPosition(options),
  },
}));

import { getCurrentPositionSafe } from '../currentPosition';

const webGetCurrentPosition = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(true);
  mockIsPluginAvailable.mockReturnValue(true);
  mockGetCurrentPosition.mockResolvedValue({
    coords: { latitude: 40.1, longitude: -75.2, accuracy: 30 },
    timestamp: 1,
  });
  webGetCurrentPosition.mockImplementation((success: PositionCallback) =>
    success({
      coords: { latitude: 1, longitude: 2, accuracy: 3 },
    } as GeolocationPosition)
  );
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: webGetCurrentPosition },
  });
});

describe('getCurrentPositionSafe — native shell', () => {
  it('uses the plugin without prompting when permission is already granted', async () => {
    mockCheckPermissions.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });

    const fix = await getCurrentPositionSafe();

    expect(fix).toMatchObject({ latitude: 40.1, longitude: -75.2, accuracyM: 30 });
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(webGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('asks once when the permission has never been decided', async () => {
    mockCheckPermissions.mockResolvedValue({ location: 'prompt', coarseLocation: 'prompt' });
    mockRequestPermissions.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });

    const fix = await getCurrentPositionSafe();

    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(fix).not.toBeNull();
  });

  it('never re-asks after a denial, and never falls back to the web prompt', async () => {
    mockCheckPermissions.mockResolvedValue({ location: 'denied', coarseLocation: 'denied' });

    const fix = await getCurrentPositionSafe();

    expect(fix).toBeNull();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    expect(webGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('resolves null when the user declines the prompt', async () => {
    mockCheckPermissions.mockResolvedValue({ location: 'prompt', coarseLocation: 'prompt' });
    mockRequestPermissions.mockResolvedValue({ location: 'denied', coarseLocation: 'denied' });

    expect(await getCurrentPositionSafe()).toBeNull();
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('resolves null (never rejects) when the plugin throws', async () => {
    mockCheckPermissions.mockRejectedValue(new Error('location services disabled'));

    expect(await getCurrentPositionSafe()).toBeNull();
  });

  it('keeps the web API on a binary that predates the plugin', async () => {
    mockIsPluginAvailable.mockReturnValue(false);

    const fix = await getCurrentPositionSafe();

    expect(mockIsPluginAvailable).toHaveBeenCalledWith('Geolocation');
    expect(fix).toMatchObject({ latitude: 1, longitude: 2, accuracyM: 3 });
    expect(mockCheckPermissions).not.toHaveBeenCalled();
  });
});

describe('getCurrentPositionSafe — web', () => {
  beforeEach(() => mockIsNativePlatform.mockReturnValue(false));

  it('uses navigator.geolocation', async () => {
    const fix = await getCurrentPositionSafe();

    expect(fix).toMatchObject({ latitude: 1, longitude: 2, accuracyM: 3 });
    expect(mockCheckPermissions).not.toHaveBeenCalled();
  });

  it('resolves null when the browser reports an error', async () => {
    webGetCurrentPosition.mockImplementation((_ok: unknown, fail: () => void) => fail());

    expect(await getCurrentPositionSafe()).toBeNull();
  });
});
