import React from 'react';
import { render, screen } from '@testing-library/react';
import { SegmentedControl } from '../SegmentedControl';

describe('SegmentedControl', () => {
  it('large size: at least 48px tall, body-size labels (Settings units)', () => {
    render(
      <SegmentedControl
        label="Weight units"
        value="kg"
        onChange={() => {}}
        size="lg"
        options={[
          { value: 'kg', label: 'kg' },
          { value: 'lb', label: 'lb' },
        ]}
      />
    );
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.className).toMatch(/min-h-\[48px\]/);
      expect(radio.className).toMatch(/text-headline/);
    }
  });
});
