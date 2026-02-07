export interface UserProfileBasic {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface UserProfileFull extends UserProfileBasic {
  bio: string | null;
  profile_visibility: string;
  follower_count: number;
  following_count: number;
  workout_count: number;
  training_experience: string | null;
}

/**
 * Fetch user profiles by user IDs and return as a Map keyed by user_id.
 *
 * @param supabase - Supabase client instance
 * @param userIds - Array of user IDs to fetch profiles for
 * @param fields - Which fields to select. 'basic' for minimal, 'full' for all fields.
 * @returns Map of user_id -> profile data
 */
export async function fetchUserProfiles<T extends 'basic' | 'full' = 'basic'>(
  supabase: { from: (...args: any[]) => any },
  userIds: string[],
  fields: T = 'basic' as T
): Promise<Map<string, T extends 'full' ? UserProfileFull : UserProfileBasic>> {
  const profilesMap = new Map<string, any>();

  if (userIds.length === 0) return profilesMap;

  const selectFields = fields === 'full'
    ? 'id, user_id, username, display_name, avatar_url, bio, profile_visibility, follower_count, following_count, workout_count, training_experience'
    : 'id, user_id, username, display_name, avatar_url';

  const { data, error } = await supabase
    .from('user_profiles' as never)
    .select(selectFields)
    .in('user_id', userIds) as { data: any[] | null; error: any };

  if (error) {
    console.error('[fetchUserProfiles] Error:', error);
    return profilesMap;
  }

  if (data) {
    data.forEach((profile: any) => {
      profilesMap.set(profile.user_id, profile);
    });
  }

  return profilesMap;
}
