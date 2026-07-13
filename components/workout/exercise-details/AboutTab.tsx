'use client';

import { useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/Accordion';
import type { Exercise } from '@/types/schema';
import { completeSingleExercise } from '@/lib/actions/exercise-completion';
import { parseYouTubeVideoId } from '@/lib/youtube';
import { shouldCollapseGuides } from '@/services/exerciseDetailAnalytics';
import { YouTubeEmbed } from '../YouTubeEmbed';
import { MuscleWikiVideo } from '../MuscleWikiVideo';
import { MuscleMap } from '@/components/muscleMap/MuscleMap';
import { exerciseHighlightData } from '@/lib/muscleMap/adapters';
import { getExerciseProp } from './helpers';

interface AboutTabProps {
  exercise: Exercise;
  /** Logged-session count; >= 5 collapses the how-to sections to reference. */
  sessionCount: number;
}

function RatingBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-surface-400 mb-1">{label}</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <div
            key={level}
            className={`flex-1 h-2 rounded ${level <= value ? 'bg-primary-500' : 'bg-surface-700'}`}
          />
        ))}
      </div>
      <p className="text-xs text-surface-500 mt-1">{value}/5</p>
    </div>
  );
}

function HypertrophyBlock({ score }: { score: any }) {
  if (!score) return null;
  return (
    <div className="p-4 bg-surface-800/50 rounded-lg">
      <p className="text-sm font-medium text-surface-200 mb-3">Hypertrophy Effectiveness</p>
      <div className="grid grid-cols-3 gap-4">
        <RatingBar label="Stretch" value={score.stretchUnderLoad ?? score.stretch_under_load ?? 0} />
        <RatingBar label="Resistance" value={score.resistanceProfile ?? score.resistance_profile ?? 0} />
        <RatingBar label="Progression" value={score.progressionEase ?? score.progression_ease ?? 0} />
      </div>
      <p className="text-xs text-surface-600 mt-3">
        Based on Jeff Nippard&apos;s evidence-based exercise rankings
      </p>
    </div>
  );
}

interface GuideSectionsProps {
  exerciseId: string;
  formCues: string[];
  commonMistakes: string[];
  setupNote: string | null;
  notes: string | null;
  /** Start with everything collapsed (user knows the lift). */
  collapsed: boolean;
}

