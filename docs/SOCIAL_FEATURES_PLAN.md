# Social Features Implementation Plan

> **Status**: Phase 4 Complete - Workout Sharing
> **Last Updated**: 2025-12-26
> **Current Sprint**: Sprint 4 - Workout Sharing (Complete)
>
> ### Phase 3 Progress (Activity Feed) - Complete
> - [x] Create activities database migration
> - [x] Create ActivityCard, ReactionBar components
> - [x] Create useActivityFeed, useReactions hooks
> - [x] Build activity feed page with Following/Discover tabs
> - [x] Add Feed and Profile links to sidebar
>
> ### Phase 4 Progress (Workout Sharing) - Complete
> - [x] Create shared_workouts, saved_workouts, workout_copies database migration
> - [x] Create ShareWorkoutModal component with type/difficulty/muscle group selection
> - [x] Create SharedWorkoutCard component with stats and tags
> - [x] Create SaveWorkoutButton and CopyWorkoutButton components
> - [x] Create useSharedWorkouts hook with filters and pagination
> - [x] Build workout browser page with Browse/Saved tabs and filters
> **Target Competitor**: Hevy (primary social fitness app benchmark)

---

## Executive Summary

This document outlines the complete implementation plan for adding social features to HyperTrack. Currently, HyperTrack is a single-user application with full data isolation via RLS. These features will transform it into a social fitness platform while maintaining user privacy and data security.

### Feature Matrix

| Feature | Priority | Complexity | Dependencies |
|---------|----------|------------|--------------|
| User Profiles | P0 (Critical) | Medium | None |
| Follow System | P0 (Critical) | Medium | User Profiles |
| Activity Feed | P1 (High) | High | Follow System |
| Workout Sharing | P1 (High) | Medium | User Profiles |
| Leaderboards | P2 (Medium) | Medium | User Profiles |
| Social Notifications | P2 (Medium) | Medium | All above |
| Direct Messaging | P3 (Low) | High | Follow System |

---

## Phase 1: User Profiles (Foundation)

### 1.1 Database Schema

```sql
-- Migration: YYYYMMDD000001_add_user_profiles.sql

-- Extended user profile for social features
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Display info
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT CHECK (char_length(bio) <= 500),

  -- Privacy settings
  profile_visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (profile_visibility IN ('public', 'followers_only', 'private')),
  show_workouts BOOLEAN NOT NULL DEFAULT true,
  show_stats BOOLEAN NOT NULL DEFAULT true,
  show_progress_photos BOOLEAN NOT NULL DEFAULT false,

  -- Social stats (denormalized for performance)
  follower_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  workout_count INTEGER NOT NULL DEFAULT 0,
  total_volume_kg NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Achievements & badges
  badges JSONB NOT NULL DEFAULT '[]',
  featured_achievement TEXT,

  -- Fitness info (optional public display)
  training_experience TEXT CHECK (training_experience IN ('beginner', 'intermediate', 'advanced', 'elite')),
  primary_goal TEXT,
  gym_name TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_user UNIQUE (user_id)
);

-- Username reservation/validation
CREATE INDEX idx_user_profiles_username_lower ON user_profiles (LOWER(username));
CREATE INDEX idx_user_profiles_user_id ON user_profiles (user_id);

-- RLS Policies
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can view public profiles
CREATE POLICY "Public profiles are viewable by all"
  ON user_profiles FOR SELECT
  USING (profile_visibility = 'public');

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Followers can view followers_only profiles (requires follows table)
CREATE POLICY "Followers can view followers_only profiles"
  ON user_profiles FOR SELECT
  USING (
    profile_visibility = 'followers_only'
    AND EXISTS (
      SELECT 1 FROM follows
      WHERE follower_id = auth.uid()
      AND following_id = user_profiles.user_id
      AND status = 'accepted'
    )
  );

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

### 1.2 TypeScript Types

```typescript
// types/social.ts

export interface UserProfile {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;

