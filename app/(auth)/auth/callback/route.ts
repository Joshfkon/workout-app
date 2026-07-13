import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

/**
 * Link types that prove the user controls the mailbox: the only way to reach
 * this callback with one of these is by clicking a link Supabase emailed to
 * the account's address. Completing them must therefore also confirm the
 * email — otherwise a user whose original confirmation email was dropped
 * (rate-limited built-in sender) finishes a password reset and is STILL
 * blocked at sign-in with "Email not confirmed".
 */
const MAILBOX_PROOF_TYPES = new Set(['recovery', 'magiclink', 'invite']);

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const type = searchParams.get('type');
  const error = searchParams.get('error');
  const errorCode = searchParams.get('error_code');

  const isRecovery = type === 'recovery' || next === '/reset-password';
  const otpType = isRecovery ? 'recovery' : 'signup';

  // Handle error parameters (e.g., expired OTP). Route to the enter-code
  // screen rather than a dead-end "Authentication failed": the user can
  // request a fresh email (and code) from there.
  if (error) {
    const reason = errorCode === 'otp_expired' ? 'link_expired' : 'link_failed';
    return NextResponse.redirect(
      `${origin}/verify-code?type=${otpType}&reason=${reason}`
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (!exchangeError) {
      const { data: { user } } = await supabase.auth.getUser();

      // Recovery implies confirmation: clicking an emailed recovery /
      // magic-link / invite link IS proof of mailbox ownership, so backfill
      // email_confirmed_at for accounts whose confirmation email never
      // arrived. Uses the service role strictly server-side; failure is
      // non-fatal — the flow the user asked for still completes.
      if (user && !user.email_confirmed_at && (isRecovery || MAILBOX_PROOF_TYPES.has(type ?? ''))) {
        try {
          const admin = createAdminClient();
          if (admin) {
            const { error: confirmError } = await admin.auth.admin.updateUserById(user.id, {
              email_confirm: true,
            });
            if (confirmError) {
              console.error('[auth/callback] failed to backfill email confirmation:', confirmError);
            }
          } else {
            console.error('[auth/callback] SUPABASE_SERVICE_ROLE_KEY not configured — cannot backfill email confirmation');
          }
        } catch (e) {
          console.error('[auth/callback] error backfilling email confirmation:', e);
        }
      }

      // If this is a password recovery flow, redirect to reset-password page
      if (isRecovery) {
        return NextResponse.redirect(`${origin}/reset-password`);
      }

      if (user) {
        // Check onboarding status
        const { data: userData } = await supabase
          .from('users')
          .select('onboarding_completed')
          .eq('id', user.id)
          .single();

        // If user hasn't completed onboarding (or is new), redirect to onboarding
        const onboardingCompleted = (userData as { onboarding_completed?: boolean } | null)?.onboarding_completed;
        if (!onboardingCompleted) {
          return NextResponse.redirect(`${origin}/onboarding`);
        }
      }

      // User has completed onboarding, go to specified next page or the log launcher
      return NextResponse.redirect(`${origin}${next || '/dashboard/log'}`);
    }
  }

  // Auth code exchange failed. The most common cause is the PKCE cross-device
  // trap: the link was opened in a different browser/device than the one that
  // started the flow, so no code verifier exists here. The 6-digit OTP from
  // the same email works anywhere — send the user to the enter-code screen.
  return NextResponse.redirect(
    `${origin}/verify-code?type=${otpType}&reason=cross_device`
  );
}
