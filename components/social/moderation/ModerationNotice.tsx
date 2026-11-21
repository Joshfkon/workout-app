import { cn } from '@/lib/utils';
import { MODERATION_CONTACT_EMAIL } from '@/lib/moderation';

/**
 * Visible moderation / contact line for surfaces that show user-generated
 * content (App Store guideline 1.2).
 */
export function ModerationNotice({ className }: { className?: string }) {
  return (
    <p className={cn('text-caption text-ink-2 text-center', className)}>
      See something that shouldn&apos;t be here? Use the &ldquo;&hellip;&rdquo; menu to report or
      block, or email{' '}
      <a href={`mailto:${MODERATION_CONTACT_EMAIL}`} className="text-action hover:underline">
        {MODERATION_CONTACT_EMAIL}
      </a>
      . Reports are reviewed within 24 hours.
    </p>
  );
}
