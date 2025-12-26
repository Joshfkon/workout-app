'use client';

import { useState, useRef, useCallback, memo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Avatar } from './Avatar';

export interface AvatarUploadProps {
  currentAvatarUrl?: string | null;
  userName?: string;
  onUploadComplete: (url: string) => void;
  onUploadError?: (error: string) => void;
  size?: 'md' | 'lg' | 'xl';
}

function AvatarUploadComponent({
  currentAvatarUrl,
  userName = '',
  onUploadComplete,
  onUploadError,
  size = 'xl',
}: AvatarUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!validTypes.includes(file.type)) {
        onUploadError?.('Please select a valid image (JPEG, PNG, WebP, or GIF)');
        return;
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        onUploadError?.('Image must be less than 5MB');
        return;
      }

      // Create preview
      const reader = new FileReader();
      reader.onload = (event) => {
        setPreviewUrl(event.target?.result as string);
      };
      reader.readAsDataURL(file);

      // Upload to Supabase Storage
      setIsUploading(true);

      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          onUploadError?.('You must be logged in to upload an avatar');
          setIsUploading(false);
          return;
        }

        // Generate unique filename
        const fileExt = file.name.split('.').pop();
        const fileName = `${user.id}/avatar-${Date.now()}.${fileExt}`;

        // Upload to avatars bucket
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: true,
          });

        if (uploadError) {
          throw uploadError;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(fileName);

        // Update profile with new avatar URL
        const { error: updateError } = await (supabase
          .from('user_profiles' as never) as ReturnType<typeof supabase.from>)
          .update({ avatar_url: publicUrl } as never)
          .eq('user_id', user.id);

        if (updateError) {
          throw updateError;
        }

        onUploadComplete(publicUrl);
      } catch (error) {
        console.error('Avatar upload error:', error);
        onUploadError?.(
          error instanceof Error ? error.message : 'Failed to upload avatar'
        );
        setPreviewUrl(null);
      } finally {
        setIsUploading(false);
      }
    },
    [onUploadComplete, onUploadError]
  );

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemove = async () => {
    setIsUploading(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        onUploadError?.('You must be logged in');
        return;
      }

      // Update profile to remove avatar URL
      const { error } = await (supabase
        .from('user_profiles' as never) as ReturnType<typeof supabase.from>)
        .update({ avatar_url: null } as never)
        .eq('user_id', user.id);

      if (error) throw error;

      setPreviewUrl(null);
      onUploadComplete('');
    } catch (error) {
      onUploadError?.(
        error instanceof Error ? error.message : 'Failed to remove avatar'
      );
    } finally {
      setIsUploading(false);
    }
  };

  const displayUrl = previewUrl || currentAvatarUrl;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative group">
        <Avatar
          src={displayUrl}
          name={userName}
          size={size}
        />

        {/* Overlay on hover */}
        <button
          onClick={handleClick}
          disabled={isUploading}
          className="absolute inset-0 flex items-center justify-center rounded-full
            bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity
            cursor-pointer disabled:cursor-not-allowed"
        >
          {isUploading ? (
            <div className="animate-spin h-6 w-6 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          )}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelect}
        className="hidden"
      />

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleClick}
          disabled={isUploading}
        >
          {displayUrl ? 'Change Photo' : 'Upload Photo'}
        </Button>

        {displayUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={isUploading}
          >
            Remove
          </Button>
        )}
      </div>

      <p className="text-xs text-surface-500 text-center">
        JPEG, PNG, WebP or GIF. Max 5MB.
      </p>
    </div>
  );
}

export const AvatarUpload = memo(AvatarUploadComponent);
AvatarUpload.displayName = 'AvatarUpload';
