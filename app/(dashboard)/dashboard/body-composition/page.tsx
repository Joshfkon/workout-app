'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, FullPageLoading } from '@/components/ui';
import { DEXAScanInput, DEXAHistory, BodyCompProjection } from '@/components/body-composition';
import { getDEXAScans, getBodyCompProfile } from '@/lib/actions/body-composition';
import type { DEXAScan, UserBodyCompProfile } from '@/src/lib/body-composition';
import { cn } from '@/lib/utils';
import Link from 'next/link';

type TabType = 'projection' | 'history' | 'add';

export default function BodyCompositionPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [scans, setScans] = useState<DEXAScan[]>([]);
  const [profile, setProfile] = useState<UserBodyCompProfile | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('projection');

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        const [scansData, profileData] = await Promise.all([
          getDEXAScans(),
          getBodyCompProfile(),
        ]);
        setScans(scansData);
        setProfile(profileData);

        // If no scans, show add tab
        if (scansData.length === 0) {
          setActiveTab('add');
        }
      } catch (error) {
        console.error('Error fetching body composition data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);

  const handleScanAdded = async () => {
    // Refresh data after adding a scan
    const [scansData, profileData] = await Promise.all([
      getDEXAScans(),
      getBodyCompProfile(),
    ]);
    setScans(scansData);
    setProfile(profileData);
    setActiveTab('projection');
  };

  if (isLoading) {
    return <FullPageLoading text="Loading body composition data..." type="heartbeat" />;
  }

  const latestScan = scans[0];

  const tabs = [
    { id: 'projection' as TabType, label: 'Projection', icon: '📊', disabled: scans.length === 0 },
    { id: 'history' as TabType, label: 'DEXA History', icon: '📋' },
    { id: 'add' as TabType, label: 'Log Scan', icon: '➕' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Body Composition Prediction</h1>
          <p className="text-surface-400">
            Model fat vs lean mass changes with DEXA calibration
          </p>
        </div>
        <Link href="/dashboard/learn/body-composition">
          <Button variant="secondary" size="sm">
            Learn More →
          </Button>
        </Link>
      </div>

      {/* Quick Stats */}
      {latestScan && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Weight</p>
            <p className="text-2xl font-bold text-surface-100 mt-1">
              {latestScan.totalMassKg.toFixed(1)} kg
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Body Fat</p>
            <p className="text-2xl font-bold text-surface-100 mt-1">
              {latestScan.bodyFatPercent.toFixed(1)}%
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Lean Mass</p>
            <p className="text-2xl font-bold text-surface-100 mt-1">
              {latestScan.leanMassKg.toFixed(1)} kg
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">P-Ratio</p>
            <p className="text-2xl font-bold text-primary-400 mt-1">
              {profile?.learnedPRatio?.toFixed(2) || '—'}
            </p>
            <p className="text-xs text-surface-500">
              {profile?.pRatioConfidence === 'none' ? 'Not calibrated' : profile?.pRatioConfidence}
            </p>
          </Card>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-surface-800/50 p-1 rounded-xl">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => !tab.disabled && setActiveTab(tab.id)}
            disabled={tab.disabled}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
              activeTab === tab.id
                ? 'bg-surface-700 text-white shadow-sm'
                : tab.disabled
                ? 'text-surface-600 cursor-not-allowed'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
            )}
          >
            <span>{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'projection' && latestScan && (
        <BodyCompProjection currentScan={latestScan} />
      )}

      {activeTab === 'history' && (
        <DEXAHistory
          scans={scans}
          profile={profile}
          onAddScan={() => setActiveTab('add')}
        />
      )}

      {activeTab === 'add' && (
        <DEXAScanInput
          onSuccess={handleScanAdded}
          onCancel={scans.length > 0 ? () => setActiveTab('projection') : undefined}
        />
      )}

      {/* Empty State Prompt */}
      {scans.length === 0 && activeTab !== 'add' && (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">Get Started with Body Composition</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Add your first DEXA scan to start tracking body composition and enable predictive modeling.
          </p>
          <Button className="mt-6" onClick={() => setActiveTab('add')}>
            + Add Your First DEXA Scan
          </Button>
        </Card>
      )}
    </div>
  );
}
