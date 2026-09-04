'use client';

import { memo, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { useHideTokenAction } from './useHiddenTokens';

/**
 * The Discover hide button: a struck-through chef hat perched on the coin
 * image's top-left corner (mirror of PumpBadge's bottom-right seat).
 * Appears on card hover; clicking hides the coin from every Discover row
 * instantly (optimistic per-user set, DB-synced) with an Undo toast for
 * mis-clicks. Hidden for signed-out visitors — there is no account to
 * remember the choice for.
 */
export const HideTokenButton = memo(function HideTokenButton({
  mint,
  ticker,
}: {
  mint: string;
  ticker: string;
}) {
  const { signedIn, hide, unhide } = useHideTokenAction();
  if (!signedIn) return null;
  return (
    <button
      type="button"
      aria-label={`Hide ${ticker} from Discover`}
      title="Hide this token from Discover"
      onClick={(e) => {
        // The whole card is a click target (role=button + a pre-hydration
        // stretched anchor) — this click must hide, never navigate.
        e.preventDefault();
        e.stopPropagation();
        hide(mint);
        toast(`${ticker} hidden from Discover`, {
          action: { label: 'Undo', onClick: () => unhide(mint) },
        });
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute z-[5] flex items-center justify-center rounded-full opacity-0 transition-opacity duration-100 group-hover/coin:opacity-100 focus-visible:opacity-100 focus:outline-none"
      style={{
        top: 0,
        left: 0,
        transform: 'translate(-35%, -35%)',
        width: 18,
        height: 18,
        background: 'var(--surface-1)',
        border: '1px solid var(--hairline)',
        color: 'var(--ink-2)',
        cursor: 'pointer',
        pointerEvents: 'auto',
      }}
    >
      <ChefHatOffIcon style={{ width: 11, height: 11 }} />
    </button>
  );
});

/** Lucide chef-hat with a diagonal strike — "hide the cook's coin". */
function ChefHatOffIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" />
      <path d="M6 17h12" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
