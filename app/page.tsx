import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home({
  searchParams,
}: {
  searchParams: { error?: string; error_code?: string; error_description?: string };
}) {
  // Handle auth errors (e.g., expired password reset links)
  if (searchParams.error) {
    // If it's a password recovery error, redirect to reset-password page
    if (searchParams.error_code === 'otp_expired' || searchParams.error_description?.includes('expired')) {
      redirect(`/reset-password?error=${encodeURIComponent(searchParams.error)}&error_code=${encodeURIComponent(searchParams.error_code || '')}&error_description=${encodeURIComponent(searchParams.error_description || '')}`);
    }
    // Otherwise redirect to login with error
    redirect(`/login?error=${encodeURIComponent(searchParams.error)}&error_code=${encodeURIComponent(searchParams.error_code || '')}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (user) {
    redirect("/dashboard");
  }
  return (
    <div className="min-h-screen bg-surface-950 relative overflow-hidden">
      {/* Top navigation - fixed height to prevent overlap */}
      <nav className="fixed top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 md:px-6 md:py-4 bg-surface-950/80 backdrop-blur-sm border-b border-surface-800/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-lg font-bold text-white tracking-tight">HyperTrack</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm font-medium text-surface-300 hover:text-white transition-colors"
          >
            Login
          </Link>
          <Link
            href="/register"
            className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm font-medium rounded-lg bg-primary-500 hover:bg-primary-600 text-white transition-colors"
          >
            Sign Up
          </Link>
        </div>
      </nav>

      {/* Background gradient effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-radial from-primary-900/20 via-transparent to-transparent" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-radial from-accent-900/20 via-transparent to-transparent" />
      </div>

      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '64px 64px'
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 pt-16">
        {/* Hero content */}
        <div className="text-center max-w-2xl animate-fade-in">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-6 tracking-tight">
            Train <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400">Smarter</span>,
            <br />Grow Faster
          </h1>
          <p className="text-lg sm:text-xl text-surface-400 mb-10 leading-relaxed px-2">
            Science-based hypertrophy training with AI coaching and nutrition tracking.
            Track volume, manage fatigue, hit your macros, and optimize your gains.
          </p>
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-4 animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <Link
            href="/login"
            className="btn-primary px-8 py-4 text-lg rounded-xl shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all"
          >
            Get Started
          </Link>
          <Link
            href="/register"
            className="btn-secondary px-8 py-4 text-lg rounded-xl border border-surface-700"
          >
            Create Account
          </Link>
        </div>

        {/* Learn More link */}
        <div className="mt-6 animate-slide-up" style={{ animationDelay: '0.15s' }}>
          <Link
            href="/learn"
            className="inline-flex items-center gap-2 text-surface-400 hover:text-primary-400 transition-colors group"
          >
            <span>Learn about the science</span>
            <svg 
              className="w-4 h-4 group-hover:translate-x-1 transition-transform" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>

        {/* Feature highlights - Row 1 */}
        <div className="mt-16 sm:mt-20 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 max-w-5xl animate-slide-up px-2" style={{ animationDelay: '0.2s' }}>
          <FeatureCard
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
            title="Volume Tracking"
            description="Monitor sets per muscle group against your MEV, MAV, and MRV landmarks"
          />
          <FeatureCard
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
            title="Auto Progression"
            description="Intelligent weight and rep recommendations based on your performance"
          />
          <FeatureCard
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            }
            title="Fatigue Management"
            description="Pre-workout readiness checks and smart deload recommendations"
          />
        </div>
        
        {/* Feature highlights - Row 2 */}
        <div className="mt-4 sm:mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 max-w-5xl animate-slide-up px-2" style={{ animationDelay: '0.25s' }}>
          <FeatureCard
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            }
            title="AI Coaching"
            description="Get personalized workout advice from AI that knows your history and goals"
            accent
          />
          <FeatureCard
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            }
            title="Nutrition & Macros"
            description="Track food with USDA database, smart macro calculator, and auto-updating targets"
            accent
          />
          <FeatureCard
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            }
            title="S-Tier Exercises"
            description="Every exercise rated for hypertrophy effectiveness—only the best make the cut"
            accent
          />
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ 
  icon, 
  title, 
  description,
  accent = false,
}: { 
  icon: React.ReactNode; 
  title: string; 
  description: string;
  accent?: boolean;
}) {
  return (
    <div className={`card p-6 transition-colors group ${
      accent 
        ? 'border-primary-500/30 bg-gradient-to-br from-primary-500/5 to-transparent hover:border-primary-500/50' 
        : 'hover:border-surface-700'
    }`}>
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 transition-colors ${
        accent
          ? 'bg-primary-500/20 text-primary-400 group-hover:bg-primary-500/30'
          : 'bg-surface-800 text-primary-400 group-hover:bg-primary-500/10'
      }`}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-surface-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

