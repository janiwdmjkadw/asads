'use client';

import type { ReactNode } from 'react';
import { Caption } from '@/components/listen/primitives';

/**
 * Small shared building blocks for the Advanced (DCA) and Limit tab
 * bodies — card container, labelled rows, summary rows. Styling follows
 * the panel's hand-rolled conventions (CSS vars, hairline borders,
 * mono numerals).
 */

/** Bordered card (Allocate / To Buy / controls sections). */
export function FieldCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-2"
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--r-lg)',
        background: 'var(--input-bg)',
        border: '1px solid var(--input-border)',
      }}
    >
      {children}
    </div>
  );
}

/** Card header: caption label left, arbitrary control right. */
export function CardHeader({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Caption size="sm" tone="ink-3">
        {label}
      </Caption>
      {right ?? null}
    </div>
  );
}

/** Borderless amount input row used inside a FieldCard. */
export function CardAmountInput({
  value,
  onChange,
  placeholder,
  suffix,
  onMax,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  suffix?: ReactNode;
  onMax?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          // Digits + one dot only — the submit-side parsers never see
          // hex / exponent / sign characters.
          if (!/^\d*(\.\d*)?$/.test(e.target.value)) return;
          onChange(e.target.value);
        }}
        className="min-w-0 flex-1 border-0 bg-transparent text-left text-[16px] tabular-nums outline-none"
        style={{ color: 'var(--ink-0)', fontFamily: 'var(--mono)' }}
      />
      {onMax ? (
        <button
          type="button"
          onClick={onMax}
          className="seg__btn"
          style={{ fontSize: 10, padding: '2px 7px' }}
        >
          MAX
        </button>
      ) : null}
      {suffix ?? null}
    </div>
  );
}

/** Two-column caption/value row under an input (balance, USD estimate). */
export function CardFootRow({ left, right, tone }: { left: string; right: string; tone?: 'down' }) {
  return (
    <div className="flex items-center justify-between" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
      <span>{left}</span>
      <span
        className="tabular-nums"
        style={{ fontFamily: 'var(--mono)', color: tone === 'down' ? 'var(--down)' : 'var(--ink-1)' }}
      >
        {right}
      </span>
    </div>
  );
}

/** Summary strip row (also reused by the confirmation modal). */
export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3" style={{ fontSize: 11 }}>
      <span style={{ color: 'var(--ink-3)' }}>{label}</span>
      <span
        className="tabular-nums text-right"
        style={{ fontFamily: 'var(--mono)', color: 'var(--ink-1)' }}
      >
        {value}
      </span>
    </div>
  );
}

/** Direction-flip button between the Allocate and To Buy cards. */
export function FlipButton({ onFlip }: { onFlip: () => void }) {
  return (
    <div className="flex justify-center" style={{ margin: '-6px 0' }}>
      <button
        type="button"
        aria-label="Flip direction"
        title="Flip direction"
        onClick={onFlip}
        className="inline-flex items-center justify-center"
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: 'var(--tabs-bg)',
          border: '1px solid var(--hairline-2)',
          color: 'var(--ink-2)',
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1,
          zIndex: 1,
        }}
      >
        ⇅
      </button>
    </div>
  );
}

/** Compact labelled numeric input for the controls grid. */
export function MiniInput({
  label,
  value,
  onChange,
  suffix,
  width,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  suffix?: ReactNode;
  width?: number | string;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1" style={width !== undefined ? { flex: `0 0 ${typeof width === 'number' ? `${width}px` : width}` } : undefined}>
      <Caption size="sm" tone="ink-3">
        {label}
      </Caption>
      <span
        className="flex items-center gap-1"
        style={{
          padding: '5px 8px',
          borderRadius: 'var(--r-md)',
          background: 'var(--input-bg)',
          border: '1px solid var(--input-border)',
        }}
      >
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            if (!/^\d*(\.\d*)?$/.test(e.target.value)) return;
            onChange(e.target.value);
          }}
          className="min-w-0 flex-1 border-0 bg-transparent outline-none"
          style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--ink-0)' }}
        />
        {suffix ?? null}
      </span>
    </label>
  );
}

/** Native select restyled to the panel's dark chip look. */
export function MiniSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  const select = (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{
        padding: '5px 8px',
        borderRadius: 'var(--r-md)',
        background: 'var(--input-bg)',
        border: '1px solid var(--input-border)',
        color: 'var(--ink-0)',
        fontSize: 12,
        fontFamily: 'var(--mono)',
        outline: 'none',
        cursor: 'pointer',
        width: '100%',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: '#101014', color: '#e8e8ee' }}>
          {o.label}
        </option>
      ))}
    </select>
  );
  if (label === undefined) return select;
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <Caption size="sm" tone="ink-3">
        {label}
      </Caption>
      {select}
    </label>
  );
}

/**
 * Live natural-language order preview (rounded box at the bottom of the
 * form, reference-app style): "Swap 1 SOL to WIF every 10s over 10
 * rounds (10 SOL total)." Renders only when the caller has enough valid
 * inputs to phrase the sentence; key numbers go through <Hl>.
 */
export function SentencePreview({ children }: { children: ReactNode }) {
  return (
    <div
      aria-live="polite"
      style={{
        padding: '9px 12px',
        borderRadius: 'var(--r-xl)',
        border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, var(--hairline))',
        background: 'color-mix(in srgb, var(--accent-primary) 6%, var(--input-bg))',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--ink-2)',
      }}
    >
      {children}
    </div>
  );
}

/** Highlighted number/token span inside a SentencePreview sentence. */
export function Hl({ children }: { children: ReactNode }) {
  return (
    <span
      className="tabular-nums"
      style={{ color: 'var(--accent-primary)', fontWeight: 600, fontFamily: 'var(--mono)' }}
    >
      {children}
    </span>
  );
}

/**
 * Status line under the submit CTA. Blocked/failed submits render in
 * the error color — a rejected create in muted ink read as "nothing
 * happened" (the confirm modal closes and the reason vanished into a
 * gray hint).
 */
export interface StatusMessage {
  readonly text: string;
  readonly tone: 'info' | 'error';
}

export function StatusLine({ status }: { status: StatusMessage }) {
  return (
    <div style={{ fontSize: 11, color: status.tone === 'error' ? 'var(--down)' : 'var(--ink-3)' }}>
      {status.text}
    </div>
  );
}

/**
 * Human copy for a blocked `useRequireTradingReady` decision (compact
 * mirror of TradePanel's private `messageForTradingReadyDecision` —
 * kept local to avoid a TradePanel↔advanced import cycle).
 */
export function tradingReadyBlockedMessage(kind: string): string {
  switch (kind) {
    case 'trading_disconnected':
      return 'Trading connection syncing; try again in a moment.';
    case 'authorization_not_ready':
      return 'Trading authorization is not ready yet.';
    case 'loading':
      return 'Loading wallet state...';
    case 'needs_sign_in':
      return 'Sign in required.';
    default:
      return 'Wallet setup required.';
  }
}

/** Two-way segmented toggle (Price USD | Market Cap USD). */
export function BasisToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`seg__btn ${value === o.value ? 'active' : ''}`}
          style={{ fontSize: 10, padding: '3px 8px' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
