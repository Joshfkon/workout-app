/**
 * RollingVolumeForecast — the rolling 7-day decay chart behind an expanded
 * volume row: one bar per day (today + 7), zone-colored with the shared
 * green/yellow/red rule, MEV floor line, and a caption naming the day the
 * count falls below the zone floor.
 */

import { render, screen } from '@testing-library/react';

import { RollingVolumeForecast } from '../RollingVolumeForecast';
import { FORECAST_HORIZON_DAYS } from '@/services/volumeProjection';

const BAND = { mev: 10, mav: 16, mrv: 20 };

describe('RollingVolumeForecast', () => {
  it('renders one zone-colored bar per day (today + horizon)', () => {
    // 12 credited sets: 4 today, 4 two days ago, 4 three days ago.
    render(
      <RollingVolumeForecast
        daily={[4, 0, 4, 4, 0, 0, 0]}
        band={BAND}
        muscle="biceps"
        displayName="Biceps"
        testIdPrefix="volume-forecast"
      />
    );

    expect(screen.getByTestId('volume-forecast-biceps')).toBeInTheDocument();
    for (let d = 0; d <= FORECAST_HORIZON_DAYS; d++) {
      expect(screen.getByTestId(`volume-forecast-bar-biceps-${d}`)).toBeInTheDocument();
    }

    // Today: 12 sets, inside the 10–20 band -> green (shared zone rule).
    expect(
      screen.getByTestId('volume-forecast-bar-biceps-0').firstChild
    ).toHaveClass('bg-success-500');
    // Day +5: only today's 4 sets remain -> below MEV, yellow.
    expect(
      screen.getByTestId('volume-forecast-bar-biceps-5').firstChild
    ).toHaveClass('bg-warning-500');
    // Day +7: everything aged out -> empty track, not a zone color.
    expect(
      screen.getByTestId(`volume-forecast-bar-biceps-${FORECAST_HORIZON_DAYS}`).firstChild
    ).toHaveClass('bg-surface-800');
  });

  it('captions the day the count falls below the zone floor', () => {
    render(
      <RollingVolumeForecast
        daily={[4, 0, 4, 4, 0, 0, 0]}
        band={BAND}
        muscle="biceps"
        displayName="Biceps"
        testIdPrefix="volume-forecast"
      />
    );
    // Rolling total holds 12 until day +4 (the 3-days-ago session ages out),
    // dropping to 8 < MEV 10.
    const caption = screen.getByTestId('volume-forecast-caption-biceps');
    expect(caption).toHaveTextContent('Falls below the 10-set zone floor');
    expect(caption).toHaveTextContent('Biceps sets leave the 7-day window');
  });

  it('says so when the count is already below the floor', () => {
    render(
      <RollingVolumeForecast
        daily={[0, 4, 0, 0, 0, 0, 0]}
        band={BAND}
        muscle="biceps"
        displayName="Biceps"
        testIdPrefix="volume-forecast"
      />
    );
    expect(screen.getByTestId('volume-forecast-caption-biceps')).toHaveTextContent(
      'Already below the 10-set zone floor'
    );
    // First bar is yellow (4 sets, below MEV) — matching the row bar's color.
    expect(
      screen.getByTestId('volume-forecast-bar-biceps-0').firstChild
    ).toHaveClass('bg-warning-500');
  });

  it('colors an over-MRV total red, same as the row bar', () => {
    render(
      <RollingVolumeForecast
        daily={[22, 0, 0, 0, 0, 0, 0]}
        band={BAND}
        muscle="chest"
        displayName="Chest"
        testIdPrefix="volume-forecast"
      />
    );
    expect(
      screen.getByTestId('volume-forecast-bar-chest-0').firstChild
    ).toHaveClass('bg-danger-500');
  });

  it('renders nothing when the window holds no sets', () => {
    render(
      <RollingVolumeForecast
        daily={[0, 0, 0, 0, 0, 0, 0]}
        band={BAND}
        muscle="biceps"
        displayName="Biceps"
        testIdPrefix="volume-forecast"
      />
    );
    expect(screen.queryByTestId('volume-forecast-biceps')).not.toBeInTheDocument();
  });
});