  // Privacy
  profile_visibility: 'public' | 'followers_only' | 'private';
  show_workouts: boolean;
  show_stats: boolean;
  show_progress_photos: boolean;

  // Stats
  follower_count: number;
  following_count: number;
  workout_count: number;
  total_volume_kg: number;

  // Optional public info
  training_experience: 'beginner' | 'intermediate' | 'advanced' | 'elite' | null;
  primary_goal: string | null;
  gym_name: string | null;
  badges: Badge[];
  featured_achievement: string | null;

  created_at: string;
  updated_at: string;
}

export interface Badge {
  id: string;
  name: string;
  icon: string;
  earned_at: string;
  description: string;
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
```

### 1.3 Components

```
/components/social/
  /profile/
    ProfileCard.tsx           # Compact profile preview (avatar, name, stats)
    ProfileHeader.tsx         # Full profile header with cover photo
    ProfileStats.tsx          # Training stats display
    ProfileBadges.tsx         # Achievement badges grid
    EditProfileModal.tsx      # Edit profile form
    AvatarUpload.tsx          # Avatar image upload with cropping
    PrivacySettings.tsx       # Privacy controls
    UsernameInput.tsx         # Username validation input
```

### 1.4 Pages/Routes

```
/app/(dashboard)/profile/
  page.tsx                    # User's own profile
  edit/page.tsx               # Edit profile page
  [username]/page.tsx         # View other user's profile
```

### 1.5 Implementation Tasks

- [x] Create database migration for `user_profiles` table (`20241228000001_add_user_profiles.sql`)
- [x] Add username validation (alphanumeric, 3-30 chars, no reserved words) (`lib/social.ts`)
- [x] Build avatar upload with Supabase Storage (`components/social/profile/AvatarUpload.tsx`)
- [x] Create profile onboarding flow (username selection) (`app/(dashboard)/dashboard/profile/setup/page.tsx`)
- [x] Build ProfileCard component for profile previews (`components/social/profile/ProfileCard.tsx`)
- [x] Build full profile page with stats (`app/(dashboard)/dashboard/profile/page.tsx`)
- [ ] Implement privacy settings UI
- [x] Add profile link sharing (deep links) (`lib/social.ts - getProfileShareUrl`)
- [x] Create username search API (`app/(dashboard)/dashboard/search/page.tsx`)

**Completed Files:**
- `types/social.ts` - All social feature types
- `lib/social.ts` - Username validation, social utilities
- `supabase/migrations/20241228000001_add_user_profiles.sql` - Database schema
- `components/social/profile/Avatar.tsx` - Avatar component
- `components/social/profile/AvatarUpload.tsx` - Avatar upload with Storage
- `components/social/profile/ProfileCard.tsx` - Profile card (compact/full)
- `components/social/UserSearch.tsx` - User search component
- `app/(dashboard)/dashboard/profile/page.tsx` - Own profile page
- `app/(dashboard)/dashboard/profile/[username]/page.tsx` - View other profiles
- `app/(dashboard)/dashboard/profile/setup/page.tsx` - Profile setup flow
- `app/(dashboard)/dashboard/search/page.tsx` - User search page

---

## Phase 2: Follow System

### 2.1 Database Schema

```sql
-- Migration: YYYYMMDD000002_add_follows.sql

CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Status for follow requests (private profiles)
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('pending', 'accepted', 'rejected')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,

  -- Prevent self-follow and duplicates
  CONSTRAINT no_self_follow CHECK (follower_id != following_id),
  CONSTRAINT unique_follow UNIQUE (follower_id, following_id)
);

CREATE INDEX idx_follows_follower ON follows (follower_id, status);
CREATE INDEX idx_follows_following ON follows (following_id, status);
CREATE INDEX idx_follows_pending ON follows (following_id) WHERE status = 'pending';

