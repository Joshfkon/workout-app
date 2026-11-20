'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Modal, Input } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { deleteAccount } from '@/lib/actions/account';
import { purgeUserCaches } from '@/lib/query/clientCachePurge';

export function DeleteAccountCard() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmText.trim().toUpperCase() === 'DELETE';

  const handleDelete = async () => {
    if (!canDelete) return;
    setIsDeleting(true);
    setError(null);

    try {
      const result = await deleteAccount();
      if (!result.success) {
        setError(result.message);
        setIsDeleting(false);
        return;
      }

      // Account is gone — clear the now-invalid session and leave the app.
      const supabase = createUntypedClient();
      await supabase.auth.signOut();
      // Finish clearing this account's cached data before the hard navigation.
      await purgeUserCaches().catch(() => {});
      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete your account.');
      setIsDeleting(false);
    }
  };

  const closeModal = () => {
    if (isDeleting) return;
    setShowConfirm(false);
    setConfirmText('');
    setError(null);
  };

  return (
    <>
      <Card className="border-status-bad/30">
        <CardHeader>
          <CardTitle className="text-status-bad">Danger zone</CardTitle>
          <p className="text-body text-ink-2 mt-1">
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-status-bad/5 border border-status-bad/20 rounded-lg">
            <div>
              <p className="text-body font-medium text-ink">Delete my account</p>
              <p className="text-caption text-ink-3">Removes your profile, workouts, nutrition, and all other data</p>
            </div>
            <Button variant="danger" size="sm" onClick={() => setShowConfirm(true)}>
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal isOpen={showConfirm} onClose={closeModal} title="Delete account?" size="md">
        <div className="space-y-4">
          <p className="text-body text-ink-2">
            This will <strong className="text-status-bad">permanently delete</strong> your account and
            all of your data — workouts, history, body composition, nutrition, and settings. This action
            cannot be undone.
          </p>
          <p className="text-caption text-ink-3">
            If you have a paid subscription, it is cancelled as part of deleting your account.
          </p>

          <div>
            <label className="block text-body text-ink-2 mb-1.5">
              Type <span className="font-mono font-semibold text-ink">DELETE</span> to confirm
            </label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              disabled={isDeleting}
              autoFocus
            />
          </div>

          {error && (
            <div className="p-3 bg-status-bad/10 border border-status-bad/20 rounded-lg text-body text-status-bad">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={closeModal} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={!canDelete || isDeleting}
              isLoading={isDeleting}
            >
              Permanently delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
