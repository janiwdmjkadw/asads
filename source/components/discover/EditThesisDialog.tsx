'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useEditCoinCall, type EditCallRejectReason } from '@/lib/api/alpha-calls';
import { MAX_THESIS_LENGTH, checkThesis } from '@/lib/api/alpha-calls-shared';

// Slice "Edit My Thesis": the alpha card's pencil opens this dialog. Only
// the thesis can change — the server keeps created_at ("called at") and the
// MC-at-call baseline immutable and stamps edited_at, which every viewer's
// card renders as the "edited" marker.

const REJECT_COPY: Record<EditCallRejectReason, string> = {
  not_found: 'this call can no longer be edited.',
  thesis_empty: 'write a thesis first.',
  thesis_too_long: `keep it under ${MAX_THESIS_LENGTH} characters.`,
  thesis_charset: 'remove the unsupported characters and try again.',
  thesis_links: 'only x.com links are allowed.',
  rate_limited: 'too many edits — slow down a moment.',
};

interface Props {
  callId: string;
  ticker: string;
  initialThesis: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditThesisDialog({
  callId,
  ticker,
  initialThesis,
  open,
  onOpenChange,
}: Props) {
  const [thesis, setThesis] = useState(initialThesis);
  const [notice, setNotice] = useState<string | null>(null);
  const edit = useEditCoinCall();

  // A fresh dialog session starts from the CURRENT thesis, clean of any
  // prior submission state (mirrors CallCoinButton's open-reset).
  useEffect(() => {
    if (open) {
      setThesis(initialThesis);
      setNotice(null);
      edit.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset() identity churns per render
  }, [open, initialThesis]);

  const check = checkThesis(thesis);
  const remaining = MAX_THESIS_LENGTH - thesis.trim().length;
  // Pre-flight hint: the x.com-only rule is the one users hit by surprise.
  const preflightHint = !check.ok && check.reason === 'links' ? REJECT_COPY.thesis_links : null;

  const submit = () => {
    if (!check.ok || edit.isPending) return;
    setNotice(null);
    edit.mutate(
      { callId, thesis: check.normalized },
      {
        onSuccess: (result) => {
          if (result.kind === 'reauth') {
            setNotice('session expired — sign in again to edit.');
            return;
          }
          if (result.kind === 'error') {
            setNotice('edit failed to send — try again.');
            return;
          }
          if (!result.data.accepted) {
            setNotice(REJECT_COPY[result.data.reason]);
            return;
          }
          onOpenChange(false);
        },
        onError: () => setNotice('edit failed to send — try again.'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit your {ticker} thesis</DialogTitle>
          <DialogDescription>
            Only the thesis changes — the call keeps its original time and market cap, and
            shows an &ldquo;edited&rdquo; marker to everyone.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="why this coin, why now…"
          rows={4}
          maxLength={MAX_THESIS_LENGTH * 2}
          autoFocus
        />

        <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--ink-3)' }}>
          <span aria-live="polite" style={notice || preflightHint ? { color: 'var(--down)' } : undefined}>
            {notice ?? preflightHint ?? ''}
          </span>
          <span
            className="font-mono tabular-nums"
            style={remaining < 0 ? { color: 'var(--down)' } : undefined}
          >
            {remaining}
          </span>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            cancel
          </Button>
          <Button onClick={submit} disabled={!check.ok || edit.isPending}>
            {edit.isPending ? 'saving…' : 'save edit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