-- Trigger to update follower/following counts
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'accepted' THEN
    UPDATE user_profiles SET follower_count = follower_count + 1 WHERE user_id = NEW.following_id;
    UPDATE user_profiles SET following_count = following_count + 1 WHERE user_id = NEW.follower_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    UPDATE user_profiles SET follower_count = follower_count + 1 WHERE user_id = NEW.following_id;
    UPDATE user_profiles SET following_count = following_count + 1 WHERE user_id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'accepted' THEN
    UPDATE user_profiles SET follower_count = follower_count - 1 WHERE user_id = OLD.following_id;
    UPDATE user_profiles SET following_count = following_count - 1 WHERE user_id = OLD.follower_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_follow_counts
  AFTER INSERT OR UPDATE OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- RLS Policies
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- Users can see their own follows
CREATE POLICY "Users can view own follows"
  ON follows FOR SELECT
  USING (auth.uid() = follower_id OR auth.uid() = following_id);

-- Users can create follows (rate limit in application layer)
CREATE POLICY "Users can follow others"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

-- Users can delete their own follows (unfollow)
CREATE POLICY "Users can unfollow"
  ON follows FOR DELETE
  USING (auth.uid() = follower_id);

-- Users can update follows they receive (accept/reject requests)
CREATE POLICY "Users can respond to follow requests"
  ON follows FOR UPDATE
  USING (auth.uid() = following_id AND status = 'pending');

-- Blocked users table
CREATE TABLE blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT no_self_block CHECK (blocker_id != blocked_id),
  CONSTRAINT unique_block UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX idx_blocked_users_blocker ON blocked_users (blocker_id);
```

### 2.2 TypeScript Types

```typescript
// types/social.ts (additions)

export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  accepted_at: string | null;
}

export interface FollowWithProfile extends Follow {
  follower_profile?: UserProfile;
  following_profile?: UserProfile;
}

export interface FollowStats {
  is_following: boolean;
  is_followed_by: boolean;
  follow_status: 'none' | 'pending' | 'accepted' | 'rejected';
}
```

### 2.3 Components

```
/components/social/
  /follow/
    FollowButton.tsx          # Follow/Unfollow/Pending button
    FollowersList.tsx         # List of followers
    FollowingList.tsx         # List of following
    FollowRequests.tsx        # Pending follow requests
    SuggestedUsers.tsx        # Follow suggestions
    UserSearchResults.tsx     # Search results with follow buttons
```

### 2.4 Implementation Tasks

- [x] Create database migration for `follows` table (`20241228000002_add_follows.sql`)
- [x] Create database migration for `blocked_users` table (`20241228000002_add_follows.sql`)
- [x] Build FollowButton component with optimistic updates (`components/social/follow/FollowButton.tsx`)
- [x] Implement follow/unfollow logic (`hooks/useFollow.ts`)
- [ ] Build followers/following list pages
- [x] Implement follow request system for private profiles (in useFollow hook)
- [x] Add user blocking functionality (database triggers)
- [x] Create user search with filters (`components/social/UserSearch.tsx`)
- [ ] Build suggested users algorithm (gym, mutual follows)
- [ ] Add rate limiting for follow actions

**Completed Files:**
- `supabase/migrations/20241228000002_add_follows.sql` - Follows and blocked_users tables
- `supabase/migrations/20241228000003_add_avatars_storage.sql` - Storage bucket docs
- `hooks/useFollow.ts` - Follow state management hook
- `components/social/follow/FollowButton.tsx` - Follow button with states

---

## Phase 3: Activity Feed

### 3.1 Database Schema

```sql
-- Migration: YYYYMMDD000003_add_activity_feed.sql

-- Activity types enum
CREATE TYPE activity_type AS ENUM (
  'workout_completed',
  'personal_record',
  'streak_milestone',
  'badge_earned',
  'mesocycle_completed',
  'followed_user',
  'shared_workout'
);

