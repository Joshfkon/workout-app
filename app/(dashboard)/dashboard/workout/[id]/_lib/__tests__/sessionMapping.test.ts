import { mapLoadedBlockRow } from '../sessionMapping';

// Minimal raw row; only fields the mapper reads need realistic values.
const exerciseRow = {
  id: 'ex-1',
  name: 'Barbell Curl',
  primary_muscle: 'biceps',
  secondary_muscles: [],
  mechanic: 'isolation',
  default_rep_range: [8, 12],
  default_rir: 2,
  min_weight_increment_kg: 2.5,
  form_cues: [],
  common_mistakes: [],
  setup_note: '',
  movement_pattern: '',
  equipment_required: ['barbell'],
  equipment: 'barbell',
  hypertrophy_tier: null,
  stretch_under_load: null,
  resistance_profile: null,
  progression_ease: null,
  is_bodyweight: false,
  bodyweight_type: null,
  assistance_type: null,
  demo_gif_url: null,
  demo_thumbnail_url: null,
  youtube_video_id: null,
  exercise_type: null,
} as any;

const blockRow = {
  id: 'blk-1',
  workout_session_id: 'sess-1',
  exercise_id: 'ex-1',
  order: 0,
  superset_group_id: null,
  superset_order: null,
  target_sets: 3,
  target_rep_range: [8, 12] as [number, number],
  target_rir: 2,
  target_weight_kg: 40,
  target_rest_seconds: 120,
  progression_type: null,
  suggestion_reason: '',
  warmup_protocol: null,
  note: null,
  dropsets_per_set: null,
  drop_percentage: null,
  exercises: exerciseRow,
};

describe('mapLoadedBlockRow', () => {
  it('maps created_at -> createdAt (P1-3 stale-target detection input)', () => {
    const mapped = mapLoadedBlockRow({ ...blockRow, created_at: '2026-07-01T10:00:00Z' });
    expect(mapped.createdAt).toBe('2026-07-01T10:00:00Z');
  });

  it('leaves createdAt undefined when the row lacks created_at (fail-safe: never flags stale)', () => {
    const mapped = mapLoadedBlockRow({ ...blockRow });
    expect(mapped.createdAt).toBeUndefined();
  });

  it('still maps the target fields the workout page depends on', () => {
    const mapped = mapLoadedBlockRow({ ...blockRow, created_at: null });
    expect(mapped.id).toBe('blk-1');
    expect(mapped.targetWeightKg).toBe(40);
    expect(mapped.exercise.name).toBe('Barbell Curl');
    expect(mapped.createdAt).toBeUndefined();
  });
});
