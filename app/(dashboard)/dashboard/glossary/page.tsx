'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconApple,
  IconBarbell,
  IconBed,
  IconBolt,
  IconBook,
  IconCalendar,
  IconChartBar,
  IconChevronDown,
  IconCircleCheck,
  IconInfoCircle,
  IconRuler,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import { Chip } from '@/components/ui';
import { ArticleHeader, ArticlePage, ContentCard, IconBadge } from '@/components/learn/ArticleKit';
import { cn } from '@/lib/utils';
import {
  TOOLTIP_CONTENT,
  GLOSSARY_CATEGORIES,
  type GlossaryCategory,
  type TooltipContent,
} from '@/types/education';

/** Tabler icons for each category (the shared data still carries emoji). */
const CATEGORY_ICONS: Record<GlossaryCategory, TablerIcon> = {
  volume: IconChartBar,
  intensity: IconBolt,
  'set-quality': IconCircleCheck,
  periodization: IconCalendar,
  strength: IconBarbell,
  'body-composition': IconRuler,
  nutrition: IconApple,
  recovery: IconBed,
};

/** Category labels in the shared data are Title Case; show them in sentence case. */
function sentenceCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

// Category display order
const categoryOrder: GlossaryCategory[] = [
  'volume',
  'intensity',
  'set-quality',
  'periodization',
  'strength',
  'body-composition',
  'nutrition',
  'recovery',
];

export default function GlossaryPage() {
  useDocumentTitle('Glossary');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<GlossaryCategory | 'all'>('all');
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);

  // Convert tooltip content to array and sort alphabetically
  const allTerms = useMemo(() => {
    return Object.entries(TOOLTIP_CONTENT)
      .map(([key, content]) => ({ key, ...content }))
      .sort((a, b) => a.term.localeCompare(b.term));
  }, []);

  // Filter terms based on search and category
  const filteredTerms = useMemo(() => {
    return allTerms.filter((term) => {
      const matchesSearch =
        searchQuery === '' ||
        term.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.shortExplanation.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        selectedCategory === 'all' || term.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [allTerms, searchQuery, selectedCategory]);

  // Group terms by category for display
  const termsByCategory = useMemo(() => {
    const grouped: Record<string, (TooltipContent & { key: string })[]> = {};

    filteredTerms.forEach((term) => {
      const category = term.category || 'other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(term);
    });

    return grouped;
  }, [filteredTerms]);

  const toggle = (key: string) => setExpandedTerm(expandedTerm === key ? null : key);

  return (
    <ArticlePage className="space-y-6">
      <ArticleHeader
        title="Training glossary"
        subtitle="Look up any training term or concept."
        backHref="/dashboard/settings"
        backLabel="Settings"
      />

      {/* Search and filter */}
      <div className="space-y-3">
        <div className="relative">
          <IconSearch
            size={20}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search terms"
            aria-label="Search terms"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 w-full rounded-xl bg-card pl-10 pr-10 text-body text-ink shadow-card placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-ink-3"
            >
              <IconX size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip selected={selectedCategory === 'all'} onClick={() => setSelectedCategory('all')}>
            All
          </Chip>
          {categoryOrder.map((cat) => {
            const CatIcon = CATEGORY_ICONS[cat];
            return (
              <Chip
                key={cat}
                selected={selectedCategory === cat}
                onClick={() => setSelectedCategory(cat)}
                icon={<CatIcon size={16} />}
              >
                {sentenceCase(GLOSSARY_CATEGORIES[cat].label)}
              </Chip>
            );
          })}
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between text-subhead text-ink-2">
        <span>
          {filteredTerms.length} {filteredTerms.length === 1 ? 'term' : 'terms'} found
        </span>
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')} className="text-action">
            Clear search
          </button>
        )}
      </div>

      {/* Terms */}
      {filteredTerms.length === 0 ? (
        <ContentCard className="space-y-2 py-12 text-center">
          <IconSearch size={40} stroke={1.5} className="mx-auto text-ink-3" aria-hidden="true" />
          <p className="text-body text-ink-2">No terms match your search.</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
            }}
            className="text-subhead text-action"
          >
            Reset filters
          </button>
        </ContentCard>
      ) : selectedCategory === 'all' && !searchQuery ? (
        // Grouped by category when no filters
        <div className="space-y-4">
          {categoryOrder.map((cat) => {
            const terms = termsByCategory[cat];
            if (!terms || terms.length === 0) return null;

            const catInfo = GLOSSARY_CATEGORIES[cat];
            return (
              <ContentCard key={cat}>
                <div className="flex items-start gap-3 pb-2">
                  <IconBadge icon={CATEGORY_ICONS[cat]} size="sm" />
                  <div className="min-w-0">
                    <h2 className="text-headline text-ink">{sentenceCase(catInfo.label)}</h2>
                    <p className="text-caption text-ink-3">{catInfo.description}</p>
                  </div>
                </div>
                <div className="divide-y divide-sep">
                  {terms.map((term) => (
                    <GlossaryTerm
                      key={term.key}
                      term={term}
                      isExpanded={expandedTerm === term.key}
                      onToggle={() => toggle(term.key)}
                    />
                  ))}
                </div>
              </ContentCard>
            );
          })}
        </div>
      ) : (
        // Flat list when filtering
        <ContentCard className="py-1">
          <div className="divide-y divide-sep">
            {filteredTerms.map((term) => (
              <GlossaryTerm
                key={term.key}
                term={term}
                isExpanded={expandedTerm === term.key}
                onToggle={() => toggle(term.key)}
                showCategory
              />
            ))}
          </div>
        </ContentCard>
      )}

      {/* Pointer to Learn */}
      <ContentCard className="flex items-start gap-3">
        <IconBadge icon={IconInfoCircle} size="sm" />
        <div className="min-w-0">
          <p className="text-headline text-ink">Need more detail?</p>
          <p className="text-subhead text-ink-2">
            <Link href="/dashboard/learn" className="text-action">
              Learn
            </Link>{' '}
            has in-depth articles on these concepts.
          </p>
        </div>
      </ContentCard>
    </ArticlePage>
  );
}

// Individual term row
function GlossaryTerm({
  term,
  isExpanded,
  onToggle,
  showCategory = false,
}: {
  term: TooltipContent & { key: string };
  isExpanded: boolean;
  onToggle: () => void;
  showCategory?: boolean;
}) {
  return (
    <div className="py-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-body font-semibold text-ink">{term.term}</span>
            {term.fullName && <span className="text-subhead text-ink-3">({term.fullName})</span>}
            {showCategory && term.category && (
              <span className="rounded-full bg-fill px-2 py-0.5 text-caption text-ink-2">
                {sentenceCase(GLOSSARY_CATEGORIES[term.category].label)}
              </span>
            )}
          </div>
          <p className="mt-1 text-subhead text-ink-2">{term.shortExplanation}</p>
        </div>
        <IconChevronDown
          size={20}
          className={cn('mt-0.5 shrink-0 text-ink-3 transition-transform', isExpanded && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {isExpanded && (term.longExplanation || term.learnMoreSlug) && (
        <div className="mt-3 space-y-3 rounded-xl bg-fill p-3">
          {term.longExplanation && <p className="text-subhead text-ink-2">{term.longExplanation}</p>}
          {term.learnMoreSlug && (
            <Link
              href={`/dashboard/learn/${term.learnMoreSlug}`}
              className="inline-flex items-center gap-1.5 text-subhead font-medium text-action"
            >
              <IconBook size={18} aria-hidden="true" />
              Read full article
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
