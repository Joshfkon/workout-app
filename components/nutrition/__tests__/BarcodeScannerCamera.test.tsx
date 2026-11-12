/**
 * The web scanner must not leave the camera running when the sheet is closed
 * while html5-qrcode's start() is still pending (e.g. during the permission
 * prompt): the unmount cleanup's stop() is rejected because nothing is
 * running yet, so the stream has to be stopped when start() finally resolves.
 */
import { render, act, waitFor } from '@testing-library/react';

const mockStart = jest.fn();
const mockStop = jest.fn();
let scannerRunning = false;

jest.mock('html5-qrcode', () => ({
  Html5Qrcode: jest.fn().mockImplementation(() => ({
    start: (...args: unknown[]) => mockStart(...args),
    stop: () => mockStop(),
    getRunningTrackCameraCapabilities: () => ({
      torchFeature: () => ({ isSupported: () => false }),
    }),
  })),
  Html5QrcodeSupportedFormats: {
    EAN_13: 0,
    EAN_8: 1,
    UPC_A: 2,
    UPC_E: 3,
    CODE_128: 4,
    CODE_39: 5,
  },
}));

const mockIsNativePlatform = jest.fn(() => false);
const mockIsPluginAvailable = jest.fn((_name: string) => false);
jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform(),
    isPluginAvailable: (name: string) => mockIsPluginAvailable(name),
  },
}));

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: jest.fn(),
}));

jest.mock('@/services/openFoodFactsService', () => ({
  lookupBarcode: jest.fn(),
}));

import { BarcodeScanner } from '../BarcodeScanner';

function deferredStart() {
  let resolveStart: () => void = () => {};
  mockStart.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveStart = () => {
          scannerRunning = true;
          resolve();
        };
      })
  );
  return () => resolveStart();
}

beforeEach(() => {
  jest.clearAllMocks();
  scannerRunning = false;
  mockIsNativePlatform.mockReturnValue(false);
  mockIsPluginAvailable.mockReturnValue(false);
  // html5-qrcode rejects stop() when the scanner isn't running yet.
  mockStop.mockImplementation(() => {
    if (!scannerRunning) return Promise.reject(new Error('Cannot stop, scanner is not running'));
    scannerRunning = false;
    return Promise.resolve();
  });
});

// The scanner starts the camera on mount; no tap is needed.
async function openCamera() {
  await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
}

describe('BarcodeScanner camera lifecycle', () => {
  it('opens the camera automatically when the scanner is shown', async () => {
    deferredStart();
    render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);

    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  });

  it('stops the stream when start() resolves after the scanner was closed', async () => {
    const finishStart = deferredStart();
    const { unmount } = render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);

    await openCamera();
    expect(mockStart).toHaveBeenCalledTimes(1);

    unmount();
    // Cleanup's stop() ran against a scanner that hadn't started.
    expect(mockStop).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishStart();
    });

    expect(mockStop).toHaveBeenCalledTimes(2);
    expect(scannerRunning).toBe(false);
  });

  it('keeps the stream running when start() resolves while still open', async () => {
    const finishStart = deferredStart();
    render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);

    await openCamera();
    await act(async () => {
      finishStart();
    });

    expect(mockStop).not.toHaveBeenCalled();
    expect(scannerRunning).toBe(true);
  });

  it('uses the web scanner in a native shell that has no ML Kit plugin', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    const finishStart = deferredStart();
    render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);

    await openCamera();
    await act(async () => {
      finishStart();
    });

    expect(mockIsPluginAvailable).toHaveBeenCalledWith('BarcodeScanner');
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});
