'use client';

import { useState, useCallback } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { createUntypedClient } from '@/lib/supabase/client';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { cn } from '@/lib/utils';
import {
  MODERATION_CONTACT_EMAIL,
  REPORT_NOTE_MAX_LENGTH,
  REPORT_REASONS,
  submitContentReport,
  type ReportReason,
  type ReportTargetType,
} from '@/lib/moderation';

const TARGET_LABEL: Record<ReportTargetType, string> = {
  activity: 'post',
  comment: 'comment',
  profile: 'profile',
  shared_workout: 'workout',
};

export interface ContentActionsMenuProps {
  targetType: ReportTargetType;
  targetId: string;
  /** Author of the content (the user that "Block" applies to). */
  targetUserId: string;
  /** Shown in the block confirmation, e.g. the author's username. */
  targetUsername?: string | null;
  className?: string;
  onBlocked?: () => void;
  onReported?: () => void;
}

type Step = 'menu' | 'report' | 'reported' | 'confirm-block' | 'blocked';

/**
 * "..." menu offering Report and Block for a piece of user-generated content.
 * Renders nothing for signed-out users and for the user's own content.
 */
export function ContentActionsMenu({
  targetType,
  targetId,
  targetUserId,
  targetUsername,
  className,
  onBlocked,
  onReported,
}: ContentActionsMenuProps) {
  const { currentUserId, isBlocked, blockUser, unblockUser } = useBlockedUsers();
  const [step, setStep] = useState<Step | null>(null);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = TARGET_LABEL[targetType];
  const who = targetUsername ? `@${targetUsername}` : 'this user';
  const alreadyBlocked = isBlocked(targetUserId);

  const close = useCallback(() => {
    const finishedStep = step;
    setStep(null);
    setReason('');
    setNote('');
    setError(null);
    if (finishedStep === 'blocked') onBlocked?.();
  }, [step, onBlocked]);

  const handleReport = useCallback(async () => {
    if (!currentUserId || !reason) {
      setError('Please choose a reason');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const result = await submitContentReport(createUntypedClient(), {
      reporterId: currentUserId,
      targetType,
      targetId,
      targetUserId,
      reason,
      note,
    });
    setIsSubmitting(false);
    if (result.success) {
      setStep('reported');
      onReported?.();
    } else {
      setError(result.error);
    }
  }, [currentUserId, reason, note, targetType, targetId, targetUserId, onReported]);

  const handleBlock = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    const result = await blockUser(targetUserId);
    setIsSubmitting(false);
    if (result.success) {
      setStep('blocked');
    } else {
      setError(result.error);
    }
  }, [blockUser, targetUserId]);

  const handleUnblock = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    const result = await unblockUser(targetUserId);
    setIsSubmitting(false);
    if (result.success) {
      setStep(null);
    } else {
      setError(result.error);
    }
  }, [unblockUser, targetUserId]);

  if (!currentUserId || currentUserId === targetUserId) return null;

  const title =
    step === 'report'
      ? `Report ${label}`
      : step === 'reported'
        ? 'Report received'
        : step === 'confirm-block'
          ? `Block ${who}?`
          : step === 'blocked'
            ? `Blocked ${who}`
            : 'Options';

  return (
    <>
      <button
        type="button"
        aria-label={`More options for this ${label}`}
        onClick={() => setStep('menu')}
        className={cn(
          'shrink-0 p-1.5 -m-1.5 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors',
          className
        )}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>

      <Modal isOpen={step !== null} onClose={close} title={title} size="sm">
        {step === 'menu' && (
          <div className="space-y-2">
            <Button variant="secondary" className="w-full" onClick={() => setStep('report')}>
              Report {label}
            </Button>
            {alreadyBlocked ? (
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleUnblock}
                isLoading={isSubmitting}
              >
                Unblock {who}
              </Button>
            ) : (
              <Button variant="danger" className="w-full" onClick={() => setStep('confirm-block')}>
                Block {who}
              </Button>
            )}
            {error && <p className="text-sm text-error-400">{error}</p>}
          </div>
        )}

        {step === 'report' && (
          <div className="space-y-4">
            <Select
              label="Why are you reporting this?"
              placeholder="Choose a reason"
              options={REPORT_REASONS}
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
            />
            <div>
              <label htmlFor={`report-note-${targetId}`} className="block text-sm font-medium text-surface-200 mb-1.5">
                Details (optional)
              </label>
              <textarea
                id={`report-note-${targetId}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={REPORT_NOTE_MAX_LENGTH}
                rows={3}
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Anything that helps us review this"
              />
            </div>
            {error && <p className="text-sm text-error-400">{error}</p>}
            <p className="text-xs text-surface-400">
              Reports are reviewed within 24 hours. Content that breaks our rules is removed and the
              account behind it may be suspended.
            </p>
            <ModalFooter>
              <Button variant="secondary" onClick={close} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleReport} isLoading={isSubmitting} disabled={!reason}>
                Submit report
              </Button>
            </ModalFooter>
          </div>
        )}

        {step === 'reported' && (
          <div className="space-y-4">
            <p className="text-sm text-surface-300">
              Thanks. We review reports within 24 hours. You can also reach us at{' '}
              <a href={`mailto:${MODERATION_CONTACT_EMAIL}`} className="text-primary-400 hover:underline">
                {MODERATION_CONTACT_EMAIL}
              </a>
              .
            </p>
            {error && <p className="text-sm text-error-400">{error}</p>}
            <ModalFooter>
              {!alreadyBlocked && (
                <Button variant="danger" onClick={handleBlock} isLoading={isSubmitting}>
                  Block {who}
                </Button>
              )}
              <Button variant="secondary" onClick={close} disabled={isSubmitting}>
                Done
              </Button>
            </ModalFooter>
          </div>
        )}

        {step === 'confirm-block' && (
          <div className="space-y-4">
            <p className="text-sm text-surface-300">
              You will no longer see their posts, comments, profile or shared workouts, and you will
              stop following each other. They are not told that you blocked them.
            </p>
            {error && <p className="text-sm text-error-400">{error}</p>}
            <ModalFooter>
              <Button variant="secondary" onClick={close} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleBlock} isLoading={isSubmitting}>
                Block
              </Button>
            </ModalFooter>
          </div>
        )}

        {step === 'blocked' && (
          <div className="space-y-4">
            <p className="text-sm text-surface-300">
              You won&apos;t see content from {who} any more. You can unblock them from their profile.
            </p>
            <ModalFooter>
              <Button variant="primary" onClick={close}>
                Done
              </Button>
            </ModalFooter>
          </div>
        )}
      </Modal>
    </>
  );
}
