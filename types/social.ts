/**
 * Social Features Type Definitions
 *
 * Types for user profiles, follows, activity feed, sharing, and leaderboards.
 */

// ============================================================================
// User Profiles
// ============================================================================

export type ProfileVisibility = 'public' | 'followers_only' | 'private';
export type TrainingExperience = 'beginner' | 'intermediate' | 'advanced' | 'elite';

export interface Badge {
  id: string;
  name: string;
  icon: string;
  earned_at: string;
  description: string;
}

export interface UserProfile {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;

  // Privacy
  profile_visibility: ProfileVisibility;
  show_workouts: boolean;
  show_stats: boolean;
  show_progress_photos: boolean;

  // Stats (denormalized)
  follower_count: number;
  following_count: number;
  workout_count: number;
  total_volume_kg: number;

  // Optional public info
  training_experience: TrainingExperience | null;
  primary_goal: string | null;
  gym_name: string | null;
  badges: Badge[];
  featured_achievement: string | null;

  created_at: string;
  updated_at: string;
}

export interface ProfileStats {
  total_workouts: number;
  total_volume_kg: number;
  total_sets: number;
  current_streak: number;
  longest_streak: number;
  favorite_exercise: string | null;
  strongest_lift: {
    exercise: string;
    weight_kg: number;
    reps: number;
  } | null;
}

export interface CreateProfileInput {
  username: string;
  display_name?: string;
  bio?: string;
  profile_visibility?: ProfileVisibility;
  training_experience?: TrainingExperience;
  primary_goal?: string;
  gym_name?: string;
}

export interface UpdateProfileInput {
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  profile_visibility?: ProfileVisibility;
  show_workouts?: boolean;
  show_stats?: boolean;
  show_progress_photos?: boolean;
  training_experience?: TrainingExperience | null;
  primary_goal?: string | null;
  gym_name?: string | null;
  featured_achievement?: string | null;
}

// ============================================================================
// Follow System
// ============================================================================

export type FollowStatus = 'pending' | 'accepted' | 'rejected';

export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  status: FollowStatus;
  created_at: string;
  accepted_at: string | null;
}

export interface FollowWithProfile extends Follow {
  follower_profile?: UserProfile;
  following_profile?: UserProfile;
}

export interface FollowRelationship {
  is_following: boolean;
  is_followed_by: boolean;
  follow_status: 'none' | FollowStatus;
}

