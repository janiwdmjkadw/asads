'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWalletActivity } from '@/components/discover/useWalletActivity';
import { useTrackedWalletsContext } from '@/components/discover/TrackedWalletsProvider';
import { displayName, displayNameWithEmoji } from '@/components/discover/trackedWallets';
import { EmojiPickerPopover } from '@/components/discover/WalletTrackerPopover';
import { tokenTickerFromNavigationHint } from '@/components/listen/navigation';
import { isValidWalletAddress, shortAddress } from '@/lib/api/tracker';
import { ImportWalletsModal } from '@/components/discover/ImportWalletsModal';
import { AddTrackerField, type FieldStatus } from './AddTrackerField';
import { usePersistentTabVisible } from '@/components/listen/PersistentTabPane';
import { ChipRow, TrackedChip } from './TrackedChip';
import { PanelEmpty, TrackerPanel } from './TrackerPanel';
import { TrackerToolbar } from './TrackerToolbar';
import { TrackerActivityRow } from './TrackerActivityRow';
import { TapeColumnsButton, tapeTemplate, useTapeCols } from './TapeColumns';
import { SolDefs } from '@/components/discover/column/sol';

/** Hard cap on rendered activity rows; the buffer retains up to 200. */
const MAX_VISIBLE_EVENTS = 60;

