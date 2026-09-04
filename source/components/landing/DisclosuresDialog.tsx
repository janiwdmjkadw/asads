'use client';

import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * The disclosure sheet behind the hero's "Agentic Disclosures" row.
 *
 * Translated from Paper `EBI-0` (the reference modal, authored at a 1920
 * design width: 798×528 surface, 12.5% inline / 40px block padding, a
 * 40×40 close button holding a 16×16 glyph, title 32/40, body 16/24,
 * square corners). Scaled ×0.75 for our 1440 anchor and capped at a fixed
 * 600px so the surface never tracks the viewport: 75px inline padding,
 * 30px top, title 28/36, body 16/24. Below `sm` it becomes a full-bleed
 * sheet with 24px padding.
 *
 * The surface renders through the shadcn `Dialog` portal, i.e. OUTSIDE the
 * `.lp` tree — so neither the landing palette nor the `--font-geist` alias
 * reaches it. Both are restated here: white ground, `#0B0E14` ink, and the
 * Geist family aliased off `--font-geist-sans` (which lives on `<html>`).
 * The `html:has(.lp)` root rules — 16px root, `zoom: 1` — target `<html>`
 * and so still apply to the portal.
 *
 * `children` is the trigger: the hero owns its visual (icon + label), this
 * file owns the surface.
 */
export function DisclosuresDialog({ children }: { children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        /* Radix's default open-focus lands on the first tabbable node — the
           close button — which paints its focus ring the moment the sheet
           opens by mouse. Focus the content instead (Radix gives it
           `tabIndex={-1}`): the trap and the Escape/return-focus behaviour
           are unchanged, and the ring is back to keyboard-only. */
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = event.currentTarget;
          if (content instanceof HTMLElement) content.focus({ preventScroll: true });
        }}
        className={[
          // Paper EBI-0: white surface, square corners, no border.
          'gap-0 rounded-none border-0 bg-white text-[#0B0E14] sm:rounded-none',
          '[--font-geist:var(--font-geist-sans)]',
          // < sm: the sheet is full-bleed with 24px padding.
          // ≥ sm: 600 wide (Paper 798 × 0.75) with 75/30 padding (100/40 × 0.75).
          'w-full max-w-none p-6 sm:w-full sm:max-w-[600px] sm:px-[75px] sm:pb-10 sm:pt-[30px]',
          // The stock close is a bare 16px glyph at right-4/top-4. Paper hangs
          // it in a 40×40 button (12px around the glyph) on the padding origin
          // — ×0.75 that is a 32px box whose glyph sits 30 in from both edges,
          // at full-strength ink on the white ground.
          '[&>button]:inline-flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center [&>button]:right-2 [&>button]:top-2 [&>button]:opacity-100',
          'sm:[&>button]:right-[22px] sm:[&>button]:top-[22px]',
          // The stock close's focus ring is `ring-ring` + `ring-offset-background`,
          // i.e. the terminal's cyan on a near-black offset — unreadable on white.
          // Both read `var(--ring)` / `var(--background)`, which are undefined
          // outside `.listen-root`; declaring them here re-points the ring at our
          // ink on a white offset without touching the shared primitive.
          '[--ring:#0B0E14] [--background:#FFFFFF]',
        ].join(' ')}
      >
        {/* Paper: the close occupies its own 40-tall row and the title starts
            18 below it — 30 + 14 once scaled. Mobile clears the 16px-inset
            close the same way. */}
        <div className="mt-8 sm:mt-11">
          <DialogTitle className="font-geist text-2xl font-medium leading-8 tracking-[-0.015em] text-[#0B0E14] sm:text-[28px] sm:leading-9">
            Limitations and risks apply
          </DialogTitle>
          <DialogDescription className="mt-4 font-geist text-base font-normal leading-6 tracking-[-0.015em] text-[#0B0E14] sm:mt-6">
            Listen is software — a terminal, not a broker, exchange or investment adviser. Trading
            digital assets involves substantial risk, including the loss of your entire principal;
            prices are volatile and liquidity can disappear without warning. Agentic features
            execute on the intent and conditions you set: they do not predict markets, and past
            performance of any strategy is no guarantee of future results. You remain responsible
            for every order placed from your account. Nothing on this site is financial, legal or
            tax advice.
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  );
}