-- Activity feed items
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type activity_type NOT NULL,

  -- Polymorphic reference to related entity
  reference_type TEXT, -- 'workout_session', 'exercise', 'user', etc.
  reference_id UUID,

  -- Denormalized data for fast feed rendering
  activity_data JSONB NOT NULL DEFAULT '{}',

  -- Privacy (inherits from user or can be overridden)
  visibility TEXT NOT NULL DEFAULT 'followers'
    CHECK (visibility IN ('public', 'followers', 'private')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft delete for hiding without removing
  hidden_at TIMESTAMPTZ
);

CREATE INDEX idx_activities_user_id ON activities (user_id, created_at DESC);
CREATE INDEX idx_activities_created_at ON activities (created_at DESC);
CREATE INDEX idx_activities_type ON activities (activity_type);

-- Reactions/likes on activities
CREATE TABLE activity_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL DEFAULT 'like'
    CHECK (reaction_type IN ('like', 'fire', 'muscle', 'clap')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_reaction UNIQUE (activity_id, user_id)
);

CREATE INDEX idx_activity_reactions_activity ON activity_reactions (activity_id);

-- Comments on activities
CREATE TABLE activity_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) <= 1000),

  -- Reply threading
  parent_comment_id UUID REFERENCES activity_comments(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ -- Soft delete
);

CREATE INDEX idx_activity_comments_activity ON activity_comments (activity_id, created_at);

-- Denormalized reaction counts on activities (updated via trigger)
ALTER TABLE activities ADD COLUMN reaction_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activities ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0;

-- RLS Policies
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_comments ENABLE ROW LEVEL SECURITY;

-- View activities from followed users or public
CREATE POLICY "View followed users activities"
  ON activities FOR SELECT
  USING (
    visibility = 'public'
    OR user_id = auth.uid()
    OR (
      visibility = 'followers'
      AND EXISTS (
        SELECT 1 FROM follows
        WHERE follower_id = auth.uid()
        AND following_id = activities.user_id
        AND status = 'accepted'
      )
    )
  );

-- Users can insert their own activities
CREATE POLICY "Users can create activities"
  ON activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can hide their own activities
CREATE POLICY "Users can hide own activities"
  ON activities FOR UPDATE
  USING (auth.uid() = user_id);
```

### 3.2 TypeScript Types

```typescript
// types/social.ts (additions)

export type ActivityType =
  | 'workout_completed'
  | 'personal_record'
  | 'streak_milestone'
  | 'badge_earned'
  | 'mesocycle_completed'
  | 'followed_user'
  | 'shared_workout';

export interface Activity {
  id: string;
  user_id: string;
  activity_type: ActivityType;
  reference_type: string | null;
  reference_id: string | null;
  activity_data: ActivityData;
  visibility: 'public' | 'followers' | 'private';
  reaction_count: number;
  comment_count: number;
  created_at: string;
  hidden_at: string | null;
}

export interface ActivityWithProfile extends Activity {
  user_profile: UserProfile;
  user_reaction?: ActivityReaction;
}

export type ActivityData =
  | WorkoutCompletedData
  | PersonalRecordData
  | StreakMilestoneData
  | BadgeEarnedData;

export interface WorkoutCompletedData {
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
  exercise_name: string;
  pr_type: 'weight' | 'reps' | 'volume' | 'e1rm';
  new_value: number;
  previous_value: number | null;
  unit: 'kg' | 'lb' | 'reps';
}

export interface StreakMilestoneData {
  streak_days: number;
  milestone_type: 'week' | 'month' | 'hundred';
}

export interface BadgeEarnedData {
  badge: Badge;
}

