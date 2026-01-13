/**
 * Type tests for discriminated unions in social.ts
 * These tests verify that TypeScript correctly handles discriminated unions
 * and enforces the relationship between the `type` discriminant and data shape.
 */
import { expectType, expectAssignable, expectNotAssignable } from 'tsd';
import type {
  ActivityData,
  ActivityType,
  WorkoutCompletedData,
  PersonalRecordData,
  StreakMilestoneData,
  BadgeEarnedData,
  MesocycleCompletedData,
  FollowedUserData,
  SharedWorkoutData,
  ProfileVisibility,
  FollowStatus,
  ReactionType,
  LeaderboardType,
  NotificationType,
  ShareType,
  Difficulty,
  ActivityVisibility,
  TrainingExperience,
  Badge,
} from '../social';

// ============================================================================
// ActivityType Union Tests
// ============================================================================

expectAssignable<ActivityType>('workout_completed');
expectAssignable<ActivityType>('personal_record');
expectAssignable<ActivityType>('streak_milestone');
expectAssignable<ActivityType>('badge_earned');
expectAssignable<ActivityType>('mesocycle_completed');
expectAssignable<ActivityType>('followed_user');
expectAssignable<ActivityType>('shared_workout');

expectNotAssignable<ActivityType>('workout_started');
expectNotAssignable<ActivityType>('pr');

// ============================================================================
// WorkoutCompletedData Tests
// ============================================================================

// Valid WorkoutCompletedData
const validWorkoutData: WorkoutCompletedData = {
  type: 'workout_completed',
  workout_name: 'Push Day',
  duration_minutes: 60,
  total_sets: 20,
  total_volume_kg: 5000,
  exercises: [
    {
      name: 'Bench Press',
      sets: 4,
      top_set: { weight_kg: 100, reps: 8 },
    },
  ],
};
expectAssignable<ActivityData>(validWorkoutData);
expectAssignable<WorkoutCompletedData>(validWorkoutData);

// WorkoutCompletedData with optional session_rpe
const workoutWithRpe: WorkoutCompletedData = {
  type: 'workout_completed',
  workout_name: 'Pull Day',
  duration_minutes: 55,
  total_sets: 18,
  total_volume_kg: 4500,
  exercises: [],
  session_rpe: 8,
};
expectAssignable<ActivityData>(workoutWithRpe);

// ============================================================================
// PersonalRecordData Tests
// ============================================================================

// Valid PersonalRecordData
const validPrData: PersonalRecordData = {
  type: 'personal_record',
  exercise_name: 'Deadlift',
  pr_type: 'weight',
  new_value: 200,
  previous_value: 190,
  unit: 'kg',
};
expectAssignable<ActivityData>(validPrData);
expectAssignable<PersonalRecordData>(validPrData);

// PR with null previous value (first PR)
const firstPrData: PersonalRecordData = {
  type: 'personal_record',
  exercise_name: 'Squat',
  pr_type: 'e1rm',
  new_value: 150,
  previous_value: null,
  unit: 'kg',
};
expectAssignable<ActivityData>(firstPrData);

// PR type must be valid
expectNotAssignable<PersonalRecordData['pr_type']>('strength');
expectNotAssignable<PersonalRecordData['pr_type']>('max');

// Unit must be valid
expectNotAssignable<PersonalRecordData['unit']>('lbs');
expectNotAssignable<PersonalRecordData['unit']>('kilograms');

// ============================================================================
// StreakMilestoneData Tests
// ============================================================================

const validStreakData: StreakMilestoneData = {
  type: 'streak_milestone',
  streak_days: 30,
  milestone_type: 'month',
};
expectAssignable<ActivityData>(validStreakData);
expectAssignable<StreakMilestoneData>(validStreakData);

// Milestone type must be valid
expectNotAssignable<StreakMilestoneData['milestone_type']>('year');
expectNotAssignable<StreakMilestoneData['milestone_type']>('day');

// ============================================================================
// BadgeEarnedData Tests
// ============================================================================

const mockBadge: Badge = {
  id: 'badge-1',
  name: 'First Workout',
  icon: 'trophy',
  earned_at: '2024-01-01',
  description: 'Complete your first workout',
};

const validBadgeData: BadgeEarnedData = {
  type: 'badge_earned',
  badge: mockBadge,
};
expectAssignable<ActivityData>(validBadgeData);
expectAssignable<BadgeEarnedData>(validBadgeData);

// ============================================================================
// MesocycleCompletedData Tests
// ============================================================================

const validMesoData: MesocycleCompletedData = {
  type: 'mesocycle_completed',
  mesocycle_name: 'Hypertrophy Block',
  duration_weeks: 6,
  total_workouts: 24,
  total_volume_kg: 150000,
};
expectAssignable<ActivityData>(validMesoData);
expectAssignable<MesocycleCompletedData>(validMesoData);

// ============================================================================
// FollowedUserData Tests
// ============================================================================

const validFollowData: FollowedUserData = {
  type: 'followed_user',
  followed_user_id: 'user-123',
  followed_username: 'johndoe',
};
expectAssignable<ActivityData>(validFollowData);
expectAssignable<FollowedUserData>(validFollowData);

// ============================================================================
// SharedWorkoutData Tests
// ============================================================================

const validShareData: SharedWorkoutData = {
  type: 'shared_workout',
  shared_workout_id: 'workout-456',
  workout_title: 'My Killer Push Day',
};
expectAssignable<ActivityData>(validShareData);
expectAssignable<SharedWorkoutData>(validShareData);

// ============================================================================
// Discriminated Union - Type Narrowing Tests
// ============================================================================

