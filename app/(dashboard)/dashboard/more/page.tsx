'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { usePrefetchSettings } from '@/hooks/useSettingsQuery';

import { ListGroup, ListRow } from '@/components/ui/ListRow';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import { ProTag } from '@/components/subscription/ProTag';
import type { Feature } from '@/lib/subscription';
import { SOCIAL_FEATURES_ENABLED } from '@/lib/socialFeatures';
import {
  IconUsers,
  IconUser,
  IconCompass,
  IconTrophy,
  IconCreditCard,
  IconSparkles,
  IconTemplate,
  IconBook,
  IconVocabulary,
  IconFlask,
  IconHeartbeat,
  IconSettings,
} from '@tabler/icons-react';

interface MoreLink {
  name: string;
  href: string;
  icon: TablerIcon;
  /** Paid feature the page opens (labelled with ProTag; gating unchanged). */
  feature?: Feature;
  /** Community feature — hidden while SOCIAL_FEATURES_ENABLED is false. */
  social?: boolean;
}

interface MoreSection {
  title: string;
  links: MoreLink[];
}

// Every route verified to exist under app/(dashboard)/dashboard/
// P1-9: Profile, Discover, Leaderboards, and Plans were reachable only by
// typing the URL — they now have a nav path.
const moreSections: MoreSection[] = [
  {
    title: 'You',
    links: [
      { name: 'Profile', href: '/dashboard/profile', icon: IconUser, social: true },
      { name: 'Blood pressure', href: '/dashboard/blood-pressure', icon: IconHeartbeat },
    ],
  },
  {
    title: 'Training',
    links: [
      { name: 'AI coach', href: '/dashboard/ai-coach', icon: IconSparkles, feature: 'ai-coaching' },
      { name: 'Templates', href: '/dashboard/templates', icon: IconTemplate },
    ],
  },
  {
    title: 'Community',
    links: [
      { name: 'Social feed', href: '/dashboard/feed', icon: IconUsers, social: true },
      { name: 'Discover workouts', href: '/dashboard/discover', icon: IconCompass, social: true },
      { name: 'Leaderboards', href: '/dashboard/leaderboards', icon: IconTrophy, social: true },
    ],
  },
  {
    title: 'Reference',
    links: [
      { name: 'Learn', href: '/dashboard/learn', icon: IconBook },
      { name: 'Glossary', href: '/dashboard/glossary', icon: IconVocabulary },
      { name: 'Science', href: '/dashboard/science', icon: IconFlask },
    ],
  },
  {
    title: 'Account',
    links: [
      { name: 'Plans & billing', href: '/dashboard/pricing', icon: IconCreditCard },
      { name: 'Settings', href: '/dashboard/settings', icon: IconSettings },
    ],
  },
];

// Sections with their social links dropped (and any section left empty).
const visibleSections: MoreSection[] = moreSections
  .map((section) => ({
    ...section,
    links: section.links.filter((link) => SOCIAL_FEATURES_ENABLED || !link.social),
  }))
  .filter((section) => section.links.length > 0);

export default function MorePage() {
  useDocumentTitle('More');
  // Settings is a row on this page: warm it so it opens without a wait.
  usePrefetchSettings(true, 300);
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-large-title text-ink">More</h1>

      {visibleSections.map((section) => (
        <ListGroup key={section.title} title={section.title}>
          {section.links.map((link) => {
            const Icon = link.icon;
            return (
              <ListRow
                key={link.name}
                href={link.href}
                title={
                  link.feature ? (
                    <span className="inline-flex items-center gap-2">
                      {link.name}
                      <ProTag feature={link.feature} />
                    </span>
                  ) : (
                    link.name
                  )
                }
                icon={<Icon size={18} stroke={2} />}
              />
            );
          })}
        </ListGroup>
      ))}
    </div>
  );
}
