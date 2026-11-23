import { render, screen } from '@testing-library/react';
import { WeeklySetsCard, pickWeeklySetsRows, weeklySetsDigest } from '../WeeklySetsCard';
import type { VolumeRow } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

const row = (muscle: string, sets: number, mev: number, mrv: number, over: Partial<VolumeRow> = {}): VolumeRow =>
  ({
    key: muscle,
    muscle,
    displayName: muscle.charAt(0).toUpperCase() + muscle.slice(1),
    isChild: false,
    parent: null,
    sets,
    effectiveSets: sets,
    unratedSets: 0,
    directSets: sets,
    directEffectiveSets: sets,
    band: { mev, mrv },
    zone: sets < mev ? 'below_mev' : sets <= mrv ? 'in_zone' : 'over_mrv',
    belowMev: sets < mev,
    laggingChildren: false,
    reachable: true,
    warnable: true,
    expandable: false,
    exercises: [],
    ...over,
  }) as unknown as VolumeRow;

describe('WeeklySetsCard', () => {
  const rows = [
    row('chest', 14, 8, 22),
    row('back', 4, 10, 25),
    row('shoulders', 28, 12, 26),
    row('biceps', 9, 8, 26),
    row('calves', 0, 8, 20),
    row('erectors', 0, 4, 12, { warnable: false }),
    row('adductors', 0, 4, 12, { isChild: true }),
  ];

  it('puts over-MRV first, then furthest below MEV, then trained in-range muscles; skips untrained un-warnable and child rows', () => {
    const { shown, total } = pickWeeklySetsRows(rows);
    expect(shown.map((r) => r.muscle)).toEqual(['shoulders', 'calves', 'back', 'chest', 'biceps']);
    expect(total).toBe(5);
  });

  it('caps the list and offers the rest', () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`m${i}`, 10, 8, 20));
    render(<WeeklySetsCard rows={many} />);
    expect(screen.getAllByTestId('home-weekly-sets-row')).toHaveLength(6);
    expect(screen.getByTestId('home-weekly-sets-all')).toHaveTextContent('See all 9 muscles');
    expect(screen.getByTestId('home-weekly-sets-all')).toHaveAttribute('href', '/dashboard/volume');
  });

  it('shows each muscle against its range and a digest', () => {
    render(<WeeklySetsCard rows={rows} />);
    expect(screen.getByText('Sets this week')).toBeInTheDocument();
    expect(screen.getByTestId('home-weekly-sets-digest')).toHaveTextContent('2 below MEV · 1 over MRV');
    expect(screen.getAllByTestId('home-weekly-sets-row')[0]).toHaveTextContent('Shoulders28 of 12–26');
  });

  it('all-clear digest, and nothing at all with no data', () => {
    expect(weeklySetsDigest([row('chest', 12, 8, 22)])).toBe('Every trained muscle is in its range');
    const { container } = render(<WeeklySetsCard rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
