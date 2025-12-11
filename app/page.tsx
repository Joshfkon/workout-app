import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
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
            Science-based hypertrophy training with intelligent auto-regulation.
            Track volume, manage fatigue, and optimize your gains.
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

        {/* Feature highlights */}
        <div className="mt-16 sm:mt-20 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 max-w-4xl animate-slide-up px-2" style={{ animationDelay: '0.2s' }}>
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
      </div>
    </div>
  );
}

function FeatureCard({ 
  icon, 
  title, 
  description 
}: { 
  icon: React.ReactNode; 
  title: string; 
  description: string;
}) {
  return (
    <div className="card p-6 hover:border-surface-700 transition-colors group">
      <div className="w-12 h-12 rounded-lg bg-surface-800 flex items-center justify-center text-primary-400 mb-4 group-hover:bg-primary-500/10 transition-colors">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-surface-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

