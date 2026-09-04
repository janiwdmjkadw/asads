'use client';

import { Bolt } from '@/components/listen/icons/Icons';
import { openFlash } from '@/lib/state/flash-store';

/**
 * The in-panel Flash offer. Replaces the optional-mode
 * `EnableTradingPanel` wherever a wallet already trades and the lane pool
 * is merely available — one line and one button, because the whole
 * explanation now lives in the modal this opens.
 *
 * Theme tokens on purpose: this chip sits INSIDE the dark wallet panel.
 * The white document treatment belongs to the modal alone.
 */
export function FlashOfferPanel({
  walletAccountId,
}: {
  readonly walletAccountId: string | null;
}): React.ReactElement {
  return (
    <div
      data-testid="flash-offer-panel"
      className="flex items-center justify-between gap-3"
      style={{
        background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
        borderRadius: 10,
        padding: '10px 12px',
        color: 'var(--ink-0)',
        fontSize: 12,
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Bolt style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--accent-primary)' }} />
        <div className="min-w-0">
          <div style={{ fontSize: 13, fontWeight: 500 }}>Flash</div>
          <p style={{ color: 'var(--ink-2)', margin: 0 }}>
            Pay once — this wallet&apos;s trades go lightning-fast, forever.
          </p>
        </div>
      </div>
      <button
        type="button"
        data-testid="flash-offer-panel-cta"
        onClick={() => openFlash(walletAccountId)}
        disabled={walletAccountId === null}
        style={{
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          border: 'none',
          padding: '8px 12px',
          borderRadius: 8,
          fontSize: 12,
          whiteSpace: 'nowrap',
          cursor: walletAccountId === null ? 'not-allowed' : 'pointer',
          opacity: walletAccountId === null ? 0.5 : 1,
        }}
      >
        Enable Flash
      </button>
    </div>
  );
}
