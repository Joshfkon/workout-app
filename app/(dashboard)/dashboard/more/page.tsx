'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { ListGroup, ListRow } from '@/components/ui/ListRow';
import type { Icon as TablerIcon } from '@tabler/icons-react';
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
      { name: 'Profile', href: '/dashboard/profile', icon: IconUser },
      { name: 'Blood pressure', href: '/dashboard/blood-pressure', icon: IconHeartbeat },
    ],
  },
  {
    title: 'Training',
    links: [
      { name: 'AI coach', href: '/dashboard/ai-coach', icon: IconSparkles },
      { name: 'Templates', href: '/dashboard/templates', icon: IconTemplate },
    ],
  },
  {
    title: 'Community',
    links: [
      { name: 'Social feed', href: '/dashboard/feed', icon: IconUsers },
      { name: 'Discover workouts', href: '/dashboard/discover', icon: IconCompass },
      { name: 'Leaderboards', href: '/dashboard/leaderboards', icon: IconTrophy },
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

export default function MorePage() {
  useDocumentTitle('More');
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-large-title text-ink">More</h1>

      {moreSections.map((section) => (
        <ListGroup key={section.title} title={section.title}>
          {section.links.map((link) => {
            const Icon = link.icon;
            return (
              <ListRow
                key={link.name}
                href={link.href}
                title={link.name}
                icon={<Icon size={18} stroke={2} />}
              />
            );
          })}
        </ListGroup>
      ))}
    </div>
  );
}
