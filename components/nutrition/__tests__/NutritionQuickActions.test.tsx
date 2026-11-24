/**
 * r22 panel (3 of 6): "The Scan button gave no hint that a typed-number
 * fallback exists when there is no camera." The r22 line lived only inside
 * the Add food sheet; personas tapped Eat's own Scan tile, which opens the
 * sheet straight on the typed-number screen, so they never saw it before the
 * tap. The tile now says so itself.
 */

import { render, screen } from '@testing-library/react';
import { NutritionQuickActions } from '../NutritionQuickActions';

const noop = () => {};

describe('NutritionQuickActions — Scan with no camera', () => {
  it('says before the tap that Scan will ask for the typed number', () => {
    render(<NutritionQuickActions onDescribe={noop} onScan={noop} onSearch={noop} onMeals={noop} noCamera />);
    const scan = screen.getByTestId('quick-action-scan');
    expect(scan).toHaveTextContent('Scan');
    expect(scan).toHaveTextContent('type code');
    expect(screen.getByTestId('quick-action-no-camera')).toHaveTextContent(/No camera on this device, so Scan lets you type the number/);
    expect(scan).toHaveAccessibleDescription(/type the number printed under the barcode/);
  });

  it('adds nothing when a camera is there (or before the check runs)', () => {
    render(<NutritionQuickActions onDescribe={noop} onScan={noop} onSearch={noop} onMeals={noop} />);
    expect(screen.getByTestId('quick-action-scan')).not.toHaveTextContent('type code');
    expect(screen.queryByTestId('quick-action-no-camera')).not.toBeInTheDocument();
  });
});