export function WalletsPanel() {
  // The SHARED tracked-wallets store (same one the Discover popover and
  // chart bubbles use): addWallet persists the row to the DB registry AND
  // keeps the local display prefs — label, EMOJI, per-wallet toggles.
  const wallets = useTrackedWalletsContext();
  // Emoji staged for the next add; cleared after a successful track.
  const [pendingEmoji, setPendingEmoji] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Which cells the tape shows; the gear beside the tracked count edits
  // it and the choice is remembered per browser.
  const [cols, setCols] = useTapeCols();
  // Dormant while /tracker is hidden: this subtree lives in a persistent
  // pane, and without the gate it re-rendered 60 rows per tracked trade
  // while invisible. The subscription (and shared buffer) stays alive;
  // reveal re-reads the buffer synchronously, so nothing is missed.
  const visible = usePersistentTabVisible();
  const { events } = useWalletActivity(wallets.addressSet, { dormant: !visible });
  // Coarse tick so row ages keep advancing on a quiet feed.
  const hasEvents = events.length > 0;
  const [ageTick, setAgeTick] = useState(0);

  useEffect(() => {
    if (!hasEvents) return;
    const timer = setInterval(() => setAgeTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, [hasEvents]);

  const visibleEvents = useMemo(() => events.slice(0, MAX_VISIBLE_EVENTS), [events]);
  // Resolve each mint's ticker ONCE per events change (plus the coarse age
  // tick, so late-arriving hints still fill in) instead of per row per render.
  const tickerByMint = useMemo(() => {
    void ageTick;
    const map = new Map<string, string | null>();
    for (const event of visibleEvents) {
      if (!map.has(event.mint)) map.set(event.mint, tokenTickerFromNavigationHint(event.mint));
    }
    return map;
  }, [ageTick, visibleEvents]);

  // Emoji and name are separate ledger cells (the emoji holds a fixed
  // 12px gutter so the labels start on one line), so they're kept apart
  // here rather than pre-joined into one string.
  const markByWallet = useMemo(() => {
    const map = new Map<string, { emoji: string | undefined; label: string }>();
    for (const w of wallets.wallets) {
      const emoji = w.emoji?.trim();
      map.set(w.address, {
        emoji: emoji || undefined,
        label: displayName(w) || shortAddress(w.address),
      });
    }
    return map;
  }, [wallets.wallets]);

  function getStatus(raw: string): FieldStatus {
    const addr = raw.trim();
    if (!addr) {
      return { tone: 'idle', text: 'Paste a Solana wallet address to track', canSubmit: false, value: null };
    }
    if (!isValidWalletAddress(addr)) {
      return { tone: 'error', text: 'Not a valid Solana address', canSubmit: false, value: null };
    }
    if (wallets.addressSet.has(addr)) {
      return { tone: 'warn', text: 'Already tracking this wallet', canSubmit: false, value: null };
    }
    return { tone: 'ok', text: `Track ${shortAddress(addr)}`, canSubmit: true, value: addr };
  }

  const toolbar = (
    <TrackerToolbar
      count={wallets.wallets.length}
      noun="wallets"
      field={
        <AddTrackerField
          placeholder="Add wallet address…"
          leading={
            <EmojiPickerPopover
              onPick={setPendingEmoji}
              triggerClassName="tk-lead"
              triggerLabel="Pick an emoji for this wallet"
            >
              {/* In its own colour, set or not — see the note in
                  tracker-row.css. */}
              <span aria-hidden>{pendingEmoji || '🙂'}</span>
            </EmojiPickerPopover>
          }
          getStatus={getStatus}
          onSubmit={async (value) => {
            const result = wallets.addWallet(value, undefined, pendingEmoji ?? undefined);
            if (!result.ok) return result.reason;
            setPendingEmoji(null);
            return null;
          }}
          trailing={
            <button type="button" onClick={() => setImportOpen(true)} className="tk-alt">
              {/* A tray with an arrow into it. Import is the one verb on
                  this line that does something to MANY wallets, and the
                  mark is what separates it from Track at a glance. */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3.5v9M12 12.5 8.5 9M12 12.5 15.5 9" />
                <path d="M4 15v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V15" />
              </svg>
              Import
            </button>
          }
        />
      }
    >
      <ChipRow>
        {wallets.wallets.map((w) => (
          <TrackedChip
            key={w.address}
            label={displayNameWithEmoji(w) || shortAddress(w.address)}
            title={w.address}
            onRemove={() => wallets.removeWallet(w.address)}
          />
        ))}
      </ChipRow>
    </TrackerToolbar>
  );

  return (
    <>
    <ImportWalletsModal
      open={importOpen}
      onClose={() => setImportOpen(false)}
      importWallets={wallets.importWallets}
    />
    <TrackerPanel
      title="Wallets"
      count={wallets.wallets.length}
      /* Beside the count, not down on the row with Track and Import.
         Those are things you press to make something happen; this only
         changes what is already showing, so it belongs with the title
         that names it. */
      afterCount={
        <TapeColumnsButton
          cols={cols}
          onChange={setCols}
          wallets={wallets.wallets.map((w) => ({
            address: w.address,
            label: displayNameWithEmoji(w) || shortAddress(w.address),
          }))}
          onRemoveWallet={(address) => wallets.removeWallet(address)}
        />
      }
      toolbar={toolbar}
    >
      {wallets.addressSet.size === 0 ? (
        <PanelEmpty
          title="No wallets tracked"
          hint="Add a wallet to see its live pump.fun trades. Activity is saved server-side, so the last 30 trades are here when you come back."
        />
      ) : events.length === 0 ? (
        <PanelEmpty title="Waiting for activity" hint="Live trades from your tracked wallets will appear here." />
      ) : (
        /* One grid template for the whole list, built from the visible
           columns, so a hidden cell takes its track with it rather than
           leaving a gap where it used to be. */
        <div style={{ ['--tr-cols' as string]: tapeTemplate(cols) }}>
          {/* `SolMark` fills from a gradient defined in the DOCUMENT, so
              one `<defs>` has to be on this surface or every mark in the
              amount column paints nothing at all. */}
          <SolDefs />
          {visibleEvents.map((event) => (
            <TrackerActivityRow
              key={`${event.signature}:${event.wallet}`}
              event={event}
              walletLabel={markByWallet.get(event.wallet)?.label ?? shortAddress(event.wallet)}
              walletEmoji={markByWallet.get(event.wallet)?.emoji}
              ticker={tickerByMint.get(event.mint) ?? null}
              cols={cols}
              ageTick={ageTick}
            />
          ))}
        </div>
      )}
    </TrackerPanel>
    </>
  );
}
