'use client';

import { useEffect, useState, type ComponentProps, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

type PendingLinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'children'> & {
  href: string;
  /** Extra classes while the destination is loading (after the tap). */
  pendingClassName?: string;
  children: ReactNode | ((pending: boolean) => ReactNode);
};

/**
 * A Link that acknowledges the tap at once. App-router navigation holds the
 * old screen until the next one is ready, so a tap on a link to a screen
 * that loads slowly (Settings, the block planner) showed nothing for a
 * moment and read as missed: the UX panel tapped the Home gear and "Plan a
 * training block" twice. Same fix as the tab bar's pending tab
 * (BottomNavigation): a visible pending state from the tap, plus a prefetch
 * on pointer-down so the route starts loading before the click lands.
 * Clears on arrival, or after 10 s if the navigation never happens.
 */
export function PendingLink({
  href,
  className,
  pendingClassName,
  onClick,
  onPointerDown,
  children,
  ...rest
}: PendingLinkProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setPending(false);
  }, [pathname]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPending(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  return (
    <Link
      href={href}
      {...rest}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        try {
          router.prefetch(href);
        } catch {
          // Prefetch is an optimisation only.
        }
      }}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        // A second tap while the first is still loading is swallowed: the
        // navigation is already on its way, and restarting it only delays it
        // (UX panel round 19: personas re-tapped the gear mid-navigation).
        if (pending) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
        if (!e.defaultPrevented && pathname !== href) setPending(true);
      }}
      aria-busy={pending || undefined}
      data-pending={pending ? 'true' : undefined}
      className={cn(className, pending && pendingClassName)}
    >
      {typeof children === 'function' ? children(pending) : children}
    </Link>
  );
}