export interface BlockedUser {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

// ============================================================================
// Activity Feed
// ============================================================================

export type ActivityType =
  | 'workout_completed'
  | 'personal_record'
  | 'streak_milestone'
  | 'badge_earned'
  | 'mesocycle_completed'
  | 'followed_user'
  | 'shared_workout';

export type ActivityVisibility = 'public' | 'followers' | 'private';

export interface Activity {
  id: string;
  user_id: string;
  activity_type: ActivityType;
  reference_type: string | null;
  reference_id: string | null;
  activity_data: ActivityData;
  visibility: ActivityVisibility;
  reaction_count: number;
  comment_count: number;
  created_at: string;
  hidden_at: string | null;
}

export interface ActivityWithProfile extends Activity {
  user_profile: UserProfile;
  user_reaction?: ActivityReaction;
}

// Activity Data Types (discriminated union)
export type ActivityData =
  | WorkoutCompletedData
  | PersonalRecordData
  | StreakMilestoneData
  | BadgeEarnedData
  | MesocycleCompletedData
  | FollowedUserData
  | SharedWorkoutData;

export interface WorkoutCompletedData {
  type: 'workout_completed';
  workout_name: string;
  duration_minutes: number;
  total_sets: number;
  total_volume_kg: number;
  exercises: Array<{
    name: string;
    sets: number;
    top_set: { weight_kg: number; reps: number };
  }>;
  session_rpe?: number;
}

export interface PersonalRecordData {
  type: 'personal_record';
  exercise_name: string;
  pr_type: 'weight' | 'reps' | 'volume' | 'e1rm';
  new_value: number;
  previous_value: number | null;
  unit: 'kg' | 'lb' | 'reps';
}

export interface StreakMilestoneData {
  type: 'streak_milestone';
  streak_days: number;
  milestone_type: 'week' | 'month' | 'hundred';
}

export interface BadgeEarnedData {
  type: 'badge_earned';
  badge: Badge;
}

export interface MesocycleCompletedData {
  type: 'mesocycle_completed';
  mesocycle_name: string;
  duration_weeks: number;
  total_workouts: number;
  total_volume_kg: number;
}

export interface FollowedUserData {
  type: 'followed_user';
  followed_user_id: string;
  followed_username: string;
}

export interface SharedWorkoutData {
  type: 'shared_workout';
  shared_workout_id: string;
  workout_title: string;
}

// ============================================================================
// Reactions & Comments
// ============================================================================

export type ReactionType = 'like' | 'fire' | 'muscle' | 'clap';

export interface ActivityReaction {
  id: string;
  activity_id: string;
  user_id: string;
  reaction_type: ReactionType;
  created_at: string;
}

export interface ActivityComment {
  id: string;
  activity_id: string;
  user_id: string;
  content: string;
  parent_comment_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  user_profile?: UserProfile;
  replies?: ActivityComment[];
}

// ============================================================================
// Workout Sharing
// ============================================================================

export type ShareType = 'single_workout' | 'program' | 'template';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export interface SharedWorkout {
  id: string;
  user_id: string;
  source_workout_id: string | null;
  source_mesocycle_id: string | null;
  title: string;
  description: string | null;
  workout_data: SharedWorkoutContent;
  share_type: ShareType;
  difficulty: Difficulty | null;
  duration_weeks: number | null;
  target_muscle_groups: string[];
  save_count: number;
  copy_count: number;
  view_count: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface SharedWorkoutContent {
  exercises: SharedExercise[];
  estimated_duration_minutes: number;
  total_sets: number;
}

export interface SharedExercise {
  exercise_id: string;
  exercise_name: string;
  sets: number;
  rep_range: [number, number];
  target_rir: number;
  notes?: string;
  superset_group?: number;
}

export interface SharedWorkoutWithProfile extends SharedWorkout {
  user_profile: UserProfile;
  is_saved: boolean;
}

export interface SavedWorkout {
  id: string;
  user_id: string;
  shared_workout_id: string;
  created_at: string;
}

// ============================================================================
// Leaderboards
// ============================================================================

export type LeaderboardType =
  | 'total_volume_week'
  | 'total_volume_month'
  | 'workout_streak'
  | 'exercise_1rm'
  | 'workouts_completed_week'
  | 'workouts_completed_month';

export interface LeaderboardEntry {
  id: string;
  user_id: string;
  leaderboard_type: LeaderboardType;
  exercise_id: string | null;
  score: number;
  rank: number;
  previous_rank: number | null;
  period_start: string;
  period_end: string;
}

export interface LeaderboardEntryWithProfile extends LeaderboardEntry {
  user_profile: UserProfile;
  rank_change: number; // positive = improved, negative = dropped
}

export interface FriendGroup {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string | null;
  created_at: string;
}

export interface FriendGroupMember {
  id: string;
  group_id: string;
  user_id: string;
  joined_at: string;
  user_profile?: UserProfile;
}

// ============================================================================
// Notifications
// ============================================================================

export type NotificationType =
  | 'new_follower'
  | 'follow_request'
  | 'follow_accepted'
  | 'activity_reaction'
  | 'activity_comment'
  | 'comment_reply'
  | 'workout_reminder'
  | 'streak_at_risk'
  | 'personal_record'
  | 'leaderboard_rank_change'
  | 'mentioned_in_comment';

export interface Notification {
  id: string;
  user_id: string;
  notification_type: NotificationType;
  actor_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  clicked_at: string | null;
  created_at: string;
}

export interface NotificationWithActor extends Notification {
  actor_profile?: UserProfile;
}

export interface NotificationPreferences {
  // In-app
  new_follower: boolean;
  activity_reactions: boolean;
  activity_comments: boolean;
  comment_replies: boolean;
  // Push
  push_enabled: boolean;
  push_new_follower: boolean;
  push_comments: boolean;
  push_workout_reminder: boolean;
  push_streak_at_risk: boolean;
  // Email
  email_weekly_summary: boolean;
  email_new_follower: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  has_more: boolean;
}

export interface FeedResponse extends PaginatedResponse<ActivityWithProfile> {}
export interface FollowersResponse extends PaginatedResponse<FollowWithProfile> {}
export interface NotificationsResponse extends PaginatedResponse<NotificationWithActor> {}
