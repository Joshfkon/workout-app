'use client';

/**
 * Wearable Connections Screen
 *
 * Allows users to connect their wearable devices (Apple Watch, Fitbit, etc.)
 * for step tracking and enhanced TDEE calculations.
 */

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { WearableSource, WearableConnection } from '@/types/wearable';
import {
  getWearableConnections,
  upsertWearableConnection,
  disconnectWearable,
} from '@/lib/actions/wearable';
import { isHealthKitAvailable, requestHealthKitPermissions } from '@/lib/integrations/healthkit';
import { isGoogleFitAvailable, requestGoogleFitPermissions } from '@/lib/integrations/google-fit';
import { initiateFitbitOAuth, isFitbitConnected } from '@/lib/integrations/fitbit';

interface WearableOption {
  source: WearableSource;
  name: string;
  icon: string;
  description: string;
  platforms: ('ios' | 'android' | 'web')[];
}

const WEARABLE_OPTIONS: WearableOption[] = [
  {
    source: 'apple_healthkit',
    name: 'Apple Watch',
    icon: '⌚',
    description: 'Connect via Apple Health',
    platforms: ['ios'],
  },
  {
    source: 'google_fit',
    name: 'Google Fit',
    icon: '📊',
    description: 'Connect your Android device',
    platforms: ['android'],
  },
  {
    source: 'fitbit',
    name: 'Fitbit',
    icon: '💪',
    description: 'Connect your Fitbit account',
    platforms: ['ios', 'android', 'web'],
  },
  {
    source: 'garmin',
    name: 'Garmin',
    icon: '🏃',
    description: 'Connect via Garmin Connect',
    platforms: ['ios', 'android', 'web'],
  },
];

export function WearableConnectionsScreen() {
  const [connections, setConnections] = useState<WearableConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<WearableSource | null>(null);
  const [availability, setAvailability] = useState<Record<WearableSource, boolean>>({
    apple_healthkit: false,
    google_fit: false,
    fitbit: true, // Always available via OAuth
    samsung_health: false,
    garmin: true, // Always available via OAuth
    manual: true,
  });

  useEffect(() => {
    loadConnections();
    checkAvailability();
  }, []);

  async function loadConnections() {
    try {
      const data = await getWearableConnections();
      setConnections(data);
    } catch (error) {
      console.error('Failed to load connections:', error);
    } finally {
      setLoading(false);
    }
  }

  async function checkAvailability() {
    const [healthKit, googleFit] = await Promise.all([
      isHealthKitAvailable(),
      isGoogleFitAvailable(),
    ]);

    setAvailability((prev) => ({
      ...prev,
      apple_healthkit: healthKit,
      google_fit: googleFit,
    }));
  }

  function getConnection(source: WearableSource): WearableConnection | undefined {
    return connections.find((c) => c.source === source);
  }

  async function handleConnect(source: WearableSource) {
    setConnecting(source);

    try {
      switch (source) {
        case 'apple_healthkit': {
          const result = await requestHealthKitPermissions();
          if (result.granted) {
            await upsertWearableConnection({
              source,
              permissions: result.permissions || ['steps', 'active_energy'],
              deviceName: 'Apple Watch',
            });
          }
          break;
        }

        case 'google_fit': {
          const result = await requestGoogleFitPermissions();
          if (result.granted) {
            await upsertWearableConnection({
              source,
              permissions: result.permissions || ['steps', 'active_energy'],
              deviceName: 'Android Device',
            });
          }
          break;
        }

        case 'fitbit': {
          // OAuth flow - redirects to Fitbit
          initiateFitbitOAuth();
          return; // Don't reload - page will redirect
        }

        case 'garmin': {
          // TODO: Implement Garmin OAuth
          alert('Garmin integration coming soon!');
          break;
        }
      }

      await loadConnections();
    } catch (error) {
      console.error('Connection failed:', error);
    } finally {
      setConnecting(null);
    }
  }

  async function handleDisconnect(source: WearableSource) {
    if (!confirm('Are you sure you want to disconnect this device?')) return;

    try {
      await disconnectWearable(source);
      await loadConnections();
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  }

  function formatLastSync(date: Date | null): string {
    if (!date) return 'Never synced';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500" />
      </div>
    );
  }

  const connectedDevices = connections.filter((c) => c.isConnected);
  const availableOptions = WEARABLE_OPTIONS.filter(
    (opt) =>
      availability[opt.source] && !connectedDevices.some((c) => c.source === opt.source)
  );

  return (
    <div className="space-y-6">
      {/* Connected Devices */}
      {connectedDevices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Connected Devices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {connectedDevices.map((connection) => {
              const option = WEARABLE_OPTIONS.find((o) => o.source === connection.source);
              return (
                <div
                  key={connection.id}
                  className="flex items-center justify-between p-4 bg-surface-100 dark:bg-surface-800 rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="text-3xl">{option?.icon || '📱'}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {connection.deviceName || option?.name || connection.source}
                        </span>
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                      </div>
                      <div className="text-sm text-surface-500">
                        Last sync: {formatLastSync(connection.lastSyncAt)}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDisconnect(connection.source)}
                  >
                    Disconnect
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Available Connections */}
      {availableOptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Available Connections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {availableOptions.map((option) => (
              <div
                key={option.source}
                className="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-900 rounded-lg border border-surface-200 dark:border-surface-700"
              >
                <div className="flex items-center gap-4">
                  <div className="text-3xl opacity-60">{option.icon}</div>
                  <div>
                    <div className="font-medium">{option.name}</div>
                    <div className="text-sm text-surface-500">{option.description}</div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleConnect(option.source)}
                  disabled={connecting === option.source}
                >
                  {connecting === option.source ? 'Connecting...' : 'Connect'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* No Available Connections */}
      {availableOptions.length === 0 && connectedDevices.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-surface-500">
            <p>No wearable integrations available on this device.</p>
            <p className="text-sm mt-2">
              Try accessing from an iOS or Android device with a compatible wearable.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <span className="text-xl">ℹ️</span>
            <div className="text-sm text-surface-600 dark:text-surface-400">
              <p className="font-medium mb-1">Why connect your wearable?</p>
              <p>
                We use step data to improve your TDEE estimate and adjust daily calorie
                targets based on activity. Your metabolism isn't the same every day - on
                active days you burn more, and we can account for that.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
