# Social Features Setup Guide

The feed page requires several database migrations to be run in your Supabase database. These migrations create the tables and policies needed for social features.

## Required Migrations (Run in Order)

You need to run these SQL migrations in your Supabase SQL Editor:

### 1. User Profiles Migration
**File**: `supabase/migrations/20241228000001_add_user_profiles.sql`

This creates:
- `user_profiles` table (username, display_name, avatar_url, bio, privacy settings)
- `reserved_usernames` table
- RLS policies for profile access
- Triggers for updating workout counts

### 2. Follows System Migration
**File**: `supabase/migrations/20241228000002_add_follows.sql`

This creates:
- `follows` table (follower/following relationships)
- `blocked_users` table
- Triggers to update follower/following counts
- RLS policies for follow management

### 3. Activity Feed Migration
**File**: `supabase/migrations/20241228000004_add_activity_feed.sql`

This creates:
- `activity_type` enum
- `activities` table (workout completions, PRs, etc.)
- `activity_reactions` table (likes/reactions)
- `activity_comments` table (comments on activities)
- Triggers to create activities when workouts are completed
- Triggers to update reaction/comment counts
- RLS policies for activity visibility

### 4. Activity Visibility Fix (IMPORTANT)
**File**: `supabase/migrations/20241228000005_fix_activity_visibility.sql`

**⚠️ This fix is required for activities to appear in the Discover feed!**

This fixes a bug where activities from users with public profiles were being created with 'followers' visibility instead of 'public'. Run this after migration #3.

## How to Run Migrations

1. **Open Supabase Dashboard**
   - Go to your Supabase project dashboard
   - Navigate to **SQL Editor**

2. **Run Each Migration**
   - Copy the contents of each migration file (in order: 1, 2, 3, 4)
   - Paste into the SQL Editor
   - Click **Run** or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
   - Wait for success confirmation
   - **Important**: Migration #4 fixes a critical bug - don't skip it!

3. **Verify Tables Were Created**
   - Go to **Table Editor** in Supabase
   - You should see these new tables:
     - `user_profiles`
     - `follows`
     - `blocked_users`
     - `activities`
     - `activity_reactions`
     - `activity_comments`
     - `reserved_usernames`

## Important Notes

- **Run migrations in order**: Each migration depends on the previous one
- **No data loss**: These migrations only add new tables, they don't modify existing data
- **RLS is enabled**: All tables have Row Level Security enabled for data protection
- **Triggers are created**: Automatic activity creation when workouts are completed

## After Running Migrations

1. **Create a user profile**: Users will need to set up their profile (username, etc.) before they can use social features
2. **Complete a workout**: Activities are automatically created when workouts are completed (if user has a profile)
3. **Follow other users**: Use the search page to find and follow other users
4. **View feed**: The feed page should now work and show activities from users you follow

## Troubleshooting

If the feed page still doesn't work after running migrations:

1. **Check browser console** for any error messages
2. **Verify RLS policies**: Make sure you're logged in and policies are working
3. **Check user profile**: Ensure you have a `user_profiles` entry (visit `/dashboard/profile/setup` if needed)
4. **Check activities exist**: Query `SELECT * FROM activities LIMIT 10;` in SQL Editor to see if any activities were created

## Migration Files Location

All migration files are in: `supabase/migrations/`

- `20241228000001_add_user_profiles.sql`
- `20241228000002_add_follows.sql`
- `20241228000003_add_avatars_storage.sql` (optional - for avatar uploads)
- `20241228000004_add_activity_feed.sql`
- `20241228000005_fix_activity_visibility.sql` (required fix)

