import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MuscleMap } from '../MuscleMap';
import { MUSCLE_IDS, MUSCLE_TO_REGIONS, type MuscleId } from '@/lib/muscleMap/taxonomy';
import { ALL_REGION_IDS } from '@/lib/muscleMap/paths';
import type { MuscleMapData } from '@/lib/muscleMap/adapters';

/** All rendered paths for a logical muscle. */
function musclePaths(container: HTMLElement, muscle: MuscleId): SVGPathElement[] {
  return Array.from(container.querySelectorAll(`path[data-muscle="${muscle}"]`));
}

describe('MuscleMap', () => {
  it('renders front + back for view="both", one figure otherwise', () => {
    const { container, rerender } = render(<MuscleMap data={{}} mode="volume" view="both" />);
    expect(container.querySelector('[data-testid="muscle-map-front"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="muscle-map-back"]')).toBeInTheDocument();

    rerender(<MuscleMap data={{}} mode="volume" view="front" />);
    expect(container.querySelector('[data-testid="muscle-map-front"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="muscle-map-back"]')).not.toBeInTheDocument();
  });

  it('left/right paths of one muscle always render the identical color', () => {
    // Give EVERY muscle some data across all three color buckets.
    const data: MuscleMapData = {};
    MUSCLE_IDS.forEach((m, i) => {
      data[m] = {
        value: i % 3 === 0 ? 0 : 10,
        zone: i % 3 === 0 ? 'below_mev' : i % 3 === 1 ? 'in_zone' : 'over_mrv',
      };
    });
    const { container } = render(<MuscleMap data={data} mode="volume" view="both" />);
    for (const muscle of MUSCLE_IDS) {
      const paths = musclePaths(container, muscle);
      expect(paths.length).toBe(MUSCLE_TO_REGIONS[muscle].length);
      const looks = new Set(
        paths.map((p) => `${p.getAttribute('class')}|${p.getAttribute('fill-opacity')}`)
      );
      if (looks.size !== 1) {
        throw new Error(
          `muscle '${muscle}' rendered ${looks.size} different looks: ${Array.from(looks).join(' vs ')}`
        );
      }
    }
  });

  it('volume mode: zone colors come from the shared helper (gray 0-set, amber low, green in-zone, red over)', () => {
    const data: MuscleMapData = {
      quads: { value: 10, zone: 'in_zone' },
      biceps: { value: 2, zone: 'below_mev' },
      chest_upper: { value: 0, zone: 'below_mev' },
      lats: { value: 30, zone: 'over_mrv' },
    };
    const { container } = render(<MuscleMap data={data} mode="volume" view="both" />);
    expect(musclePaths(container, 'quads')[0]!.getAttribute('class')).toContain('fill-success-500');
    expect(musclePaths(container, 'biceps')[0]!.getAttribute('class')).toContain('fill-warning-500');
    expect(musclePaths(container, 'chest_upper')[0]!.getAttribute('class')).toContain('fill-surface-600');
    expect(musclePaths(container, 'lats')[0]!.getAttribute('class')).toContain('fill-danger-500');
    // No data → neutral base tone.
    expect(musclePaths(container, 'calves')[0]!.getAttribute('class')).toContain('fill-surface-800');
  });

  it('recovery mode: fresh green / recovering amber / fatigued gray, matching the badges', () => {
    const data: MuscleMapData = {
      chest_upper: { value: 4, status: 'fresh' },
      quads: { value: 5, status: 'recovering' },
      biceps: { value: 3, status: 'fatigued' },
    };
    const { container } = render(<MuscleMap data={data} mode="recovery" view="both" />);
    expect(musclePaths(container, 'chest_upper')[0]!.getAttribute('class')).toContain('fill-success-500');
    expect(musclePaths(container, 'quads')[0]!.getAttribute('class')).toContain('fill-warning-500');
    expect(musclePaths(container, 'biceps')[0]!.getAttribute('class')).toContain('fill-surface-600');
    expect(musclePaths(container, 'lats')[0]!.getAttribute('class')).toContain('fill-surface-800');
  });

  it('highlight mode: primary at full opacity, secondaries dimmed, rest neutral', () => {
    const data: MuscleMapData = {
      glutes: { value: 1 },
      hamstrings: { value: 0.4 },
      erectors: { value: 0.4 },
    };
    const { container } = render(<MuscleMap data={data} mode="highlight" view="back" />);
    const glutes = musclePaths(container, 'glutes')[0]!;
    const hams = musclePaths(container, 'hamstrings')[0]!;
    const erectors = musclePaths(container, 'erectors')[0]!;
    expect(glutes.getAttribute('class')).toContain('fill-primary-500');
    expect(glutes.getAttribute('fill-opacity')).toBe('1');
    expect(hams.getAttribute('class')).toContain('fill-primary-500');
    expect(hams.getAttribute('fill-opacity')).toBe('0.4');
    expect(erectors.getAttribute('fill-opacity')).toBe('0.4');
    expect(musclePaths(container, 'lats')[0]!.getAttribute('class')).toContain('fill-surface-800');
  });

  it('tapping a quads region fires onMuscleTap with "quads" (mouse and keyboard)', async () => {
    const user = userEvent.setup();
    const onTap = jest.fn();
    const { container } = render(
      <MuscleMap data={{ quads: { value: 10, zone: 'in_zone' } }} mode="volume" view="front" onMuscleTap={onTap} />
    );
    const quads = musclePaths(container, 'quads')[0]!;
    await user.click(quads);
    expect(onTap).toHaveBeenCalledWith('quads');

    onTap.mockClear();
    quads.focus();
    await user.keyboard('{Enter}');
    expect(onTap).toHaveBeenCalledWith('quads');
  });

  it('tappable regions get transparent stroke padding and button semantics', () => {
    const { container } = render(
      <MuscleMap data={{}} mode="volume" view="both" onMuscleTap={() => {}} />
    );
    const erectors = musclePaths(container, 'erectors')[0]!;
    expect(erectors.getAttribute('stroke')).toBe('transparent');
    expect(Number(erectors.getAttribute('stroke-width'))).toBeGreaterThan(0);
    expect(erectors.getAttribute('role')).toBe('button');
    expect(erectors.getAttribute('tabindex')).toBe('0');
  });

  it('mapped paths carry muscle-name + status aria-labels; decorative paths are aria-hidden', () => {
    const { container } = render(
      <MuscleMap data={{ quads: { value: 10, zone: 'in_zone' } }} mode="volume" view="both" />
    );
    const quads = musclePaths(container, 'quads')[0]!;
    expect(quads.getAttribute('aria-label')).toBe('Quads: in the optimal volume zone');
    expect(quads.getAttribute('role')).toBe('img');

    const head = container.querySelector('path[data-region="head"]')!;
    expect(head.getAttribute('aria-hidden')).toBe('true');
    expect(head.getAttribute('class')).toContain('fill-surface-800');

    // Every vendored region renders exactly once across both views.
    expect(container.querySelectorAll('path[data-region]').length).toBe(ALL_REGION_IDS.size);
  });
});
