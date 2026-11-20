'use client';

import { type HTMLAttributes, forwardRef, memo } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'bordered' | 'ghost';
  /** One density everywhere (p-4); 'none' is structural for flush-edge cards only. */
  padding?: 'none' | 'md';
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', padding = 'md', children, ...props }, ref) => {
    const variants = {
      // One card style (design system): fill only, soft shadow in light mode.
      default: 'bg-card shadow-card',
      elevated: 'bg-card shadow-float',
      bordered: 'bg-card border border-sep',
      ghost: 'bg-fill/50',
    };

    const paddings = {
      none: '',
      md: 'p-4',
    };

    return (
      <div
        ref={ref}
        className={cn('rounded-card text-ink', variants[variant], paddings[padding], className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

const MemoizedCard = memo(Card);
MemoizedCard.displayName = 'Card';

// Card sub-components
const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5 pb-4', className)}
      {...props}
    />
  )
);
CardHeader.displayName = 'CardHeader';

const MemoizedCardHeader = memo(CardHeader);
MemoizedCardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-headline text-ink', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

const MemoizedCardTitle = memo(CardTitle);
MemoizedCardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-subhead text-ink-2', className)}
      {...props}
    />
  )
);
CardDescription.displayName = 'CardDescription';

const MemoizedCardDescription = memo(CardDescription);
MemoizedCardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

const MemoizedCardContent = memo(CardContent);
MemoizedCardContent.displayName = 'CardContent';

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center pt-4', className)}
      {...props}
    />
  )
);
CardFooter.displayName = 'CardFooter';

const MemoizedCardFooter = memo(CardFooter);
MemoizedCardFooter.displayName = 'CardFooter';

export {
  MemoizedCard as Card,
  MemoizedCardHeader as CardHeader,
  MemoizedCardTitle as CardTitle,
  MemoizedCardDescription as CardDescription,
  MemoizedCardContent as CardContent,
  MemoizedCardFooter as CardFooter,
};