export interface ActivityReaction {
  id: string;
  activity_id: string;
  user_id: string;
  reaction_type: 'like' | 'fire' | 'muscle' | 'clap';
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
  user_profile?: UserProfile;
  replies?: ActivityComment[];
}
```

### 3.3 Components

```
/components/social/
  /feed/
    ActivityFeed.tsx          # Main feed container with infinite scroll
    ActivityCard.tsx          # Single activity item
    WorkoutActivityCard.tsx   # Workout completion card
    PRActivityCard.tsx        # Personal record card
    StreakActivityCard.tsx    # Streak milestone card
    ReactionBar.tsx           # Like/react buttons
    ReactionPicker.tsx        # Emoji reaction picker
    CommentSection.tsx        # Comments list and input
    CommentItem.tsx           # Single comment
    FeedFilters.tsx           # Filter by activity type
    EmptyFeed.tsx             # Empty state with suggestions
```

### 3.4 Feed Generation Strategy

The activity feed should be generated efficiently:

1. **Fan-out on write**: When a user completes an activity, write to a feed cache table for each follower
2. **Hybrid approach**: For users with many followers (>1000), use fan-out on read
3. **Caching**: Use edge caching for popular activities

```sql
-- Feed cache for fast retrieval
CREATE TABLE feed_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  activity_user_id UUID NOT NULL,
  activity_type activity_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT unique_feed_entry UNIQUE (user_id, activity_id)
);

CREATE INDEX idx_feed_cache_user_timeline ON feed_cache (user_id, created_at DESC);
```

### 3.5 Implementation Tasks

- [ ] Create database migrations for activities, reactions, comments
- [ ] Implement activity creation triggers (on workout complete, PR, etc.)
- [ ] Build ActivityFeed with infinite scroll
- [ ] Create activity card variants for each type
- [ ] Implement reaction system with optimistic updates
- [ ] Build comment system with replies
- [ ] Add feed caching strategy
- [ ] Implement activity hiding/deletion
- [ ] Create feed filtering options
- [ ] Add pull-to-refresh functionality

---

## Phase 4: Workout Sharing

### 4.1 Database Schema

```sql
-- Migration: YYYYMMDD000004_add_workout_sharing.sql

-- Shared workouts (templates/programs shared publicly)
CREATE TABLE shared_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Source workout
  source_workout_id UUID REFERENCES workout_sessions(id) ON DELETE SET NULL,
  source_mesocycle_id UUID REFERENCES mesocycles(id) ON DELETE SET NULL,

  -- Shared content
  title TEXT NOT NULL,
  description TEXT,
  workout_data JSONB NOT NULL, -- Denormalized workout structure

  -- Metadata
  share_type TEXT NOT NULL CHECK (share_type IN ('single_workout', 'program', 'template')),
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  duration_weeks INTEGER, -- For programs
  target_muscle_groups TEXT[], -- Primary focus

  -- Stats
  save_count INTEGER NOT NULL DEFAULT 0,
  copy_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,

  -- Visibility
  is_public BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shared_workouts_user ON shared_workouts (user_id);
CREATE INDEX idx_shared_workouts_public ON shared_workouts (is_public, created_at DESC);
CREATE INDEX idx_shared_workouts_type ON shared_workouts (share_type);

-- Saved/bookmarked workouts
CREATE TABLE saved_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_workout_id UUID NOT NULL REFERENCES shared_workouts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_save UNIQUE (user_id, shared_workout_id)
);

CREATE INDEX idx_saved_workouts_user ON saved_workouts (user_id, created_at DESC);

-- RLS
ALTER TABLE shared_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_workouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public workouts are viewable"
  ON shared_workouts FOR SELECT
  USING (is_public = true OR user_id = auth.uid());

CREATE POLICY "Users can share workouts"
  ON shared_workouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shares"
  ON shared_workouts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own shares"
  ON shared_workouts FOR DELETE
  USING (auth.uid() = user_id);
```

### 4.2 TypeScript Types

```typescript
// types/social.ts (additions)

