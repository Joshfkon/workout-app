'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Input, Badge } from '@/components/ui';
import {
  TOOLTIP_CONTENT,
  GLOSSARY_CATEGORIES,
  type GlossaryCategory,
  type TooltipContent,
} from '@/types/education';

export default function GlossaryPage() {
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

  // Get category order
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Training Glossary</h1>
          <p className="text-surface-400 mt-1">
            Look up any training term or concept
          </p>
        </div>
        <Link
          href="/dashboard/settings"
          className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Settings
        </Link>
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search Input */}
            <div className="flex-1 relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search terms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Category Filter */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === 'all'
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                }`}
              >
                All
              </button>
              {categoryOrder.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    selectedCategory === cat
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                  }`}
                >
                  <span>{GLOSSARY_CATEGORIES[cat].icon}</span>
                  <span className="hidden sm:inline">{GLOSSARY_CATEGORIES[cat].label}</span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Count */}
      <div className="flex items-center justify-between text-sm text-surface-400">
        <span>
          {filteredTerms.length} {filteredTerms.length === 1 ? 'term' : 'terms'} found
        </span>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-primary-400 hover:text-primary-300"
          >
            Clear search
          </button>
        )}
      </div>

      {/* Terms by Category */}
      {filteredTerms.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <svg
              className="w-12 h-12 mx-auto text-surface-600 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-surface-400">No terms match your search.</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
              className="mt-2 text-primary-400 hover:text-primary-300 text-sm"
            >
              Reset filters
            </button>
          </CardContent>
        </Card>
      ) : selectedCategory === 'all' && !searchQuery ? (
        // Show grouped by category when no filters
        <div className="space-y-6">
          {categoryOrder.map((cat) => {
            const terms = termsByCategory[cat];
            if (!terms || terms.length === 0) return null;

            const catInfo = GLOSSARY_CATEGORIES[cat];
            return (
              <Card key={cat}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <span>{catInfo.icon}</span>
                    {catInfo.label}
                  </CardTitle>
                  <p className="text-sm text-surface-500">{catInfo.description}</p>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="divide-y divide-surface-800">
                    {terms.map((term) => (
                      <GlossaryTerm
                        key={term.key}
                        term={term}
                        isExpanded={expandedTerm === term.key}
                        onToggle={() =>
                          setExpandedTerm(expandedTerm === term.key ? null : term.key)
                        }
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        // Show flat list when filtering
        <Card>
          <CardContent className="py-2">
            <div className="divide-y divide-surface-800">
              {filteredTerms.map((term) => (
                <GlossaryTerm
                  key={term.key}
                  term={term}
                  isExpanded={expandedTerm === term.key}
                  onToggle={() =>
                    setExpandedTerm(expandedTerm === term.key ? null : term.key)
                  }
                  showCategory
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Reference Footer */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-500/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-surface-200">Need more detail?</p>
              <p className="text-xs text-surface-500 mt-0.5">
                Check out the{' '}
                <Link href="/dashboard/learn" className="text-primary-400 hover:underline">
                  Learn Hub
                </Link>{' '}
                for in-depth articles on these concepts.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Individual term component
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
        onClick={onToggle}
        className="w-full flex items-start justify-between gap-4 text-left group"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-surface-100 group-hover:text-primary-400 transition-colors">
              {term.term}
            </span>
            {term.fullName && (
              <span className="text-sm text-surface-500">({term.fullName})</span>
            )}
            {showCategory && term.category && (
              <Badge variant="outline" className="text-xs">
                {GLOSSARY_CATEGORIES[term.category].icon} {GLOSSARY_CATEGORIES[term.category].label}
              </Badge>
            )}
          </div>
          <p className="text-sm text-surface-400 mt-1">{term.shortExplanation}</p>
        </div>
        <svg
          className={`w-5 h-5 text-surface-500 flex-shrink-0 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-3 pl-4 border-l-2 border-primary-500/30">
          {term.longExplanation && (
            <p className="text-sm text-surface-300 mb-3">{term.longExplanation}</p>
          )}
          {term.learnMoreSlug && (
            <Link
              href={`/dashboard/learn/${term.learnMoreSlug}`}
              className="inline-flex items-center gap-1.5 text-sm text-primary-400 hover:text-primary-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Read full article
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
