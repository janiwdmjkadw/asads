'use client';

import { KeyMini } from '@/components/onboarding/welcome/art/key-mini';
import { WelcomePanel } from '@/components/onboarding/welcome/WelcomePanel';
import s from '@/components/onboarding/welcome/welcome.module.css';
import { ArtFadeLoop } from '@/components/onboarding/welcome/art/ArtFadeLoop';

/**
 * Onboarding step 1, with the key artwork under one of the motion
 * treatments.
 *
 * Everything here is the export's own and matches `RecoveryStep` line for
 * line: `WelcomePanel`, its stylesheet, `ArtFadeLoop` around the `KeyMini`
 * art, and the eyebrow / headline / body strings. What is on this page is
 * what is on /welcome.
 *
 * What is not the export's: the reveal region. The real step mounts
 * `WalletExportIframe`, which talks to `export.turnkey.com` and is the one
 * part of this flow that cannot exist in a sandbox. `RecoveryStep` already
 * has a seam for it — its `exportRegion` prop, which its own dev fixture
 * uses — so the provisioning hold stands in, and the question being asked
 * does not touch it.
 */
export function WelcomeStep() {
  return (
    <>
      <WelcomePanel
        testId="welcome-step-recovery"
        eyebrow="STEP 1 OF 2 · WALLET SECURITY"
        headline="Back up your recovery key"
        headlineNarrow
        body="This is the only way to restore your wallet. Only you will ever see it."
        art={
          <ArtFadeLoop>
            <KeyMini size={140} />
          </ArtFadeLoop>
        }
      >
        <div className={s.revealRegion}>
          {/* The step's PROVISIONING HOLD, copied from RecoveryStep. It is
              the export's own no-backend state — same 52px bar, same inert
              reveal pill — so the panel keeps its real height and metrics
              without a Turnkey session and without this app ever rendering
              words it is not allowed to hold. */}
          <div className={s.holdBar}>
            <span className={s.holdStatus}>PROVISIONING YOUR VAULT…</span>
          </div>
          <button type="button" className={s.holdReveal} disabled>
            Reveal my key
          </button>
        </div>
      </WelcomePanel>

    </>
  );
}
