'use client';

import { IconBarbell, IconCircleCheck } from '@tabler/icons-react';
import { useState, memo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { RIR_EXPLANATIONS, type RIRExplanation } from '@/types/education';
import { Button } from '@/components/ui';

export interface RPEExplainerProps {
  /** Called when user completes the explainer */
  onComplete: () => void;

  /** Called when user wants to skip */
  onSkip?: () => void;

  /** Whether to show as a modal or inline */
  variant?: 'modal' | 'inline';

  /** Custom class name */
  className?: string;
}

export const RPEExplainer = memo(function RPEExplainer({
  onComplete,
  onSkip,
  variant = 'inline',
  className,
}: RPEExplainerProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  const steps = [
    { type: 'intro' as const },
    { type: 'learn' as const, index: 0 }, // 4+ Easy
    { type: 'learn' as const, index: 1 }, // 2-3 Good
    { type: 'learn' as const, index: 2 }, // 1 Hard
    { type: 'learn' as const, index: 3 }, // 0 Max
    { type: 'quiz' as const },
    { type: 'complete' as const },
  ];

  const currentStepData = steps[currentStep];

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
      setSelectedAnswer(null);
      setShowFeedback(false);
    } else {
      onComplete();
    }
  }, [currentStep, steps.length, onComplete]);

  const handleQuizAnswer = useCallback((answer: number) => {
    setSelectedAnswer(answer);
    setShowFeedback(true);
  }, []);

  const renderIntro = () => (
    <div className="text-center space-y-4">
      <IconBarbell size={40} className="mx-auto mb-4 text-action" aria-hidden="true" />
      <h3 className="text-title font-bold text-ink">
        Understanding effort levels
      </h3>
      <p className="text-ink-2">
        To help us track your progress and recommend the right weights, we need to know how hard each set felt.
      </p>
      <p className="text-ink-2 text-body">
        This uses something called <span className="text-action">RIR</span> (Reps In Reserve) -
        simply put, how many more reps could you have done?
      </p>
    </div>
  );

  const renderLearnStep = (explanation: RIRExplanation) => (
    <div className="space-y-4">
      {/* RIR indicator */}
      <div className="flex items-center justify-center gap-4">
        <div
          className={cn(
            'w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold',
            'bg-fill border-2',
            explanation.color.replace('text-', 'border-')
          )}
        >
          {explanation.rir === 4 ? '4+' : explanation.rir}
        </div>
      </div>

      {/* Label */}
      <div className="text-center">
        <h3 className={cn('text-title font-bold', explanation.color)}>
          {explanation.label}
        </h3>
        <p className="text-ink-2 text-body">
          {explanation.shortDesc}
        </p>
      </div>

      {/* Description */}
      <div className="bg-fill/50 rounded-lg p-4 space-y-3">
        <p className="text-ink">{explanation.longDesc}</p>
        <div className="border-t border-sep pt-3">
          <p className="text-body text-ink-2 italic">
            &ldquo;{explanation.example}&rdquo;
          </p>
        </div>
      </div>

      {/* Visual scale */}
      <div className="pt-2">
        <div className="flex justify-between text-caption text-ink-3 mb-1">
          <span>Easy</span>
          <span>Maximum</span>
        </div>
        <div className="h-2 bg-fill rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              explanation.rir === 4 && 'w-1/4 bg-status-bad',
              explanation.rir === 2 && 'w-2/4 bg-status-ok',
              explanation.rir === 1 && 'w-3/4 bg-status-warn',
              explanation.rir === 0 && 'w-full bg-status-bad'
            )}
          />
        </div>
      </div>
    </div>
  );

  const renderQuiz = () => {
    const correctAnswer = 2; // "2-3 Good" is the right answer for typical training
    const isCorrect = selectedAnswer === correctAnswer;

    return (
      <div className="space-y-4">
        <div className="text-center">
          <h3 className="text-title font-bold text-ink mb-2">
            Quick check
          </h3>
          <p className="text-ink-2">
            For most of your training sets, which effort level should you aim for?
          </p>
        </div>

        <div className="space-y-2">
          {RIR_EXPLANATIONS.map((exp, index) => (
            <button
              key={exp.rir}
              onClick={() => handleQuizAnswer(index)}
              disabled={showFeedback}
              className={cn(
                'w-full p-3 rounded-lg text-left transition-all',
                'border',
                selectedAnswer === index
                  ? showFeedback
                    ? index === correctAnswer
                      ? 'bg-status-ok-tint border-status-ok'
                      : 'bg-status-bad-tint border-status-bad'
                    : 'bg-action/15 border-action'
                  : 'bg-fill/50 border-sep hover:border-sep',
                showFeedback && index === correctAnswer && 'bg-status-ok-tint border-status-ok'
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn('font-semibold', exp.color)}>
                  {exp.label}
                </span>
                <span className="text-ink-2 text-body">
                  - {exp.shortDesc}
                </span>
              </div>
            </button>
          ))}
        </div>

        {showFeedback && (
          <div
            className={cn(
              'p-4 rounded-lg',
              isCorrect ? 'bg-status-ok-tint' : 'bg-fill'
            )}
          >
            {isCorrect ? (
              <p className="text-status-ok">
                <span className="font-semibold">Correct!</span> Training at RIR 2 or 3 gives you the best balance of stimulus and recovery.
                This is the &ldquo;sweet spot&rdquo; for muscle growth.
              </p>
            ) : (
              <p className="text-ink-2">
                <span className="font-semibold text-status-warn">Almost!</span> While that effort level has its place,
                most training should be at <span className="text-status-warn">RIR 2 or 3 (good)</span> for optimal results.
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderComplete = () => (
    <div className="text-center space-y-4">
      <IconCircleCheck size={40} className="mx-auto mb-4 text-status-ok" aria-hidden="true" />
      <h3 className="text-title font-bold text-ink">
        You&apos;re Ready!
      </h3>
      <p className="text-ink-2">
        Now you know how to rate your effort. During calibration, we&apos;ll ask how hard each set felt
        so we can calculate the right weights for you.
      </p>
      <div className="bg-fill/50 rounded-lg p-4">
        <p className="text-body text-ink-2">
          <span className="text-action">Pro tip:</span> Don&apos;t overthink it!
          Just ask yourself: &ldquo;How many more reps could I have done?&rdquo;
        </p>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (currentStepData.type) {
      case 'intro':
        return renderIntro();
      case 'learn':
        return renderLearnStep(RIR_EXPLANATIONS[currentStepData.index]);
      case 'quiz':
        return renderQuiz();
      case 'complete':
        return renderComplete();
      default:
        return null;
    }
  };

  const canProceed = currentStepData.type !== 'quiz' || showFeedback;

  return (
    <div
      className={cn(
        variant === 'modal' && 'p-6 bg-card rounded-xl border border-sep',
        className
      )}
    >
      {/* Progress indicator */}
      <div className="flex gap-1 mb-6">
        {steps.map((_, index) => (
          <div
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              index <= currentStep ? 'bg-action' : 'bg-sep'
            )}
          />
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[280px]">
        {renderContent()}
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center mt-6 pt-4 border-t border-sep">
        {onSkip && currentStep < steps.length - 1 ? (
          <button
            onClick={onSkip}
            className="text-body text-ink-2 hover:text-ink transition-colors"
          >
            Skip tutorial
          </button>
        ) : (
          <div />
        )}

        <Button
          onClick={handleNext}
          disabled={!canProceed}
          className="min-w-[100px]"
        >
          {currentStep === steps.length - 1 ? "Let's Go!" : 'Next'}
        </Button>
      </div>
    </div>
  );
});

RPEExplainer.displayName = 'RPEExplainer';

/**
 * Compact version for inline reference
 */
export const RPEQuickReference = memo(function RPEQuickReference({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <h4 className="text-body font-medium text-ink-2">Effort guide</h4>
      <div className="grid grid-cols-2 gap-2">
        {RIR_EXPLANATIONS.map((exp) => (
          <div
            key={exp.rir}
            className="flex items-center gap-2 p-2 bg-fill/50 rounded text-body"
          >
            <span className={cn('font-semibold', exp.color)}>
              {exp.rir === 4 ? '4+' : exp.rir}
            </span>
            <span className="text-ink-2">{exp.shortDesc}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

RPEQuickReference.displayName = 'RPEQuickReference';