// Test that the discriminant correctly narrows the type
function handleActivity(data: ActivityData) {
  switch (data.type) {
    case 'workout_completed':
      // TypeScript should know this is WorkoutCompletedData
      expectType<string>(data.workout_name);
      expectType<number>(data.duration_minutes);
      expectType<number>(data.total_sets);
      break;
    case 'personal_record':
      // TypeScript should know this is PersonalRecordData
      expectType<string>(data.exercise_name);
      expectType<'weight' | 'reps' | 'volume' | 'e1rm'>(data.pr_type);
      break;
    case 'streak_milestone':
      expectType<number>(data.streak_days);
      expectType<'week' | 'month' | 'hundred'>(data.milestone_type);
      break;
    case 'badge_earned':
      expectType<Badge>(data.badge);
      break;
    case 'mesocycle_completed':
      expectType<string>(data.mesocycle_name);
      expectType<number>(data.duration_weeks);
      break;
    case 'followed_user':
      expectType<string>(data.followed_user_id);
      expectType<string>(data.followed_username);
      break;
    case 'shared_workout':
      expectType<string>(data.shared_workout_id);
      expectType<string>(data.workout_title);
      break;
  }
}

// ============================================================================
// ProfileVisibility Tests
// ============================================================================

expectAssignable<ProfileVisibility>('public');
expectAssignable<ProfileVisibility>('followers_only');
expectAssignable<ProfileVisibility>('private');

expectNotAssignable<ProfileVisibility>('friends_only');
expectNotAssignable<ProfileVisibility>('hidden');

// ============================================================================
// FollowStatus Tests
// ============================================================================

expectAssignable<FollowStatus>('pending');
expectAssignable<FollowStatus>('accepted');
expectAssignable<FollowStatus>('rejected');

expectNotAssignable<FollowStatus>('blocked');
expectNotAssignable<FollowStatus>('requested');

// ============================================================================
// ReactionType Tests
// ============================================================================

expectAssignable<ReactionType>('like');
expectAssignable<ReactionType>('fire');
expectAssignable<ReactionType>('muscle');
expectAssignable<ReactionType>('clap');

expectNotAssignable<ReactionType>('heart');
expectNotAssignable<ReactionType>('thumbsup');

// ============================================================================
// LeaderboardType Tests
// ============================================================================

expectAssignable<LeaderboardType>('total_volume_week');
expectAssignable<LeaderboardType>('total_volume_month');
expectAssignable<LeaderboardType>('workout_streak');
expectAssignable<LeaderboardType>('exercise_1rm');
expectAssignable<LeaderboardType>('workouts_completed_week');
expectAssignable<LeaderboardType>('workouts_completed_month');

expectNotAssignable<LeaderboardType>('total_reps');
expectNotAssignable<LeaderboardType>('weight_lifted');

// ============================================================================
// NotificationType Tests
// ============================================================================

expectAssignable<NotificationType>('new_follower');
expectAssignable<NotificationType>('follow_request');
expectAssignable<NotificationType>('follow_accepted');
expectAssignable<NotificationType>('activity_reaction');
expectAssignable<NotificationType>('activity_comment');
expectAssignable<NotificationType>('comment_reply');
expectAssignable<NotificationType>('workout_reminder');
expectAssignable<NotificationType>('streak_at_risk');
expectAssignable<NotificationType>('personal_record');
expectAssignable<NotificationType>('leaderboard_rank_change');
expectAssignable<NotificationType>('mentioned_in_comment');

expectNotAssignable<NotificationType>('new_message');
expectNotAssignable<NotificationType>('friend_request');

// ============================================================================
// ShareType Tests
// ============================================================================

expectAssignable<ShareType>('single_workout');
expectAssignable<ShareType>('program');
expectAssignable<ShareType>('template');

expectNotAssignable<ShareType>('routine');
expectNotAssignable<ShareType>('plan');

// ============================================================================
// Difficulty Tests
// ============================================================================

expectAssignable<Difficulty>('beginner');
expectAssignable<Difficulty>('intermediate');
expectAssignable<Difficulty>('advanced');

expectNotAssignable<Difficulty>('novice');
expectNotAssignable<Difficulty>('expert');

// ============================================================================
// ActivityVisibility Tests
// ============================================================================

expectAssignable<ActivityVisibility>('public');
expectAssignable<ActivityVisibility>('followers');
expectAssignable<ActivityVisibility>('private');

expectNotAssignable<ActivityVisibility>('friends');
expectNotAssignable<ActivityVisibility>('hidden');

// ============================================================================
// TrainingExperience Tests
// ============================================================================

expectAssignable<TrainingExperience>('beginner');
expectAssignable<TrainingExperience>('intermediate');
expectAssignable<TrainingExperience>('advanced');
expectAssignable<TrainingExperience>('elite');

expectNotAssignable<TrainingExperience>('novice');
expectNotAssignable<TrainingExperience>('pro');

// ============================================================================
// Mismatched Discriminant and Data Tests
// ============================================================================

// These should fail - wrong type discriminant for the data shape
expectNotAssignable<ActivityData>({
  type: 'workout_completed',
  exercise_name: 'Bench Press', // This is PersonalRecordData shape
  pr_type: 'weight',
  new_value: 100,
  previous_value: 90,
  unit: 'kg',
});

expectNotAssignable<ActivityData>({
  type: 'personal_record',
  workout_name: 'Push Day', // This is WorkoutCompletedData shape
  duration_minutes: 60,
  total_sets: 20,
  total_volume_kg: 5000,
  exercises: [],
});
