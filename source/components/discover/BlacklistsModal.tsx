'use client';

/**
 * THE BLACKLISTS.
 *
 * Three lists behind one modal: dev wallets, hidden tokens, and X
 * handles. All three answer the same question — what never shows on the
 * board — so they are three tabs rather than three places to go looking.
 *
 * ── WHERE IT DIFFERS FROM THE REFERENCE ──────────────────────────────
 *
 * DELETE ALL IS NOT RED. The reference fills it red, next to a green Add
 * and a green active tab, which spends the two colours that mean loss and
 * gain on the chrome. Red here would also be the loudest thing on a panel
 * whose whole body is usually empty. It is a ghost like Import, and the
 * confirmation is that it asks once before it fires.
 *
 * THE COUNT SAYS WHAT IT COUNTS. `0/1000 addresses` under a tab that
 * might be showing handles reads as a stale label; each tab counts its
 * own kind by name.
 *
 * ADD IS THE ONE FILLED BUTTON, because typing an address and pressing it
 * is the only thing this panel exists for.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  MAX_BLACKLIST_ENTRIES,
  isValidDevAddress,
  normalizeHandle,
  useBlacklistStore,
} from '@/lib/state/blacklist-store';
import { useHiddenTokens } from './useHiddenTokens';

import '@/components/settings/discover-filters-v2.css';
import './blacklists.css';

type TabId = 'devs' | 'tokens' | 'handles';

/*
 * ONE WORD EACH, SO ALL THREE FIT.
 *
 * They were `Dev blacklist`, `Hidden tokens` and `Handles blacklist`,
 * which needed more width than a phone has: the strip scrolled and the
 * third tab was off the side, so a tab you could not see was a tab you
 * could not pick. The panel is already titled Blacklists, so no tab has
 * to say the word again.
 */
const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'devs', label: 'Devs' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'handles', label: 'Handles' },
];

