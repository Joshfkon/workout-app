'use client';

import { memo, forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/social';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showOnlineIndicator?: boolean;
  isOnline?: boolean;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-xl',
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
          <img
            src={src}
            alt={alt || name || 'Avatar'}
            className={cn(
              'rounded-full object-cover bg-surface-800',
              sizeClasses[size]
            )}
          />
        ) : (
          <div
            className={cn(
              'rounded-full bg-gradient-to-br from-primary-500 to-primary-700',
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
              'absolute bottom-0 right-0 block rounded-full ring-2 ring-surface-900',
              size === 'xs' ? 'w-1.5 h-1.5' : size === 'sm' ? 'w-2 h-2' : 'w-3 h-3',
              isOnline ? 'bg-success-500' : 'bg-surface-500'
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
