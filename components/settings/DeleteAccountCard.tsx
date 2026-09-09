'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Modal, Input } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { deleteAccount } from '@/lib/actions/account';

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
      <Card className="border-danger-500/30">
        <CardHeader>
          <CardTitle className="text-danger-400">Danger Zone</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-danger-500/5 border border-danger-500/20 rounded-lg">
            <div>
              <p className="text-sm font-medium text-surface-200">Delete my account</p>
              <p className="text-xs text-surface-500">Removes your profile, workouts, nutrition, and all other data</p>
            </div>
            <Button variant="danger" size="sm" onClick={() => setShowConfirm(true)}>
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal isOpen={showConfirm} onClose={closeModal} title="Delete account?" size="md">
        <div className="space-y-4">
          <p className="text-sm text-surface-300">
            This will <strong className="text-danger-400">permanently delete</strong> your account and
            all of your data — workouts, history, body composition, nutrition, and settings. This action
            cannot be undone.
          </p>
          <p className="text-xs text-surface-500">
            If you have a paid subscription, cancel it on the web first — deleting your account here does
            not automatically cancel web billing.
          </p>

          <div>
            <label className="block text-sm text-surface-300 mb-1.5">
              Type <span className="font-mono font-semibold text-surface-100">DELETE</span> to confirm
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
            <div className="p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg text-sm text-danger-400">
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
              Permanently Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
