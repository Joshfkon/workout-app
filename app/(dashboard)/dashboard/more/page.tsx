'use client';

import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconUsers,
  IconSparkles,
  IconTemplate,
  IconBook,
  IconVocabulary,
  IconFlask,
  IconSettings,
  IconChevronRight,
} from '@tabler/icons-react';

interface MoreLink {
  name: string;
  href: string;
  icon: TablerIcon;
}

// Every route verified to exist under app/(dashboard)/dashboard/
const moreLinks: MoreLink[] = [
  { name: 'Social Feed', href: '/dashboard/feed', icon: IconUsers },
  { name: 'AI Coach', href: '/dashboard/ai-coach', icon: IconSparkles },
  { name: 'Templates', href: '/dashboard/templates', icon: IconTemplate },
  { name: 'Learn', href: '/dashboard/learn', icon: IconBook },
  { name: 'Glossary', href: '/dashboard/glossary', icon: IconVocabulary },
  { name: 'Science', href: '/dashboard/science', icon: IconFlask },
  { name: 'Settings', href: '/dashboard/settings', icon: IconSettings },
];

export default function MorePage() {
  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-[17px] font-medium text-surface-100">More</h1>

      <div className="space-y-2">
        {moreLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.name}
              href={link.href}
              className="flex items-center gap-3 bg-surface-900 border border-surface-800 rounded-xl px-4 py-3.5 hover:bg-surface-800 transition-colors"
            >
              <Icon size={20} stroke={2} className="text-surface-400" aria-hidden="true" />
              <span className="flex-1 text-sm font-medium text-surface-100">{link.name}</span>
              <IconChevronRight size={18} stroke={2} className="text-surface-500" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
