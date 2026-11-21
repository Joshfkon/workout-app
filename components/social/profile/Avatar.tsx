'use client';

import { memo, forwardRef, type HTMLAttributes } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/social';

const sizePx = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
};

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showOnlineIndicator?: boolean;
  isOnline?: boolean;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-caption',
  sm: 'w-8 h-8 text-subhead',
  md: 'w-10 h-10 text-subhead',
  lg: 'w-14 h-14 text-headline',
  xl: 'w-20 h-20 text-headline',
};

const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      src,
      alt,
      name = '',
      size = 'md',
      showOnlineIndicator = false,
      isOnline = false,
      className,
      ...props
    },
    ref
  ) => {
    const initials = getInitials(name || alt || 'U');

    return (
      <div ref={ref} className={cn('relative inline-block', className)} {...props}>
        {src ? (
          <Image
            src={src}
            alt={alt || name || 'Avatar'}
            width={sizePx[size]}
            height={sizePx[size]}
            className={cn(
              'rounded-full object-cover bg-fill',
              sizeClasses[size]
            )}
            unoptimized
          />
        ) : (
          <div
            className={cn(
              'rounded-full bg-action ',
              'flex items-center justify-center font-semibold text-white',
              sizeClasses[size]
            )}
          >
            {initials}
          </div>
        )}

        {showOnlineIndicator && (
          <span
            className={cn(
              'absolute bottom-0 right-0 block rounded-full ring-2 ring-card',
              size === 'xs' ? 'w-1.5 h-1.5' : size === 'sm' ? 'w-2 h-2' : 'w-3 h-3',
              isOnline ? 'bg-status-ok' : 'bg-ink-3'
            )}
          />
        )}
      </div>
    );
  }
);

Avatar.displayName = 'Avatar';

const MemoizedAvatar = memo(Avatar);
MemoizedAvatar.displayName = 'Avatar';

export { MemoizedAvatar as Avatar };
