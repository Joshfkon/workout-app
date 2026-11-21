/**
 * JS side of the native WatchConnectivity bridge (`WatchBridgePlugin.swift`
 * in the iOS app target, registered as "WatchBridge").
 *
 * Web-bundle safety: reached through `registerPlugin` by name only, and the
 * proxy is NEVER awaited or returned from an async function — Capacitor's
 * proxy answers every property including `then`, so awaiting it hangs (see
 * lib/integrations/healthkit.ts). On the web, or in an app build that predates
 * the plugin, every call is a quiet no-op.
 */
import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@/lib/integrations/capacitor-stub';
import type { WatchWorkoutState } from './protocol';

export const WATCH_BRIDGE_PLUGIN_NAME = 'WatchBridge';
export const WATCH_MESSAGE_EVENT = 'watchMessage';

interface PluginListenerHandle {
  remove: () => Promise<void> | void;
}

interface WatchBridgePlugin {
  sendState(options: { state: WatchWorkoutState }): Promise<void>;
  addListener(
    eventName: typeof WATCH_MESSAGE_EVENT,
    listener: (event: { message: unknown }) => void
  ): Promise<PluginListenerHandle> | PluginListenerHandle;
}

let plugin: WatchBridgePlugin | null = null;

/** Synchronous on purpose — see the file header. */
function getPlugin(): WatchBridgePlugin | null {
  if (plugin) return plugin;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return null;
  try {
    plugin = registerPlugin<WatchBridgePlugin>(WATCH_BRIDGE_PLUGIN_NAME);
    return plugin;
  } catch {
    return null;
  }
}

export function isWatchBridgeAvailable(): boolean {
  return getPlugin() !== null;
}

/** Push the latest workout snapshot to the watch. Never throws. */
export function sendWatchState(state: WatchWorkoutState): Promise<void> {
  const p = getPlugin();
  if (!p) return Promise.resolve();
  try {
    return Promise.resolve(p.sendState({ state })).then(
      () => undefined,
      () => undefined // older app build without the plugin, or no paired watch
    );
  } catch {
    return Promise.resolve();
  }
}

/**
 * Subscribe to raw messages from the watch. Returns an unsubscribe function.
 * Messages are untrusted input: run them through `parseWatchCommand`.
 */
export function addWatchMessageListener(listener: (message: unknown) => void): () => void {
  const p = getPlugin();
  if (!p) return () => {};
  let handle: PluginListenerHandle | null = null;
  let removed = false;
  try {
    const result = p.addListener(WATCH_MESSAGE_EVENT, (event) => listener(event?.message));
    // Capacitor 8 returns a Promise<handle>; resolve without awaiting the proxy itself.
    Promise.resolve(result).then(
      (h) => {
        if (removed) void h?.remove();
        else handle = h;
      },
      () => {}
    );
  } catch {
    return () => {};
  }
  return () => {
    removed = true;
    void handle?.remove();
  };
}