function Glyph({ d, size = 13, weight = 1.9 }: { d: string; size?: number; weight?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const I = {
  close: 'M6 6l12 12M18 6L6 18',
  remove: 'M6 6l12 12M18 6L6 18',
} as const;

/** Long strings in a 460px panel: keep both ends, drop the middle. */
function short(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 8)}…${value.slice(-8)}`;
}

export function BlacklistsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [tab, setTab] = useState<TabId>('devs');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const devs = useBlacklistStore((s) => s.devs);
  const handles = useBlacklistStore((s) => s.handles);
  const addDev = useBlacklistStore((s) => s.addDev);
  const removeDev = useBlacklistStore((s) => s.removeDev);
  const addHandle = useBlacklistStore((s) => s.addHandle);
  const removeHandle = useBlacklistStore((s) => s.removeHandle);
  const importDevs = useBlacklistStore((s) => s.importDevs);
  const importHandles = useBlacklistStore((s) => s.importHandles);
  const clearDevs = useBlacklistStore((s) => s.clearDevs);
  const clearHandles = useBlacklistStore((s) => s.clearHandles);
  const hydrate = useBlacklistStore((s) => s.hydrate);

  const hiddenTokens = useHiddenTokens();
  const hiddenMints = useMemo(() => [...hiddenTokens.mintSet], [hiddenTokens.mintSet]);

  useEffect(() => {
    if (open) hydrate();
  }, [open, hydrate]);

  // A draft and a warning belong to the tab they were typed on.
  useEffect(() => {
    setDraft('');
    setError(null);
    setConfirmClear(false);
  }, [tab]);

  const entries = tab === 'devs' ? devs : tab === 'handles' ? handles : hiddenMints;
  const noun = tab === 'handles' ? 'handles' : tab === 'devs' ? 'addresses' : 'tokens';
  /* Hidden tokens are added by pressing hide on a card, so this tab has
     no field: an input that cannot be filled in is worse than no input. */
  const canAdd = tab !== 'tokens';

  const submit = () => {
    const value = draft.trim();
    if (value.length === 0) return;
    if (tab === 'devs') {
      if (!isValidDevAddress(value)) {
        setError('That is not a Solana address.');
        return;
      }
      if (devs.includes(value)) {
        setError('Already on the list.');
        return;
      }
      if (!addDev(value)) {
        setError(`The list is full at ${MAX_BLACKLIST_ENTRIES}.`);
        return;
      }
    } else {
      const handle = normalizeHandle(value);
      if (handle === null) {
        setError('Letters, numbers and underscores only.');
        return;
      }
      if (handles.includes(handle)) {
        setError('Already on the list.');
        return;
      }
      if (!addHandle(handle)) {
        setError(`The list is full at ${MAX_BLACKLIST_ENTRIES}.`);
        return;
      }
    }
    setDraft('');
    setError(null);
  };

  const clear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    if (tab === 'devs') clearDevs();
    else if (tab === 'handles') clearHandles();
    else hiddenTokens.unhideAll();
    setConfirmClear(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const added = tab === 'devs' ? importDevs(text) : importHandles(text);
    setError(added === 0 ? 'Nothing in that file was new.' : null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="df bl" hideCloseButton>
        <div className="df-head">
          <DialogTitle className="df-title">Blacklists</DialogTitle>
          <DialogClose className="df-icon" aria-label="Close">
            <Glyph d={I.close} size={15} weight={2} />
          </DialogClose>
        </div>

        <div className="df-lanes" role="tablist" aria-label="Blacklist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              className={`df-lane${t.id === tab ? ' is-on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {canAdd ? (
          <div className="bl-add">
            <input
              value={draft}
              spellCheck={false}
              autoComplete="off"
              placeholder={tab === 'devs' ? 'Dev address' : 'X handle, with or without the @'}
              aria-label={tab === 'devs' ? 'Dev address' : 'X handle'}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
            <button type="button" className="df-apply" onClick={submit} disabled={draft.trim().length === 0}>
              Add
            </button>
          </div>
        ) : null}

        {error === null ? null : <p className="bl-error">{error}</p>}

        <div className="bl-body">
          {entries.length === 0 ? (
            <p className="bl-empty">
              {tab === 'devs'
                ? 'No blacklisted devs. Paste a wallet above and every coin it launches stays off the board.'
                : tab === 'handles'
                  ? 'No blacklisted handles. Add one and every coin linking to it stays off the board.'
                  : 'No hidden tokens. Press hide on a card and it lands here.'}
            </p>
          ) : (
            <ul className="bl-list">
              {entries.map((entry) => (
                <li key={entry} className="bl-row">
                  <span className="bl-entry" title={entry}>
                    {tab === 'handles' ? `@${entry}` : short(entry)}
                  </span>
                  <button
                    type="button"
                    className="bl-remove"
                    aria-label={`Remove ${entry}`}
                    onClick={() => {
                      if (tab === 'devs') removeDev(entry);
                      else if (tab === 'handles') removeHandle(entry);
                      else hiddenTokens.unhide(entry);
                    }}
                  >
                    <Glyph d={I.remove} size={12} weight={2.2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="df-foot">
          <span className="df-cap">
            {entries.length}
            {canAdd ? `/${MAX_BLACKLIST_ENTRIES}` : ''} {noun}
          </span>
          <span className="df-grow" />
          {canAdd ? (
            <>
              {/* A real file input, hidden behind the button, so Import is
                  one press rather than a press and a second dialog. */}
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.csv,text/plain,text/csv"
                className="bl-file"
                onChange={(event) => {
                  void onFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <button type="button" className="df-ghost" onClick={() => fileRef.current?.click()}>
                Import
              </button>
            </>
          ) : null}
          {/*
           * Asks once, rather than firing on the first press. This is the
           * one control here that destroys work, and the reference makes
           * it the loudest thing on the panel instead of the safest.
           */}
          <button
            type="button"
            className="df-ghost"
            disabled={entries.length === 0}
            onBlur={() => setConfirmClear(false)}
            onClick={clear}
          >
            {confirmClear ? 'Press again to delete' : 'Delete all'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
