'use client';

import type { CSSProperties, ReactNode } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ExternalLink } from '@/components/listen/icons/Icons';
import { shortAddress } from './trackedWallets';
import type { FeeShareRecipient } from './mockCoins';

/**
 * FeeShareHoverCard — creator fee-sharing dossier popover for the
 * Discover MetaRow pie-chart badge. Renders entirely from data already
 * on the streamed card (recipients + locked flag + config authority),
 * so opening it costs zero network round-trips.
 *
 * Layout mirrors the reference design: authority chip, locked-status
 * tile, then one row per shareholder with its percent of the creator
 * fee stream.
 */

// Same intent-gating rationale as WalletFundingHoverCard: the badge sits
// in a row the cursor crosses constantly; a small delay avoids flicker.
const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 140;

/** bps -> display percent: 10000 -> "100.00%", 250 -> "2.50%". */
export function formatShareBps(bps: number): string {
  if (!Number.isFinite(bps)) return '—';
  return `${(Math.max(0, bps) / 100).toFixed(2)}%`;
}

const tileStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '8px 10px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const sectionLabelCls = 'text-[11px] leading-none';

/* Lucide chef-hat — same glyph MetricsRow uses for the dev, here marking
   the config authority (typically the creator). */
function ChefHatIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" />
      <path d="M6 17h12" />
    </svg>
  );
}

/* Remix lock-line: the locked-shares marker. */
function LockIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={style} aria-hidden>
      <path d="M19 10H20C20.5523 10 21 10.4477 21 11V21C21 21.5523 20.5523 22 20 22H4C3.44772 22 3 21.5523 3 21V11C3 10.4477 3.44772 10 4 10H5V9C5 5.13401 8.13401 2 12 2C15.866 2 19 5.13401 19 9V10ZM5 12V20H19V12H5ZM11 14H13V18H11V14ZM17 10V9C17 6.23858 14.7614 4 12 4C9.23858 4 7 6.23858 7 9V10H17Z" />
    </svg>
  );
}

function SolscanLink({ address, label }: { address: string; label: string }) {
  return (
    <a
      href={`https://solscan.io/account/${encodeURIComponent(address)}`}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-white/[0.06] transition-colors"
    >
      <ExternalLink style={{ width: 13, height: 13, color: 'var(--ink-2)' }} />
    </a>
  );
}

function CardBody({
  authority,
  recipients,
  locked,
}: {
  authority: string | null;
  recipients: FeeShareRecipient[];
  locked: boolean;
}) {
  return (
    <div className="flex w-[236px] flex-col gap-2" style={{ fontFamily: 'var(--mono)' }}>
      <span className={sectionLabelCls} style={{ color: 'var(--ink-2)' }}>
        Fee Authority
      </span>
      {authority ? (
        <div style={tileStyle}>
          <ChefHatIcon style={{ width: 14, height: 14, color: '#818cf8', flexShrink: 0 }} />
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-none"
            style={{ color: 'var(--ink-0)' }}
          >
            {shortAddress(authority)}
          </span>
          <SolscanLink address={authority} label="Open fee authority on Solscan" />
        </div>
      ) : (
        <div style={tileStyle}>
          <span className="text-[13px] leading-none" style={{ color: 'var(--ink-3)' }}>
            —
          </span>
        </div>
      )}

      <div style={{ ...tileStyle, flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span
          className="flex items-center gap-1.5 text-[13px] font-semibold leading-none"
          style={{ color: locked ? 'var(--up)' : 'var(--ink-1)' }}
        >
          <LockIcon style={{ width: 13, height: 13 }} />
          {locked ? 'Locked' : 'Unlocked'}
        </span>
        <span className={sectionLabelCls} style={{ color: 'var(--ink-3)' }}>
          Status
        </span>
      </div>

      {recipients.length > 0 ? (
        <>
          <span className={sectionLabelCls} style={{ color: 'var(--ink-2)' }}>
            Shares
          </span>
          {recipients.map((recipient) => (
            <div key={recipient.pubkey} style={tileStyle}>
              <span
                className="min-w-0 flex-1 truncate text-[13px] leading-none"
                style={{ color: 'var(--ink-1)' }}
              >
                {shortAddress(recipient.pubkey)}
              </span>
              <span
                className="shrink-0 text-[13px] font-semibold leading-none tabular-nums"
                style={{ color: 'var(--ink-0)' }}
              >
                {formatShareBps(recipient.bps)}
              </span>
              <SolscanLink address={recipient.pubkey} label="Open shareholder on Solscan" />
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

export function FeeShareHoverCard({
  authority,
  recipients,
  locked,
  children,
}: {
  authority: string | null;
  recipients: FeeShareRecipient[];
  locked: boolean;
  /** Trigger element (the MetaRow pie-chart badge). Rendered via `asChild`. */
  children: ReactNode;
}) {
  return (
    <HoverCard openDelay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-auto p-3 duration-100"
        /* Floats above a clickable CoinCard — swallow pointer/keyboard
           events so interacting with it never triggers quickbuy/nav. */
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <CardBody authority={authority} recipients={recipients} locked={locked} />
      </HoverCardContent>
    </HoverCard>
  );
}