export interface SharedWorkout {
  id: string;
  user_id: string;
  source_workout_id: string | null;
  source_mesocycle_id: string | null;
  title: string;
  description: string | null;
  workout_data: SharedWorkoutData;
  share_type: 'single_workout' | 'program' | 'template';
  difficulty: 'beginner' | 'intermediate' | 'advanced' | null;
  duration_weeks: number | null;
  target_muscle_groups: string[];
  save_count: number;
  copy_count: number;
  view_count: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface SharedWorkoutData {
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
```

### 4.3 Components

```
/components/social/
  /sharing/
    ShareWorkoutModal.tsx     # Share workout dialog
    SharedWorkoutCard.tsx     # Preview card
    SharedWorkoutDetail.tsx   # Full shared workout view
    CopyWorkoutButton.tsx     # Import to own library
    SaveWorkoutButton.tsx     # Bookmark
    WorkoutBrowser.tsx        # Browse public workouts
    WorkoutFilters.tsx        # Filter by type, muscle group
    ShareLinkGenerator.tsx    # Generate shareable link
```

### 4.4 Implementation Tasks

- [ ] Create database migration for shared workouts
- [ ] Build share workout modal with privacy options
- [ ] Implement workout serialization for sharing
- [ ] Create public workout browser page
- [ ] Build workout import/copy functionality
- [ ] Add save/bookmark feature
- [ ] Generate shareable deep links
- [ ] Implement workout search and filters
- [ ] Add share to activity feed
- [ ] Track view/copy/save analytics

---

## Phase 5: Leaderboards

### 5.1 Database Schema

```sql
-- Migration: YYYYMMDD000005_add_leaderboards.sql

-- Leaderboard types
CREATE TYPE leaderboard_type AS ENUM (
  'total_volume_week',
  'total_volume_month',
  'workout_streak',
  'exercise_1rm',
  'workouts_completed_week',
  'workouts_completed_month'
);

-- Leaderboard entries (updated periodically via cron)
CREATE TABLE leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leaderboard_type leaderboard_type NOT NULL,

  -- For exercise-specific leaderboards
  exercise_id UUID REFERENCES exercises(id) ON DELETE CASCADE,

  -- Ranking
  score NUMERIC(14,2) NOT NULL,
  rank INTEGER,
  previous_rank INTEGER,

  -- Context
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_leaderboard_entry UNIQUE (user_id, leaderboard_type, exercise_id, period_start)
);

CREATE INDEX idx_leaderboard_type_rank ON leaderboard_entries (leaderboard_type, exercise_id, period_start, rank);
CREATE INDEX idx_leaderboard_user ON leaderboard_entries (user_id);

-- User opt-in for leaderboards
ALTER TABLE user_profiles ADD COLUMN show_on_leaderboards BOOLEAN NOT NULL DEFAULT true;

-- Friend groups for private leaderboards
CREATE TABLE friend_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE friend_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_member UNIQUE (group_id, user_id)
);

-- RLS
ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;

-- Leaderboards are public for opted-in users
CREATE POLICY "View leaderboards"
  ON leaderboard_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = leaderboard_entries.user_id
      AND show_on_leaderboards = true
    )
  );
```

### 5.2 TypeScript Types

```typescript
// types/social.ts (additions)

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
  member_count: number;
}
```

### 5.3 Components

```
/components/social/
  /leaderboards/
    LeaderboardTabs.tsx       # Tab navigation
    LeaderboardTable.tsx      # Ranked list
    LeaderboardEntry.tsx      # Single entry row
    ExerciseSelector.tsx      # Select exercise for 1RM boards
    TimeframeSelector.tsx     # Week/Month toggle
    FriendGroupBoard.tsx      # Private group leaderboard
    CreateGroupModal.tsx      # Create friend group
    JoinGroupModal.tsx        # Join via invite code
    LeaderboardCard.tsx       # Dashboard widget
    RankBadge.tsx             # Rank indicator
```

### 5.4 Leaderboard Calculation

Leaderboards should be calculated via scheduled jobs:

```typescript
// lib/jobs/calculateLeaderboards.ts

export async function calculateWeeklyLeaderboards() {
  // Calculate total volume for the week
  // Calculate workout count
  // Rank users
  // Update leaderboard_entries table
}

