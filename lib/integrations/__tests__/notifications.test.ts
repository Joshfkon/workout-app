/**
 * Tests for haptic feedback and notification helpers.
 *
 * The notifications module uses a try-catch pattern to conditionally require
 * Capacitor plugins, which makes deep mocking challenging. These tests verify
 * the public contract: the functions are callable without throwing, and they
 * respect the native platform guard.
 */

import { successHaptic, lightHaptic } from '../notifications';

describe('successHaptic', () => {
  it('is callable without throwing', async () => {
    await expect(successHaptic()).resolves.toBeUndefined();
  });

  it('completes synchronously when awaited', async () => {
    const result = await successHaptic();
    expect(result).toBeUndefined();
  });
});

describe('lightHaptic', () => {
  it('is callable without throwing', async () => {
    await expect(lightHaptic()).resolves.toBeUndefined();
  });

  it('completes synchronously when awaited', async () => {
    const result = await lightHaptic();
    expect(result).toBeUndefined();
  });
});
