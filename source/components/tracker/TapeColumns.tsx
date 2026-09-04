'use client';

import { useEffect, useState } from 'react';
import { PanelList, PanelSection, PanelSetting, PanelSettingsButton } from './PanelSettingsButton';

/**
 * Which columns the wallet tape shows.
 *
 * The tape used to carry a header strip naming all five. It named things
 * nobody needs named — a column of `$6.12K` is a market cap and a column
 * of green and pink names is who traded — and it was a sticky row inside
 * the scroller, so it painted over the tracked-wallets popout every time
 * that opened. It is gone. What it was really for is here instead: one
 * gear beside the tracked count, and a list of what to show.
 *
 * Persisted per browser, so a column you turn off stays off.
 */
export interface TapeCols {
  age: boolean;
  name: boolean;
  token: boolean;
  amount: boolean;
  mc: boolean;
}

export const TAPE_COLS_DEFAULT: TapeCols = { age: true, name: true, token: true, amount: true, mc: true };

const KEY = 'tracker:tape-columns:v1';

/** Track widths, in the tape's own order. */
const TRACK: Record<keyof TapeCols, string> = {
  age: '32px',
  name: 'minmax(0, 1.15fr)',
  token: 'minmax(0, 1.15fr)',
  amount: 'minmax(0, 0.95fr)',
  mc: 'minmax(58px, 0.6fr)',
};

const ORDER: (keyof TapeCols)[] = ['age', 'name', 'token', 'amount', 'mc'];

const LABEL: Record<keyof TapeCols, string> = {
  age: 'Age',
  name: 'Name',
  token: 'Token',
  amount: 'Amount',
  mc: 'Market cap',
};

/** The grid template for a set of visible columns. */
export function tapeTemplate(cols: TapeCols): string {
  return ORDER.filter((k) => cols[k])
    .map((k) => TRACK[k])
    .join(' ');
}

export function useTapeCols(): [TapeCols, (next: TapeCols) => void] {
  // Reads run in an effect, not at init: the server has no localStorage
  // and a divergent first render is a hydration error.
  const [cols, setCols] = useState<TapeCols>(TAPE_COLS_DEFAULT);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<TapeCols>;
      setCols({ ...TAPE_COLS_DEFAULT, ...parsed });
    } catch {
      // best-effort
    }
  }, []);

  const write = (next: TapeCols) => {
    setCols(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // best-effort
    }
  };

  return [cols, write];
}

/**
 * The wallets panel's gear: what the tape shows, and which wallets it
 * is showing. Both are "what is on and what is off", so both are the
 * same list of switches under two headings — and untracking a wallet no
 * longer needs a second control somewhere else on the panel.
 */
export function TapeColumnsButton({
  cols,
  onChange,
  wallets,
  onRemoveWallet,
}: {
  cols: TapeCols;
  onChange: (next: TapeCols) => void;
  /** Every tracked wallet, in the order the panel holds them. */
  wallets: readonly { address: string; label: string }[];
  onRemoveWallet: (address: string) => void;
}) {
  // The last visible column cannot be turned off — an empty tape is a
  // bug, not a preference.
  const shown = ORDER.filter((k) => cols[k]);

  return (
    <PanelSettingsButton label="Wallets and columns" title="Wallets">
      <PanelSection>Columns</PanelSection>
      <div className="tk-switches">
        {ORDER.map((k) => {
          const on = cols[k];
          const last = on && shown.length === 1;
          return (
            <PanelSetting key={k} checked={on} disabled={last} onChange={(next) => onChange({ ...cols, [k]: next })}>
              {LABEL[k]}
            </PanelSetting>
          );
        })}
      </div>

      {wallets.length > 0 ? (
        <>
          <PanelSection>Tracked · {wallets.length}</PanelSection>
          <PanelList
            items={wallets.map((w) => ({ key: w.address, label: w.label }))}
            onRemove={onRemoveWallet}
            placeholder="Find a wallet…"
            noun="wallets"
          />
        </>
      ) : null}
    </PanelSettingsButton>
  );
}
