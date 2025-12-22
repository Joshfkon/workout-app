'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import type { DEXAScan, UserBodyCompProfile } from '@/src/lib/body-composition';
import { getBodyCompChangeSummary, explainPRatioResult, formatPRatioAsPercentage } from '@/src/lib/body-composition';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { kgToLbs, formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface DEXAHistoryProps {
  scans: DEXAScan[];
  profile: UserBodyCompProfile | null;
  onAddScan?: () => void;
  onDeleteScan?: (scanId: string) => void;
}

export function DEXAHistory({
  scans,
  profile,
  onAddScan,
  onDeleteScan,
}: DEXAHistoryProps) {
  const { preferences } = useUserPreferences();
  const units = preferences?.units || 'lb';
  const [selectedPair, setSelectedPair] = useState<[number, number] | null>(
    scans.length >= 2 ? [1, 0] : null
  );

  const weightUnit = units === 'lb' ? 'lbs' : 'kg';

  const displayWeight = (kg: number) => {
    const value = units === 'lb' ? kgToLbs(kg) : kg;
    return value.toFixed(1);
  };

  // Get comparison data if two scans are selected
  const comparisonData = selectedPair && scans[selectedPair[0]] && scans[selectedPair[1]]
    ? getBodyCompChangeSummary(scans[selectedPair[0]], scans[selectedPair[1]])
    : null;

  if (scans.length === 0) {
    return (
      <Card className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-surface-200">No DEXA scans yet</h2>
        <p className="text-surface-500 mt-2 max-w-md mx-auto">
          Add your first DEXA scan to start tracking your body composition and enable predictions.
        </p>
        {onAddScan && (
          <Button className="mt-6" onClick={onAddScan}>
            + Add DEXA Scan
          </Button>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-surface-100">Your Scans</h2>
        {onAddScan && (
          <Button size="sm" onClick={onAddScan}>
            + Log New Scan
          </Button>
        )}
      </div>

      {/* Scan Cards */}
      <div className="space-y-3">
        {scans.map((scan, index) => (
          <Card
            key={scan.id}
            className={cn(
              'cursor-pointer transition-all',
              selectedPair?.includes(index)
                ? 'ring-2 ring-primary-500'
                : 'hover:border-surface-600'
            )}
            onClick={() => {
              if (!selectedPair) {
                setSelectedPair([index, index]);
              } else if (selectedPair[0] === index) {
                // Clicking the same first one, deselect
                setSelectedPair(null);
              } else {
                // Set as comparison pair
                const newPair: [number, number] = index < selectedPair[0]
                  ? [selectedPair[0], index]
                  : [index, selectedPair[0]];
                setSelectedPair(newPair);
              }
            }}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-medium text-surface-100">
                    {formatDate(scan.scanDate)}
                  </p>
                  {scan.provider && (
                    <p className="text-xs text-surface-500">{scan.provider}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'px-2 py-0.5 text-xs rounded-full',
                      scan.confidence === 'high'
                        ? 'bg-success-500/20 text-success-400'
                        : scan.confidence === 'medium'
                        ? 'bg-warning-500/20 text-warning-400'
                        : 'bg-surface-700 text-surface-400'
                    )}
                  >
                    {scan.confidence} confidence
                  </span>
                  {scan.isBaseline && (
                    <span className="px-2 py-0.5 text-xs bg-primary-500/20 text-primary-400 rounded-full">
                      Baseline
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-lg font-bold text-surface-100">
                    {displayWeight(scan.totalMassKg)}
                  </p>
                  <p className="text-xs text-surface-500">{weightUnit}</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-surface-100">
                    {scan.bodyFatPercent.toFixed(1)}%
                  </p>
                  <p className="text-xs text-surface-500">BF</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-surface-100">
                    {displayWeight(scan.leanMassKg)}
                  </p>
                  <p className="text-xs text-surface-500">Lean</p>
                </div>
              </div>

              {scan.notes && (
                <p className="mt-3 text-sm text-surface-400 italic">{scan.notes}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Comparison View */}
      {comparisonData && scans.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Changes: {formatDate(comparisonData.startDate)} → {formatDate(comparisonData.endDate)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-3 bg-surface-800/50 rounded-lg">
                <p className={cn(
                  'text-xl font-bold',
                  comparisonData.weightChange < 0 ? 'text-success-400' : 'text-warning-400'
                )}>
                  {comparisonData.weightChange < 0 ? '' : '+'}
                  {displayWeight(comparisonData.weightChange)}
                </p>
                <p className="text-xs text-surface-500">{weightUnit} total</p>
              </div>

              <div className="text-center p-3 bg-surface-800/50 rounded-lg">
                <p className={cn(
                  'text-xl font-bold',
                  comparisonData.fatChange < 0 ? 'text-success-400' : 'text-warning-400'
                )}>
                  {comparisonData.fatChange < 0 ? '' : '+'}
                  {displayWeight(comparisonData.fatChange)}
                </p>
                <p className="text-xs text-surface-500">{weightUnit} fat</p>
              </div>

              <div className="text-center p-3 bg-surface-800/50 rounded-lg">
                <p className={cn(
                  'text-xl font-bold',
                  comparisonData.leanChange > 0 ? 'text-success-400' : 'text-warning-400'
                )}>
                  {comparisonData.leanChange > 0 ? '+' : ''}
                  {displayWeight(comparisonData.leanChange)}
                </p>
                <p className="text-xs text-surface-500">{weightUnit} lean</p>
              </div>

              <div className="text-center p-3 bg-surface-800/50 rounded-lg">
                <p className={cn(
                  'text-xl font-bold',
                  comparisonData.bodyFatChange < 0 ? 'text-success-400' : 'text-warning-400'
                )}>
                  {comparisonData.bodyFatChange < 0 ? '' : '+'}
                  {comparisonData.bodyFatChange.toFixed(1)}%
                </p>
                <p className="text-xs text-surface-500">BF change</p>
              </div>
            </div>

            {/* P-Ratio Analysis */}
            {Math.abs(comparisonData.weightChange) >= 1 && (
              <div className="p-4 bg-surface-800/30 rounded-lg border border-surface-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-surface-400">Your P-ratio:</span>
                  <span className={cn(
                    'text-lg font-bold',
                    comparisonData.pRatioQuality === 'excellent' ? 'text-success-400' :
                    comparisonData.pRatioQuality === 'good' ? 'text-primary-400' :
                    comparisonData.pRatioQuality === 'fair' ? 'text-warning-400' :
                    'text-danger-400'
                  )}>
                    {comparisonData.calculatedPRatio.toFixed(2)}
                  </span>
                </div>
                <p className="text-sm text-surface-300 mb-1">
                  {formatPRatioAsPercentage(comparisonData.calculatedPRatio)}
                </p>
                <p className="text-xs text-surface-500">
                  {explainPRatioResult(comparisonData.calculatedPRatio)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Calibration Status */}
      {profile && (
        <Card>
          <CardHeader>
            <CardTitle>Prediction Calibration</CardTitle>
          </CardHeader>
          <CardContent>
            {profile.pRatioDataPoints === 0 ? (
              <div className="text-center py-4">
                <p className="text-surface-400 mb-2">
                  No calibration data yet
                </p>
                <p className="text-xs text-surface-500">
                  Add at least 2 DEXA scans with weight change to calibrate predictions to your body.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-surface-400">Personal P-ratio:</span>
                  <span className="text-lg font-bold text-primary-400">
                    {profile.learnedPRatio?.toFixed(2) || 'N/A'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-surface-400">Confidence:</span>
                  <span className={cn(
                    'px-2 py-1 text-xs rounded-full',
                    profile.pRatioConfidence === 'high' ? 'bg-success-500/20 text-success-400' :
                    profile.pRatioConfidence === 'medium' ? 'bg-warning-500/20 text-warning-400' :
                    'bg-surface-700 text-surface-400'
                  )}>
                    {profile.pRatioConfidence}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-surface-400">Data points:</span>
                  <span className="text-surface-200">{profile.pRatioDataPoints} scan pairs</span>
                </div>

                <p className="text-xs text-surface-500 mt-2">
                  Your personal data is now improving future predictions.
                  {profile.pRatioConfidence === 'low' && ' Add more scans to increase confidence.'}
                  {profile.pRatioConfidence === 'medium' && ' 2 more scans will give high confidence.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {scans.length >= 2 && (
        <p className="text-xs text-surface-500 text-center">
          Click two scans to compare them
        </p>
      )}
    </div>
  );
}
