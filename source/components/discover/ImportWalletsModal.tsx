'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { parseWalletImportText, type WalletImportResult } from './trackedWallets';
import './import-wallets.css';

/**
 * The family's ONE filled action button (this dialog's Import, the wallet
 * manager's ADD): a white plate with black type, and there is exactly one
 * per surface.
 *
 * It shipped as `--accent-primary` fill when actionable and a chip fill
 * inside a `--hairline-2` border when not — a different colour AND a
 * different border for the same button in two states, in the accent this
 * page has otherwise left. Now it is one plate that never changes shape
 * or colour; only its presence drops.
 *
 * Still exported so the manager's ADD is the same button rather than a
 * copy that drifts.
 */
export const primaryActionClass = (enabled: boolean): string =>
  `inline-flex h-[30px] min-w-[88px] shrink-0 items-center justify-center rounded-[7px] px-3 text-[11px] font-semibold leading-none transition-[background-color,box-shadow,opacity] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
    enabled ? 'cursor-pointer hover:bg-[#f4f4f5]' : 'cursor-default'
  }`;

export const primaryActionStyle = (enabled: boolean): CSSProperties => ({
  background: '#ffffff',
  border: 0,
  color: '#000000',
  opacity: enabled ? 1 : 0.45,
});

/**
 * Import Addresses, shared by the Wallet Tracker popover's IMPORT button
 * and the Tracker page. Paste anything (JSON exports with aliases, flags
 * and sounds, bare address lists, address and label lines) or load a
 * file; parsing is `parseWalletImportText`, writing is the context
 * store's `importWallets`, which every tracker surface subscribes to.
 *
 * Rebuilt into the tracker's voice — see `import-wallets.css` for what
 * it was.
 */
export function ImportWalletsModal({
  open,
  onClose,
  importWallets,
}: {
  open: boolean;
  onClose: () => void;
  importWallets: (entries: unknown) => WalletImportResult;
}) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setError(null);
    // Focus the paste box on open — the dominant flow is paste-and-import.
    const id = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // ESC closes the dialog, and works from the textarea because the
  // listener is on the window. Capture phase + stopped propagation so the
  // TOPMOST surface consumes the key: this modal can be mounted inside
  // the Radix popover (top-nav) and above the tracker's own window-level
  // Escape handlers, and neither may close behind it. Bound only while
  // open, so a closed modal never swallows Escape. A native file picker
  // gets the key first — the page receives no keydown while it is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const runImport = (raw: string) => {
    const entries = parseWalletImportText(raw);
    if (entries === null) {
      setMessage(null);
      setError('No wallet addresses found in that.');
      return;
    }
    const result = importWallets(entries);
    setError(null);
    setMessage(`Imported ${result.imported} · updated ${result.updated} · skipped ${result.skipped}`);
    if (result.imported > 0 || result.updated > 0) setText('');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      runImport(await file.text());
    } catch {
      setError('Could not read that file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const canImport = text.trim().length > 0;

  return (
    <div
      className="iw-scrim"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="iw" role="dialog" aria-modal="true" aria-label="Import wallet addresses">
        <header>
          <b>Import addresses</b>
          {/* A drawn cross, and no tooltip on it. A `×` on a dialog header
              does not need a label reading "Close". */}
          <button type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="iw-body">
          <p className="iw-note">
            Any format works. A JSON export, one per line, or comma separated. Names, emoji, alert
            flags and sounds come across when they are there.
          </p>

          <textarea
            ref={textareaRef}
            className="iw-paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={
              '[{ "trackedWalletAddress": "…", "name": "alias" }]\n\n<address> my label\n<address> whale\n\n<address>, <address>, <address>'
            }
          />

          {error ? (
            <p className="iw-say" data-bad>
              {error}
            </p>
          ) : message ? (
            <p className="iw-say">{message}</p>
          ) : null}
        </div>

        <footer>
          <button type="button" className="iw-alt" onClick={() => fileInputRef.current?.click()}>
            {/* The same tray the tracker's Import wears. */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3.5v9M12 12.5 8.5 9M12 12.5 15.5 9" />
              <path d="M4 15v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V15" />
            </svg>
            From a file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.txt,.csv,application/json,text/plain,text/csv"
            className="hidden"
            onChange={(event) => {
              void onFile(event.target.files?.[0]);
            }}
          />

          <i />

          <button type="button" className="iw-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="iw-go"
            style={canImport ? undefined : { opacity: 0.45, cursor: 'default' }}
            disabled={!canImport}
            onClick={() => runImport(text)}
          >
            Import
          </button>
        </footer>
      </div>
    </div>
  );
}
