'use client';

/**
 * "Add more data" — the Body tab's setup prompts (goal phase, body scan,
 * goals) collapsed into one compact list BELOW the weight trend, so nothing
 * that asks for setup sits above what the user came for. Rows only appear
 * for what's actually missing; with nothing missing it renders nothing.
 */

import { ListGroup, ListRow } from '@/components/ui';

export interface BodyAddMoreDataProps {
  /** No active goal phase (cut / maintain / bulk) → offer to set one. */
  needsPhase: boolean;
  /** Route of the phase editor. */
  phaseHref: string;
  /** Body scans (DEXA) logged so far; < 2 → offer to log one. */
  scanCount: number;
  onLogScan: () => void;
  /** No body goal set → offer to set one. */
  needsGoals: boolean;
  onSetGoals: () => void;
}

export function BodyAddMoreData({
  needsPhase,
  phaseHref,
  scanCount,
  onLogScan,
  needsGoals,
  onSetGoals,
}: BodyAddMoreDataProps) {
  const needsScan = scanCount < 2;
  if (!needsPhase && !needsScan && !needsGoals) return null;

  return (
    <div data-testid="body-add-more-data">
      <ListGroup title="Add more data">
        {needsPhase && (
          <ListRow
            title="Set a goal phase"
            subtitle="Cut, maintain or bulk: lets us check your weight trend against it"
            href={phaseHref}
          />
        )}
        {needsScan && (
          <ListRow
            title="Log a body scan (DEXA)"
            subtitle={
              scanCount === 0
                ? 'A body scan measures fat vs. muscle, which weight alone can’t'
                : 'One more scan shows how your fat and muscle changed between scans'
            }
            onClick={onLogScan}
          />
        )}
        {needsGoals && (
          <ListRow
            title="Set body goals"
            subtitle="Target weight, body fat or measurements"
            onClick={onSetGoals}
          />
        )}
      </ListGroup>
    </div>
  );
}