/** Form cues / mistakes / setup / notes as collapsible reference sections. */
function GuideSections({ exerciseId, formCues, commonMistakes, setupNote, notes, collapsed }: GuideSectionsProps) {
  const sections: { id: string; title: string; body: React.ReactNode }[] = [];

  if (formCues.length > 0) {
    sections.push({
      id: 'form-cues',
      title: 'Form Cues',
      body: (
        <ul className="space-y-2">
          {formCues.map((cue, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-surface-300">
              <span className="text-primary-400 mt-0.5">•</span>
              <span>{cue}</span>
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (commonMistakes.length > 0) {
    sections.push({
      id: 'mistakes',
      title: 'Common Mistakes',
      body: (
        <ul className="space-y-2">
          {commonMistakes.map((mistake, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-danger-400/80">
              <span className="mt-0.5">✗</span>
              <span>{mistake}</span>
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (setupNote) {
    sections.push({
      id: 'setup',
      title: 'Setup Instructions',
      body: <p className="text-sm text-surface-300">{setupNote}</p>,
    });
  }
  if (notes) {
    sections.push({
      id: 'notes',
      title: 'Notes',
      body: <p className="text-sm text-surface-300">{notes}</p>,
    });
  }

  if (sections.length === 0) return null;

  return (
    // Keyed so the default open/collapsed state re-resolves if the session
    // count crosses the threshold while the sheet is open.
    <Accordion
      key={`${exerciseId}-${collapsed}`}
      type="multiple"
      defaultOpen={collapsed ? [] : sections.map((s) => s.id)}
    >
      {sections.map((section) => (
        <AccordionItem key={section.id} id={section.id}>
          <AccordionTrigger id={section.id} className="text-sm">{section.title}</AccordionTrigger>
          <AccordionContent id={section.id}>{section.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function CompleteWithAIButton({ exerciseId }: { exerciseId: string }) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleClick = async () => {
    setIsCompleting(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await completeSingleExercise(exerciseId);
      if (result.success && result.updated) {
        setSuccess(true);
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else if (result.limitReached) {
        setError(result.error || 'AI limit reached. Please try again tomorrow.');
      } else {
        setError(result.error || 'Failed to complete exercise with AI');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsCompleting(false);
    }
  };

  if (success) {
    return (
      <div className="p-3 bg-success-900/30 border border-success-700 rounded-lg">
        <p className="text-sm text-success-400 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Exercise completed successfully! Refreshing...
        </p>
      </div>
    );
  }

  return (
    <>
      <Button variant="primary" onClick={handleClick} disabled={isCompleting} className="w-full">
        {isCompleting ? (
          <>
            <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Completing with AI...
          </>
        ) : (
          <>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
            Complete Fields with AI
          </>
        )}
      </Button>
      {error && (
        <div className="p-3 bg-danger-900/30 border border-danger-700 rounded-lg">
          <p className="text-sm text-danger-400">{error}</p>
        </div>
      )}
    </>
  );
}

interface MusclesWorkedProps {
  primaryMuscle: string | null;
  secondaryMuscles: string[];
  repRange: number[];
}

/**
 * Highlight body map (primary full accent, secondaries dimmed), with the
 * chips as the accessible text representation and the default rep range on
 * the same row.
 */
function MusclesWorked({ primaryMuscle, secondaryMuscles, repRange }: MusclesWorkedProps) {
  if (!primaryMuscle && secondaryMuscles.length === 0 && repRange.length < 2) return null;

  return (
    <div>
      {(primaryMuscle || secondaryMuscles.length > 0) && (
        <>
          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
            Muscles Worked
          </p>
          <MuscleMap
            data={exerciseHighlightData(primaryMuscle, secondaryMuscles)}
            mode="highlight"
            view="both"
            className="h-40 mb-2"
            data-testid="exercise-muscle-map"
          />
        </>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1">
          {primaryMuscle && (
            <Badge variant="info" size="sm">
              {String(primaryMuscle).replace(/_/g, ' ')}
            </Badge>
          )}
          {secondaryMuscles.map((muscle, idx) => (
            <Badge key={idx} variant="default" size="sm">
              {String(muscle).replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
        {repRange.length >= 2 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-surface-500 uppercase tracking-wider">Rep range</span>
            <span className="text-sm text-surface-200">{repRange[0]}-{repRange[1]}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function exerciseHasMissingFields(exercise: Exercise, hasFormCues: boolean, hasTier: boolean): boolean {
  const stabilizers = getExerciseProp(exercise, 'stabilizers', 'stabilizers');
  const hasStabilizers = Array.isArray(stabilizers) && stabilizers.length > 0;
  const hasSpinalLoading = !!getExerciseProp(exercise, 'spinalLoading', 'spinal_loading');
  const contraindications = getExerciseProp(exercise, 'contraindications', 'contraindications');
  const hasContraindications = Array.isArray(contraindications) && contraindications.length > 0;
  return !hasFormCues || !hasTier || !hasStabilizers || !hasSpinalLoading || !hasContraindications;
}

export function AboutTab({ exercise, sessionCount }: AboutTabProps) {
  const demoGifUrl = getExerciseProp(exercise, 'demoGifUrl', 'demo_gif_url');
  const youtubeVideoId = getExerciseProp(exercise, 'youtubeVideoId', 'youtube_video_id');
  const hypertrophyScore = getExerciseProp(exercise, 'hypertrophyScore', 'hypertrophy_score');
  const primaryMuscle = getExerciseProp(exercise, 'primaryMuscle', 'primary_muscle');
  const secondaryMusclesRaw = getExerciseProp(exercise, 'secondaryMuscles', 'secondary_muscles');
  const repRangeRaw = getExerciseProp(exercise, 'defaultRepRange', 'default_rep_range');
  const formCuesRaw = getExerciseProp(exercise, 'formCues', 'form_cues');
  const mistakesRaw = getExerciseProp(exercise, 'commonMistakes', 'common_mistakes');
  const setupNote = getExerciseProp(exercise, 'setupNote', 'setup_note') || null;
  const notes = getExerciseProp(exercise, 'notes', 'notes') || null;

  const secondaryMuscles: string[] = Array.isArray(secondaryMusclesRaw) ? secondaryMusclesRaw : [];
  const repRange: number[] = Array.isArray(repRangeRaw) ? repRangeRaw : [];
  const formCues: string[] = Array.isArray(formCuesRaw) ? formCuesRaw : [];
  const commonMistakes: string[] = Array.isArray(mistakesRaw) ? mistakesRaw : [];

  const videoId = youtubeVideoId ? parseYouTubeVideoId(youtubeVideoId) : null;
  const muscleWikiDemo = demoGifUrl ? (
    <MuscleWikiVideo src={demoGifUrl} name={exercise.name} />
  ) : null;

  return (
    <div className="space-y-5" data-testid="exercise-detail-about">
      {/* Demo video */}
      {(videoId || muscleWikiDemo) && (
        <div>
          {videoId ? (
            <YouTubeEmbed
              videoId={videoId}
              title={`${exercise.name} form video`}
              fallback={muscleWikiDemo}
            />
          ) : (
            muscleWikiDemo
          )}
        </div>
      )}

      <HypertrophyBlock score={hypertrophyScore} />

      <MusclesWorked
        primaryMuscle={primaryMuscle || null}
        secondaryMuscles={secondaryMuscles}
        repRange={repRange}
      />

      {/* How-to sections: collapsed once the user knows the lift */}
      <GuideSections
        exerciseId={exercise.id}
        formCues={formCues}
        commonMistakes={commonMistakes}
        setupNote={setupNote}
        notes={notes}
        collapsed={shouldCollapseGuides(sessionCount)}
      />

      {/* Reference-data actions live on About only */}
      <div className="space-y-2 pt-2 border-t border-surface-800">
        {exerciseHasMissingFields(exercise, formCues.length > 0, !!hypertrophyScore?.tier) && (
          <CompleteWithAIButton exerciseId={exercise.id} />
        )}
        <a
          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' exercise form')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg text-sm text-surface-300 transition-colors"
        >
          <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
          {videoId ? 'More Videos' : 'Find Videos'}
        </a>
      </div>
    </div>
  );
}