export async function calculateExercise1RMLeaderboards() {
  // For popular exercises
  // Calculate E1RM from set_logs
  // Rank users (optionally by weight class)
}
```

### 5.5 Implementation Tasks

- [ ] Create database migrations for leaderboards
- [ ] Build leaderboard calculation jobs
- [ ] Create leaderboard UI components
- [ ] Implement exercise-specific leaderboards
- [ ] Add friend group creation and management
- [ ] Create private group leaderboards
- [ ] Add leaderboard opt-out toggle
- [ ] Build dashboard leaderboard widget
- [ ] Implement rank change indicators
- [ ] Add weight class divisions (optional)

---

## Phase 6: Notifications

### 6.1 Database Schema

```sql
-- Migration: YYYYMMDD000006_add_notifications.sql

CREATE TYPE notification_type AS ENUM (
  'new_follower',
  'follow_request',
  'follow_accepted',
  'activity_reaction',
  'activity_comment',
  'comment_reply',
  'workout_reminder',
  'streak_at_risk',
  'personal_record',
  'leaderboard_rank_change',
  'mentioned_in_comment'
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type notification_type NOT NULL,

  -- Actor (who triggered the notification)
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Reference to related entity
  reference_type TEXT,
  reference_id UUID,

  -- Notification content
  title TEXT NOT NULL,
  body TEXT,
  data JSONB NOT NULL DEFAULT '{}',

  -- Status
  read_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Auto-expire old notifications
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_expires ON notifications (expires_at);

-- Notification preferences
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- In-app notifications
  new_follower BOOLEAN NOT NULL DEFAULT true,
  activity_reactions BOOLEAN NOT NULL DEFAULT true,
  activity_comments BOOLEAN NOT NULL DEFAULT true,
  comment_replies BOOLEAN NOT NULL DEFAULT true,

  -- Push notifications
  push_enabled BOOLEAN NOT NULL DEFAULT false,
  push_new_follower BOOLEAN NOT NULL DEFAULT true,
  push_comments BOOLEAN NOT NULL DEFAULT true,
  push_workout_reminder BOOLEAN NOT NULL DEFAULT true,
  push_streak_at_risk BOOLEAN NOT NULL DEFAULT true,

  -- Email notifications
  email_weekly_summary BOOLEAN NOT NULL DEFAULT true,
  email_new_follower BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT unique_notification_prefs UNIQUE (user_id)
);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);
```

### 6.2 TypeScript Types

```typescript
// types/social.ts (additions)

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
  new_follower: boolean;
  activity_reactions: boolean;
  activity_comments: boolean;
  comment_replies: boolean;
  push_enabled: boolean;
  push_new_follower: boolean;
  push_comments: boolean;
  push_workout_reminder: boolean;
  push_streak_at_risk: boolean;
  email_weekly_summary: boolean;
  email_new_follower: boolean;
}
```

### 6.3 Components

```
/components/social/
  /notifications/
    NotificationBell.tsx      # Header bell with badge
    NotificationDropdown.tsx  # Dropdown list
    NotificationItem.tsx      # Single notification
    NotificationList.tsx      # Full page list
    NotificationPrefs.tsx     # Preferences form
    MarkAllReadButton.tsx     # Bulk action
```

### 6.4 Implementation Tasks

- [ ] Create database migration for notifications
- [ ] Build notification creation service
- [ ] Create notification triggers (on follow, reaction, etc.)
- [ ] Build NotificationBell component with unread count
- [ ] Create notification dropdown and list
- [ ] Implement mark as read functionality
- [ ] Build notification preferences UI
- [ ] Add real-time notifications (Supabase Realtime)
- [ ] Implement push notification infrastructure (optional)
- [ ] Create email notification service (optional)

---

## Technical Considerations

### Privacy & Security

1. **Data Isolation**: Maintain strict RLS policies
2. **Block Lists**: Hidden from blocked users' feeds
3. **Report System**: Add user/content reporting
4. **Moderation**: Content moderation for comments
5. **GDPR**: Export/delete social data

```sql
-- Add reporting
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id),
  reported_type TEXT NOT NULL, -- 'user', 'activity', 'comment'
  reported_id UUID NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Performance Optimizations

