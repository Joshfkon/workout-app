'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Toggle, Button } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useEducationStore } from '@/hooks/useEducationPreferences';
import type { Experience } from '@/types/schema';

const EXPERIENCE_LEVEL_INFO = {
  novice: {
    label: 'Beginner',
    sublabel: 'New to training (< 1 year)',
    description: 'More guidance, detailed explanations, and conservative recommendations',
    features: [
      'Extra tooltips and hints throughout the app',
      'Simpler exercise selections',
      'Lower starting volume (easier to recover)',
      'More detailed form cues',
    ],
  },
  intermediate: {
    label: 'Intermediate',
    sublabel: '1-3 years of training',
    description: 'Balanced guidance with room to customize',
    features: [
      'Standard tooltips for complex terms',
      'Full exercise library access',
      'Moderate volume recommendations',
      'Optional form cues',
    ],
  },
  advanced: {
    label: 'Advanced',
    sublabel: '3+ years of training',
    description: 'Minimal hand-holding, maximum flexibility',
    features: [
      'Concise interface with fewer prompts',
      'Advanced exercise variations',
      'Higher volume capacity',
      'You know what you\'re doing',
    ],
  },
} as const;

export function EducationPreferencesCard() {
  const {
    showBeginnerTips,
    explainScienceTerms,
    dismissedHints,
    setShowBeginnerTips,
    setExplainScienceTerms,
    resetAllHints,
  } = useEducationStore();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [localExperience, setLocalExperience] = useState<Experience | null>(null);
  const [isLoadingExperience, setIsLoadingExperience] = useState(true);
  const [showExperienceDetails, setShowExperienceDetails] = useState(false);

  // Load experience level on mount
  useEffect(() => {
    async function loadExperience() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('users')
          .select('experience')
          .eq('id', user.id)
          .single();
        if (data?.experience) {
          setLocalExperience(data.experience as Experience);
        }
      }
      setIsLoadingExperience(false);
    }
    loadExperience();
  }, []);

  // Save experience level when changed
  const handleExperienceChange = async (newExperience: Experience) => {
    setLocalExperience(newExperience);
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('users')
        .update({ experience: newExperience })
        .eq('id', user.id);
    }
  };

  const handleResetHints = () => {
    resetAllHints();
    setShowResetConfirm(false);
  };

  const currentExperienceInfo = localExperience ? EXPERIENCE_LEVEL_INFO[localExperience] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Education & Tips
        </CardTitle>
        <p className="text-sm text-surface-400 mt-1">
          Control how the app explains features and terminology
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Experience Level Selection */}
        <div className="p-4 bg-surface-800/50 rounded-lg border border-surface-700">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-surface-200">Training Experience</p>
              <p className="text-xs text-surface-500">Adjusts guidance level throughout the app</p>
            </div>
            <button
              onClick={() => setShowExperienceDetails(!showExperienceDetails)}
              className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"
            >
              {showExperienceDetails ? 'Hide' : 'What changes?'}
              <svg
                className={`w-3 h-3 transition-transform ${showExperienceDetails ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {isLoadingExperience ? (
            <div className="h-12 bg-surface-700/50 rounded-lg animate-pulse" />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {(['novice', 'intermediate', 'advanced'] as Experience[]).map((level) => {
                const info = EXPERIENCE_LEVEL_INFO[level];
                const isSelected = localExperience === level;
                return (
                  <button
                    key={level}
                    onClick={() => handleExperienceChange(level)}
                    className={`p-3 rounded-lg text-center transition-all ${
                      isSelected
                        ? 'bg-primary-500/20 border-2 border-primary-500'
                        : 'bg-surface-700/50 border border-surface-600 hover:border-surface-500'
                    }`}
                  >
                    <p className={`text-sm font-medium ${isSelected ? 'text-primary-400' : 'text-surface-200'}`}>
                      {info.label}
                    </p>
                    <p className="text-xs text-surface-500 mt-0.5">{info.sublabel}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Expandable details about what changes */}
          {showExperienceDetails && currentExperienceInfo && (
            <div className="mt-4 pt-4 border-t border-surface-700">
              <p className="text-sm text-surface-300 mb-2">{currentExperienceInfo.description}</p>
              <ul className="space-y-1.5">
                {currentExperienceInfo.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-surface-400">
                    <svg className="w-3.5 h-3.5 text-primary-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-surface-200">Show Beginner Tips</p>
            <p className="text-xs text-surface-500">Display helpful hints when you first use features</p>
          </div>
          <Toggle
            checked={showBeginnerTips}
            onChange={setShowBeginnerTips}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-surface-200">Explain Science Terms</p>
            <p className="text-xs text-surface-500">Show tooltips for terms like MEV, RIR, FFMI, etc.</p>
          </div>
          <Toggle
            checked={explainScienceTerms}
            onChange={setExplainScienceTerms}
          />
        </div>

        {dismissedHints.length > 0 && (
          <div className="pt-4 border-t border-surface-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-200">Reset Tips</p>
                <p className="text-xs text-surface-500">
                  You&apos;ve dismissed {dismissedHints.length} tips. Reset to see them again.
                </p>
              </div>
              {showResetConfirm ? (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowResetConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleResetHints}
                  >
                    Reset
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowResetConfirm(true)}
                >
                  Reset Tips
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Glossary Link */}
        <div className="pt-4 border-t border-surface-700">
          <Link
            href="/dashboard/glossary"
            className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg hover:bg-surface-700/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-surface-200">Training Glossary</p>
                <p className="text-xs text-surface-500">Look up any training term or concept</p>
              </div>
            </div>
            <svg
              className="w-5 h-5 text-surface-500 group-hover:text-primary-400 transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        <div className="p-3 bg-surface-800/50 rounded-lg">
          <p className="text-xs text-surface-400">
            <span className="text-primary-400">Tip:</span> You can always learn more about training concepts
            in the <Link href="/dashboard/learn" className="text-primary-400 hover:underline">Learn Hub</Link>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
