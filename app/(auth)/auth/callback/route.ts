import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const type = searchParams.get('type');
  const error = searchParams.get('error');
  const errorCode = searchParams.get('error_code');
  const errorDescription = searchParams.get('error_description');

  // Handle error parameters (e.g., expired OTP)
  if (error) {
    // If this was a password recovery attempt, redirect to reset-password with error
    if (type === 'recovery' || next === '/reset-password') {
      const errorParams = new URLSearchParams({
        error: error,
        ...(errorCode && { error_code: errorCode }),
        ...(errorDescription && { error_description: errorDescription }),
      });
      return NextResponse.redirect(`${origin}/reset-password?${errorParams.toString()}`);
    }
    // Otherwise redirect to login with error
    const errorParams = new URLSearchParams({
      error: error,
      ...(errorCode && { error_code: errorCode }),
    });
    return NextResponse.redirect(`${origin}/login?${errorParams.toString()}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!exchangeError) {
      // If this is a password recovery flow, redirect to reset-password page
      if (type === 'recovery' || next === '/reset-password') {
        return NextResponse.redirect(`${origin}/reset-password`);
      }
      
      // Check if user has completed onboarding
      const { data: { user } } = await supabase.auth.getUser();
      
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
      
      // User has completed onboarding, go to specified next page or dashboard
      return NextResponse.redirect(`${origin}${next || '/dashboard'}`);
    }
  }

  // Auth code exchange failed
  return NextResponse.redirect(`${origin}/login?message=Authentication failed`);
}

