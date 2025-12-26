'use client';

import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { UserSearch } from '@/components/social/UserSearch';
import { getProfileUrl } from '@/lib/social';
import type { UserProfile } from '@/types/social';

export default function SearchPage() {
  const router = useRouter();

  const handleSelectUser = (profile: UserProfile) => {
    router.push(getProfileUrl(profile.username));
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Card>
        <CardHeader>
          <CardTitle>Find People</CardTitle>
        </CardHeader>
        <CardContent>
          <UserSearch
            onSelectUser={handleSelectUser}
            placeholder="Search by username or name..."
            autoFocus
          />
        </CardContent>
      </Card>
    </div>
  );
}
