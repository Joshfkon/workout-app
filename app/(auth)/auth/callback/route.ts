import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
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

