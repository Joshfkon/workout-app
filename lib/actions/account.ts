'use server';

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

interface DeleteAccountResult {
  success: boolean;
  message: string;
}

/**
 * Permanently delete the currently authenticated user's account.
 *
 * Required by App Store Review Guideline 5.1.1(v): any app that supports
 * account creation must let the user initiate account deletion from within
 * the app.
 *
 * Deleting the row in `auth.users` cascades to every user-owned table — they
 * all declare `user_id ... REFERENCES auth.users(id) ON DELETE CASCADE` — so a
 * single admin delete removes the user's profile, workouts, nutrition,
 * subscription record, measurements, etc. (Custom exercises authored by the
 * user use `ON DELETE SET NULL`, so they remain in the library un-owned.)
 *
 * Note: this does not cancel an active Stripe subscription. Billing is managed
 * on the web; users should cancel there before deleting if they have a paid
 * plan. We surface that in the confirmation UI.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  // Identify the caller from their session cookie (anon client).
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: 'You must be logged in to delete your account.' };
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    return { success: false, message: 'Server configuration error. Please contact support.' };
  }

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  );

  // Deleting the auth user cascades to all user-owned rows.
  const { error } = await serviceSupabase.auth.admin.deleteUser(user.id);

  if (error) {
    console.error('Account deletion failed:', error);
    return { success: false, message: 'Failed to delete your account. Please try again or contact support.' };
  }

  return { success: true, message: 'Your account has been permanently deleted.' };
}
