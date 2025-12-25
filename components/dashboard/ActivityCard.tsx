'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { WearableConnectionsScreen } from '@/components/wearables/WearableConnectionsScreen';
import { ActivitySettingsScreen } from '@/components/wearables/ActivitySettingsScreen';
import {
  getActiveWearableConnections,
  getDailyActivityData,
} from '@/lib/actions/wearable';
import type { WearableConnection, DailyActivityData } from '@/types/wearable';

interface ActivityCardProps {
  userId: string;
}

export const ActivityCard = memo(function ActivityCard({ userId }: ActivityCardProps) {
  const [connections, setConnections] = useState<WearableConnection[]>([]);
  const [todayActivity, setTodayActivity] = useState<DailyActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [manualSteps, setManualSteps] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [connectionsData, activityData] = await Promise.all([
        getActiveWearableConnections(),
        getDailyActivityData(new Date().toISOString().split('T')[0]),
      ]);
      setConnections(connectionsData);
      setTodayActivity(activityData);
    } catch (error) {
      console.error('Failed to load activity data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const hasWearable = connections.length > 0;
  const steps = todayActivity?.steps.total || 0;
  const activityLevel = todayActivity?.calculated.activityLevel || 'sedentary';

  const getActivityColor = useCallback((level: string) => {
    switch (level) {
      case 'very_active': return 'text-red-400';
      case 'active': return 'text-orange-400';
      case 'moderate': return 'text-green-400';
      case 'light': return 'text-blue-400';
      default: return 'text-surface-400';
    }
  }, []);

  const getActivityLabel = useCallback((level: string) => {
    const labels: Record<string, string> = {
      sedentary: 'Sedentary',
      light: 'Light',
      moderate: 'Moderate',
      active: 'Active',
      very_active: 'Very Active',
    };
    return labels[level] || 'Sedentary';
  }, []);

  const stepGoalProgress = useMemo(() => {
    const goal = 10000; // Default step goal
    return Math.min(100, (steps / goal) * 100);
  }, [steps]);

  const handleOpenConnectModal = useCallback(() => setShowConnectModal(true), []);
  const handleCloseConnectModal = useCallback(() => setShowConnectModal(false), []);
  const handleOpenSettingsModal = useCallback(() => setShowSettingsModal(true), []);
  const handleCloseSettingsModal = useCallback(() => setShowSettingsModal(false), []);
  const handleOpenManualInput = useCallback(() => setShowManualInput(true), []);
  const handleCloseManualInput = useCallback(() => setShowManualInput(false), []);
  const handleManualStepsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setManualSteps(e.target.value);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-surface-700 rounded w-1/3" />
            <div className="h-8 bg-surface-700 rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span>👟</span> Today&apos;s Activity
            </CardTitle>
            <div className="flex items-center gap-1">
              {hasWearable && (
                <button
                  onClick={handleOpenSettingsModal}
                  className="p-1.5 hover:bg-surface-700 rounded-lg transition-colors"
                  title="Activity settings"
                >
                  <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
              <Link href="/dashboard/learn/wearable-integration">
                <button
                  className="p-1.5 hover:bg-surface-700 rounded-lg transition-colors"
                  title="Learn more"
                >
                  <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {hasWearable && steps > 0 ? (
            <div className="space-y-3">
              {/* Steps Display */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-surface-100">
                      {steps.toLocaleString()}
                    </p>
                    <p className="text-xs text-surface-500">steps today</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-medium ${getActivityColor(activityLevel)}`}>
                    {getActivityLabel(activityLevel)}
                  </span>
                  <p className="text-xs text-surface-500">
                    {connections[0]?.deviceName || 'Connected'}
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex items-center justify-between text-xs text-surface-500 mb-1">
                  <span>Daily Goal</span>
                  <span>{steps.toLocaleString()} / 10,000</span>
                </div>
                <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 transition-all duration-500"
                    style={{ width: `${stepGoalProgress}%` }}
                  />
                </div>
              </div>

              {/* Calorie Burn Estimate */}
              {todayActivity?.calculated.totalActivityExpenditure && (
                <div className="flex items-center justify-between pt-2 border-t border-surface-800 text-sm">
                  <span className="text-surface-400">Est. activity burn</span>
                  <span className="text-surface-200 font-medium">
                    +{todayActivity.calculated.totalActivityExpenditure} cal
                  </span>
                </div>
              )}
            </div>
          ) : hasWearable ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-800 flex items-center justify-center">
                <svg className="w-6 h-6 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-surface-400 text-sm">Waiting for activity data...</p>
              <p className="text-surface-500 text-xs mt-1">
                Steps will sync from your {connections[0]?.deviceName || 'wearable'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Manual Step Input */}
              {showManualInput ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Enter steps"
                    value={manualSteps}
                    onChange={handleManualStepsChange}
                    className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    autoFocus
                  />
                  <Button size="sm" disabled={!manualSteps}>
                    Save
                  </Button>
                  <button
                    onClick={handleCloseManualInput}
                    className="p-2 text-surface-400 hover:text-surface-300"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-primary-500/10 to-accent-500/10 rounded-lg border border-primary-500/20">
                    <div className="w-12 h-12 rounded-xl bg-primary-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-2xl">⌚</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-200">Connect Your Wearable</p>
                      <p className="text-xs text-surface-400 mt-0.5">
                        Track steps for activity-adjusted calorie targets
                      </p>
                    </div>
                    <Button size="sm" onClick={handleOpenConnectModal}>
                      Connect
                    </Button>
                  </div>
                  <button
                    onClick={handleOpenManualInput}
                    className="w-full text-center text-xs text-surface-500 hover:text-surface-400 transition-colors py-2"
                  >
                    Or enter steps manually
                  </button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connect Wearable Modal */}
      <Modal
        isOpen={showConnectModal}
        onClose={handleCloseConnectModal}
        title="Connect Wearable"
        size="lg"
      >
        <WearableConnectionsScreen />
      </Modal>

      {/* Settings Modal */}
      <Modal
        isOpen={showSettingsModal}
        onClose={handleCloseSettingsModal}
        title="Activity Settings"
        size="lg"
      >
        <ActivitySettingsScreen />
      </Modal>
    </>
  );
});
