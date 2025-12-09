'use client';

import { useState, createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Context for accordion state
interface AccordionContextType {
  openItems: Set<string>;
  toggle: (id: string) => void;
  type: 'single' | 'multiple';
}

const AccordionContext = createContext<AccordionContextType | null>(null);

function useAccordion() {
  const context = useContext(AccordionContext);
  if (!context) {
    throw new Error('Accordion components must be used within an Accordion');
  }
  return context;
}

// Main Accordion component
export interface AccordionProps {
  type?: 'single' | 'multiple';
  defaultOpen?: string[];
  children: ReactNode;
  className?: string;
}

export function Accordion({
  type = 'single',
  defaultOpen = [],
  children,
  className,
}: AccordionProps) {
  const [openItems, setOpenItems] = useState<Set<string>>(new Set(defaultOpen));

  const toggle = (id: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (type === 'single') {
          next.clear();
        }
        next.add(id);
      }
      return next;
    });
  };

  return (
    <AccordionContext.Provider value={{ openItems, toggle, type }}>
      <div className={cn('divide-y divide-surface-800', className)}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

// Accordion Item
export interface AccordionItemProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function AccordionItem({ id, children, className }: AccordionItemProps) {
  return (
    <div className={cn('', className)} data-accordion-item={id}>
      {children}
    </div>
  );
}

// Accordion Trigger (header)
export interface AccordionTriggerProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function AccordionTrigger({ id, children, className }: AccordionTriggerProps) {
  const { openItems, toggle } = useAccordion();
  const isOpen = openItems.has(id);

  return (
    <button
      onClick={() => toggle(id)}
      className={cn(
        'flex items-center justify-between w-full py-3 text-left text-surface-200 hover:text-surface-100 transition-colors',
        className
      )}
      aria-expanded={isOpen}
    >
      <span className="font-medium">{children}</span>
      <svg
        className={cn(
          'w-5 h-5 text-surface-400 transition-transform duration-200',
          isOpen && 'rotate-180'
        )}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>
  );
}

// Accordion Content
export interface AccordionContentProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function AccordionContent({ id, children, className }: AccordionContentProps) {
  const { openItems } = useAccordion();
  const isOpen = openItems.has(id);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'pb-4 text-sm text-surface-400 animate-slide-down',
        className
      )}
    >
      {children}
    </div>
  );
}