1. **Feed Pagination**: Use cursor-based pagination
2. **Denormalization**: Store counts on parent records
3. **Caching**: Edge cache for public profiles/leaderboards
4. **Batch Updates**: Aggregate notification counts
5. **Lazy Loading**: Load comments/reactions on demand

### Rate Limiting

```typescript
// Suggested rate limits
const RATE_LIMITS = {
  follow: { max: 50, window: '1h' },
  comment: { max: 100, window: '1h' },
  reaction: { max: 200, window: '1h' },
  share: { max: 20, window: '1h' },
};
```

---

## Implementation Timeline

### Sprint 1: Foundation (Weeks 1-2)
- [ ] User profiles database and UI
- [ ] Avatar upload
- [ ] Profile privacy settings
- [ ] Username system

### Sprint 2: Connections (Weeks 3-4)
- [ ] Follow system
- [ ] User search
- [ ] Blocking
- [ ] Followers/following lists

### Sprint 3: Activity (Weeks 5-6)
- [ ] Activity feed infrastructure
- [ ] Activity cards
- [ ] Reactions
- [ ] Comments

### Sprint 4: Sharing (Weeks 7-8)
- [ ] Workout sharing
- [ ] Shared workout browser
- [ ] Import/copy workouts
- [ ] Share links

### Sprint 5: Competition (Weeks 9-10)
- [ ] Leaderboards
- [ ] Friend groups
- [ ] Rank tracking
- [ ] Dashboard widgets

### Sprint 6: Polish (Weeks 11-12)
- [ ] Notifications
- [ ] Real-time updates
- [ ] Performance optimization
- [ ] Bug fixes and polish

---

## API Endpoints Summary

```
# Profiles
GET    /api/profiles/:username
PATCH  /api/profiles/me
POST   /api/profiles/avatar

# Follow
POST   /api/follow/:userId
DELETE /api/follow/:userId
GET    /api/follow/followers
GET    /api/follow/following
PATCH  /api/follow/requests/:id

# Feed
GET    /api/feed
GET    /api/feed/:userId
POST   /api/activities/:id/reactions
DELETE /api/activities/:id/reactions
POST   /api/activities/:id/comments
DELETE /api/comments/:id

# Sharing
POST   /api/workouts/share
GET    /api/workouts/shared
GET    /api/workouts/shared/:id
POST   /api/workouts/shared/:id/save
POST   /api/workouts/shared/:id/copy

# Leaderboards
GET    /api/leaderboards/:type
GET    /api/leaderboards/groups/:groupId
POST   /api/leaderboards/groups
POST   /api/leaderboards/groups/:id/join

# Notifications
GET    /api/notifications
PATCH  /api/notifications/read
GET    /api/notifications/preferences
PATCH  /api/notifications/preferences
```

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Profile creation rate | 80% of users | Users with completed profiles |
| Follow connections | 5+ per active user | Average following count |
| Feed engagement | 30% daily active | Users viewing feed daily |
| Workout shares | 10% of completed | Workouts shared publicly |
| Comment rate | 5% of activities | Activities with comments |

---

## Open Questions

1. **Monetization**: Should some social features be premium-only?
2. **Moderation**: Build in-house or use third-party service?
3. **Verification**: Add verified badges for athletes/coaches?
4. **Groups**: Add gym/team groups beyond friend groups?
5. **Challenges**: Add social challenges/competitions?

---

## Next Steps

1. Review and approve this plan
2. Prioritize MVP features for initial release
3. Create detailed technical specs for Phase 1
4. Set up database migrations
5. Begin implementation

---

*Document maintained by the HyperTrack development team*
