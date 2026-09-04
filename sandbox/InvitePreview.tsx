'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { InviteModal } from './InviteModal';

/**
 * The invite-code modal, mounted over the real landing page.
 *
 * `/?invite` opens it. This is the only way to judge it properly — a stage
 * on `/whatever` is a box with a fake scrim, and the real question is how
 * the sheet sits over the actual hero, at the actual scale, with the
 * page's own ground behind it. Resize the window across `lg` and the two
 * compositions swap here exactly as they will in production.
 *
 * Sandbox only, and it is NOT the production gate: `HomeAccessGate` decides
 * when the real modal opens and routes a redeemed user into /discover, and
 * none of that is here. Nothing on the landing links to this — you reach it
 * by putting `?invite` in the URL.
 */
export function InvitePreview() {
  const wanted = useSearchParams().get('invite') !== null;
  const [open, setOpen] = useState(true);

  useEffect(() => setOpen(true), [wanted]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!wanted || !open) return null;

  return (
    /* `lp` is NOT decoration here, it is load-bearing — the same note the
       export's MobileMenu carries. This overlay is a SIBLING of
       `<LandingPage/>`, which is the element that owns the `.lp` class, so
       without restating it every `--lp-*` token inside is undefined: the
       sheet's ink resolves to nothing and the whole thing renders grey on
       grey. */
    <div className="lp fixed inset-0 z-[80]">
      {/* THE SCRIM CAME BACK UP.

          It was `rgba(0,0,0,0.72)`, and the reason was sound at the time:
          a near black sheet cannot hold itself against a half dim, so the
          dim had to go deeper. The sheet is paper now and has the opposite
          problem — at 72% the page behind it is gone and the sheet reads
          as a route rather than as something over the page.

          46% with a blur behind it instead, which is the treatment the
          header bar already uses. The landing stays legible underneath,
          which is the entire reason this is a modal. */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => setOpen(false)}
        className="absolute inset-0 h-full w-full cursor-default bg-[rgba(11,14,20,0.46)] backdrop-blur-[3px]"
      />

      {/* The 12px gutter is the header bar's own, so the sheet lines up
          with the page chrome at 390 instead of picking its own inset. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center px-3">
        <div className="pointer-events-auto w-full max-w-[620px]">
          <InviteModal />
        </div>
      </div>
    </div>
  );
}
