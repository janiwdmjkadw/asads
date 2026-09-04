'use client';

import type { MouseEvent, PointerEvent } from 'react';

// One-click Solscan jump — a compact icon anchor used across the trade
// tables (holders / top traders / trades / dev tokens) and the wallet
// dossier. Real <a target=_blank> so modifier clicks behave natively;
// propagation stopped so the hosting row's own click (profile modal,
// token navigation) never fires alongside.

const KIND_PATH = {
  account: 'account',
  tx: 'tx',
  token: 'token',
} as const;

export function SolscanButton({
  kind,
  id,
  size = 14,
}: {
  kind: keyof typeof KIND_PATH;
  id: string;
  size?: number;
}) {
  const label =
    kind === 'tx' ? 'View transaction on Solscan' : kind === 'token' ? 'View token on Solscan' : 'View wallet on Solscan';
  return (
    <a
      href={`https://solscan.io/${KIND_PATH[kind]}/${encodeURIComponent(id)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      draggable={false}
      onClick={(e: MouseEvent) => e.stopPropagation()}
      onPointerDown={(e: PointerEvent) => e.stopPropagation()}
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] border transition-colors hover:border-[var(--hairline-2)] hover:text-[var(--ink-0)]"
      style={{
        width: size + 4,
        height: size + 4,
        color: 'var(--ink-3)',
        borderColor: 'var(--hairline)',
      }}
    >
      <svg
        width={size - 5}
        height={size - 5}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    </a>
  );
}
